"""Yönetim paneli yazma API: /api/platform/admin-v1/* (HMAC, platform_admin).

Kimliğe bürünme, silme, şifre/2FA, kullanıcı ve anahtar yönetimi burada yok.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request

from client_ip import request_ip
import idempotency
import platform_store as store
import saas
from platform_admin_v1 import _auth, _item, _redact

router = APIRouter(prefix="/api", tags=["platform-admin-v1-write"])

_LICENSE_FIELDS = (
    "plan_id",
    "status",
    "trial_ends_at",
    "expires_at",
    "extend_days",
    "billing_period",
    "notes",
)
_PRODUCT_FIELDS = ("name", "status", "base_url")
_UPGRADE_STATUSES = ("approved", "rejected", "pending")
_BILLING_PERIODS = ("monthly", "yearly")

_Prepare = Callable[[Dict[str, Any]], Awaitable[List[str]]]
_Apply = Callable[[Dict[str, Any], dict], Awaitable[Any]]


def _canonical(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _endpoint_of(request: Request, payload: Dict[str, Any]) -> str:
    digest = hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()[:16]
    return f"{request.method} {request.url.path}#{digest}"


def _reject_unknown(payload: Dict[str, Any], allowed: Tuple[str, ...]) -> None:
    allowed_set = set(allowed)
    for key in payload:
        if key not in allowed_set:
            raise HTTPException(status_code=400, detail=f"Desteklenmeyen alan: {key}")


def _present(payload: Dict[str, Any], allowed: Tuple[str, ...]) -> List[str]:
    return [key for key in allowed if key in payload]


def _iso_or_null(value: Any, field: str) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(
            status_code=400,
            detail=f"{field} geçerli bir ISO tarih ya da null olmalı.",
        )
    text = value.strip().replace("Z", "+00:00")
    try:
        datetime.fromisoformat(text)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"{field} geçerli bir ISO tarih ya da null olmalı.",
        ) from None


def _require_bool(payload: Dict[str, Any], field: str) -> None:
    if field not in payload:
        raise HTTPException(status_code=400, detail=f"{field} zorunlu.")
    if not isinstance(payload[field], bool):
        raise HTTPException(status_code=400, detail=f"{field} boolean olmalı.")


_SECRET_BODY_KEYS = ("password", "api_key", "merchant_key", "merchant_salt", "legal_iban")
_AUDIT_BLOCK = ("password", "secret", "api_key", "merchant_key", "merchant_salt", "token", "credential")


def body_has_secret(payload: Dict[str, Any]) -> bool:
    """Gövde sır alanı taşıyor mu. Alanın varlığı yeter; boş ve yalnızca boşluk da sırdır.

    clear_key yalnız True iken sırdır. false mevcut sırrı silmez.
    """
    if payload.get("clear_key") is True:
        return True
    for key in _SECRET_BODY_KEYS:
        if key in payload:
            return True
    return False


async def require_secret_scope(request: Request) -> None:
    """Parola / API anahtarı yazan gövde admin.secrets:write ister. Sır döndürülmez."""
    key_id = (request.headers.get("X-Platform-Key") or "").strip()
    doc = await store._db.platform_api_keys.find_one({"_id": key_id})
    scopes = list((doc or {}).get("scopes") or [])
    if store.SCOPE_ADMIN_SECRETS_WRITE not in scopes:
        raise HTTPException(status_code=403, detail="Kapsam yetersiz")


def audit_field_names(names: List[str]) -> List[str]:
    out = []
    for name in names:
        low = name.lower()
        if any(part in low for part in _AUDIT_BLOCK):
            continue
        out.append(name)
    return out


async def _company_or_404(company_id: str) -> None:
    if not await saas._db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")


def _http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


async def _prepare_license(company_id: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, _LICENSE_FIELDS)
    if not payload:
        raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
    if "plan_id" in payload:
        plan_id = payload["plan_id"]
        if not isinstance(plan_id, str) or not plan_id.strip():
            raise HTTPException(status_code=400, detail="Geçersiz paket.")
        if not await saas._db.saas_plans.find_one({"_id": plan_id}):
            raise HTTPException(status_code=400, detail="Geçersiz paket.")
    if "status" in payload and payload["status"] not in saas.STATUSES:
        raise HTTPException(status_code=400, detail="Geçersiz durum.")
    for field in ("trial_ends_at", "expires_at"):
        if field in payload:
            _iso_or_null(payload[field], field)
    if "extend_days" in payload:
        days = payload["extend_days"]
        if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 3650:
            raise HTTPException(
                status_code=400,
                detail="extend_days 1 ile 3650 arasında bir tamsayı olmalı.",
            )
    if "billing_period" in payload and payload["billing_period"] not in _BILLING_PERIODS:
        raise HTTPException(status_code=400, detail="billing_period monthly veya yearly olmalı.")
    if "notes" in payload:
        notes = payload["notes"]
        if not isinstance(notes, str):
            raise HTTPException(status_code=400, detail="notes metin olmalı.")
        if len(notes) > 2000:
            raise HTTPException(status_code=400, detail="notes en çok 2000 karakter olabilir.")
    await _company_or_404(company_id)
    return _present(payload, _LICENSE_FIELDS)


async def _prepare_module(company_id: str, module_key: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, ("enabled",))
    _require_bool(payload, "enabled")
    key = "/" + str(module_key or "").lstrip("/")
    if key not in saas._ALL:
        raise HTTPException(status_code=400, detail="Bilinmeyen ya da çekirdek modül.")
    await _company_or_404(company_id)
    return ["enabled"]


async def _prepare_activation(company_id: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, ("active",))
    _require_bool(payload, "active")
    await _company_or_404(company_id)
    return ["active"]


async def _prepare_upgrade(req_id: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, ("status", "note", "apply"))
    if "status" not in payload or payload["status"] in (None, ""):
        raise HTTPException(status_code=400, detail="status zorunlu.")
    if payload["status"] not in _UPGRADE_STATUSES:
        raise HTTPException(status_code=400, detail="Geçersiz durum.")
    if "note" in payload:
        note = payload["note"]
        if not isinstance(note, str):
            raise HTTPException(status_code=400, detail="note metin olmalı.")
        if len(note) > 1000:
            raise HTTPException(status_code=400, detail="note en çok 1000 karakter olabilir.")
    if "apply" in payload and not isinstance(payload["apply"], bool):
        raise HTTPException(status_code=400, detail="apply boolean olmalı.")
    if not await saas._db.upgrade_requests.find_one({"_id": req_id}):
        raise HTTPException(status_code=404, detail="Talep bulunamadı.")
    return _present(payload, ("status", "note", "apply"))


async def _find_product(product_id: str) -> Optional[dict]:
    db = store._db
    doc = await db.platform_products.find_one({"_id": product_id})
    if doc:
        return doc
    return await db.platform_products.find_one({"code": product_id})


async def _prepare_product(product_id: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, _PRODUCT_FIELDS)
    if not payload:
        raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
    if "name" in payload:
        name = payload["name"]
        if not isinstance(name, str):
            raise HTTPException(status_code=400, detail="name metin olmalı.")
        if not name.strip():
            raise HTTPException(status_code=400, detail="name boş olamaz.")
        if len(name.strip()) > 200:
            raise HTTPException(status_code=400, detail="name en çok 200 karakter olabilir.")
    if "status" in payload:
        status = payload["status"]
        if not isinstance(status, str):
            raise HTTPException(status_code=400, detail="status metin olmalı.")
        if not status.strip():
            raise HTTPException(status_code=400, detail="status boş olamaz.")
        if len(status.strip()) > 40:
            raise HTTPException(status_code=400, detail="status en çok 40 karakter olabilir.")
    if "base_url" in payload:
        base_url = payload["base_url"]
        if not isinstance(base_url, str):
            raise HTTPException(status_code=400, detail="base_url metin olmalı.")
        cleaned = base_url.strip()
        if len(cleaned) > 500:
            raise HTTPException(status_code=400, detail="base_url en çok 500 karakter olabilir.")
        if not _http_url(cleaned):
            raise HTTPException(status_code=400, detail="base_url http veya https adresi olmalı.")
    if not await _find_product(product_id):
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    return _present(payload, _PRODUCT_FIELDS)


async def _write(
    request: Request,
    scope: str,
    target_type: str,
    target_id: str,
    fn: _Apply,
    *,
    op: str,
    prepare: _Prepare,
    action: Optional[str] = None,
):
    """authenticate → Idempotency-Key → doğrulama → çakışma → run → yazma audit'i.

    400/404 prepare içinde, hiçbir koleksiyona yazmadan döner. Audit fn başarılı
    yazdıktan sonra, idempotency.run içinde atılır; aynı anahtar + gövde ikinci
    kez fn'i çağırmaz. action verilmezse eylem admin_v1.write.<op> kalır.
    """
    key_doc, payload = await _auth(request, scope)
    key_id = str(key_doc.get("_id") or "")
    idem_key = idempotency.header_key(request)
    if not idem_key:
        raise HTTPException(status_code=400, detail="Idempotency-Key gerekli")
    endpoint = _endpoint_of(request, payload)
    db = store._db
    ns = f"platform_admin:{key_id}"
    existing = await db.idempotency_keys.find_one({"_id": f"{ns}:{idem_key}"})
    if existing and str(existing.get("endpoint") or "") != endpoint:
        raise HTTPException(status_code=409, detail="Idempotency-Key farklı istekle kullanıldı")
    if (
        existing
        and existing.get("status") == "completed"
        and existing.get("response") is not None
        and str(existing.get("endpoint") or "") == endpoint
    ):
        return existing["response"]
    changed = await prepare(payload)

    async def run_fn():
        outcome = await fn(payload, key_doc)
        audit_fields: Optional[List[str]]
        if isinstance(outcome, tuple):
            response, audit_fields = outcome
        else:
            response, audit_fields = outcome, changed
        if audit_fields is not None:
            if action:
                details = (
                    dict(audit_fields)
                    if isinstance(audit_fields, dict)
                    else {"fields": sorted(audit_fields), "idempotency": True}
                )
                audit_action = action
            else:
                details = {"fields": sorted(audit_fields), "idempotency": True}
                audit_action = f"admin_v1.write.{op}"
            await store.write_audit(
                actor_type="api_key",
                actor_id=key_id,
                ip=request_ip(request),
                action=audit_action,
                target_type=target_type,
                target_id=str(target_id),
                details=details,
            )
        return _redact(response)

    return await idempotency.run(db, ns, request, endpoint, run_fn)


@router.put("/platform/admin-v1/companies/{company_id}/license")
async def admin_v1_update_license(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_license(company_id, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        await saas.apply_license_update(company_id, payload)
        return _item(await saas.effective(company_id))

    return await _write(
        request,
        store.SCOPE_ADMIN_LICENSES_WRITE,
        "company",
        company_id,
        apply,
        op="license.update",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/companies/{company_id}/modules/{module_key:path}")
async def admin_v1_toggle_module(company_id: str, module_key: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_module(company_id, module_key, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        await saas.apply_module_toggle(company_id, module_key, payload["enabled"])
        return _item(await saas.effective(company_id))

    return await _write(
        request,
        store.SCOPE_ADMIN_LICENSES_WRITE,
        "company",
        company_id,
        apply,
        op="module.toggle",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/companies/{company_id}/activation")
async def admin_v1_company_activation(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_activation(company_id, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        await saas.apply_company_activation(company_id, payload["active"])
        return _item(await saas.effective(company_id))

    return await _write(
        request,
        store.SCOPE_ADMIN_LICENSES_WRITE,
        "company",
        company_id,
        apply,
        op="company.activation",
        prepare=prepare,
    )


@router.put("/platform/admin-v1/upgrade-requests/{req_id}")
async def admin_v1_resolve_upgrade(req_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_upgrade(req_id, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        current = await saas._db.upgrade_requests.find_one({"_id": req_id})
        if current and current.get("status") == payload.get("status"):
            return _item(saas._clean(current)), None
        note = payload.get("note")
        apply_flag = payload["apply"] if "apply" in payload else True
        result = await saas.apply_upgrade_resolution(req_id, payload["status"], note, apply_flag)
        return _item(result)

    return await _write(
        request,
        store.SCOPE_ADMIN_REQUESTS_WRITE,
        "upgrade_request",
        req_id,
        apply,
        op="upgrade_request.resolve",
        prepare=prepare,
    )


@router.put("/platform/admin-v1/integrators/products/{product_id}")
async def admin_v1_update_product(product_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_product(product_id, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        body: Dict[str, Any] = {}
        if "name" in payload:
            body["name"] = payload["name"].strip()
        if "status" in payload:
            body["status"] = payload["status"].strip()
        if "base_url" in payload:
            body["base_url"] = payload["base_url"].strip()
        try:
            doc = await store.update_product(
                product_id,
                body,
                actor_id=str(key_doc.get("_id") or ""),
                ip=request_ip(request),
            )
        except LookupError:
            raise HTTPException(status_code=404, detail="Ürün bulunamadı") from None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        return _item(doc)

    return await _write(
        request,
        store.SCOPE_ADMIN_INTEGRATORS_WRITE,
        "product",
        product_id,
        apply,
        op="product.update",
        prepare=prepare,
    )
