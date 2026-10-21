"""B2B kimliği: bir e-posta, birden fazla tedarikçi cari.

Portal adresi çerez taşımaz; oturum kodu select_token olarak döner ve
istemci sessionStorage'da tutar. Veritabanında yalnız SHA-256 özeti durur.
Şifre yalnız auth_utils üzerinden doğrulanır. Tedarikçi cari yazımı kimlik
şifresine dokunmaz. Bildirim postası notify_outbox kuyruğuna yazılır.
"""
from __future__ import annotations

import hashlib
import html
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request

import applog
import host_audience
import password_reset
from auth_utils import hash_password, verify_password
from mysql_store import DuplicateKeyError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

SESSION_MINUTES = 15
VERIFY_HOURS = 24
ACCEPT_HOURS = 72
_LOCK_LIMIT = 5
_LOCK_MINUTES = 15
_NOTICE_DAILY_PER_RECIPIENT = 5
_NOTICE_DAILY_PER_COMPANY = 20
_NOTICE_SUBJECT = "B2B hesabınıza bir tedarikçi bağlanmak istiyor"

_FAIL = "Bilgiler hatalı ya da B2B erişiminiz tanımlı değil. Tedarikçinizle iletişime geçin."
_PASSIVE = "Cari hesap pasif. B2B girişi kapalı."
_CLOSED = "B2B portalı şu an kapalı."
_LINK_ONLY = "Bu portal yalnızca kişiye özel link ile açılır."
_NEED = "E-posta / VKN ve şifre gerekli."
_LOCK = "Çok fazla hatalı giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin."
_VERIFY_LOCK = "Çok fazla doğrulama isteği. Lütfen 15 dakika sonra tekrar deneyin."
_SESSION_BAD = "Geçersiz veya süresi dolmuş oturum."
_SESSION_EXPIRED = "Oturum süresi doldu. Yeniden giriş yapın."
_NOT_LINKED = "Bu cari bu oturuma bağlı değil."

_PUBLIC_KEYS = ("contact_id", "company_id", "company_name", "logo_url", "contact_name")
_DIRECT_EVENTS = ("b2b_link_notice", "b2b_verify_email", "b2b_password_reset")

# Bilinmeyen hesapta gerçek bcrypt süresi. Düz metin bir sır değildir.
_DUMMY_HASH = hash_password("b2b-unknown-account-timing")

_db = None


def init(database=None) -> None:
    """Testler geçici bellek veritabanı bağlar. None üretimde server.db kullanır."""
    global _db
    _db = database


def set_mailer(fn=None) -> None:
    """Eski test kancası. Posta artık kuyruğa yazılır; SMTP burada çağrılmaz."""
    _ = fn


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


def _sha256(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def token_digest(token: str) -> str:
    """URL'deki ham token'ın SHA-256 özeti. Veritabanında yalnız bu durur."""
    return _sha256(str(token or "").strip())


def _esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def _log_ref(ident: str) -> str:
    """Log ve kilit anahtarında ham e-posta veya VKN tutulmaz."""
    kind = "email" if "@" in ident else "tax"
    return f"b2b:{kind}:{_sha256(ident)[:16]}"


def _resolve_settings(company: dict, contact: dict) -> dict:
    import server
    return server.resolve_b2b_settings(company, contact)


def _public_link(row: dict) -> dict:
    return {key: row.get(key) or "" for key in _PUBLIC_KEYS}


def _ip_lock_id(ip: str, ident: str) -> str:
    return f"b2b:ip:{ip}:{_sha256(ident)}"


def _acct_lock_id(ident: str) -> str:
    return f"b2b:acct:{_sha256(ident)}"


def _verify_ip_id(ip: str, email: str) -> str:
    return f"b2b:verify:ip:{ip}:{_sha256(email)}"


def _verify_acct_id(email: str) -> str:
    return f"b2b:verify:acct:{_sha256(email)}"


async def _locked(db, identifier: str) -> bool:
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if not attempt or attempt.get("count", 0) < _LOCK_LIMIT:
        return False
    last_attempt = attempt.get("last_attempt", _now())
    if isinstance(last_attempt, str):
        last_attempt = datetime.fromisoformat(last_attempt)
    if getattr(last_attempt, "tzinfo", None) is None:
        last_attempt = last_attempt.replace(tzinfo=timezone.utc)
    return _now() - last_attempt < timedelta(minutes=_LOCK_MINUTES)


async def _bump_failure(db, identifier: str) -> None:
    """Atomik sayaç. Çakışan upsert 500 döndürmez. Bellek deposu upsert yazmıyorsa ekler."""
    now = _iso()
    update = {"$inc": {"count": 1}, "$set": {"last_attempt": now, "identifier": identifier}}
    try:
        result = await db.login_attempts.update_one({"identifier": identifier}, update, upsert=True)
    except DuplicateKeyError:
        try:
            await db.login_attempts.update_one({"identifier": identifier}, update)
        except DuplicateKeyError:
            return
        return
    if getattr(result, "matched_count", 0) or getattr(result, "upserted_id", None) or getattr(result, "modified_count", 0):
        return
    try:
        await db.login_attempts.insert_one({
            "_id": identifier,
            "identifier": identifier,
            "count": 1,
            "last_attempt": now,
        })
    except DuplicateKeyError:
        try:
            await db.login_attempts.update_one({"identifier": identifier}, update)
        except DuplicateKeyError:
            return


async def _record_failure(db, ip_id: str, acct_id: str) -> None:
    await _bump_failure(db, ip_id)
    await _bump_failure(db, acct_id)


async def _clear_failures(db, ip_id: str, acct_id: str) -> None:
    for identifier in (ip_id, acct_id):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$set": {"count": 0, "last_attempt": _iso()}},
        )


def _fail_log(ident: str, request: Request) -> None:
    applog.log_auth("b2b_login_failed", _log_ref(ident), ip=applog.client_ip(request))


def _ok_log(ident: str, request: Request, *, user_id: str, company_id: str = "") -> None:
    applog.log_auth(
        "b2b_login_success", _log_ref(ident),
        ip=applog.client_ip(request), user_id=user_id, company_id=company_id or None,
    )


async def _reject_credentials(db, ip_id: str, acct_id: str, ident: str, request: Request) -> None:
    await _record_failure(db, ip_id, acct_id)
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


def _contact_password_matches(password: str, contact: dict) -> bool:
    stored = contact.get("b2b_password_hash") or ""
    if not password or not stored:
        return False
    return verify_password(str(password), stored)


def _link_allowed(identity: dict, contact: dict, *, accepted: bool) -> bool:
    """Doğrulanmış kimlik yalnız kabul edilmiş bağı görür.

    Doğrulanmamış oturum, şifresi tutan cariyi bu istekte gösterebilir.
    Bu eşleşme kabul değildir. Doğrulama sonrası eski oturum kabul
    edilmemiş cariyi taşımaz.
    """
    verified = bool(identity.get("email_verified_at"))
    pw = _contact_password_matches(str(identity.get("_password") or ""), contact)
    cid = str(contact.get("_id") or "")
    sess = cid in {str(item) for item in (identity.get("_matched_contact_ids") or [])}
    if verified:
        return accepted or pw
    return pw or sess


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


async def _accepted_contact_ids(db, email: str) -> set:
    rows = await db.b2b_link_acceptances.find({"email": email}).to_list(500)
    found = set()
    for row in rows:
        if not row.get("accepted_at"):
            continue
        found.add(f"{row.get('company_id')}:{row.get('contact_id')}")
    return found


def _accept_key(email: str, company_id: str, contact_id: str) -> str:
    return _sha256(f"{email}|{company_id}|{contact_id}")


async def _mark_accepted(db, email: str, contact: dict) -> None:
    email = _norm_email(email)
    contact_id = str((contact or {}).get("_id") or (contact or {}).get("contact_id") or "")
    company_id = str((contact or {}).get("company_id") or "")
    if "@" not in email or not contact_id or not company_id:
        return
    now = _iso()
    key = _accept_key(email, company_id, contact_id)
    existing = await db.b2b_link_acceptances.find_one({"_id": key})
    if existing:
        if not existing.get("accepted_at"):
            await db.b2b_link_acceptances.update_one({"_id": key}, {"$set": {"accepted_at": now}})
        return
    await db.b2b_link_acceptances.insert_one({
        "_id": key,
        "email": email,
        "contact_id": contact_id,
        "company_id": company_id,
        "accepted_at": now,
        "created_at": now,
        "token_hash": None,
    })


async def _contacts_for_login_email(db, email: str) -> list:
    # tenant-ok: B2B kimliği yalnız b2b_login_email ile tedarikçi carilerini eşler; fiyat, bakiye ve token dönülmez
    rows = await db.contacts.find({"b2b_enabled": True, "b2b_login_email": email}).to_list(500)
    return [
        row for row in rows
        if _norm_email(row.get("b2b_login_email")) == email and row.get("company_id")
    ]


async def _legacy_email_contacts(db, email: str) -> list:
    # tenant-ok: ana dalda yalnız contacts.email ile giren cari; kimlik bağı b2b_login_email ile kurulmaz
    rows = await db.contacts.find({
        "b2b_enabled": True,
        "email": {"$regex": f"^{re.escape(email)}$", "$options": "i"},
    }).to_list(200)
    found = []
    for row in rows:
        if _norm_email(row.get("email")) != email or not row.get("company_id"):
            continue
        if _norm_email(row.get("b2b_login_email")) == email:
            continue
        found.append(row)
    return found


async def _contacts_for_tax(db, tax: str) -> list:
    # tenant-ok: VKN girişi contacts.tax_number_or_id indeksiyle tek sorguda okunur
    rows = await db.contacts.find({"b2b_enabled": True, "tax_number_or_id": tax}).to_list(200)
    return [
        row for row in rows
        if str(row.get("tax_number_or_id") or "").strip() == tax and row.get("company_id")
    ]


async def list_supplier_links(db, identity) -> list:
    """Kimliğe bağlı tedarikçiler. Dönüşte şifre, bakiye, fiyat ve b2b_token yoktur."""
    email = _norm_email((identity or {}).get("email") if isinstance(identity, dict) else "")
    if not email or not isinstance(identity, dict):
        return []
    rows = await _contacts_for_login_email(db, email)
    accepted = await _accepted_contact_ids(db, email)
    links = []
    meta = []
    for contact in rows:
        built = await _describe_contact(db, identity, contact, accepted)
        meta.append(built["meta"])
        if built["link"]:
            links.append(built["link"])
    if identity.get("_capture"):
        identity["_meta"] = meta
    return links


async def _describe_contact(db, identity: dict, contact: dict, accepted: set) -> dict:
    company_id = str(contact.get("company_id") or "")
    company = await db.companies.find_one({"_id": company_id}) or {}
    settings = _resolve_settings(company, contact)
    active = contact.get("is_active") is not False
    portal = bool(settings.get("enabled", True))
    link_only = settings.get("login_method") == "link"
    cid = str(contact.get("_id") or "")
    key = f"{company_id}:{cid}"
    allowed = _link_allowed(identity, contact, accepted=key in accepted)
    visible = allowed and active and portal and not link_only
    pw = _contact_password_matches(str(identity.get("_password") or ""), contact)
    meta = {
        "contact_id": contact.get("_id"),
        "company_id": company_id,
        "password_ok": allowed,
        "password_match": pw,
        "is_active": active,
        "portal_enabled": portal,
        "link_only": link_only,
        "visible": visible,
    }
    link = None
    if visible:
        link = {
            "contact_id": cid,
            "company_id": company_id,
            "company_name": company.get("name") or "",
            "logo_url": company.get("logo_url") or "",
            "contact_name": contact.get("name") or "",
        }
    return {"meta": meta, "link": link}


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
    """VKN tek indeksli sorgu. Bağlı cariler tam bir kimliğe işaret etmiyorsa None."""
    tax = str(tax or "").strip()
    if not tax:
        return None
    rows = await _contacts_for_tax(db, tax)
    emails = []
    for row in rows:
        company = await db.companies.find_one({"_id": row.get("company_id")}) or {}
        if not _row_eligible(company, row):
            continue
        email = _norm_email(row.get("b2b_login_email"))
        if email and email not in emails:
            emails.append(email)
    found = []
    for email in emails:
        identity = await db.b2b_identities.find_one({"email": email})
        if not identity or identity.get("is_active") is False:
            return None
        found.append(identity)
    ids = {row["_id"] for row in found}
    if len(ids) != 1:
        return None
    return found[0]


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
    """Şifre sıfırlama carisi. b2b_login_email veya ana daldaki contacts.email."""
    email = _norm_email(ident)
    if "@" in email:
        primary = await _contacts_for_login_email(db, email)
        legacy = await _legacy_email_contacts(db, email)
        rows = primary + legacy
    else:
        rows = await _contacts_for_tax(db, str(ident or "").strip())
        if len(rows) != 1:
            return None
    for row in rows:
        if row.get("b2b_password_hash"):
            return await db.contacts.find_one({"_id": row["_id"], "company_id": row["company_id"]})
    if rows and "@" in email:
        row = rows[0]
        return await db.contacts.find_one({"_id": row["_id"], "company_id": row["company_id"]})
    return None


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


async def _open_session(db, identity_id: str, email: str, contact_ids: list) -> str:
    raw = secrets.token_urlsafe(32)
    moment = _now()
    await db.b2b_sessions.insert_one({
        "_id": _sha256(raw),
        "identity_id": str(identity_id or ""),
        "email": _norm_email(email),
        "expires_at": (moment + timedelta(minutes=SESSION_MINUTES)).isoformat(),
        "created_at": moment.isoformat(),
        "contact_ids": [str(item) for item in contact_ids if item],
    })
    return raw


async def _drop_one_session(db, token: str) -> None:
    """Verilen select_token satırını hash ile siler. Ham token loglanmaz, yazılmaz."""
    raw = str(token or "").strip()
    if not raw:
        return
    digest = _sha256(raw)
    coll = db.b2b_sessions
    delete_one = getattr(coll, "delete_one", None)
    if delete_one is not None:
        await delete_one({"_id": digest})
        return
    docs = getattr(coll, "docs", None)
    if isinstance(docs, list):
        coll.docs = [row for row in docs if str(row.get("_id") or "") != digest]


async def _drop_sessions(db, *, identity_id: str = "", email: str = "") -> None:
    coll = db.b2b_sessions
    identity_id = str(identity_id or "")
    email = _norm_email(email)
    delete_many = getattr(coll, "delete_many", None)
    if delete_many is not None:
        if identity_id:
            await delete_many({"identity_id": identity_id})
        if email:
            await delete_many({"email": email})
        return
    docs = getattr(coll, "docs", None)
    if not isinstance(docs, list):
        return

    def keep(row: dict) -> bool:
        if identity_id and str(row.get("identity_id") or "") == identity_id:
            return False
        if email and _norm_email(row.get("email")) == email:
            return False
        return True

    coll.docs = [row for row in docs if keep(row)]


async def _load_session_identity(db, token: str) -> tuple:
    row = await _require_session(db, token)
    identity_id = str(row.get("identity_id") or "")
    if identity_id:
        identity = await db.b2b_identities.find_one({"_id": identity_id})
        if not identity or identity.get("is_active") is False:
            raise HTTPException(status_code=401, detail=_SESSION_BAD)
        return row, identity
    email = _norm_email(row.get("email"))
    if "@" not in email:
        raise HTTPException(status_code=401, detail=_SESSION_BAD)
    return row, {
        "email": email,
        "password_hash": "",
        "email_verified_at": None,
        "is_active": True,
        "_id": "",
    }


async def _require_session(db, token: str) -> dict:
    token = str(token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail=_SESSION_BAD)
    row = await db.b2b_sessions.find_one({"_id": _sha256(token)})
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


async def _legacy_links(db, email: str, password: str, *, verified: bool, matched: Optional[list] = None) -> tuple:
    rows = await _legacy_email_contacts(db, email)
    if not rows:
        return [], []
    accepted = await _accepted_contact_ids(db, email)
    probe = _probe(
        {"email": email, "email_verified_at": _iso() if verified else None, "password_hash": ""},
        password,
        matched=matched,
        capture=True,
    )
    links = []
    meta = []
    for contact in rows:
        built = await _describe_contact(db, probe, contact, accepted)
        meta.append(built["meta"])
        if built["link"]:
            links.append(built["link"])
    return links, meta


def _burn_unknown(password: str) -> None:
    verify_password(password, _DUMMY_HASH)


async def _accept_matches(db, email: str, meta: list, *, identity_password_ok: bool) -> None:
    """Kabul yalnız kimlik şifresi doğrulanmışsa yazılır.

    Tedarikçinin seçtiği cari şifresinin eşleşmesi kabul sayılmaz.
    """
    if not identity_password_ok:
        return
    for row in meta:
        if not row.get("password_match"):
            continue
        await _mark_accepted(db, email, {"_id": row.get("contact_id"), "company_id": row.get("company_id")})


async def authenticate(db, req: dict, request: Request) -> dict:
    ident = _norm_email(req.get("email"))
    password = str(req.get("password") or "")
    if not ident or not password:
        raise HTTPException(status_code=400, detail=_NEED)
    ip = applog.client_ip(request)
    ip_id = _ip_lock_id(ip, ident)
    acct_id = _acct_lock_id(ident)
    if await _locked(db, ip_id) or await _locked(db, acct_id):
        _fail_log(ident, request)
        raise HTTPException(status_code=429, detail=_LOCK)

    verified = False
    if "@" in ident:
        identity = await db.b2b_identities.find_one({"email": ident})
        if identity and identity.get("is_active") is False:
            await _reject_credentials(db, ip_id, acct_id, ident, request)
        verified = bool(identity and identity.get("email_verified_at"))
        identity_ok = bool(identity and verify_password(password, identity.get("password_hash") or ""))
        login_email_contacts = await _contacts_for_login_email(db, ident)
        if verified and not identity_ok and not login_email_contacts:
            links, meta = await _legacy_links(db, ident, password, verified=False)
            if not links:
                detail = _block_detail(meta)
                if detail:
                    raise HTTPException(status_code=403, detail=detail)
                await _reject_credentials(db, ip_id, acct_id, ident, request)
            return await _finish_login(
                db, request, ident, identity=None, email=ident, links=links,
                ip_id=ip_id, acct_id=acct_id,
            )
        if verified and not identity_ok:
            await _reject_credentials(db, ip_id, acct_id, ident, request)
        if not identity and not identity_ok:
            probe_identity = {"email": ident, "email_verified_at": None, "password_hash": ""}
        else:
            probe_identity = identity or {"email": ident, "email_verified_at": None, "password_hash": ""}
        if not verified:
            probe_identity = {**probe_identity, "email_verified_at": None}
        links, meta = await _links_for_identity(db, probe_identity, password=password, capture=True)
        if not login_email_contacts:
            legacy_links, legacy_meta = await _legacy_links(
                db, ident, password, verified=verified and identity_ok,
            )
            links = links + legacy_links
            meta = meta + legacy_meta
        if not links:
            detail = _block_detail(meta)
            if detail:
                raise HTTPException(status_code=403, detail=detail)
            if identity_ok or any(row.get("password_match") for row in meta):
                _fail_log(ident, request)
                raise HTTPException(status_code=401, detail=_FAIL)
            if not await _contacts_for_login_email(db, ident) and not await _legacy_email_contacts(db, ident):
                _burn_unknown(password)
            await _reject_credentials(db, ip_id, acct_id, ident, request)
        await _accept_matches(db, ident, meta, identity_password_ok=bool(identity_ok))
        bound = identity if identity_ok else None
        return await _finish_login(
            db, request, ident, identity=bound, email=ident, links=links,
            ip_id=ip_id, acct_id=acct_id,
        )

    identity = await identity_for_tax_number(db, ident)
    if not identity or identity.get("is_active") is False:
        _burn_unknown(password)
        await _reject_credentials(db, ip_id, acct_id, ident, request)
    if not verify_password(password, identity.get("password_hash") or ""):
        await _reject_credentials(db, ip_id, acct_id, ident, request)
    links, meta = await _links_for_identity(db, identity, password=password, capture=True)
    if not links:
        detail = _block_detail(meta)
        if detail:
            raise HTTPException(status_code=403, detail=detail)
        _fail_log(ident, request)
        raise HTTPException(status_code=401, detail=_FAIL)
    await _accept_matches(db, identity.get("email"), meta, identity_password_ok=True)
    return await _finish_login(
        db, request, ident, identity=identity, email=identity.get("email") or "",
        links=links, ip_id=ip_id, acct_id=acct_id,
    )


async def _finish_login(db, request, ident, *, identity, email, links, ip_id, acct_id) -> dict:
    await _clear_failures(db, ip_id, acct_id)
    if identity and identity.get("_id"):
        await db.b2b_identities.update_one(
            {"_id": identity["_id"]},
            {"$set": {"last_login_at": _iso()}},
        )
    select_token = await _open_session(
        db, (identity or {}).get("_id") or "", email, [row["contact_id"] for row in links],
    )
    body = {"suppliers": [_public_link(row) for row in links], "select_token": select_token}
    if len(links) == 1:
        portal = await _issue_portal_token(db, links[0])
        body["redirect"] = f"/portal/{portal}"
        body["token"] = portal
        body["name"] = links[0]["contact_name"]
        _ok_log(ident, request, user_id=str(links[0]["contact_id"]), company_id=links[0]["company_id"])
    else:
        _ok_log(ident, request, user_id=str((identity or {}).get("_id") or ""))
    if identity and identity.get("_id"):
        try:
            await notify_unnotified_links(db, identity)
        except Exception as exc:
            logger.warning("b2b link notice skipped: %s", type(exc).__name__)
    return body


def _session_has_identity(row: dict) -> bool:
    return bool(str((row or {}).get("identity_id") or ""))


async def _stored_contact_links(db, row: dict) -> list:
    """Kimliğe bağlı olmayan oturum. Liste kimlikten yeniden hesaplanmaz."""
    ids = [str(item) for item in (row.get("contact_ids") or []) if item]
    if not ids:
        return []
    # tenant-ok: B2B oturumu yalnız girişte saklanan cari id'lerini okur
    found = await db.contacts.find({"_id": {"$in": ids}}).to_list(len(ids) + 5)
    order = {cid: index for index, cid in enumerate(ids)}
    found = [item for item in found if str(item.get("_id")) in order]
    found.sort(key=lambda item: order[str(item.get("_id"))])
    probe = _probe(
        {"email": _norm_email(row.get("email")), "email_verified_at": None, "password_hash": ""},
        matched=ids,
    )
    links = []
    for contact in found:
        built = await _describe_contact(db, probe, contact, set())
        if built["link"]:
            links.append(built["link"])
    return links


async def _links_for_session(db, row: dict, identity: dict) -> list:
    if not _session_has_identity(row):
        return await _stored_contact_links(db, row)
    links, _meta = await _links_for_identity(db, identity, matched=row.get("contact_ids") or [])
    legacy, _legacy_meta = await _legacy_links(
        db, _norm_email(identity.get("email")), "",
        verified=bool(identity.get("email_verified_at")),
        matched=row.get("contact_ids") or [],
    )
    return links + [item for item in legacy if item["contact_id"] not in {row["contact_id"] for row in links}]


async def select_supplier(db, req: dict) -> dict:
    token = str((req or {}).get("select_token") or "").strip()
    contact_id = str((req or {}).get("contact_id") or "").strip()
    if not contact_id:
        raise HTTPException(status_code=400, detail="Cari seçilmedi.")
    row, identity = await _load_session_identity(db, token)
    links = await _links_for_session(db, row, identity)
    chosen = next((item for item in links if str(item.get("contact_id")) == contact_id), None)
    if not chosen:
        raise HTTPException(status_code=403, detail=_NOT_LINKED)
    portal = await _issue_portal_token(db, chosen)
    return {"redirect": f"/portal/{portal}"}


async def list_suppliers_for_session(db, request: Request) -> dict:
    token = _session_token(request)
    row, identity = await _load_session_identity(db, token)
    links = await _links_for_session(db, row, identity)
    return {"suppliers": [_public_link(item) for item in links]}


async def logout_session(db, request: Request, body: Optional[dict] = None) -> dict:
    """Seçim oturumunu kapatır. Token yoksa veya geçersizse de aynı yanıt; başka kayda dokunmaz."""
    token = _session_token(request, body if isinstance(body, dict) else None)
    try:
        await _drop_one_session(db, token)
    except Exception as exc:
        logger.warning("b2b logout failed: %s", type(exc).__name__)
    return {"status": "success"}


async def _auth_hashes(db, contact: dict) -> list:
    """Portal şifre değişiminde mevcut şifre: kimlik veya bu carinin kendi hash'i."""
    hashes = []
    email = _norm_email((contact or {}).get("b2b_login_email") or (contact or {}).get("email"))
    if "@" in email:
        identity = await db.b2b_identities.find_one({"email": email})
        if identity and identity.get("password_hash"):
            hashes.append(identity["password_hash"])
    stored = (contact or {}).get("b2b_password_hash") or ""
    if stored and stored not in hashes:
        hashes.append(stored)
    return hashes


async def portal_current_password_error(db, contact: dict, current: str, new_plain: str) -> Optional[str]:
    """Portal şifre değişimi. Hash yoksa eski akış gibi serbest."""
    hashes = await _auth_hashes(db, contact)
    if not hashes:
        return None
    current = str(current or "")
    if not current or not any(verify_password(current, item) for item in hashes):
        return "Mevcut şifre hatalı."
    if any(verify_password(str(new_plain or ""), item) for item in hashes):
        return "Yeni şifre mevcut şifreyle aynı olamaz."
    return None


async def change_own_password(db, contact: dict, new_hash: str, *, current_plain: str = "") -> Optional[dict]:
    """Portal şifre değişimi. Kimlik hash'i yalnız mevcut şifre kimlik hash'ine uyarsa yazılır.

    Kimlik yoksa bu yoldan oluşturulmaz. password_hash boşsa, cari daha önce
    kendi şifresiyle doğrulanmış tek kayıt olsa bile kimliğe yazılmaz.
    _mark_accepted yalnız kimlik şifresi doğrulanınca çağrılır. Diğer durumda
    çağıran yalnız cari hash'ini değiştirmiş olur.
    """
    email = _norm_email((contact or {}).get("b2b_login_email") or (contact or {}).get("email"))
    if "@" not in email or not new_hash:
        return None
    identity = await db.b2b_identities.find_one({"email": email})
    stored = str((identity or {}).get("password_hash") or "")
    if not identity or not stored or not verify_password(str(current_plain or ""), stored):
        return identity
    await db.b2b_identities.update_one(
        {"_id": identity["_id"]},
        {"$set": {"password_hash": new_hash}},
    )
    identity["password_hash"] = new_hash
    await _drop_sessions(db, identity_id=identity.get("_id") or "", email=email)
    await _mark_accepted(db, email, contact)
    return identity


async def apply_password_reset(db, contact: dict, plain_password: str, *, email: Optional[str] = None) -> dict:
    """Kimlik şifresini yeniler, e-postayı doğrular, oturumları siler. Cari hash'ine dokunmaz."""
    target = _norm_email(email or (contact or {}).get("b2b_login_email") or (contact or {}).get("email"))
    if "@" not in target:
        raise HTTPException(status_code=400, detail="B2B giriş e-postası tanımlı değil.")
    new_hash = hash_password(plain_password)
    verified = _iso()
    identity = await db.b2b_identities.find_one({"email": target})
    if identity:
        await db.b2b_identities.update_one(
            {"_id": identity["_id"]},
            {"$set": {"password_hash": new_hash, "email_verified_at": verified}},
        )
        identity["password_hash"] = new_hash
        identity["email_verified_at"] = verified
    else:
        identity = await _insert_identity(db, target, new_hash, verified_at=verified)
    await _drop_sessions(db, identity_id=identity.get("_id") or "", email=target)
    await _mark_accepted(db, target, contact)
    return identity


async def _enqueue_customer_mail(db, *, company_id: str, event: str, to: str, subject: str, text: str, html_body: str) -> bool:
    """notify_outbox satırı. SMTP çağırmaz."""
    recipient = _norm_email(to)
    if event not in _DIRECT_EVENTS or "@" not in recipient:
        return False
    cid = str(company_id or "").strip() or "platform"
    now = _iso()
    await db.notify_outbox.insert_one({
        "_id": uuid.uuid4().hex,
        "company_id": cid,
        "event": event,
        "direct_to": True,
        "channels": {"email": True, "sms": False},
        "digest": "instant",
        "status": "pending",
        "attempts": 0,
        "to": [recipient],
        "subject": str(subject or "")[:300],
        "text": str(text or ""),
        "html": str(html_body or ""),
        "due_at": now,
        "created_at": now,
    })
    return True


async def consider_link_notice(db, before: dict, after: dict, upd: dict) -> None:
    """Tedarikçi yeni giriş e-postası yazınca onay postasını kuyruğa alır."""
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
    contact_id = str(before.get("_id") or after.get("_id") or "")
    if not company_id or not contact_id:
        return
    key = _accept_key(email, company_id, contact_id)
    existing = await db.b2b_link_acceptances.find_one({"_id": key})
    if existing and existing.get("accepted_at"):
        upd["b2b_link_notified_email"] = email
        return
    raw = await _issue_accept_token(db, email=email, contact_id=contact_id, company_id=company_id, existing=existing)
    if not raw:
        return
    company = await db.companies.find_one({"_id": company_id}) if company_id else None
    queued = await _send_link_notice(
        db,
        to=identity.get("email") or email,
        company_name=(company or {}).get("name") or "Bir tedarikçi",
        contact_name=after.get("name") or before.get("name") or "",
        company_id=company_id,
        token=raw,
    )
    if queued:
        upd["b2b_link_notified_email"] = email


def _day_start_iso() -> str:
    moment = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    return moment.isoformat()


async def _notice_over_daily_cap(db, *, recipient: str, company_id: str) -> bool:
    """Bağ bildirimi: alıcı ve şirket başına UTC gün tavanı."""
    start = _day_start_iso()
    cid = str(company_id or "").strip() or "platform"
    company_n = await db.notify_outbox.count_documents({
        "company_id": cid,
        "event": "b2b_link_notice",
        "created_at": {"$gte": start},
    })
    if company_n >= _NOTICE_DAILY_PER_COMPANY:
        return True
    # tenant-ok: bağ bildirimi alıcı başına günlük tavan, e-posta firmalar arasında sayılır
    recipient_n = await db.notify_outbox.count_documents({"event": "b2b_link_notice", "to": recipient, "created_at": {"$gte": start}})
    return recipient_n >= _NOTICE_DAILY_PER_RECIPIENT


def _accept_token_fields(email: str, contact_id: str, company_id: str, raw: str) -> dict:
    return {
        "token_hash": token_digest(raw),
        "email": email,
        "contact_id": contact_id,
        "company_id": company_id,
        "expires_at": _iso(_now() + timedelta(hours=ACCEPT_HOURS)),
        "token_used_at": None,
    }


async def _issue_accept_token(db, *, email: str, contact_id: str, company_id: str, existing: Optional[dict]) -> Optional[str]:
    """72 saatlik onay token'ı yazar. Günlük tavan doluysa token döndürmez."""
    if await _notice_over_daily_cap(db, recipient=email, company_id=company_id):
        return None
    raw = secrets.token_urlsafe(32)
    key = _accept_key(email, company_id, contact_id)
    fields = _accept_token_fields(email, contact_id, company_id, raw)
    if existing:
        await db.b2b_link_acceptances.update_one({"_id": key}, {"$set": fields})
    else:
        await db.b2b_link_acceptances.insert_one({
            "_id": key, "accepted_at": None, "created_at": _iso(), **fields,
        })
    return raw


async def _send_link_notice(db, *, to: str, company_name: str, contact_name: str, company_id: str, token: str) -> bool:
    recipient = _norm_email(to)
    if await _notice_over_daily_cap(db, recipient=recipient, company_id=company_id):
        return False
    safe_company = _esc(company_name)
    safe_contact = _esc(contact_name)
    link = f"{host_audience.public_host_url(host_audience.KIND_B2B)}/api/public/b2b/accept-link/{token}"
    safe_link = _esc(link)
    subject = _NOTICE_SUBJECT
    body = (
        f"Merhaba,\n{company_name} firması {contact_name} carisini B2B hesabınıza bağlamak istiyor.\n"
        f"Onaylamak için bu bağlantıyı açın:\n{link}\n"
        "Bu işlemi siz istemediyseniz bağlantıya tıklamayın.\n"
    )
    html_body = (
        "<p>Merhaba,</p>"
        f"<p><strong>{safe_company}</strong> firması <strong>{safe_contact}</strong> "
        "carisini B2B hesabınıza bağlamak istiyor.</p>"
        f"<p><a href='{safe_link}'>Bağlantıyı onayla</a></p>"
        "<p>Bu işlemi siz istemediyseniz bağlantıya tıklamayın.</p>"
    )
    return await _enqueue_customer_mail(
        db, company_id=company_id, event="b2b_link_notice", to=to,
        subject=subject, text=body, html_body=html_body,
    )


async def notify_unnotified_links(db, identity: dict) -> None:
    """Kabul edilmemiş yeni bağlar için onay postasını kuyruğa yazar."""
    email = _norm_email(identity.get("email"))
    if "@" not in email:
        return
    accepted = await _accepted_contact_ids(db, email)
    for contact in await _contacts_for_login_email(db, email):
        cid = str(contact.get("_id") or "")
        company_id = str(contact.get("company_id") or "")
        if f"{company_id}:{cid}" in accepted:
            continue
        if _norm_email(contact.get("b2b_link_notified_email")) == email:
            continue
        company = await db.companies.find_one({"_id": company_id}) or {}
        key = _accept_key(email, company_id, cid)
        existing = await db.b2b_link_acceptances.find_one({"_id": key})
        raw = await _issue_accept_token(
            db, email=email, contact_id=cid, company_id=company_id, existing=existing,
        )
        if not raw:
            continue
        queued = await _send_link_notice(
            db, to=email, company_name=company.get("name") or "Bir tedarikçi",
            contact_name=contact.get("name") or "", company_id=company_id, token=raw,
        )
        if queued:
            await db.contacts.update_one(
                {"_id": cid, "company_id": company_id},
                {"$set": {"b2b_link_notified_email": email}},
            )


async def _accept_row(db, token: str) -> dict:
    raw = str(token or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Onay bağlantısı geçersiz.")
    row = await db.b2b_link_acceptances.find_one({"token_hash": token_digest(raw)})
    if not row or row.get("token_used_at"):
        raise HTTPException(status_code=400, detail="Onay bağlantısı geçersiz.")
    expires = row.get("expires_at")
    if not expires:
        raise HTTPException(status_code=400, detail="Onay bağlantısı geçersiz.")
    try:
        if _parse_dt(expires) <= _now():
            raise HTTPException(status_code=400, detail="Onay bağlantısının süresi doldu.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Onay bağlantısı geçersiz.")
    return row


async def preview_supplier_link(db, token: str) -> dict:
    """GET onaylamaz. Onay sayfasının göstereceği bilgiyi döner."""
    row = await _accept_row(db, token)
    company_id = str(row.get("company_id") or "")
    contact_id = str(row.get("contact_id") or "")
    company = await db.companies.find_one({"_id": company_id}) if company_id else None
    contact = None
    if contact_id and company_id:
        contact = await db.contacts.find_one({"_id": contact_id, "company_id": company_id})
    return {
        "status": "pending",
        "message": "Bu bağlantı bir tedarikçi bağını onaylamak içindir. Onaylamak için formu gönderin.",
        "company_name": (company or {}).get("name") or "",
        "contact_name": (contact or {}).get("name") or "",
        "expires_at": row.get("expires_at") or "",
    }


async def accept_supplier_link(db, token: str) -> dict:
    """POST tek kullanımlık. MySQL update_one_atomic kaydı kilit altında tüketir."""
    raw = str(token or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Onay bağlantısı geçersiz.")
    digest = token_digest(raw)
    now = _iso()
    row = await db.b2b_link_acceptances.find_one({"token_hash": digest})
    if not row or row.get("token_used_at") or not row.get("_id"):
        raise HTTPException(status_code=400, detail="Onay bağlantısı geçersiz.")
    expires = row.get("expires_at")
    if not expires:
        raise HTTPException(status_code=400, detail="Onay bağlantısı geçersiz.")
    try:
        if _parse_dt(expires) <= _now():
            raise HTTPException(status_code=400, detail="Onay bağlantısının süresi doldu.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Onay bağlantısı geçersiz.")
    result = await db.b2b_link_acceptances.update_one_atomic(
        {"_id": row["_id"], "token_hash": digest, "token_used_at": None, "expires_at": {"$gt": now}},
        {"$set": {"accepted_at": now, "token_used_at": now, "token_hash": None}},
    )
    if getattr(result, "matched_count", 0):
        return {"status": "success", "message": "Tedarikçi bağlantısı onaylandı."}
    raise HTTPException(status_code=400, detail="Onay bağlantısı geçersiz.")


async def start_email_verification(db, request: Request, req: Optional[dict] = None) -> dict:
    token = _session_token(request, req)
    row, identity = await _load_session_identity(db, token)
    if not _session_has_identity(row) or not identity.get("_id"):
        raise HTTPException(status_code=403, detail="Bu oturum kimliğe bağlı değil.")
    email = _norm_email(identity.get("email"))
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Doğrulanacak e-posta yok.")
    ip_id = _verify_ip_id(applog.client_ip(request), email)
    acct_id = _verify_acct_id(email)
    if await _locked(db, ip_id) or await _locked(db, acct_id):
        raise HTTPException(status_code=429, detail=_VERIFY_LOCK)
    await _bump_failure(db, ip_id)
    await _bump_failure(db, acct_id)
    if identity.get("email_verified_at"):
        return {"status": "ok", "message": "E-posta zaten doğrulanmış."}
    verify_token = secrets.token_urlsafe(32)
    digest = token_digest(verify_token)
    moment = _now()
    await db.b2b_email_verifications.insert_one({
        "_id": digest,
        "identity_id": identity["_id"],
        "email": email,
        "expires_at": (moment + timedelta(hours=VERIFY_HOURS)).isoformat(),
        "used_at": None,
        "created_at": moment.isoformat(),
    })
    link = f"{host_audience.public_host_url(host_audience.KIND_B2B)}/api/public/b2b/verify-email/{verify_token}"
    company_id = ""
    contacts = await _contacts_for_login_email(db, email)
    if contacts:
        company_id = str(contacts[0].get("company_id") or "")
    queued = await _enqueue_customer_mail(
        db,
        company_id=company_id,
        event="b2b_verify_email",
        to=email,
        subject="B2B e-posta doğrulama",
        text=f"B2B hesabınızın e-postasını doğrulamak için bu bağlantıyı kullanın:\n{link}\n",
        html_body=(
            "<p>B2B hesabınızın e-postasını doğrulamak için aşağıdaki bağlantıyı kullanın.</p>"
            f"<p><a href='{_esc(link)}'>E-postayı doğrula</a></p>"
        ),
    )
    if not queued:
        await db.b2b_email_verifications.update_one(
            {"_id": digest},
            {"$set": {"used_at": _iso(), "revoked": True}},
        )
        return {"status": "ok", "message": "Doğrulama e-postası şu an gönderilemedi. Daha sonra tekrar deneyin."}
    return {"status": "ok", "message": "Doğrulama bağlantısı e-posta adresinize gönderildi."}


async def _verification_row(db, token: str) -> dict:
    row = await db.b2b_email_verifications.find_one({"_id": token_digest(token)})
    if not row or row.get("used_at"):
        raise HTTPException(status_code=400, detail="Doğrulama bağlantısı geçersiz.")
    try:
        if _parse_dt(row.get("expires_at")) < _now():
            raise HTTPException(status_code=400, detail="Doğrulama bağlantısının süresi doldu.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Doğrulama bağlantısı geçersiz.")
    return row


async def preview_email_verification(db, token: str) -> dict:
    """GET doğrulamaz. Onay sayfasının göstereceği bilgiyi döner."""
    row = await _verification_row(db, token)
    return {
        "status": "pending",
        "message": "Bu bağlantı e-posta adresini doğrulamak içindir. Onaylamak için formu gönderin.",
        "expires_at": row.get("expires_at") or "",
    }


async def confirm_email_verification(db, token: str) -> dict:
    """POST e-postayı doğrular. GET bu fonksiyonu çağırmaz."""
    row = await _verification_row(db, token)
    identity = await db.b2b_identities.find_one({"_id": row.get("identity_id")})
    if not identity or _norm_email(identity.get("email")) != _norm_email(row.get("email")):
        raise HTTPException(status_code=400, detail="Doğrulama bağlantısı geçersiz.")
    now = _iso()
    result = await db.b2b_email_verifications.update_one_atomic(
        {"_id": row["_id"], "used_at": None},
        {"$set": {"used_at": now}},
    )
    if not getattr(result, "matched_count", 0):
        raise HTTPException(status_code=400, detail="Doğrulama bağlantısı geçersiz.")
    await db.b2b_identities.update_one({"_id": identity["_id"]}, {"$set": {"email_verified_at": now}})
    return {"status": "success", "message": "E-posta doğrulandı."}


async def finish_b2b_forgot(db, ident: str, request: Request, ready: dict, out: dict, contact: Optional[dict]) -> dict:
    """Sıfırlama postasını kuyruğa yazar. SMTP isteğin içinde çalışmaz."""
    _ = ready
    email = _norm_email(ident)
    identity = None
    if "@" in email:
        identity = await db.b2b_identities.find_one({"email": email})
    else:
        identity = await identity_for_tax_number(db, email)
    if contact is None and "@" in email:
        contact = await find_legacy_contact(db, email)
    if contact is None and "@" not in email:
        contact = await find_legacy_contact(db, ident)
    typed = email if "@" in email else ""
    contact_email = _norm_email((contact or {}).get("b2b_login_email") or (contact or {}).get("email"))
    identity_email = _norm_email((identity or {}).get("email"))
    to = typed or identity_email or contact_email
    if not contact or "@" not in to:
        return out
    token = secrets.token_urlsafe(32)
    digest = token_digest(token)
    now = _now()
    await db.b2b_password_resets.update_many(
        {"contact_id": contact["_id"], "used_at": None},
        {"$set": {"used_at": now.isoformat(), "revoked": True}},
    )
    await db.b2b_password_resets.insert_one({
        "_id": digest,
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
    safe_company = _esc(company.get("name") or "Tedarikçiniz")
    safe_who = _esc(contact.get("name") or "")
    safe_link = _esc(link)
    subject = f"{company.get('name') or 'Tedarikçiniz'} B2B şifre sıfırlama"
    body = (
        f"Merhaba {contact.get('name') or ''},\nB2B portal şifrenizi sıfırlamak için bu bağlantıyı 1 saat içinde kullanın:\n{link}\n"
        "Bu isteği siz yapmadıysanız bu e-postayı yok sayın."
    )
    html_body = (
        f"<p>Merhaba {safe_who},</p><p><strong>{safe_company}</strong> B2B portal şifrenizi sıfırlamak için "
        "aşağıdaki düğmeye tıklayın. Bağlantı 1 saat geçerlidir.</p>"
        f"<p><a href='{safe_link}' style='background:#059669;color:#fff;padding:10px 18px;border-radius:8px;"
        "text-decoration:none;font-weight:bold'>Şifreyi Sıfırla</a></p>"
    )
    try:
        queued = await _enqueue_customer_mail(
            db, company_id=str(contact.get("company_id") or ""), event="b2b_password_reset",
            to=to, subject=subject, text=body, html_body=html_body,
        )
    except Exception as exc:
        queued = False
        logger.warning("b2b forgot-password queue failed: %s", type(exc).__name__)
    if not queued:
        await db.b2b_password_resets.update_one(
            {"_id": digest},
            {"$set": {"used_at": now.isoformat(), "revoked": True, "mail_failed": True}},
        )
        return password_reset.finalize_forgot_mail_result(out, mail_status="failed", mail_detail="queue_failed")
    return password_reset.finalize_forgot_mail_result(out, mail_status="queued", mail_detail="queued")


@router.post("/public/b2b/login")
async def b2b_login(req: dict, request: Request):
    return await authenticate(get_db(), req or {}, request)


@router.post("/public/b2b/select-supplier")
async def b2b_select_supplier(req: dict):
    return await select_supplier(get_db(), req or {})


@router.get("/public/b2b/suppliers")
async def b2b_suppliers(request: Request):
    return await list_suppliers_for_session(get_db(), request)


@router.post("/public/b2b/logout")
async def b2b_logout(request: Request):
    body = None
    try:
        parsed = await request.json()
        if isinstance(parsed, dict):
            body = parsed
    except Exception:
        body = None
    return await logout_session(get_db(), request, body)


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
    return await preview_email_verification(get_db(), token)


@router.post("/public/b2b/verify-email/{token}")
async def b2b_verify_email_post(token: str):
    return await confirm_email_verification(get_db(), token)


@router.get("/public/b2b/accept-link/{token}")
async def b2b_accept_link_get(token: str):
    return await preview_supplier_link(get_db(), token)


@router.post("/public/b2b/accept-link/{token}")
async def b2b_accept_link_post(token: str):
    return await accept_supplier_link(get_db(), token)
