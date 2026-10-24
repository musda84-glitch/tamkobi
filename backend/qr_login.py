"""Web girişi için tek kullanımlık QR oturumu.

QR içeriği yalnız rastgele koddur. Kod ve tarayıcı sırrı JWT_SECRET ile
HMAC'lenir; ham değer saklanmaz ve loglanmaz. Onaylanan oturum, kodu üreten
tarayıcıya polling cevabında bir kez verilir. Süper yönetici QR ile giremez.
2FA'lı sıradan hesapta mobil oturum 2FA'yı geçmiş sayılır.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

from fastapi import HTTPException

import applog
from auth_utils import get_jwt_secret
from client_ip import request_ip

QR_TTL_SECONDS = 120
QR_DELIVER_GRACE_SECONDS = 15
QR_START_PER_MINUTE = 10
QR_POLL_PER_MINUTE = 90

_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{40,128}$")
_LOCKS: dict = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _parse_dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        text = text.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _mac(purpose: str, value: str) -> str:
    key = get_jwt_secret().encode("utf-8")
    msg = f"{purpose}:{value}".encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def code_mac(code: str) -> str:
    return _mac("qr-login-code", code)


def poll_mac(secret: str) -> str:
    return _mac("qr-login-poll", secret)


def clean_code(code: str) -> str:
    text = (code or "").strip()
    if not _CODE_RE.fullmatch(text):
        return ""
    return text


def browser_label(user_agent: str) -> str:
    ua = user_agent or ""
    if "Edg/" in ua:
        return "Edge"
    if "OPR/" in ua or "Opera" in ua:
        return "Opera"
    if "Chrome/" in ua or "CriOS/" in ua:
        return "Chrome"
    if "Firefox/" in ua or "FxiOS/" in ua:
        return "Firefox"
    if "Safari/" in ua:
        return "Safari"
    if "Mobile" in ua:
        return "Mobil tarayıcı"
    return "Tarayıcı" if ua else "Bilinmeyen tarayıcı"


def _user_agent(request) -> str:
    headers = getattr(request, "headers", None) or {}
    raw = headers.get("user-agent") or headers.get("User-Agent") or ""
    clean = "".join(ch for ch in str(raw) if ch.isprintable())
    return clean[:180]


def _lock():
    import asyncio
    loop = asyncio.get_running_loop()
    key = id(loop)
    lock = _LOCKS.get(key)
    if lock is None:
        _LOCKS.clear()
        lock = asyncio.Lock()
        _LOCKS[key] = lock
    return lock


def _expired(doc: dict, *, grace: int = 0) -> bool:
    exp = _parse_dt((doc or {}).get("expires_at"))
    if exp is None:
        return True
    return _now() > exp + timedelta(seconds=grace)


def _secret_matches(doc: dict, secret: str) -> bool:
    expect = str((doc or {}).get("poll_hash") or "")
    if not secret or not expect:
        return False
    got = poll_mac(secret)
    if len(expect) != len(got):
        return False
    return hmac.compare_digest(expect, got)


def _token_payload(user: Optional[dict]) -> dict:
    if not isinstance(user, dict):
        return {}
    payload = user.get("_token_payload")
    return payload if isinstance(payload, dict) else {}


def _is_impersonation(payload: Optional[dict]) -> bool:
    if not isinstance(payload, dict):
        return False
    return bool(payload.get("imp_session") or payload.get("imp_by"))


def _request_access_payload(request) -> dict:
    """İstek çerezindeki veya bearer'daki access JWT. Yoksa veya bozuksa boş."""
    from auth_utils import decode_access_payload, session_token

    token = session_token(request)
    if not token:
        return {}
    try:
        payload = decode_access_payload(token)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _assert_human_session(user: Optional[dict]) -> dict:
    """İnsan oturumu. Süper yönetici, atölye cihazı ve taklit (imp_session) reddedilir."""
    if not isinstance(user, dict) or not str(user.get("_id") or user.get("id") or "").strip():
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    if user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Süper yönetici hesapları QR ile web girişi kullanamaz.")
    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Hesabınız pasif durumda.")
    from shopfloor_accounts import is_device_user
    if is_device_user(user):
        raise HTTPException(status_code=403, detail="Atölye cihaz hesabı QR ile web girişi onaylayamaz.")
    payload = _token_payload(user)
    if _is_impersonation(payload) or user.get("imp_session"):
        raise HTTPException(status_code=403, detail="Taklit oturumu QR ile web girişi onaylayamaz.")
    return user


def _assert_mobile_approver(user: dict) -> None:
    """Onay yalnız mobil uygulamanın bearer oturumunda. Web oturumu onaylayamaz."""
    cli = str(_token_payload(user).get("cli") or "").strip().lower()
    if cli != "mobile":
        raise HTTPException(status_code=403, detail="QR girişi yalnızca mobil uygulama oturumuyla onaylanır.")


def _user_id(user: dict) -> str:
    return str(user.get("_id") or user.get("id") or "").strip()


async def _enforce_rate(db, ip: str, kind: str, limit: int, detail: str) -> None:
    bucket = _now().strftime("%Y%m%d%H%M")
    identifier = f"qrlogin:{kind}:{ip or 'unknown'}:{bucket}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    count = int((attempt or {}).get("count") or 0)
    if count >= limit:
        applog.log_auth("qr_login_rate_limit", "qr login rate limit", ip=ip or "unknown")
        raise HTTPException(status_code=429, detail=detail)
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$inc": {"count": 1}, "$set": {"last_attempt": _iso(_now())}},
        upsert=True,
    )


async def _find(db, code: str) -> Optional[dict]:
    return await db.web_login_qr.find_one({"_id": code_mac(code)})


async def _transition(db, doc_id: str, status: str, fields: dict, extra: Optional[dict] = None) -> bool:
    query = {"_id": doc_id, "status": status}
    if extra:
        query.update(extra)
    coll = db.web_login_qr
    atomic = getattr(coll, "update_one_atomic", None)
    if callable(atomic):
        result = await atomic(query, {"$set": fields})
    else:
        result = await coll.update_one(query, {"$set": fields})
    return int(getattr(result, "matched_count", 0) or 0) == 1


async def _company_name(db, user: dict) -> tuple[str, str]:
    """Etiket yalnız kullanıcının mevcut aktif şirketidir. Şirket değiştirilmez."""
    cid = str(user.get("active_company_id") or "").strip()
    if not cid:
        return "", ""
    doc = await db.companies.find_one({"_id": cid})
    name = str((doc or {}).get("name") or "")
    return cid, name


async def _reload(db, doc_id: str) -> Optional[dict]:
    return await db.web_login_qr.find_one({"_id": doc_id})


async def start_session(db, request, *, remember: bool = False) -> dict:
    if _is_impersonation(_request_access_payload(request)):
        raise HTTPException(status_code=403, detail="Taklit oturumu QR ile web girişi başlatamaz.")
    ip = request_ip(request)
    await _enforce_rate(
        db, ip, "start", QR_START_PER_MINUTE,
        "Çok fazla QR giriş denemesi. Lütfen bir dakika sonra tekrar deneyin.",
    )
    code = secrets.token_urlsafe(32)
    poll_secret = secrets.token_urlsafe(32)
    if not clean_code(code) or not clean_code(poll_secret):
        raise HTTPException(status_code=500, detail="QR oturumu oluşturulamadı.")
    now = _now()
    exp = now + timedelta(seconds=QR_TTL_SECONDS)
    ua = _user_agent(request)
    doc = {
        "_id": code_mac(code),
        "poll_hash": poll_mac(poll_secret),
        "status": "pending",
        "created_at": _iso(now),
        "expires_at": _iso(exp),
        "ip": ip,
        "user_agent": ua,
        "browser": browser_label(ua),
        "remember": bool(remember),
        "user_id": "",
        "delivered_at": None,
        "approved_at": None,
        "rejected_at": None,
    }
    await db.web_login_qr.insert_one(doc)
    applog.log_auth("qr_login_started", "qr login session created", ip=ip)
    return {
        "code": code,
        "poll_secret": poll_secret,
        "expires_at": doc["expires_at"],
        "ttl_seconds": QR_TTL_SECONDS,
    }


async def poll_status(
    db,
    request,
    response,
    code: str,
    poll_secret: str,
    *,
    issue_session: Callable[..., Awaitable[dict]],
) -> dict:
    ip = request_ip(request)
    await _enforce_rate(
        db, ip, "poll", QR_POLL_PER_MINUTE,
        "Çok fazla durum sorgusu. Lütfen bir dakika sonra tekrar deneyin.",
    )
    cleaned = clean_code(code)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Geçersiz kod")
    secret = clean_code(poll_secret)
    if not secret:
        raise HTTPException(status_code=404, detail="Oturum bulunamadı")
    async with _lock():
        doc = await _find(db, cleaned)
        if not doc or not _secret_matches(doc, secret):
            raise HTTPException(status_code=404, detail="Oturum bulunamadı")
        status = str(doc.get("status") or "")
        if status == "pending" and _expired(doc):
            await _transition(db, doc["_id"], "pending", {"status": "expired"})
            return {"status": "expired"}
        if status == "pending":
            return {"status": "pending", "expires_at": doc.get("expires_at")}
        if status == "rejected":
            return {"status": "rejected"}
        if status in ("expired", "consumed") or doc.get("delivered_at"):
            return {"status": status if status in ("expired", "consumed") else "consumed"}
        if status != "approved":
            return {"status": "expired"}
        if _expired(doc, grace=QR_DELIVER_GRACE_SECONDS):
            await _transition(
                db, doc["_id"], "approved", {"status": "expired"},
                extra={"delivered_at": None},
            )
            return {"status": "expired"}
        claimed = await _transition(
            db,
            doc["_id"],
            "approved",
            {"status": "consumed", "delivered_at": _iso(_now())},
            extra={"delivered_at": None},
        )
        if not claimed:
            return {"status": "consumed"}
        user = await db.users.find_one({"_id": str(doc.get("user_id") or "")})
        try:
            fresh = _assert_human_session(user)
        except HTTPException:
            raise
        cid = str(fresh.get("active_company_id") or "")
        await db.users.update_one(
            {"_id": _user_id(fresh)},
            {"$set": {"last_login_at": _iso(_now())}},
        )
        body = await issue_session(fresh, request, response, remember=bool(doc.get("remember")))
        if not isinstance(body, dict):
            body = {}
        else:
            body = dict(body)
        body.pop("code", None)
        body.pop("poll_secret", None)
        body.pop("password", None)
        body.pop("password_hash", None)
        body["status"] = "approved"
        applog.log_auth(
            "qr_login_delivered",
            "web session issued",
            user_id=_user_id(fresh),
            ip=ip,
            company_id=cid,
        )
        return body


async def preview(db, request, user: Optional[dict], code: str) -> dict:
    actor = _assert_human_session(user)
    cleaned = clean_code(code)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Geçersiz kod")
    doc = await _find(db, cleaned)
    if not doc:
        raise HTTPException(status_code=404, detail="Oturum bulunamadı")
    if str(doc.get("status") or "") == "pending" and _expired(doc):
        async with _lock():
            await _transition(db, doc["_id"], "pending", {"status": "expired"})
        raise HTTPException(status_code=401, detail="Kodun süresi doldu")
    if str(doc.get("status") or "") != "pending":
        raise HTTPException(status_code=409, detail="Kod kullanılmış")
    cid, company_name = await _company_name(db, actor)
    return {
        "company_name": company_name,
        "company_id": cid,
        "user_name": str(actor.get("name") or ""),
        "user_email": str(actor.get("email") or ""),
        "browser": str(doc.get("browser") or ""),
        "ip": str(doc.get("ip") or ""),
        "expires_at": doc.get("expires_at"),
    }


async def approve(db, request, user: Optional[dict], code: str) -> dict:
    """Yalnız cli=mobile bearer onaylar. Web oturumu ve taklit oturumu onaylayamaz."""
    actor = _assert_human_session(user)
    _assert_mobile_approver(actor)
    cleaned = clean_code(code)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Geçersiz kod")
    async with _lock():
        doc = await _find(db, cleaned)
        if not doc:
            raise HTTPException(status_code=404, detail="Oturum bulunamadı")
        status = str(doc.get("status") or "")
        if status == "pending" and _expired(doc):
            await _transition(db, doc["_id"], "pending", {"status": "expired"})
            raise HTTPException(status_code=401, detail="Kodun süresi doldu")
        if status != "pending":
            raise HTTPException(status_code=409, detail="Kod kullanılmış")
        cid, company_name = await _company_name(db, actor)
        ok = await _transition(db, doc["_id"], "pending", {
            "status": "approved",
            "approved_at": _iso(_now()),
            "user_id": _user_id(actor),
            "user_name": str(actor.get("name") or ""),
            "company_id": cid,
            "company_name": company_name,
            "approver_ip": request_ip(request),
        })
        if not ok:
            raise HTTPException(status_code=409, detail="Kod kullanılmış")
    applog.log_auth(
        "qr_login_approved",
        "qr login approved",
        user_id=_user_id(actor),
        ip=request_ip(request),
        company_id=str(actor.get("active_company_id") or ""),
    )
    return {"status": "approved"}


async def reject(db, request, user: Optional[dict], code: str) -> dict:
    actor = _assert_human_session(user)
    cleaned = clean_code(code)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Geçersiz kod")
    async with _lock():
        doc = await _find(db, cleaned)
        if not doc:
            raise HTTPException(status_code=404, detail="Oturum bulunamadı")
        status = str(doc.get("status") or "")
        if status == "pending" and _expired(doc):
            await _transition(db, doc["_id"], "pending", {"status": "expired"})
            raise HTTPException(status_code=401, detail="Kodun süresi doldu")
        if status != "pending":
            raise HTTPException(status_code=409, detail="Kod kullanılmış")
        ok = await _transition(db, doc["_id"], "pending", {
            "status": "rejected",
            "rejected_at": _iso(_now()),
            "user_id": _user_id(actor),
            "approver_ip": request_ip(request),
        })
        if not ok:
            raise HTTPException(status_code=409, detail="Kod kullanılmış")
    applog.log_auth(
        "qr_login_rejected",
        "qr login rejected",
        user_id=_user_id(actor),
        ip=request_ip(request),
    )
    return {"status": "rejected"}
