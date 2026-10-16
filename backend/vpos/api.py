"""Sanal POS HTTP uçları.

GET/PUT /vpos/configs ve POST /vpos/test-payment şirket yöneticisi ister.
POST /contacts/{contact_id}/vpos-collect cari tahsilatı başlatır.
Cari modülü middleware'de /contacts edit ister.
POST /vpos/callback/{intent_id} bankanın tarayıcı dönüşüdür: oturum yok,
intent kimliği + hash yeter. Kart verisi okunup atılır; loglanmaz ve
saklanmaz. Kasa ve cari yalnız doğrulanmış contact_collection veya
b2b_collection ödemesinde yazılır.
"""
from __future__ import annotations

import hmac
import logging
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, RedirectResponse

import bank_guard
import comm_service
import company_audit
import public_url
import rbac
import tenant_access
from client_ip import request_ip

from . import iyzico as iyzico_family
from . import paytr as paytr_family
from .base import MISMATCH_ERRORS, VposStartError, get_adapter
from .collect import post_collection
from .nestpay import PAYTEN_TEST_3D_URL, PAYTEN_TEST_HOST, format_amount, is_expired

logger = logging.getLogger("vpos")

router = APIRouter(prefix="/api")
_db = None
_current_user = None

CONFIGS = "vpos_configs"
INTENTS = "payment_intents"
INTENT_TTL = timedelta(minutes=30)
POS_ACCOUNT_TYPES = ("pos", "okc_pos")
TERMINAL_STATUSES = ("paid", "failed", "expired", "processing")
MAX_FORM_FIELDS = 80
MAX_FORM_VALUE = 2048
CALLBACK_RATE_LIMIT = 30
CALLBACK_RATE_WINDOW_S = 60.0
TEST_AMOUNT_MAX = Decimal("1000.00")
B2B_START_LIMIT = 5
B2B_START_WINDOW_S = 600.0
_COLLECTION_PURPOSES = frozenset({"contact_collection", "b2b_collection"})
_HITS: Dict[str, list] = {}
_B2B_STARTS: Dict[str, list] = {}

_CLIENT_ID = re.compile(r"^[A-Za-z0-9]{1,32}$")
_MASK_CHARS = set("•*· ")


def init(db, get_current_user=None):
    global _db, _current_user
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user


_outbound_client = None


def reset_callback_rate_limit() -> None:
    _HITS.clear()
    _B2B_STARTS.clear()


def set_outbound_client(client) -> None:
    """Test kancası. None iken adaptör kendi istemcisini açar."""
    global _outbound_client
    _outbound_client = client


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime] = None) -> str:
    return (dt or _now()).isoformat()


def _user_id(user: Optional[dict]) -> str:
    user = user or {}
    return str(user.get("id") or user.get("_id") or "")


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Sanal POS oturumu bağlanmadı.")
    return await _current_user(request)


def _require_db():
    if _db is None:
        raise HTTPException(status_code=500, detail="Veritabanı bağlanmadı.")
    return _db


def _is_mask(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    if set(text) <= _MASK_CHARS:
        return True
    if text.lower() in {"null", "undefined", "********", "password"}:
        return True
    return False


def _https_url(value: str, label: str) -> str:
    raw = (value or "").strip()
    if not raw or any(ch in raw for ch in "\r\n\t "):
        raise HTTPException(status_code=400, detail=f"{label} https olmalı.")
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail=f"{label} https olmalı.")
    return raw.rstrip("/")


def _allow_callback(ip: str) -> bool:
    now = time.monotonic()
    bucket = [stamp for stamp in _HITS.get(ip, []) if now - stamp < CALLBACK_RATE_WINDOW_S]
    if len(bucket) >= CALLBACK_RATE_LIMIT:
        _HITS[ip] = bucket
        return False
    bucket.append(now)
    _HITS[ip] = bucket
    if len(_HITS) > 4000:
        stale = [key for key, stamps in _HITS.items() if not stamps or now - stamps[-1] >= CALLBACK_RATE_WINDOW_S]
        for key in stale:
            _HITS.pop(key, None)
    return True


def allow_b2b_start(contact_id: str) -> bool:
    """Aynı cari 10 dakikada en fazla 5 kart ödemesi başlatabilir."""
    now = time.monotonic()
    key = str(contact_id or "")
    bucket = [stamp for stamp in _B2B_STARTS.get(key, []) if now - stamp < B2B_START_WINDOW_S]
    if len(bucket) >= B2B_START_LIMIT:
        _B2B_STARTS[key] = bucket
        return False
    bucket.append(now)
    _B2B_STARTS[key] = bucket
    if len(_B2B_STARTS) > 4000:
        stale = [item for item, stamps in _B2B_STARTS.items() if not stamps or now - stamps[-1] >= B2B_START_WINDOW_S]
        for item in stale:
            _B2B_STARTS.pop(item, None)
    return True


def public_config(doc: Optional[dict]) -> dict:
    doc = doc or {}
    family = doc.get("family") or "nestpay"
    try:
        max_installment = int(doc.get("max_installment") or 0)
    except (TypeError, ValueError):
        max_installment = 0
    return {
        "id": doc.get("_id") or "",
        "company_id": doc.get("company_id") or "",
        "family": family,
        "bank_label": doc.get("bank_label") or "",
        "mode": doc.get("mode") or "test",
        "client_id": doc.get("client_id") or "",
        "has_store_key": bool(doc.get("store_key_enc")),
        "api_user": doc.get("api_user") or "",
        "has_api_password": bool(doc.get("api_password_enc")),
        "gateway_3d_url": doc.get("gateway_3d_url") or "",
        "merchant_id": doc.get("merchant_id") or "",
        "has_merchant_key": bool(doc.get("merchant_key_enc")),
        "has_merchant_salt": bool(doc.get("merchant_salt_enc")),
        "max_installment": max_installment,
        "no_installment": bool(doc.get("no_installment")),
        "has_api_key": bool(doc.get("api_key")),
        "has_secret_key": bool(doc.get("secret_key_enc")),
        "account_id": doc.get("account_id") or "",
        "enabled": bool(doc.get("enabled")),
        "created_at": doc.get("created_at") or "",
        "updated_at": doc.get("updated_at") or "",
    }


def public_result(result: Any) -> Optional[dict]:
    if not isinstance(result, dict):
        return None
    out: Dict[str, Any] = {}
    error = str(result.get("error") or "").strip()
    if error:
        out["error"] = error[:80]
    for key, limit in (("auth_code", 32), ("proc_return_code", 8), ("md_status", 4)):
        text = str(result.get(key) or "").strip()
        if text:
            out[key] = text[:limit]
    masked = str(result.get("masked_pan") or "")
    if re.fullmatch(r"\d{6}\*{4,}\d{4}", masked):
        out["masked_pan"] = masked
    return out or None


def _public_installment(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number < 1:
        return None
    return number


def public_intent(doc: dict) -> dict:
    tx_id = str(doc.get("collection_tx_id") or "").strip()
    return {
        "id": doc.get("_id") or "",
        "company_id": doc.get("company_id") or "",
        "contact_id": doc.get("contact_id"),
        "purpose": doc.get("purpose") or "",
        "amount": doc.get("amount") or "",
        "currency": doc.get("currency") or "TRY",
        "installment": _public_installment(doc.get("installment")),
        "order_id": doc.get("order_id") or "",
        "status": doc.get("status") or "",
        "vpos_config_id": doc.get("vpos_config_id") or "",
        "collection_tx_id": tx_id or None,
        "created_at": doc.get("created_at") or "",
        "expires_at": doc.get("expires_at") or "",
        "result": public_result(doc.get("result")),
    }


def _form_dict(form: Any) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if form is None:
        return out
    items = form.multi_items() if hasattr(form, "multi_items") else form.items()
    for key, value in items:
        if len(out) >= MAX_FORM_FIELDS:
            break
        name = str(key)
        if name in out:
            continue
        if hasattr(value, "read") or hasattr(value, "file"):
            continue
        text = "" if value is None else str(value)
        if len(text) > MAX_FORM_VALUE:
            raise HTTPException(status_code=400, detail="Banka dönüşü kabul edilmedi.")
        out[name] = text
    return out


def _safe_result(verdict: dict) -> dict:
    """Banka dönüşünden saklanabilecek maskeli alanlar. Tutar yazılmaz."""
    result: Dict[str, Any] = {}
    error = str(verdict.get("error") or "").strip()
    if error:
        result["error"] = error[:80]
    for key in ("auth_code", "proc_return_code", "md_status", "masked_pan"):
        text = str(verdict.get(key) or "").strip()
        if not text:
            continue
        if key == "masked_pan":
            if re.fullmatch(r"\d{6}\*{4,}\d{4}", text):
                result[key] = text
            continue
        result[key] = text
    return result


async def _conditional_update(intent_id: str, match: dict, fields: dict) -> bool:
    coll = _require_db().payment_intents
    query = {"_id": intent_id, **match}
    update = {"$set": fields}
    atomic = getattr(coll, "update_one_atomic", None)
    if atomic is not None:
        res = await atomic(query, update)
    else:
        res = await coll.update_one(query, update)
    return int(getattr(res, "modified_count", 0) or 0) > 0


async def _claim_finish(intent_id: str, final_status: str, result: dict) -> bool:
    claim_id = uuid.uuid4().hex
    now = _iso()
    claimed = await _conditional_update(intent_id, {"status": "pending"}, {
        "status": "processing",
        "claim_id": claim_id,
        "updated_at": now,
    })
    if not claimed:
        return False
    return await _conditional_update(intent_id, {"status": "processing", "claim_id": claim_id}, {
        "status": final_status,
        "result": result,
        "updated_at": _iso(),
    })


async def _record_paid_collection(intent_id: str) -> None:
    """Kazanan paid claim. Test ve diğer amaçlar kasa/cari yazmaz."""
    db = _require_db()
    fresh = await db.payment_intents.find_one({"_id": intent_id})
    if not fresh or fresh.get("purpose") not in _COLLECTION_PURPOSES:
        return
    if str(fresh.get("status") or "") != "paid":
        return
    await post_collection(db, fresh)


async def _retry_paid_collection(intent_id: str) -> None:
    """Aynı yardımcı. Yeni callback, daha önce post_failed kaldıysa bir kez daha dener."""
    db = _require_db()
    fresh = await db.payment_intents.find_one({"_id": intent_id})
    if not fresh or fresh.get("purpose") not in _COLLECTION_PURPOSES:
        return
    if str(fresh.get("status") or "") != "paid":
        return
    if fresh.get("collection_tx_id"):
        return
    if fresh.get("collection_error") != "post_failed":
        return
    await post_collection(db, fresh)


async def _require_contact_collector(user: dict, company_id: str) -> None:
    """Cari tahsilat ile aynı çubuk: /contacts edit. Yönetici kısayolu yalnız admin."""
    if user.get("is_super_admin"):
        return
    if rbac.normalize_role_code(user.get("role")) == "admin":
        return
    perms = user.get("permissions")
    if not isinstance(perms, dict):
        role_doc = await rbac.role_for(user, company_id)
        perms = role_doc.get("permissions") or {}
    if not rbac.level_allows(perms.get("/contacts"), "edit"):
        raise HTTPException(status_code=403, detail="Bu işlem için yetkiniz yok.")


async def _audit(request: Request, user: dict, company_id: str, action: str, record_id: str, label: str, summary: str) -> None:
    try:
        await company_audit.write(
            _require_db(),
            company_id=company_id,
            user=user,
            module="/settings",
            action=action,
            record_id=record_id,
            record_label=label,
            summary=summary,
            ip=request_ip(request),
            path=str(getattr(getattr(request, "url", None), "path", "") or ""),
            href="/settings?tab=vpos",
        )
    except Exception:
        logger.exception("vpos audit yazılamadı")


async def _admin_company(request: Request, requested: Optional[str]) -> tuple:
    user = await _user_dep(request)
    company_id = tenant_access.resolve_company_id(user, requested)
    await tenant_access.require_company_admin(user, company_id)
    return user, company_id


async def _load_config(company_id: str) -> Optional[dict]:
    return await _require_db().vpos_configs.find_one({"company_id": company_id})


async def _decrypt_secret(enc: str, label: str) -> str:
    if not enc:
        return ""
    try:
        return comm_service.decrypt(enc)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Kayıtlı {label} çözülemedi.") from exc


async def _validate_account(company_id: str, account_id: str, enabled: bool) -> str:
    account_id = (account_id or "").strip()
    if not account_id:
        if enabled:
            raise HTTPException(status_code=400, detail="Bağlı POS hesabı seçin.")
        return ""
    acc = await _require_db().bank_accounts.find_one({"_id": account_id})
    if not acc or str(acc.get("company_id") or "") != company_id:
        raise HTTPException(status_code=400, detail="POS hesabı bu şirkete ait değil.")
    if str(acc.get("type") or "") not in POS_ACCOUNT_TYPES:
        raise HTTPException(status_code=400, detail="Bağlı hesap POS veya ÖKC POS olmalı.")
    return account_id


def _normalize_mode_and_url(mode: str, gateway: str) -> tuple:
    mode = (mode or "").strip().lower()
    if mode not in ("test", "live"):
        raise HTTPException(status_code=400, detail="Mod test veya live olmalı.")
    gateway = (gateway or "").strip()
    if mode == "test":
        if not gateway:
            gateway = PAYTEN_TEST_3D_URL
        gateway = _https_url(gateway, "Gateway adresi")
        return mode, gateway
    gateway = _https_url(gateway, "Canlı gateway adresi")
    host = (urlparse(gateway).hostname or "").lower()
    if host == PAYTEN_TEST_HOST:
        raise HTTPException(status_code=400, detail="Canlı modda Payten test ucu kullanılamaz. Bankanın 3D adresini girin.")
    return mode, gateway


async def _app_base(request: Request) -> str:
    return await public_url.public_base_url_for(_require_db(), "app", request=request)


async def _result_redirect(app_base: str, intent_id: str) -> RedirectResponse:
    """Panel sonucu /vpos/result. B2B portal ödemesi portal sonuç sayfasına gider."""
    db = _require_db()
    intent = await db.payment_intents.find_one({"_id": intent_id}) or {}
    if str(intent.get("source") or "") == "b2b_portal":
        contact_id = str(intent.get("contact_id") or "")
        contact = await db.contacts.find_one({"_id": contact_id}) if contact_id else None
        token = str((contact or {}).get("b2b_token") or "")
        if token:
            b2b_base = await public_url.public_base_url_for(db, "b2b")
            target = f"{str(b2b_base).rstrip('/')}/portal/{token}/odeme/{intent_id}"
            return RedirectResponse(target, status_code=303)
    target = f"{str(app_base).rstrip('/')}/vpos/result/{intent_id}"
    return RedirectResponse(target, status_code=303)


_MERCHANT_ID = re.compile(r"^\d{1,32}$")
_API_KEY = re.compile(r"^[A-Za-z0-9_.:-]{4,128}$")
OPEN_FAMILIES = frozenset({"nestpay", "paytr", "iyzico"})


def _mode_only(mode: str) -> str:
    mode = (mode or "").strip().lower()
    if mode not in ("test", "live"):
        raise HTTPException(status_code=400, detail="Mod test veya live olmalı.")
    return mode


def _installment(value: Any) -> int:
    try:
        number = int(value if value not in (None, "") else 0)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Taksit sayısı 0 ile 12 arasında olmalı.") from exc
    if number < 0 or number > 12:
        raise HTTPException(status_code=400, detail="Taksit sayısı 0 ile 12 arasında olmalı.")
    return number


def _secret_enc(existing: dict, field: str, body: Dict[str, Any], body_key: str, active: bool, same_family: bool) -> str:
    if not active:
        return ""
    current = str(existing.get(field) or "") if same_family else ""
    if body_key in body and not _is_mask(body.get(body_key)):
        return comm_service.encrypt(str(body.get(body_key)).strip())
    return current


def _plain_value(existing: dict, field: str, body: Dict[str, Any], body_key: str, active: bool, same_family: bool) -> str:
    if not active:
        return ""
    current = str(existing.get(field) or "") if same_family else ""
    if body_key in body and not _is_mask(body.get(body_key)):
        return str(body.get(body_key)).strip()
    return current


async def _attach_notify(request: Request, body: dict) -> dict:
    if body.get("family") == "paytr" and body.get("id"):
        base = await _app_base(request)
        body["notify_url"] = f"{base.rstrip('/')}/api/vpos/paytr/notify/{body['id']}"
    return body


def _start_failure_result(exc: VposStartError) -> dict:
    result = {"error": str(exc.error or "start_failed")[:80]}
    detail = str(exc.detail or "").strip()
    if detail:
        key = exc.detail_key if exc.detail_key in {"reason", "errorMessage"} else "reason"
        result[key] = detail[:120]
    return result


@router.get("/vpos/configs")
async def get_vpos_config(request: Request, company_id: Optional[str] = None):
    _user, cid = await _admin_company(request, company_id)
    doc = await _load_config(cid)
    if not doc:
        return public_config({"company_id": cid, "mode": "test", "gateway_3d_url": PAYTEN_TEST_3D_URL, "family": "nestpay"})
    return await _attach_notify(request, public_config(doc))


@router.put("/vpos/configs")
async def put_vpos_config(body: Dict[str, Any], request: Request):
    user, cid = await _admin_company(request, body.get("company_id"))
    family = str(body.get("family") or "nestpay").strip().lower()
    if family not in OPEN_FAMILIES:
        raise HTTPException(status_code=400, detail="Bu ödeme ailesi henüz açık değil.")
    try:
        get_adapter(family)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="Bu ödeme ailesi henüz açık değil.") from exc
    raw_label = body.get("bank_label")
    if raw_label in (None, ""):
        raw_label = body.get("display_name")
    bank_label = str(raw_label or "").strip()[:80]
    if not bank_label:
        detail = "Banka adı gerekli." if family == "nestpay" else "Görünen ad gerekli."
        raise HTTPException(status_code=400, detail=detail)
    enabled = bool(body.get("enabled"))
    existing = await _load_config(cid) or {}
    same_family = bool(existing.get("_id")) and str(existing.get("family") or "") == family
    account_id = await _validate_account(cid, str(body.get("account_id") or ""), enabled)
    if account_id:
        await bank_guard.assert_collection_allowed(_require_db(), account_id)
    client_id = ""
    api_user = ""
    gateway = ""
    merchant_id = ""
    max_installment = 0
    no_installment = False
    if family == "nestpay":
        client_id = str(body.get("client_id") or "").strip()
        if not _CLIENT_ID.match(client_id):
            raise HTTPException(status_code=400, detail="Client ID yalnızca harf ve rakam olabilir.")
        mode, gateway = _normalize_mode_and_url(str(body.get("mode") or "test"), str(body.get("gateway_3d_url") or ""))
        api_user = str(body.get("api_user") or "").strip()[:64]
    elif family == "paytr":
        mode = _mode_only(str(body.get("mode") or "test"))
        merchant_id = str(body.get("merchant_id") or "").strip()
        if not _MERCHANT_ID.match(merchant_id):
            raise HTTPException(status_code=400, detail="Mağaza numarası yalnız rakam olmalı.")
        max_installment = _installment(body.get("max_installment"))
        no_installment = bool(body.get("no_installment"))
    else:
        mode = _mode_only(str(body.get("mode") or "test"))
    store_enc = _secret_enc(existing, "store_key_enc", body, "store_key", family == "nestpay", same_family)
    password_enc = _secret_enc(existing, "api_password_enc", body, "api_password", family == "nestpay", same_family)
    merchant_key_enc = _secret_enc(existing, "merchant_key_enc", body, "merchant_key", family == "paytr", same_family)
    merchant_salt_enc = _secret_enc(existing, "merchant_salt_enc", body, "merchant_salt", family == "paytr", same_family)
    secret_key_enc = _secret_enc(existing, "secret_key_enc", body, "secret_key", family == "iyzico", same_family)
    api_key = _plain_value(existing, "api_key", body, "api_key", family == "iyzico", same_family)
    if family == "iyzico" and api_key and not _API_KEY.match(api_key):
        raise HTTPException(status_code=400, detail="API anahtarı geçersiz.")
    if enabled and family == "nestpay" and not store_enc:
        raise HTTPException(status_code=400, detail="Store key gerekli.")
    if enabled and family == "paytr" and not (merchant_key_enc and merchant_salt_enc):
        raise HTTPException(status_code=400, detail="PayTR mağaza anahtarı ve salt gerekli.")
    if enabled and family == "iyzico" and not (api_key and secret_key_enc):
        raise HTTPException(status_code=400, detail="iyzico API anahtarı ve secret key gerekli.")
    now = _iso()
    doc = {
        "_id": existing.get("_id") or str(uuid.uuid4()),
        "company_id": cid,
        "family": family,
        "bank_label": bank_label,
        "mode": mode,
        "client_id": client_id,
        "store_key_enc": store_enc,
        "api_user": api_user,
        "api_password_enc": password_enc,
        "gateway_3d_url": gateway,
        "merchant_id": merchant_id,
        "merchant_key_enc": merchant_key_enc,
        "merchant_salt_enc": merchant_salt_enc,
        "max_installment": max_installment,
        "no_installment": no_installment,
        "api_key": api_key,
        "secret_key_enc": secret_key_enc,
        "account_id": account_id,
        "enabled": enabled,
        "created_at": existing.get("created_at") or now,
        "updated_at": now,
    }
    db = _require_db()
    if existing.get("_id"):
        await db.vpos_configs.update_one({"_id": doc["_id"]}, {"$set": doc})
    else:
        await db.vpos_configs.insert_one(doc)
    await _audit(
        request, user, cid, "update", doc["_id"], bank_label,
        f"Sanal POS ayarı kaydedildi ({family}, {mode}).",
    )
    return await _attach_notify(request, public_config(doc))


async def _runtime_config(cfg: dict) -> dict:
    family = str(cfg.get("family") or "nestpay")
    runtime = dict(cfg)
    if family == "nestpay":
        store_key = await _decrypt_secret(str(cfg.get("store_key_enc") or ""), "store key")
        if not store_key:
            raise HTTPException(status_code=400, detail="Store key gerekli.")
        runtime["store_key"] = store_key
    elif family == "paytr":
        runtime["merchant_key"] = await _decrypt_secret(str(cfg.get("merchant_key_enc") or ""), "merchant key")
        runtime["merchant_salt"] = await _decrypt_secret(str(cfg.get("merchant_salt_enc") or ""), "merchant salt")
        if not runtime["merchant_key"] or not runtime["merchant_salt"]:
            raise HTTPException(status_code=400, detail="PayTR mağaza anahtarı gerekli.")
    elif family == "iyzico":
        runtime["secret_key"] = await _decrypt_secret(str(cfg.get("secret_key_enc") or ""), "secret key")
        runtime["api_key"] = str(cfg.get("api_key") or "")
        if not runtime["secret_key"] or not runtime["api_key"]:
            raise HTTPException(status_code=400, detail="iyzico anahtarı gerekli.")
    else:
        raise HTTPException(status_code=400, detail="Bu ödeme ailesi henüz açık değil.")
    return runtime


def _public_start(intent_id: str, started: dict) -> dict:
    public = {"intent_id": intent_id}
    for key in ("kind", "action_url", "fields", "iframe_url", "url"):
        if started.get(key) not in (None, ""):
            public[key] = started[key]
    return public


def _payment_ctx(
    request: Request,
    app_base: str,
    intent_id: str,
    family: str,
    *,
    email: str,
    name: str,
    phone: str,
    address: str,
    basket_label: str,
    identity_number: str = "",
    result_page: str = "",
) -> dict:
    app_base = str(app_base).rstrip("/")
    callback = f"{app_base}/api/vpos/callback/{intent_id}"
    shown = result_page or f"{app_base}/vpos/result/{intent_id}"
    ip = request_ip(request) or ""
    if not ip or ip == "unknown":
        ip = "127.0.0.1"
    ctx = {
        "callback_url": callback if family == "nestpay" else (
            f"{app_base}/api/vpos/iyzico/callback/{intent_id}" if family == "iyzico" else shown
        ),
        "ok_url": callback if family == "nestpay" else shown,
        "fail_url": callback if family == "nestpay" else shown,
        "user_ip": ip,
        "email": email,
        "name": name,
        "phone": phone,
        "address": address,
        "basket_label": basket_label,
    }
    if identity_number:
        ctx["identity_number"] = identity_number
    return ctx


async def _allocate_order_id(db) -> str:
    for _ in range(5):
        candidate = secrets.token_hex(16)
        if not await db.payment_intents.find_one({"order_id": candidate}):
            return candidate
    raise HTTPException(status_code=500, detail="Sipariş numarası üretilemedi.")


async def _begin_payment(
    request: Request,
    user: dict,
    cfg: dict,
    runtime: dict,
    *,
    company_id: str,
    amount: str,
    purpose: str,
    contact_id: Optional[str],
    installment: Optional[int],
    description: str,
    email: str,
    name: str,
    phone: str,
    address: str,
    basket_label: str,
    identity_number: str = "",
    audit_label: str = "",
    audit_summary: str = "",
    extra: Optional[Dict[str, Any]] = None,
    portal_token: str = "",
) -> dict:
    """Intent + sağlayıcı start. test_payment, panel tahsilatı ve B2B aynı yolu kullanır."""
    family = str(cfg.get("family") or "nestpay")
    db = _require_db()
    order_id = await _allocate_order_id(db)
    now = _now()
    intent_id = str(uuid.uuid4())
    intent = {
        "_id": intent_id,
        "company_id": company_id,
        "contact_id": contact_id,
        "purpose": purpose,
        "amount": amount,
        "currency": "TRY",
        "order_id": order_id,
        "status": "pending",
        "vpos_config_id": cfg.get("_id"),
        "provider_ref": None,
        "created_by": _user_id(user),
        "created_at": _iso(now),
        "expires_at": _iso(now + INTENT_TTL),
        "result": None,
    }
    if purpose != "test":
        intent["installment"] = installment if installment is not None else 1
        intent["description"] = description
    for key in ("ledger_amount", "commission_amount", "commission_payer", "source"):
        if extra and extra.get(key) not in (None, ""):
            intent[key] = extra[key]
    await db.payment_intents.insert_one(intent)
    app_base = (await _app_base(request)).rstrip("/")
    portal_result = ""
    if str(intent.get("source") or "") == "b2b_portal" and portal_token:
        b2b_base = await public_url.public_base_url_for(db, "b2b", request=request)
        portal_result = f"{str(b2b_base).rstrip('/')}/portal/{portal_token}/odeme/{intent_id}"
    ctx = _payment_ctx(
        request, app_base, intent_id, family,
        email=email, name=name, phone=phone, address=address,
        basket_label=basket_label, identity_number=identity_number,
        result_page=portal_result,
    )
    try:
        started = await get_adapter(family).start(runtime, intent, ctx, client=_outbound_client)
    except VposStartError as exc:
        await _claim_finish(intent_id, "failed", _start_failure_result(exc))
        logger.warning("vpos start failed id=%s error=%s", intent_id, exc.error)
        raise HTTPException(status_code=502, detail="Ödeme başlatılamadı.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Sanal POS formu hazırlanamadı.") from exc
    ref = str(started.pop("provider_ref", "") or "")
    if ref:
        wrote = await _conditional_update(intent_id, {"status": "pending"}, {"provider_ref": ref, "updated_at": _iso()})
        if not wrote:
            raise HTTPException(status_code=502, detail="Ödeme başlatılamadı.")
    if audit_label:
        await _audit(request, user, company_id, "create", intent_id, audit_label, audit_summary)
    return _public_start(intent_id, started)


def _open_family(cfg: dict) -> str:
    family = str((cfg or {}).get("family") or "nestpay")
    try:
        get_adapter(family)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="Bu ödeme ailesi henüz açık değil.") from exc
    return family


def _parse_amount(value: Any) -> str:
    try:
        return format_amount(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Tutar 0'dan büyük ve en fazla 2 hane olmalı.") from exc


def _collect_installment(cfg: dict, value: Any) -> int:
    if value in (None, ""):
        number = 1
    else:
        if isinstance(value, bool) or (isinstance(value, float) and not float(value).is_integer()):
            raise HTTPException(status_code=400, detail="Taksit sayısı geçersiz.")
        if isinstance(value, str) and not re.fullmatch(r"\d{1,2}", value.strip()):
            raise HTTPException(status_code=400, detail="Taksit sayısı geçersiz.")
        try:
            number = int(value)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Taksit sayısı geçersiz.") from exc
    if number < 1:
        raise HTTPException(status_code=400, detail="Taksit sayısı geçersiz.")
    if number != 1 and bool(cfg.get("no_installment")):
        raise HTTPException(status_code=400, detail="Bu sanal POS taksitli tahsilata kapalı.")
    if number == 1:
        return 1
    try:
        limit = int(cfg.get("max_installment") or 0)
    except (TypeError, ValueError):
        limit = 0
    if number > limit:
        raise HTTPException(status_code=400, detail="Taksit sayısı izin verilen üst sınırı aşıyor.")
    return number


def _collect_options_body(doc: Optional[dict]) -> dict:
    doc = doc or {}
    enabled = bool(doc.get("enabled")) and bool(str(doc.get("account_id") or "").strip())
    if not enabled:
        return {
            "enabled": False,
            "family": "",
            "bank_label": "",
            "mode": "",
            "max_installment": 0,
            "no_installment": False,
        }
    try:
        max_installment = int(doc.get("max_installment") or 0)
    except (TypeError, ValueError):
        max_installment = 0
    return {
        "enabled": True,
        "family": doc.get("family") or "",
        "bank_label": doc.get("bank_label") or "",
        "mode": doc.get("mode") or "test",
        "max_installment": max_installment,
        "no_installment": bool(doc.get("no_installment")),
    }


def _clip_text(value: Any, limit: int) -> str:
    return re.sub(r"[\r\n\t]+", " ", str(value or "")).strip()[:limit]


@router.post("/vpos/test-payment")
async def test_payment(body: Dict[str, Any], request: Request):
    user, cid = await _admin_company(request, (body or {}).get("company_id"))
    cfg = await _load_config(cid)
    if not cfg or not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="Test için etkin bir sanal POS ayarı gerekli.")
    if str(cfg.get("mode") or "") != "test":
        raise HTTPException(status_code=400, detail="Test ödemesi yalnız test modunda açılır.")
    _open_family(cfg)
    amount = _parse_amount((body or {}).get("amount"))
    if Decimal(amount) > TEST_AMOUNT_MAX:
        raise HTTPException(status_code=400, detail="Test tutarı 1000,00 TL'yi aşamaz.")
    runtime = await _runtime_config(cfg)
    email = str(user.get("email") or "test@example.com").strip() or "test@example.com"
    return await _begin_payment(
        request, user, cfg, runtime,
        company_id=cid,
        amount=amount,
        purpose="test",
        contact_id=None,
        installment=None,
        description="",
        email=email,
        name=str(user.get("name") or "Test"),
        phone=str(user.get("phone") or ""),
        address="",
        basket_label="Test ödemesi",
        audit_label="Test ödemesi",
        audit_summary=f"Sanal POS test ödemesi başlatıldı ({amount} TRY).",
    )


@router.get("/vpos/collect-options")
async def collect_options(request: Request, company_id: Optional[str] = None):
    """Sır içermeyen tahsilat seçenekleri. Şirket yöneticisi şart değil."""
    user = await _user_dep(request)
    cid = tenant_access.resolve_company_id(user, company_id)
    return _collect_options_body(await _load_config(cid))


@router.post("/contacts/{contact_id}/vpos-collect")
async def collect_payment(contact_id: str, body: Dict[str, Any], request: Request):
    """Cari kart tahsilatı. Kart verisi kabul edilmez; sağlayıcı sayfası açılır."""
    user = await _user_dep(request)
    body = body or {}
    cid = tenant_access.resolve_company_id(user, body.get("company_id"))
    await _require_contact_collector(user, cid)
    contact_id = str(contact_id or "").strip()
    if not contact_id:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    contact = await tenant_access.get_tenant_doc(
        _require_db(), "contacts", contact_id, user, not_found="Cari hesap bulunamadı.",
    )
    if str(contact.get("company_id") or "") != cid:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    cfg = await _load_config(cid)
    if not cfg or not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="Etkin bir sanal POS ayarı gerekli.")
    account_id = str(cfg.get("account_id") or "").strip()
    if not account_id:
        raise HTTPException(status_code=400, detail="Bağlı POS hesabı seçin.")
    account = await bank_guard.assert_collection_allowed(_require_db(), account_id)
    if not account or str(account.get("company_id") or "") != cid or str(account.get("type") or "") not in POS_ACCOUNT_TYPES:
        raise HTTPException(status_code=400, detail="Bağlı POS hesabı seçin.")
    _open_family(cfg)
    amount = _parse_amount(body.get("amount"))
    if str(cfg.get("mode") or "") == "test" and Decimal(amount) > TEST_AMOUNT_MAX:
        raise HTTPException(status_code=400, detail="Test tutarı 1000,00 TL'yi aşamaz.")
    installment = _collect_installment(cfg, body.get("installment"))
    description = _clip_text(body.get("description"), 160)
    runtime = await _runtime_config(cfg)
    tax = re.sub(r"\D", "", str(contact.get("tax_number_or_id") or ""))
    identity = tax if len(tax) == 11 else ""
    email = str(contact.get("email") or user.get("email") or "odeme@example.com").strip() or "odeme@example.com"
    name = str(contact.get("name") or user.get("name") or "Cari").strip() or "Cari"
    return await _begin_payment(
        request, user, cfg, runtime,
        company_id=cid,
        amount=amount,
        purpose="contact_collection",
        contact_id=contact_id,
        installment=installment,
        description=description,
        email=email,
        name=name,
        phone=str(contact.get("phone") or ""),
        address=str(contact.get("address") or ""),
        basket_label=description or "Cari tahsilat",
        identity_number=identity,
        audit_label="Kartla tahsilat",
        audit_summary=f"Kartla cari tahsilatı başlatıldı ({amount} TRY).",
    )


@router.post("/vpos/callback/{intent_id}")
async def vpos_callback(intent_id: str, request: Request):
    """Banka okUrl/failUrl dönüşü. Kimlik yok; hash + intent kimliği doğrulanır."""
    if not _allow_callback(request_ip(request) or "unknown"):
        raise HTTPException(status_code=429, detail="Çok fazla deneme. Biraz sonra tekrar deneyin.")
    form = _form_dict(await request.form())
    db = _require_db()
    intent = await db.payment_intents.find_one({"_id": intent_id})
    if not intent:
        raise HTTPException(status_code=404, detail="Ödeme bulunamadı.")
    app_base = await _app_base(request)
    status = str(intent.get("status") or "")
    if status in TERMINAL_STATUSES:
        logger.info("vpos callback id=%s status=%s repeat=1", intent_id, status)
        await _retry_paid_collection(intent_id)
        return await _result_redirect(app_base, intent_id)
    if status != "pending":
        return await _result_redirect(app_base, intent_id)
    if is_expired(intent):
        await _conditional_update(intent_id, {"status": "pending"}, {
            "status": "expired",
            "result": {"error": "expired"},
            "updated_at": _iso(),
        })
        logger.info("vpos callback id=%s status=expired", intent_id)
        return await _result_redirect(app_base, intent_id)
    cfg = None
    cfg_id = intent.get("vpos_config_id")
    if cfg_id:
        cfg = await db.vpos_configs.find_one({"_id": cfg_id})
    same_company = bool(cfg) and str(cfg.get("company_id") or "") == str(intent.get("company_id") or "")
    if not same_company:
        await _claim_finish(intent_id, "failed", {"error": "company_mismatch"})
        logger.info("vpos callback id=%s status=failed error=company_mismatch", intent_id)
        return await _result_redirect(app_base, intent_id)
    family = str(cfg.get("family") or "nestpay")
    if family != "nestpay":
        logger.info("vpos callback id=%s family=%s ignored=1", intent_id, family)
        return await _result_redirect(app_base, intent_id)
    try:
        store_key = await _decrypt_secret(str(cfg.get("store_key_enc") or ""), "store key")
        adapter = get_adapter(family)
    except (HTTPException, KeyError):
        await _claim_finish(intent_id, "failed", {"error": "config"})
        logger.info("vpos callback id=%s status=failed error=config", intent_id)
        return await _result_redirect(app_base, intent_id)
    verdict = adapter.verify_callback({**cfg, "store_key": store_key}, intent, form)
    error = str(verdict.get("error") or "")
    if not verdict.get("ok"):
        if error in MISMATCH_ERRORS:
            result = {"error": error}
        else:
            result = {"error": error or "bad_hash"}
        final = "failed"
    elif verdict.get("approved"):
        result = _safe_result(verdict)
        result.pop("error", None)
        final = "paid"
    else:
        result = _safe_result(verdict)
        final = "failed"
    wrote = await _claim_finish(intent_id, final, result)
    if wrote and final == "paid":
        await _record_paid_collection(intent_id)
    if wrote:
        logger.info("vpos callback id=%s status=%s", intent_id, final)
    else:
        logger.info("vpos callback id=%s status=%s repeat=1", intent_id, final)
        await _retry_paid_collection(intent_id)
    return await _result_redirect(app_base, intent_id)


def _notify_ok() -> PlainTextResponse:
    return PlainTextResponse("OK")


@router.post("/vpos/paytr/notify/{config_id}")
async def paytr_notify(config_id: str, request: Request):
    """PayTR bildirim URL. Kimlik yok; hash doğrulanmadan intent yazılmaz."""
    if not _allow_callback(request_ip(request) or "unknown"):
        raise HTTPException(status_code=429, detail="Çok fazla deneme. Biraz sonra tekrar deneyin.")
    form = _form_dict(await request.form())
    db = _require_db()
    cfg = await db.vpos_configs.find_one({"_id": config_id})
    if not cfg or str(cfg.get("family") or "") != "paytr":
        raise HTTPException(status_code=400, detail="Bildirim doğrulanamadı.")
    try:
        merchant_key = await _decrypt_secret(str(cfg.get("merchant_key_enc") or ""), "merchant key")
        merchant_salt = await _decrypt_secret(str(cfg.get("merchant_salt_enc") or ""), "merchant salt")
    except HTTPException as exc:
        raise HTTPException(status_code=400, detail="Bildirim doğrulanamadı.") from exc
    runtime = {**cfg, "merchant_key": merchant_key, "merchant_salt": merchant_salt}
    if not paytr_family.notification_hash_ok(runtime, form):
        logger.info("vpos paytr notify config=%s bad_hash=1", config_id)
        raise HTTPException(status_code=400, detail="Bildirim doğrulanamadı.")
    oid = str(form.get("merchant_oid") or "")
    intent = await db.payment_intents.find_one({"order_id": oid}) if oid else None
    if not intent:
        logger.info("vpos paytr notify config=%s missing=1", config_id)
        return _notify_ok()
    intent_id = str(intent.get("_id") or "")
    same = str(intent.get("vpos_config_id") or "") == str(config_id) and str(intent.get("company_id") or "") == str(cfg.get("company_id") or "")
    if not same:
        logger.info("vpos paytr notify id=%s skipped=1", intent_id)
        return _notify_ok()
    status = str(intent.get("status") or "")
    if status in TERMINAL_STATUSES or status != "pending":
        logger.info("vpos paytr notify id=%s status=%s repeat=1", intent_id, status)
        await _retry_paid_collection(intent_id)
        return _notify_ok()
    verdict = await paytr_family.ADAPTER.confirm(runtime, intent, form)
    error = str(verdict.get("error") or "")
    if not verdict.get("ok"):
        final = "failed"
        result = {"error": error or "bad_hash"}
    elif verdict.get("approved"):
        final = "paid"
        result = {}
    else:
        final = "failed"
        result = {"error": error or "declined"}
    wrote = await _claim_finish(intent_id, final, result)
    if wrote and final == "paid":
        await _record_paid_collection(intent_id)
    if wrote:
        logger.info("vpos paytr notify id=%s status=%s", intent_id, final)
    else:
        logger.info("vpos paytr notify id=%s status=%s repeat=1", intent_id, final)
        await _retry_paid_collection(intent_id)
    return _notify_ok()


@router.post("/vpos/iyzico/callback/{intent_id}")
async def iyzico_callback(intent_id: str, request: Request):
    """Checkout Form dönüşü. Token kanıt değildir; karar retrieve yanıtındadır."""
    if not _allow_callback(request_ip(request) or "unknown"):
        raise HTTPException(status_code=429, detail="Çok fazla deneme. Biraz sonra tekrar deneyin.")
    form = _form_dict(await request.form())
    db = _require_db()
    intent = await db.payment_intents.find_one({"_id": intent_id})
    if not intent:
        raise HTTPException(status_code=404, detail="Ödeme bulunamadı.")
    app_base = await _app_base(request)
    status = str(intent.get("status") or "")
    if status in TERMINAL_STATUSES or status != "pending":
        logger.info("vpos iyzico callback id=%s status=%s repeat=1", intent_id, status)
        await _retry_paid_collection(intent_id)
        return await _result_redirect(app_base, intent_id)
    token = str(form.get("token") or "")
    stored = str(intent.get("provider_ref") or "")
    if not _token_equal(stored, token):
        logger.info("vpos iyzico callback id=%s token_mismatch=1", intent_id)
        return await _result_redirect(app_base, intent_id)
    cfg = None
    cfg_id = intent.get("vpos_config_id")
    if cfg_id:
        cfg = await db.vpos_configs.find_one({"_id": cfg_id})
    same_company = bool(cfg) and str(cfg.get("company_id") or "") == str(intent.get("company_id") or "")
    if not same_company or str(cfg.get("family") or "") != "iyzico":
        await _claim_finish(intent_id, "failed", {"error": "company_mismatch"})
        logger.info("vpos iyzico callback id=%s status=failed error=company_mismatch", intent_id)
        return await _result_redirect(app_base, intent_id)
    try:
        runtime = await _runtime_config(cfg)
    except HTTPException:
        logger.info("vpos iyzico callback id=%s status=pending error=config", intent_id)
        return await _result_redirect(app_base, intent_id)
    verdict = await iyzico_family.ADAPTER.confirm(runtime, intent, {"token": stored}, client=_outbound_client)
    if verdict.get("retryable"):
        logger.info("vpos iyzico callback id=%s status=pending retry=1", intent_id)
        return await _result_redirect(app_base, intent_id)
    error = str(verdict.get("error") or "")
    if not verdict.get("ok"):
        final = "failed"
        result = {"error": error or "bad_signature"}
    elif verdict.get("approved"):
        final = "paid"
        result = {}
    else:
        final = "failed"
        result = {"error": error or "declined"}
    wrote = await _claim_finish(intent_id, final, result)
    if wrote and final == "paid":
        await _record_paid_collection(intent_id)
    if wrote:
        logger.info("vpos iyzico callback id=%s status=%s", intent_id, final)
    else:
        logger.info("vpos iyzico callback id=%s status=%s repeat=1", intent_id, final)
        await _retry_paid_collection(intent_id)
    return await _result_redirect(app_base, intent_id)


def _token_equal(left: str, right: str) -> bool:
    a = left or ""
    b = right or ""
    if not a or not b or len(a) != len(b):
        return False
    return hmac.compare_digest(a, b)


@router.get("/vpos/intents/{intent_id}")
async def get_payment_intent(intent_id: str, request: Request):
    user = await _user_dep(request)
    doc = await tenant_access.get_tenant_doc(
        _require_db(), INTENTS, intent_id, user, not_found="Ödeme bulunamadı.",
    )
    return public_intent(doc)
