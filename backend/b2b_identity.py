"""B2B kimliği: bir e-posta, birden fazla tedarikçi cari.

Portal adresi çerez taşımaz; oturum kodu select_token olarak döner ve
istemci sessionStorage'da tutar. Şifre yalnız auth_utils üzerinden doğrulanır.
"""
from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from fastapi import APIRouter, HTTPException, Request

import applog
import host_audience
import password_reset
import platform_mail
from auth_utils import hash_password, verify_password
from mysql_store import DuplicateKeyError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

SESSION_MINUTES = 15
VERIFY_HOURS = 24
_LOCK_LIMIT = 5
_LOCK_MINUTES = 15

_FAIL = "Bilgiler hatalı ya da B2B erişiminiz tanımlı değil. Tedarikçinizle iletişime geçin."
_PASSIVE = "Cari hesap pasif. B2B girişi kapalı."
_CLOSED = "B2B portalı şu an kapalı."
_LINK_ONLY = "Bu portal yalnızca kişiye özel link ile açılır."
_NEED = "E-posta / VKN ve şifre gerekli."
_LOCK = "Çok fazla hatalı giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin."
_SESSION_BAD = "Geçersiz veya süresi dolmuş oturum."
_SESSION_EXPIRED = "Oturum süresi doldu. Yeniden giriş yapın."
_NOT_LINKED = "Bu cari bu oturuma bağlı değil."

_PUBLIC_KEYS = ("contact_id", "company_id", "company_name", "logo_url", "contact_name")

_db = None
_mailer: Optional[Callable] = None


def init(database=None) -> None:
    """Testler geçici bellek veritabanı bağlar. None üretimde server.db kullanır."""
    global _db
    _db = database


def set_mailer(fn: Optional[Callable]) -> None:
    """Bildirim postasını testlerde değiştirir. None platform posta kutusunu kullanır."""
    global _mailer
    _mailer = fn


def get_db():
    if _db is not None:
        return _db
    import server
    return server.db


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: Optional[datetime] = None) -> str:
    return (moment or _now()).isoformat()


def _parse_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    text = str(value or "").replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _norm_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _resolve_settings(company: dict, contact: dict) -> dict:
    import server
    return server.resolve_b2b_settings(company, contact)


def _public_link(row: dict) -> dict:
    return {key: row.get(key) or "" for key in _PUBLIC_KEYS}


def _lock_id(ip: str, ident: str) -> str:
    return f"b2b:{ip}:{ident}"


async def _locked(db, identifier: str) -> bool:
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if not attempt or attempt.get("count", 0) < _LOCK_LIMIT:
        return False
    last_attempt = attempt.get("last_attempt", _now())
    if isinstance(last_attempt, str):
        last_attempt = datetime.fromisoformat(last_attempt)
    return _now() - last_attempt < timedelta(minutes=_LOCK_MINUTES)


async def _record_failure(db, identifier: str) -> None:
    now = _iso()
    existing = await db.login_attempts.find_one({"identifier": identifier})
    if not existing:
        await db.login_attempts.insert_one({
            "_id": identifier,
            "identifier": identifier,
            "count": 1,
            "last_attempt": now,
        })
        return
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$inc": {"count": 1}, "$set": {"last_attempt": now}},
    )


async def _clear_failures(db, identifier: str) -> None:
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$set": {"count": 0, "last_attempt": _iso()}},
    )


def _fail_log(ident: str, request: Request) -> None:
    applog.log_auth(
        "b2b_login_failed", ident,
        email=ident, ip=applog.client_ip(request), user_email=ident,
    )


async def _reject_credentials(db, identifier: str, ident: str, request: Request) -> None:
    await _record_failure(db, identifier)
    _fail_log(ident, request)
    raise HTTPException(status_code=401, detail=_FAIL)


def _probe(identity: dict, password: str = "", *, matched: Optional[list] = None, capture: bool = False) -> dict:
    """Veritabanına yazılmaz. Düz şifre yalnız bu istekteki süzgeçte durur."""
    return {
        "email": _norm_email(identity.get("email")),
        "password_hash": identity.get("password_hash") or "",
        "email_verified_at": identity.get("email_verified_at"),
        "is_active": identity.get("is_active", True),
        "_password": password or "",
        "_matched_contact_ids": list(matched or []),
        "_capture": capture,
    }


def _password_ok(identity: dict, contact: dict) -> bool:
    if identity.get("email_verified_at"):
        return True
    stored = contact.get("b2b_password_hash") or ""
    plain = identity.get("_password") or ""
    if plain and stored and verify_password(str(plain), stored):
        return True
    ident_hash = identity.get("password_hash") or ""
    if stored and ident_hash and stored == ident_hash:
        return True
    cid = str(contact.get("_id") or "")
    matched = {str(item) for item in (identity.get("_matched_contact_ids") or [])}
    return bool(cid and cid in matched)


def _block_detail(meta: list) -> Optional[str]:
    blocked = [row for row in meta if row.get("password_ok") and not row.get("visible")]
    if not blocked:
        return None

    def reason(row: dict) -> Optional[str]:
        if not row.get("is_active"):
            return _PASSIVE
        if not row.get("portal_enabled"):
            return _CLOSED
        if row.get("link_only"):
            return _LINK_ONLY
        return None

    reasons = [reason(row) for row in blocked]
    reasons = [item for item in reasons if item]
    if not reasons:
        return None
    if len(blocked) == 1 or len(set(reasons)) == 1:
        return reasons[0]
    return None


async def list_supplier_links(db, identity) -> list:
    """Kimliğe bağlı tedarikçiler. Dönüşte şifre, bakiye, fiyat ve b2b_token yoktur."""
    email = _norm_email((identity or {}).get("email") if isinstance(identity, dict) else "")
    if not email or not isinstance(identity, dict):
        return []
    # tenant-ok: B2B kimliği yalnız b2b_login_email ile tedarikçi carilerini eşler; fiyat, bakiye ve token dönülmez
    rows = await db.contacts.find({"b2b_enabled": True, "b2b_login_email": email}).to_list(500)
    links = []
    meta = []
    for contact in rows:
        if _norm_email(contact.get("b2b_login_email")) != email:
            continue
        company_id = str(contact.get("company_id") or "")
        if not company_id:
            continue
        company = await db.companies.find_one({"_id": company_id}) or {}
        settings = _resolve_settings(company, contact)
        active = contact.get("is_active") is not False
        portal = bool(settings.get("enabled", True))
        link_only = settings.get("login_method") == "link"
        password_ok = _password_ok(identity, contact)
        visible = password_ok and active and portal and not link_only
        meta.append({
            "contact_id": contact.get("_id"),
            "company_id": company_id,
            "password_ok": password_ok,
            "is_active": active,
            "portal_enabled": portal,
            "link_only": link_only,
            "visible": visible,
        })
        if not visible:
            continue
        links.append({
            "contact_id": str(contact.get("_id") or ""),
            "company_id": company_id,
            "company_name": company.get("name") or "",
            "logo_url": company.get("logo_url") or "",
            "contact_name": contact.get("name") or "",
        })
    if identity.get("_capture"):
        identity["_meta"] = meta
    return links


def _row_eligible(company: dict, contact: dict) -> bool:
    if contact.get("is_active") is False:
        return False
    if not _norm_email(contact.get("b2b_login_email")):
        return False
    settings = _resolve_settings(company, contact)
    if not settings.get("enabled", True):
        return False
    if settings.get("login_method") == "link":
        return False
    return True


async def identity_for_tax_number(db, tax: str) -> Optional[dict]:
    """VKN yalnız mevcut kimliğe bağlı carilerden, tam bir kimliğe işaret ediyorsa."""
    tax = str(tax or "").strip()
    if not tax:
        return None
    companies = await db.companies.find({}, {"_id": 1, "b2b_settings": 1}).to_list(5000)
    emails = []
    for company in companies:
        company_id = str(company.get("_id") or "")
        if not company_id:
            continue
        rows = await db.contacts.find({
            "company_id": company_id,
            "tax_number_or_id": tax,
            "b2b_enabled": True,
        }).to_list(50)
        for row in rows:
            if not _row_eligible(company, row):
                continue
            emails.append(_norm_email(row.get("b2b_login_email")))
    seen = []
    found = []
    for email in emails:
        if not email or email in seen:
            continue
        seen.append(email)
        identity = await db.b2b_identities.find_one({"email": email})
        if not identity or identity.get("is_active") is False:
            return None
        found.append(identity["_id"])
    if len(set(found)) != 1:
        return None
    return await db.b2b_identities.find_one({"_id": found[0]})


async def _insert_identity(db, email: str, password_hash: str, *, verified_at: Optional[str] = None) -> dict:
    now = _iso()
    doc = {
        "_id": uuid.uuid4().hex,
        "email": email,
        "password_hash": password_hash,
        "email_verified_at": verified_at,
        "is_active": True,
        "created_at": now,
        "last_login_at": None,
    }
    try:
        await db.b2b_identities.insert_one(doc)
        return doc
    except DuplicateKeyError:
        existing = await db.b2b_identities.find_one({"email": email})
        if not existing:
            raise
        return existing


async def find_legacy_contact(db, ident: str) -> Optional[dict]:
    """Şifre sıfırlama için e-posta ile bağlı ilk cari. contacts.email ve VKN kullanılmaz."""
    email = _norm_email(ident)
    if "@" not in email:
        return None
    probe = {"email": email, "email_verified_at": "lookup", "password_hash": "x"}
    links = await list_supplier_links(db, probe)
    if not links:
        return None
    link = links[0]
    return await db.contacts.find_one({"_id": link["contact_id"], "company_id": link["company_id"]})


async def _issue_portal_token(db, link: dict) -> str:
    contact = await db.contacts.find_one({
        "_id": link["contact_id"],
        "company_id": link["company_id"],
    })
    if not contact:
        raise HTTPException(status_code=403, detail=_NOT_LINKED)
    token = contact.get("b2b_token") or uuid.uuid4().hex
    await db.contacts.update_one(
        {"_id": link["contact_id"], "company_id": link["company_id"]},
        {"$set": {"b2b_token": token, "b2b_last_login": _iso()}},
    )
    return token


async def _open_session(db, identity_id: str, contact_ids: list) -> str:
    token = secrets.token_urlsafe(32)
    moment = _now()
    await db.b2b_sessions.insert_one({
        "_id": token,
        "identity_id": identity_id,
        "expires_at": (moment + timedelta(minutes=SESSION_MINUTES)).isoformat(),
        "created_at": moment.isoformat(),
        "contact_ids": [str(item) for item in contact_ids if item],
    })
    return token


async def _load_session_identity(db, token: str) -> tuple:
    row = await _require_session(db, token)
    identity = await db.b2b_identities.find_one({"_id": row.get("identity_id")})
    if not identity or identity.get("is_active") is False:
        raise HTTPException(status_code=401, detail=_SESSION_BAD)
    return row, identity


async def _require_session(db, token: str) -> dict:
    token = str(token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail=_SESSION_BAD)
    row = await db.b2b_sessions.find_one({"_id": token})
    if not row:
        raise HTTPException(status_code=401, detail=_SESSION_BAD)
    try:
        expires_at = _parse_dt(row.get("expires_at"))
    except Exception:
        raise HTTPException(status_code=401, detail=_SESSION_BAD)
    if expires_at < _now():
        raise HTTPException(status_code=401, detail=_SESSION_EXPIRED)
    return row


def _session_token(request: Optional[Request], body: Optional[dict] = None) -> str:
    header = ""
    if request is not None:
        headers = getattr(request, "headers", None) or {}
        header = headers.get("authorization") or headers.get("Authorization") or ""
    if header.lower().startswith("b2bsession "):
        return header.split(" ", 1)[1].strip()
    if isinstance(body, dict):
        return str(body.get("select_token") or "").strip()
    return ""


async def _links_for_identity(db, identity: dict, *, password: str = "", matched: Optional[list] = None, capture: bool = False) -> tuple:
    probe = _probe(identity, password, matched=matched, capture=capture)
    links = await list_supplier_links(db, probe)
    return links, probe.get("_meta") or []


async def authenticate(db, req: dict, request: Request) -> dict:
    ident = _norm_email(req.get("email"))
    password = str(req.get("password") or "")
    if not ident or not password:
        raise HTTPException(status_code=400, detail=_NEED)
    ip = applog.client_ip(request)
    identifier = _lock_id(ip, ident)
    if await _locked(db, identifier):
        _fail_log(ident, request)
        raise HTTPException(status_code=429, detail=_LOCK)

    if "@" in ident:
        identity = await db.b2b_identities.find_one({"email": ident})
        if identity:
            if identity.get("is_active") is False or not verify_password(password, identity.get("password_hash") or ""):
                await _reject_credentials(db, identifier, ident, request)
            links, meta = await _links_for_identity(db, identity, password=password, capture=True)
        else:
            stub = {"email": ident, "password_hash": "", "email_verified_at": None}
            links, meta = await _links_for_identity(db, stub, password=password, capture=True)
            matched = [row for row in meta if row.get("password_ok")]
            if not matched:
                await _reject_credentials(db, identifier, ident, request)
            source = next((row for row in matched if row.get("visible")), matched[0])
            contact = await db.contacts.find_one({
                "_id": source["contact_id"],
                "company_id": source["company_id"],
            })
            copied = (contact or {}).get("b2b_password_hash") or ""
            if not copied:
                await _reject_credentials(db, identifier, ident, request)
            identity = await _insert_identity(db, ident, copied)
    else:
        identity = await identity_for_tax_number(db, ident)
        if not identity or identity.get("is_active") is False or not verify_password(password, identity.get("password_hash") or ""):
            await _reject_credentials(db, identifier, ident, request)
        links, meta = await _links_for_identity(db, identity, password=password, capture=True)

    await _clear_failures(db, identifier)
    if not links:
        detail = _block_detail(meta)
        if detail:
            raise HTTPException(status_code=403, detail=detail)
        _fail_log(ident, request)
        raise HTTPException(status_code=401, detail=_FAIL)

    await db.b2b_identities.update_one(
        {"_id": identity["_id"]},
        {"$set": {"last_login_at": _iso()}},
    )
    select_token = await _open_session(db, identity["_id"], [row["contact_id"] for row in links])
    body = {"suppliers": [_public_link(row) for row in links], "select_token": select_token}
    if len(links) == 1:
        portal = await _issue_portal_token(db, links[0])
        body["redirect"] = f"/portal/{portal}"
        body["token"] = portal
        body["name"] = links[0]["contact_name"]
        applog.log_auth(
            "b2b_login_success", ident,
            email=ident, user_email=ident, user_id=str(links[0]["contact_id"]),
            company_id=links[0]["company_id"], ip=ip,
        )
    else:
        applog.log_auth(
            "b2b_login_success", ident,
            email=ident, user_email=ident, user_id=str(identity.get("_id")), ip=ip,
        )
    try:
        await notify_unnotified_links(db, identity)
    except Exception as exc:
        logger.warning("b2b link notice skipped: %s", type(exc).__name__)
    return body


async def select_supplier(db, req: dict) -> dict:
    token = str((req or {}).get("select_token") or "").strip()
    contact_id = str((req or {}).get("contact_id") or "").strip()
    if not contact_id:
        raise HTTPException(status_code=400, detail="Cari seçilmedi.")
    row, identity = await _load_session_identity(db, token)
    links, _meta = await _links_for_identity(
        db, identity, matched=row.get("contact_ids") or [],
    )
    chosen = next((item for item in links if str(item.get("contact_id")) == contact_id), None)
    if not chosen:
        raise HTTPException(status_code=403, detail=_NOT_LINKED)
    portal = await _issue_portal_token(db, chosen)
    return {"redirect": f"/portal/{portal}"}


async def list_suppliers_for_session(db, request: Request) -> dict:
    token = _session_token(request)
    row, identity = await _load_session_identity(db, token)
    links, _meta = await _links_for_identity(
        db, identity, matched=row.get("contact_ids") or [],
    )
    return {"suppliers": [_public_link(item) for item in links]}


async def _auth_hashes(db, contact: dict) -> list:
    """Girişte geçerli hash'ler: kimlik önce, cari hash geri dönüş için duruyor."""
    hashes = []
    email = _norm_email((contact or {}).get("b2b_login_email"))
    if "@" in email:
        identity = await db.b2b_identities.find_one({"email": email})
        if identity and identity.get("password_hash"):
            hashes.append(identity["password_hash"])
    stored = (contact or {}).get("b2b_password_hash") or ""
    if stored and stored not in hashes:
        hashes.append(stored)
    return hashes


async def portal_current_password_error(db, contact: dict, current: str, new_plain: str) -> Optional[str]:
    """Portal şifre değişimi. Hash yoksa eski akış gibi serbest; varsa kimlik veya cari hash kabul edilir."""
    hashes = await _auth_hashes(db, contact)
    if not hashes:
        return None
    current = str(current or "")
    if not current or not any(verify_password(current, item) for item in hashes):
        return "Mevcut şifre hatalı."
    if any(verify_password(str(new_plain or ""), item) for item in hashes):
        return "Yeni şifre mevcut şifreyle aynı olamaz."
    return None


async def sync_identity_password(db, contact: dict, new_hash: str) -> None:
    """Tedarikçi veya portal yeni şifre yazdıysa kimlik şifresini aynı hash ile güncelle."""
    email = _norm_email((contact or {}).get("b2b_login_email"))
    if not email or not new_hash:
        return
    identity = await db.b2b_identities.find_one({"email": email})
    if not identity:
        return
    await db.b2b_identities.update_one(
        {"_id": identity["_id"]},
        {"$set": {"password_hash": new_hash}},
    )


async def apply_password_reset(db, contact: dict, plain_password: str) -> dict:
    """Kimlik şifresini yeniler ve e-postayı doğrulanmış sayar. Cari hash'ine dokunmaz."""
    email = _norm_email((contact or {}).get("b2b_login_email"))
    if "@" not in email:
        raise HTTPException(status_code=400, detail="B2B giriş e-postası tanımlı değil.")
    new_hash = hash_password(plain_password)
    verified = _iso()
    identity = await db.b2b_identities.find_one({"email": email})
    if identity:
        await db.b2b_identities.update_one(
            {"_id": identity["_id"]},
            {"$set": {"password_hash": new_hash, "email_verified_at": verified}},
        )
        identity["password_hash"] = new_hash
        identity["email_verified_at"] = verified
        return identity
    return await _insert_identity(db, email, new_hash, verified_at=verified)


async def _send_notice(*, to: str, subject: str, body: str, html: str, context: str, company_id: Optional[str] = None) -> bool:
    if _mailer is not None:
        try:
            result = _mailer(to=to, subject=subject, body=body, html=html, context=context, company_id=company_id)
            if hasattr(result, "__await__"):
                result = await result
            return bool(result)
        except Exception as exc:
            logger.warning("b2b notice mail skipped: %s", type(exc).__name__)
            return False
    try:
        ready = await platform_mail.begin_password_reset_delivery(context=context)
        if not ready.get("ok"):
            return False
        sent = await platform_mail.dispatch_password_reset_mail(
            ready["sender"],
            to=[to],
            subject=subject,
            body=body,
            html=html,
            context=context,
            company_id=company_id,
        )
        return bool(sent.get("ok"))
    except Exception as exc:
        logger.warning("b2b notice mail skipped: %s", type(exc).__name__)
        return False


async def consider_link_notice(db, before: dict, after: dict, upd: dict) -> None:
    """Tedarikçi cariye yeni giriş e-postası yazınca kimlik sahibine haber ver."""
    try:
        await _consider_link_notice(db, before or {}, after or {}, upd)
    except Exception as exc:
        logger.warning("b2b link notice skipped: %s", type(exc).__name__)


async def _consider_link_notice(db, before: dict, after: dict, upd: dict) -> None:
    email = _norm_email(after.get("b2b_login_email"))
    if "@" not in email:
        return
    enabled = upd["b2b_enabled"] if "b2b_enabled" in upd else before.get("b2b_enabled")
    if not enabled:
        return
    already = _norm_email(before.get("b2b_link_notified_email"))
    if already == email or _norm_email(upd.get("b2b_link_notified_email")) == email:
        return
    identity = await db.b2b_identities.find_one({"email": email})
    if not identity or identity.get("is_active") is False:
        return
    company_id = str(before.get("company_id") or after.get("company_id") or "")
    company = await db.companies.find_one({"_id": company_id}) if company_id else None
    name = (company or {}).get("name") or "Bir tedarikçi"
    sent = await _send_link_notice(identity.get("email") or email, name, company_id or None)
    if sent:
        upd["b2b_link_notified_email"] = email


async def _send_link_notice(to: str, company_name: str, company_id: Optional[str]) -> bool:
    subject = f"{company_name} B2B hesabınıza bağlandı"
    body = (
        f"Merhaba,\n{company_name} firmanın B2B portalında sizin e-posta adresinizle bir cari bağlandı.\n"
        "Bu işlemi siz istemediyseniz tedarikçinizle iletişime geçin.\n"
    )
    html = (
        f"<p>Merhaba,</p><p><strong>{company_name}</strong> firmanın B2B portalında "
        "sizin e-posta adresinizle bir cari bağlandı.</p>"
        "<p>Bu işlemi siz istemediyseniz tedarikçinizle iletişime geçin.</p>"
    )
    return await _send_notice(
        to=to, subject=subject, body=body, html=html,
        context="b2b_link_notice", company_id=company_id,
    )


async def notify_unnotified_links(db, identity: dict) -> None:
    """Kimlik oluştuktan sonra, şifresi bu caride durmayan yeni bağları haber ver."""
    email = _norm_email(identity.get("email"))
    if "@" not in email:
        return
    probe = {
        "email": email,
        "email_verified_at": identity.get("email_verified_at") or "notice",
        "password_hash": identity.get("password_hash") or "",
    }
    links = await list_supplier_links(db, probe)
    ident_hash = identity.get("password_hash") or ""
    for link in links:
        contact = await db.contacts.find_one({
            "_id": link["contact_id"],
            "company_id": link["company_id"],
        })
        if not contact:
            continue
        if _norm_email(contact.get("b2b_link_notified_email")) == email:
            continue
        if ident_hash and contact.get("b2b_password_hash") == ident_hash:
            await db.contacts.update_one(
                {"_id": link["contact_id"], "company_id": link["company_id"]},
                {"$set": {"b2b_link_notified_email": email}},
            )
            continue
        sent = await _send_link_notice(email, link.get("company_name") or "Bir tedarikçi", link.get("company_id"))
        if sent:
            await db.contacts.update_one(
                {"_id": link["contact_id"], "company_id": link["company_id"]},
                {"$set": {"b2b_link_notified_email": email}},
            )


async def start_email_verification(db, request: Request, req: Optional[dict] = None) -> dict:
    token = _session_token(request, req)
    _row, identity = await _load_session_identity(db, token)
    email = _norm_email(identity.get("email"))
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Doğrulanacak e-posta yok.")
    if identity.get("email_verified_at"):
        return {"status": "ok", "message": "E-posta zaten doğrulanmış."}
    verify_token = secrets.token_urlsafe(32)
    moment = _now()
    await db.b2b_email_verifications.insert_one({
        "_id": verify_token,
        "identity_id": identity["_id"],
        "email": email,
        "expires_at": (moment + timedelta(hours=VERIFY_HOURS)).isoformat(),
        "used_at": None,
        "created_at": moment.isoformat(),
    })
    link = f"{host_audience.public_host_url(host_audience.KIND_B2B)}/api/public/b2b/verify-email/{verify_token}"
    sent = await _send_notice(
        to=email,
        subject="B2B e-posta doğrulama",
        body=f"B2B hesabınızın e-postasını doğrulamak için bu bağlantıyı kullanın:\n{link}\n",
        html=(
            "<p>B2B hesabınızın e-postasını doğrulamak için aşağıdaki bağlantıyı kullanın.</p>"
            f"<p><a href='{link}'>E-postayı doğrula</a></p>"
        ),
        context="b2b_verify_email",
    )
    if not sent:
        await db.b2b_email_verifications.update_one(
            {"_id": verify_token},
            {"$set": {"used_at": _iso(), "revoked": True}},
        )
        return {"status": "ok", "message": "Doğrulama e-postası şu an gönderilemedi. Daha sonra tekrar deneyin."}
    return {"status": "ok", "message": "Doğrulama bağlantısı e-posta adresinize gönderildi."}


async def confirm_email_verification(db, token: str) -> dict:
    row = await db.b2b_email_verifications.find_one({"_id": str(token or "").strip()})
    if not row or row.get("used_at"):
        raise HTTPException(status_code=400, detail="Doğrulama bağlantısı geçersiz.")
    try:
        if _parse_dt(row.get("expires_at")) < _now():
            raise HTTPException(status_code=400, detail="Doğrulama bağlantısının süresi doldu.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Doğrulama bağlantısı geçersiz.")
    identity = await db.b2b_identities.find_one({"_id": row.get("identity_id")})
    if not identity or _norm_email(identity.get("email")) != _norm_email(row.get("email")):
        raise HTTPException(status_code=400, detail="Doğrulama bağlantısı geçersiz.")
    now = _iso()
    await db.b2b_identities.update_one({"_id": identity["_id"]}, {"$set": {"email_verified_at": now}})
    await db.b2b_email_verifications.update_one({"_id": row["_id"]}, {"$set": {"used_at": now}})
    return {"status": "success", "message": "E-posta doğrulandı."}


async def finish_b2b_forgot(db, ident: str, request: Request, ready: dict, out: dict, contact: Optional[dict]) -> dict:
    """Kimlik e-postasına sıfırlama gönder. Hesap yoksa out ile aynı yanıt."""
    email = _norm_email(ident)
    identity = None
    if "@" in email:
        identity = await db.b2b_identities.find_one({"email": email})
    else:
        identity = await identity_for_tax_number(db, email)
        if identity:
            email = _norm_email(identity.get("email"))
    if contact is None and "@" in email:
        contact = await find_legacy_contact(db, email)
    to = _norm_email((identity or {}).get("email") or (contact or {}).get("b2b_login_email"))
    if not contact or "@" not in to:
        return out
    token = secrets.token_urlsafe(32)
    now = _now()
    await db.b2b_password_resets.update_many(
        {"contact_id": contact["_id"], "used_at": None},
        {"$set": {"used_at": now.isoformat(), "revoked": True}},
    )
    await db.b2b_password_resets.insert_one({
        "_id": token,
        "contact_id": contact["_id"],
        "company_id": contact["company_id"],
        "email": to,
        "identity_id": (identity or {}).get("_id"),
        "expires_at": (now + timedelta(hours=1)).isoformat(),
        "used_at": None,
        "created_at": now.isoformat(),
    })
    import public_url as pu
    link = await pu.public_link(db, f"/b2b/sifre/{token}", context="b2b", request=request)
    company = await db.companies.find_one({"_id": contact["company_id"]}) or {}
    mail_status, mail_detail = "failed", "Gönderilemedi."
    try:
        subject = f"{company.get('name') or 'Tedarikçiniz'} B2B şifre sıfırlama"
        who = contact.get("name") or ""
        body = (
            f"Merhaba {who},\nB2B portal şifrenizi sıfırlamak için bu bağlantıyı 1 saat içinde kullanın:\n{link}\n"
            "Bu isteği siz yapmadıysanız bu e-postayı yok sayın."
        )
        html = (
            f"<p>Merhaba {who},</p><p>B2B portal şifrenizi sıfırlamak için aşağıdaki düğmeye tıklayın. "
            f"Bağlantı 1 saat geçerlidir.</p><p><a href='{link}' "
            "style='background:#059669;color:#fff;padding:10px 18px;border-radius:8px;"
            "text-decoration:none;font-weight:bold'>Şifreyi Sıfırla</a></p>"
        )
        sent = await platform_mail.dispatch_password_reset_mail(
            ready["sender"],
            to=[to],
            subject=subject,
            body=body,
            html=html,
            context="b2b_reset",
            company_id=contact.get("company_id"),
        )
        if not sent.get("ok"):
            raise HTTPException(status_code=424, detail=str(sent.get("error") or "Gönderilemedi.")[:140])
        mail_status, mail_detail = "sent", f"{to} adresine gönderildi."
    except HTTPException as exc:
        mail_status, mail_detail = "failed", str(exc.detail)[:140]
    except Exception as exc:
        mail_status, mail_detail = "failed", str(exc)[:140]
    if mail_status != "sent":
        await db.b2b_password_resets.update_one(
            {"_id": token},
            {"$set": {"used_at": now.isoformat(), "revoked": True, "mail_failed": True, "mail_error": mail_detail[:200]}},
        )
        logger.warning("b2b forgot-password mail %s to=%s", mail_status, to)
    return password_reset.finalize_forgot_mail_result(
        out,
        mail_status=mail_status,
        mail_detail=mail_detail,
    )


@router.post("/public/b2b/login")
async def b2b_login(req: dict, request: Request):
    return await authenticate(get_db(), req or {}, request)


@router.post("/public/b2b/select-supplier")
async def b2b_select_supplier(req: dict):
    return await select_supplier(get_db(), req or {})


@router.get("/public/b2b/suppliers")
async def b2b_suppliers(request: Request):
    return await list_suppliers_for_session(get_db(), request)


@router.post("/public/b2b/verify-email/start")
async def b2b_verify_email_start(request: Request):
    body: dict = {}
    try:
        parsed = await request.json()
        if isinstance(parsed, dict):
            body = parsed
    except Exception:
        body = {}
    return await start_email_verification(get_db(), request, body)


@router.get("/public/b2b/verify-email/{token}")
async def b2b_verify_email_get(token: str):
    return await confirm_email_verification(get_db(), token)


@router.post("/public/b2b/verify-email/{token}")
async def b2b_verify_email_post(token: str):
    return await confirm_email_verification(get_db(), token)
