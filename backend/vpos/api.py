"""Sanal POS HTTP uçları.

GET/PUT /vpos/configs ve POST /vpos/test-payment şirket yöneticisi ister.
POST /vpos/callback/{intent_id} bankanın tarayıcı dönüşüdür: oturum yok,
intent kimliği + hash yeter. Kart verisi okunup atılır; loglanmaz ve
saklanmaz. Kasa / cari / fatura yazılmaz.
"""
from __future__ import annotations

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
from fastapi.responses import RedirectResponse

import comm_service
import company_audit
import public_url
import tenant_access
from client_ip import request_ip

from .base import get_adapter
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
MISMATCH_ERRORS = frozenset({"amount_mismatch", "currency_mismatch", "order_mismatch"})
MAX_FORM_FIELDS = 80
MAX_FORM_VALUE = 2048
CALLBACK_RATE_LIMIT = 30
CALLBACK_RATE_WINDOW_S = 60.0
TEST_AMOUNT_MAX = Decimal("1000.00")
_HITS: Dict[str, list] = {}

_CLIENT_ID = re.compile(r"^[A-Za-z0-9]{1,32}$")
_MASK_CHARS = set("•*· ")


def init(db, get_current_user=None):
    global _db, _current_user
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user


def reset_callback_rate_limit() -> None:
    _HITS.clear()


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


def public_config(doc: Optional[dict]) -> dict:
    doc = doc or {}
    return {
        "id": doc.get("_id") or "",
        "company_id": doc.get("company_id") or "",
        "family": doc.get("family") or "nestpay",
        "bank_label": doc.get("bank_label") or "",
        "mode": doc.get("mode") or "test",
        "client_id": doc.get("client_id") or "",
        "has_store_key": bool(doc.get("store_key_enc")),
        "api_user": doc.get("api_user") or "",
        "has_api_password": bool(doc.get("api_password_enc")),
        "gateway_3d_url": doc.get("gateway_3d_url") or "",
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


def public_intent(doc: dict) -> dict:
    return {
        "id": doc.get("_id") or "",
        "company_id": doc.get("company_id") or "",
        "contact_id": doc.get("contact_id"),
        "purpose": doc.get("purpose") or "",
        "amount": doc.get("amount") or "",
        "currency": doc.get("currency") or "TRY",
        "order_id": doc.get("order_id") or "",
        "status": doc.get("status") or "",
        "vpos_config_id": doc.get("vpos_config_id") or "",
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


def _result_redirect(app_base: str, intent_id: str) -> RedirectResponse:
    target = f"{str(app_base).rstrip('/')}/vpos/result/{intent_id}"
    return RedirectResponse(target, status_code=303)


@router.get("/vpos/configs")
async def get_vpos_config(request: Request, company_id: Optional[str] = None):
    _user, cid = await _admin_company(request, company_id)
    doc = await _load_config(cid)
    if not doc:
        return public_config({"company_id": cid, "mode": "test", "gateway_3d_url": PAYTEN_TEST_3D_URL, "family": "nestpay"})
    return public_config(doc)


@router.put("/vpos/configs")
async def put_vpos_config(body: Dict[str, Any], request: Request):
    user, cid = await _admin_company(request, body.get("company_id"))
    family = str(body.get("family") or "nestpay").strip().lower()
    if family != "nestpay":
        raise HTTPException(status_code=400, detail="Bu ödeme ailesi henüz açık değil.")
    try:
        get_adapter(family)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="Bu ödeme ailesi henüz açık değil.") from exc
    bank_label = str(body.get("bank_label") or "").strip()[:80]
    if not bank_label:
        raise HTTPException(status_code=400, detail="Banka adı gerekli.")
    client_id = str(body.get("client_id") or "").strip()
    if not _CLIENT_ID.match(client_id):
        raise HTTPException(status_code=400, detail="Client ID yalnızca harf ve rakam olabilir.")
    enabled = bool(body.get("enabled"))
    mode, gateway = _normalize_mode_and_url(str(body.get("mode") or "test"), str(body.get("gateway_3d_url") or ""))
    account_id = await _validate_account(cid, str(body.get("account_id") or ""), enabled)
    api_user = str(body.get("api_user") or "").strip()[:64]
    existing = await _load_config(cid)
    existing = existing or {}
    store_enc = str(existing.get("store_key_enc") or "")
    if not _is_mask(body.get("store_key")):
        store_enc = comm_service.encrypt(str(body.get("store_key")).strip())
    password_enc = str(existing.get("api_password_enc") or "")
    if "api_password" in body and not _is_mask(body.get("api_password")):
        password_enc = comm_service.encrypt(str(body.get("api_password")).strip())
    if enabled and not store_enc:
        raise HTTPException(status_code=400, detail="Store key gerekli.")
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
    return public_config(doc)


@router.post("/vpos/test-payment")
async def test_payment(body: Dict[str, Any], request: Request):
    user, cid = await _admin_company(request, (body or {}).get("company_id"))
    cfg = await _load_config(cid)
    if not cfg or not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="Test için etkin bir sanal POS ayarı gerekli.")
    if str(cfg.get("mode") or "") != "test":
        raise HTTPException(status_code=400, detail="Test ödemesi yalnız test modunda açılır.")
    if str(cfg.get("family") or "") != "nestpay":
        raise HTTPException(status_code=400, detail="Bu ödeme ailesi henüz açık değil.")
    try:
        amount = format_amount((body or {}).get("amount"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Tutar 0'dan büyük ve en fazla 2 hane olmalı.") from exc
    if Decimal(amount) > TEST_AMOUNT_MAX:
        raise HTTPException(status_code=400, detail="Test tutarı 1000,00 TL'yi aşamaz.")
    store_key = await _decrypt_secret(str(cfg.get("store_key_enc") or ""), "store key")
    if not store_key:
        raise HTTPException(status_code=400, detail="Store key gerekli.")
    db = _require_db()
    order_id = ""
    for _ in range(5):
        candidate = secrets.token_hex(16)
        if not await db.payment_intents.find_one({"order_id": candidate}):
            order_id = candidate
            break
    if not order_id:
        raise HTTPException(status_code=500, detail="Sipariş numarası üretilemedi.")
    now = _now()
    intent_id = str(uuid.uuid4())
    intent = {
        "_id": intent_id,
        "company_id": cid,
        "contact_id": None,
        "purpose": "test",
        "amount": amount,
        "currency": "TRY",
        "order_id": order_id,
        "status": "pending",
        "vpos_config_id": cfg.get("_id"),
        "created_by": _user_id(user),
        "created_at": _iso(now),
        "expires_at": _iso(now + INTENT_TTL),
        "result": None,
    }
    await db.payment_intents.insert_one(intent)
    app_base = await _app_base(request)
    callback = f"{app_base.rstrip('/')}/api/vpos/callback/{intent_id}"
    try:
        built = get_adapter("nestpay").build_3d_form(
            {**cfg, "store_key": store_key},
            intent,
            {"ok_url": callback, "fail_url": callback},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Sanal POS formu hazırlanamadı.") from exc
    await _audit(
        request, user, cid, "create", intent_id, "Test ödemesi",
        f"Sanal POS test ödemesi başlatıldı ({amount} TRY).",
    )
    return {"intent_id": intent_id, "action_url": built["action_url"], "fields": built["fields"]}


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
        return _result_redirect(app_base, intent_id)
    if status != "pending":
        return _result_redirect(app_base, intent_id)
    if is_expired(intent):
        await _conditional_update(intent_id, {"status": "pending"}, {
            "status": "expired",
            "result": {"error": "expired"},
            "updated_at": _iso(),
        })
        logger.info("vpos callback id=%s status=expired", intent_id)
        return _result_redirect(app_base, intent_id)
    cfg = None
    cfg_id = intent.get("vpos_config_id")
    if cfg_id:
        cfg = await db.vpos_configs.find_one({"_id": cfg_id})
    same_company = bool(cfg) and str(cfg.get("company_id") or "") == str(intent.get("company_id") or "")
    if not same_company:
        await _claim_finish(intent_id, "failed", {"error": "company_mismatch"})
        logger.info("vpos callback id=%s status=failed error=company_mismatch", intent_id)
        return _result_redirect(app_base, intent_id)
    try:
        store_key = await _decrypt_secret(str(cfg.get("store_key_enc") or ""), "store key")
        adapter = get_adapter(str(cfg.get("family") or "nestpay"))
    except (HTTPException, KeyError):
        await _claim_finish(intent_id, "failed", {"error": "config"})
        logger.info("vpos callback id=%s status=failed error=config", intent_id)
        return _result_redirect(app_base, intent_id)
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
    if wrote:
        logger.info("vpos callback id=%s status=%s", intent_id, final)
    else:
        logger.info("vpos callback id=%s status=%s repeat=1", intent_id, final)
    return _result_redirect(app_base, intent_id)


@router.get("/vpos/intents/{intent_id}")
async def get_payment_intent(intent_id: str, request: Request):
    user = await _user_dep(request)
    doc = await tenant_access.get_tenant_doc(
        _require_db(), INTENTS, intent_id, user, not_found="Ödeme bulunamadı.",
    )
    return public_intent(doc)
