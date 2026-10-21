"""Şirket API anahtarı.

Her yasal şirketin en fazla bir anahtarı vardır. Biçim ``tk_live_`` ve ardından
en az 32 bayt rastgele değerdir. Veritabanında yalnız SHA-256 özeti durur;
düz anahtar oluşturma ve yenileme yanıtında bir kez döner. Karşılaştırma
``hmac.compare_digest`` ile sabit zamanlıdır.

Hash deseni ``platform_store._sha256_hex`` ile aynıdır. Şirket erişimi
``saas.user_may_access_company`` ve ``saas.companies_on_license`` ile doğrulanır.
"""
from __future__ import annotations

import hmac
import logging
import re
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

import saas
import tenant_scope
from client_ip import request_ip
from mysql_store import DuplicateKeyError
from platform_store import _sha256_hex

logger = logging.getLogger("tamkobi.company_api")

router = APIRouter(prefix="/api")

KEY_PREFIX = "tk_live_"
KEY_RANDOM_BYTES = 32
KEY_RATE_LIMIT = 60
IP_RATE_LIMIT = 120
LINK_RATE_LIMIT = 30
_DUMMY_HASH = _sha256_hex("tamkobi-company-api-key-dummy")
_KEY_IN_LOG = re.compile(r"tk_live_[A-Za-z0-9_\-]{8,}")

_db = None
_current_user = None


def _redact_message(record: logging.LogRecord) -> None:
    try:
        rendered = record.getMessage()
    except Exception:
        return
    if "tk_live_" not in rendered:
        return
    record.msg = _KEY_IN_LOG.sub("tk_live_[gizli]", rendered)
    record.args = ()


def _install_log_redact() -> None:
    """Her logger kaydı oluşurken düz anahtarı düşürür. Kök filtre alt logger'a yetişmez."""
    current = logging.getLogRecordFactory()
    if getattr(current, "_tamkobi_key_redact", False):
        return

    def factory(*args, **kwargs):
        record = current(*args, **kwargs)
        _redact_message(record)
        return record

    factory._tamkobi_key_redact = True  # type: ignore[attr-defined]
    logging.setLogRecordFactory(factory)


_install_log_redact()


def init(db, current_user_dep=None) -> None:
    global _db, _current_user
    _db = db
    if current_user_dep is not None:
        _current_user = current_user_dep


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_api_key() -> str:
    """``tk_live_`` + 32 bayt URL-güvenli rastgele değer."""
    return KEY_PREFIX + secrets.token_urlsafe(KEY_RANDOM_BYTES)


def _digest_equal(stored: str, computed: str) -> bool:
    """Uzunluk farkında da compare_digest çağrılır; erken dönüş zaman sızdırmaz."""
    left = str(stored or "")
    right = str(computed or "")
    if len(left) != len(right):
        hmac.compare_digest(_DUMMY_HASH, _DUMMY_HASH)
        return False
    return hmac.compare_digest(left, right)


def is_company_admin(user: Optional[dict]) -> bool:
    """saas.create_license_company ile aynı yönetici kuralı."""
    if not user:
        return False
    if user.get("is_super_admin"):
        return True
    return user.get("role") in (None, "admin")


def bearer_token(request: Request) -> str:
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def public_key_info(doc: dict) -> dict:
    """Bilgi ucu. Düz anahtar, hash ve şifreli kopya yok."""
    return {
        "prefix": doc.get("key_prefix") or KEY_PREFIX,
        "last4": doc.get("key_last4") or "",
        "created_at": doc.get("created_at"),
        "last_used_at": doc.get("last_used_at"),
        "last_used_by": doc.get("last_used_by"),
    }


def _revealed(doc: dict, secret: str) -> dict:
    return {"api_key": secret, **public_key_info(doc)}


async def ensure_indexes(db) -> None:
    """key_hash benzersiz; şirket başına bir anahtar; bağlantı çifti benzersiz.

    Sunucu açılışında kurulur. STARTUP_INDEXES canlı meta_indexes anlık
    görüntüsüdür; süreç bu kodla bir kez açılmadan oraya yazılmaz.
    """
    keys = getattr(db, "company_api_keys", None)
    links = getattr(db, "company_links", None)
    if keys is not None and hasattr(keys, "create_index"):
        await keys.create_index("key_hash", unique=True)
        await keys.create_index("company_id", unique=True)
    if links is not None and hasattr(links, "create_index"):
        await links.create_index([("from_company", 1), ("to_company", 1)], unique=True)


async def _user(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Şirket API kimliği bağlanmadı.")
    return await _current_user(request)


async def optional_user(request: Request) -> Optional[dict]:
    """tk_live_ bearer oturum değildir. JWT veya çerez varsa kullanıcı döner."""
    token = bearer_token(request)
    if token.startswith(KEY_PREFIX):
        return None
    if _current_user is None:
        return None
    cookie = ""
    cookies = getattr(request, "cookies", None) or {}
    cookie = str(cookies.get("access_token") or "").strip()
    if not token and not cookie:
        return None
    try:
        return await _current_user(request)
    except HTTPException:
        return None


async def require_admin_company(user: dict, company_id: str) -> dict:
    """Üye değilse 404. Yönetici değilse 403. Şirket lisansın parçası olmalı."""
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    if not is_company_admin(user):
        raise HTTPException(status_code=403, detail="Bu işlem için şirket yöneticisi olmalısınız.")
    company = await _db.companies.find_one({"_id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    license_id = str(company.get("license_id") or company_id)
    rows = await companies_on_license(license_id)
    if not any(str(row.get("_id") or "") == company_id for row in rows):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    return company


def user_may_access_company(user: Optional[dict], company_id: str) -> bool:
    return saas.user_may_access_company(user, company_id)


async def companies_on_license(license_id: str) -> list:
    return await saas.companies_on_license(license_id)


async def _audit(company_id: str, user: Optional[dict], action: str, summary: str, request: Request, record_id: str = "") -> None:
    try:
        import company_audit
        await company_audit.write(
            _db,
            company_id=company_id,
            user=user,
            module="/settings",
            action=action,
            record_id=record_id,
            summary=summary,
            ip=request_ip(request),
            path=request.url.path,
        )
    except Exception as exc:
        logger.warning("company api audit skipped: %s", type(exc).__name__)


async def bump_rate(bucket: str, limit: int) -> bool:
    """Sayaç limitin altındayken artar. Dolu kova artmaz. True: istek geçebilir."""
    coll = _db.company_api_rate
    doc = await coll.find_one({"_id": bucket})
    count = int((doc or {}).get("count") or 0)
    if count >= int(limit):
        return False
    now = _now_iso()
    if doc is None:
        try:
            await coll.insert_one({"_id": bucket, "count": 1, "updated_at": now})
            return True
        except DuplicateKeyError:
            pass
    await coll.update_one(
        {"_id": bucket},
        {"$inc": {"count": 1}, "$set": {"updated_at": now}},
    )
    return True


def _minute() -> int:
    return int(time.time() // 60)


async def enforce_ip_rate(request: Request) -> None:
    ip = request_ip(request) or "unknown"
    if not await bump_rate(f"cak:ip:{ip}:{_minute()}", IP_RATE_LIMIT):
        raise HTTPException(status_code=429, detail="Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin.")


async def enforce_key_rate(key_id: str) -> None:
    if not await bump_rate(f"cak:key:{key_id}:{_minute()}", KEY_RATE_LIMIT):
        raise HTTPException(status_code=429, detail="Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin.")


async def enforce_link_rate(company_id: str, request: Request) -> None:
    ip = request_ip(request) or "unknown"
    minute = _minute()
    ip_ok = await bump_rate(f"cak:linkip:{ip}:{minute}", IP_RATE_LIMIT)
    co_ok = await bump_rate(f"cak:linkco:{company_id}:{minute}", LINK_RATE_LIMIT)
    if not ip_ok or not co_ok:
        raise HTTPException(status_code=429, detail="Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin.")


async def enforce_user_rate(user_id: str) -> None:
    if not await bump_rate(f"cak:user:{user_id}:{_minute()}", KEY_RATE_LIMIT):
        raise HTTPException(status_code=429, detail="Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin.")


async def resolve_api_key(token: str) -> Optional[dict]:
    """Anahtarı hash ile bulur. Düz değer yazılmaz. Bulunamazsa sabit zamanlı karşılaştırma yine çalışır."""
    computed = _sha256_hex(str(token or ""))
    with tenant_scope.unscoped("şirket API anahtarı şirket bilinmeden hash ile aranır"):
        doc = await _db.company_api_keys.find_one({"key_hash": computed})
    stored = _DUMMY_HASH
    if doc and doc.get("key_hash"):
        stored = str(doc.get("key_hash"))
    if not _digest_equal(stored, computed):
        return None
    if not doc or doc.get("status") != "active" or doc.get("revoked_at"):
        return None
    return doc


async def touch_key(doc: dict) -> None:
    await _db.company_api_keys.update_one(
        {"_id": doc["_id"], "company_id": doc.get("company_id")},
        {"$set": {"last_used_at": _now_iso(), "last_used_by": "external"}},
    )


async def _key_for_company(company_id: str) -> Optional[dict]:
    return await _db.company_api_keys.find_one({"company_id": company_id})


def _key_fields(company_id: str, secret: str, user: dict, *, created_at: Optional[str] = None) -> dict:
    now = created_at or _now_iso()
    return {
        "company_id": company_id,
        "key_prefix": KEY_PREFIX,
        "key_last4": secret[-4:],
        "key_hash": _sha256_hex(secret),
        "status": "active",
        "created_at": now,
        "created_by": str((user or {}).get("_id") or (user or {}).get("id") or ""),
        "last_used_at": None,
        "last_used_by": None,
        "revoked_at": None,
        "rotated_at": now if created_at is None else now,
    }


async def _insert_key(company_id: str, secret: str, user: dict) -> dict:
    now = _now_iso()
    fields = _key_fields(company_id, secret, user, created_at=now)
    doc = {
        "_id": f"cak_{uuid.uuid4().hex[:16]}",
        "company_id": company_id,
        "key_prefix": fields["key_prefix"],
        "key_last4": fields["key_last4"],
        "key_hash": fields["key_hash"],
        "status": "active",
        "created_at": now,
        "created_by": fields["created_by"],
        "last_used_at": None,
        "last_used_by": None,
        "revoked_at": None,
        "rotated_at": None,
    }
    try:
        await _db.company_api_keys.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Bu şirketin API anahtarı zaten var.")
    return doc


async def _replace_secret(existing: dict, secret: str, user: dict) -> dict:
    now = _now_iso()
    fields = _key_fields(existing.get("company_id") or "", secret, user, created_at=now)
    await _db.company_api_keys.update_one(
        {"_id": existing["_id"], "company_id": existing.get("company_id")},
        {"$set": fields},
    )
    return {**existing, **fields}


@router.get("/license/companies/{company_id}/api-key")
async def get_company_api_key(company_id: str, request: Request):
    user = await _user(request)
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    await require_admin_company(user, company_id)
    doc = await _key_for_company(company_id)
    if not doc:
        raise HTTPException(status_code=404, detail="API anahtarı yok.")
    return public_key_info(doc)


@router.post("/license/companies/{company_id}/api-key")
async def create_company_api_key(company_id: str, request: Request):
    user = await _user(request)
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    await require_admin_company(user, company_id)
    existing = await _key_for_company(company_id)
    if existing and existing.get("status") == "active" and not existing.get("revoked_at"):
        raise HTTPException(status_code=409, detail="Bu şirketin API anahtarı zaten var.")
    secret = new_api_key()
    if existing:
        doc = await _replace_secret(existing, secret, user)
    else:
        doc = await _insert_key(company_id, secret, user)
    await _audit(company_id, user, "create", "Şirket API anahtarı oluşturuldu", request, record_id=doc["_id"])
    return _revealed(doc, secret)


@router.post("/license/companies/{company_id}/api-key/rotate")
async def rotate_company_api_key(company_id: str, request: Request):
    user = await _user(request)
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    await require_admin_company(user, company_id)
    existing = await _key_for_company(company_id)
    if not existing:
        raise HTTPException(status_code=404, detail="API anahtarı yok.")
    secret = new_api_key()
    doc = await _replace_secret(existing, secret, user)
    await _audit(company_id, user, "update", "Şirket API anahtarı yenilendi", request, record_id=doc["_id"])
    return _revealed(doc, secret)


@router.post("/license/companies/{company_id}/api-key/revoke")
async def revoke_company_api_key(company_id: str, request: Request):
    user = await _user(request)
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    await require_admin_company(user, company_id)
    existing = await _key_for_company(company_id)
    if not existing:
        raise HTTPException(status_code=404, detail="API anahtarı yok.")
    now = _now_iso()
    if existing.get("status") != "revoked":
        await _db.company_api_keys.update_one(
            {"_id": existing["_id"], "company_id": company_id},
            {"$set": {"status": "revoked", "revoked_at": now}},
        )
        existing = {**existing, "status": "revoked", "revoked_at": now}
        await _audit(company_id, user, "delete", "Şirket API anahtarı iptal edildi", request, record_id=existing["_id"])
    return public_key_info(existing)
