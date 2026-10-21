"""admin-v1 ynt eşliği: firma, paket, eklenti, bildirim, destek ve entegratör yazmaları.

Okuma uçları platform_admin_v1 içindedir. Silme işlemleri danger prepare/confirm akışındadır.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request

from client_ip import request_ip
import addons
import einvoice_assign
import event_notify
import saas
import support_tickets
import platform_store as store
from platform_admin_v1 import _item
from platform_admin_v1_write import (
    _company_or_404,
    _http_url,
    _iso_or_null,
    _present,
    _reject_unknown,
    _require_bool,
    _write,
)

router = APIRouter(prefix="/api", tags=["platform-admin-v1-ops"])

_COMPANY_FIELDS = (
    "name",
    "tax_number",
    "tax_office",
    "address",
    "city",
    "phone",
    "admin_name",
    "admin_email",
    "admin_password",
    "plan_id",
    "trial_days",
    "expires_at",
    "billing_period",
    "notes",
)
_CHILD_FIELDS = (
    "name",
    "tax_number",
    "tax_office",
    "address",
    "city",
    "phone",
    "email",
    "admin_name",
    "admin_email",
    "admin_password",
    "separate_login",
)
_PLAN_FIELDS = (
    "name",
    "tagline",
    "price_monthly",
    "price_yearly",
    "user_limit",
    "company_limit",
    "product_limit",
    "contact_limit",
    "storage_limit_mb",
    "modules",
    "color",
    "sort",
    "is_public",
    "is_popular",
)
_PLAN_INTS = (
    "user_limit",
    "company_limit",
    "product_limit",
    "contact_limit",
    "storage_limit_mb",
    "sort",
)
_PLAN_MONEY = ("price_monthly", "price_yearly")
_NOTIFY_FIELDS = (
    "events",
    "extra_emails",
    "email_from",
    "gib_credits_threshold",
    "daily_email_cap",
)
_REPLY_FIELDS = ("body", "attachments", "is_internal", "status", "operator_email")
_STATUS_FIELDS = ("status", "operator_email")
_PRODUCT_FIELDS = ("code", "name", "kind", "status", "base_url")
_PRODUCT_KINDS = ("erp", "ecommerce", "other")
_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
_BILLING = ("monthly", "yearly")


def _text(payload: Dict[str, Any], field: str, *, required: bool = False, max_len: int = 200, min_len: int = 0) -> Optional[str]:
    if field not in payload:
        if required:
            raise HTTPException(status_code=400, detail=f"{field} zorunlu.")
        return None
    value = payload[field]
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail=f"{field} metin olmalı.")
    cleaned = value.strip()
    if required and not cleaned:
        raise HTTPException(status_code=400, detail=f"{field} boş olamaz.")
    if len(cleaned) < min_len:
        raise HTTPException(status_code=400, detail=f"{field} en az {min_len} karakter olmalı.")
    if len(value) > max_len:
        raise HTTPException(status_code=400, detail=f"{field} en çok {max_len} karakter olabilir.")
    return cleaned


def _int_field(payload: Dict[str, Any], field: str, *, min_v: int, max_v: int, required: bool = False) -> None:
    if field not in payload:
        if required:
            raise HTTPException(status_code=400, detail=f"{field} zorunlu.")
        return
    value = payload[field]
    if isinstance(value, bool) or not isinstance(value, int) or not min_v <= value <= max_v:
        raise HTTPException(
            status_code=400,
            detail=f"{field} {min_v} ile {max_v} arasında bir tamsayı olmalı.",
        )


def _money(payload: Dict[str, Any], field: str) -> None:
    if field not in payload:
        return
    value = payload[field]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HTTPException(status_code=400, detail=f"{field} sayı olmalı.")
    if value < 0 or value > 1_000_000_000:
        raise HTTPException(status_code=400, detail=f"{field} 0 ile 1000000000 arasında olmalı.")


def _modules(payload: Dict[str, Any]) -> None:
    if "modules" not in payload:
        return
    mods = payload["modules"]
    if not isinstance(mods, list) or any(not isinstance(item, str) for item in mods):
        raise HTTPException(status_code=400, detail="modules metin listesi olmalı.")
    unknown = [item for item in mods if item not in saas._ALL]
    if unknown:
        raise HTTPException(status_code=400, detail="Bilinmeyen modül.")


async def _operator(payload: Dict[str, Any]) -> str:
    from platform_admin_v1_danger import _operator_or_403

    return await _operator_or_403(payload)


async def _staff(payload: Dict[str, Any], key_doc: dict) -> dict:
    email = await _operator(payload)
    user = await saas._db.users.find_one({"email": email}) or {}
    uid = user.get("_id") or str(key_doc.get("_id") or "")
    return {"id": uid, "_id": uid, "email": email, "name": user.get("name") or email}


async def _audit_created(request: Request, key_doc: dict, op: str, target_type: str, target_id: str, fields: List[str]) -> None:
    safe = [name for name in fields if "password" not in name and "secret" not in name]
    await store.write_audit(
        actor_type="api_key",
        actor_id=str(key_doc.get("_id") or ""),
        ip=request_ip(request),
        action=f"admin_v1.write.{op}",
        target_type=target_type,
        target_id=str(target_id),
        details={"fields": sorted(safe), "idempotency": True},
    )


def _plan_shape(payload: Dict[str, Any], *, create: bool) -> List[str]:
    allowed = _PLAN_FIELDS + (("code",) if create else ())
    _reject_unknown(payload, allowed)
    if not payload:
        raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
    if create:
        _text(payload, "name", required=True, max_len=120)
    elif "name" in payload:
        _text(payload, "name", required=True, max_len=120)
    if "tagline" in payload:
        _text(payload, "tagline", max_len=300)
    if "color" in payload:
        _text(payload, "color", max_len=40)
    if "code" in payload:
        code = _text(payload, "code", required=True, max_len=40)
        if not _CODE_RE.match((code or "").lower()):
            raise HTTPException(status_code=400, detail="code yalnızca küçük harf, rakam, _ ve - içerebilir.")
    for field in _PLAN_MONEY:
        _money(payload, field)
    for field in _PLAN_INTS:
        _int_field(payload, field, min_v=0, max_v=10_000_000)
    _modules(payload)
    for field in ("is_public", "is_popular"):
        if field in payload and not isinstance(payload[field], bool):
            raise HTTPException(status_code=400, detail=f"{field} boolean olmalı.")
    return _present(payload, allowed)


async def _prepare_company(payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, _COMPANY_FIELDS)
    _text(payload, "name", required=True, max_len=200)
    _text(payload, "admin_email", required=True, max_len=200)
    _text(payload, "admin_password", required=True, max_len=200, min_len=6)
    for field, limit in (
        ("tax_number", 32),
        ("tax_office", 120),
        ("address", 500),
        ("city", 80),
        ("phone", 40),
        ("admin_name", 200),
    ):
        if field in payload:
            _text(payload, field, max_len=limit)
    if "plan_id" in payload:
        _text(payload, "plan_id", required=True, max_len=80)
    _int_field(payload, "trial_days", min_v=0, max_v=3650)
    if "expires_at" in payload:
        _iso_or_null(payload["expires_at"], "expires_at")
    if "billing_period" in payload and payload["billing_period"] not in _BILLING:
        raise HTTPException(status_code=400, detail="billing_period monthly veya yearly olmalı.")
    if "notes" in payload:
        _text(payload, "notes", max_len=2000)
    await saas.validate_new_company(payload)
    return _present(payload, _COMPANY_FIELDS)


async def _prepare_child(company_id: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, _CHILD_FIELDS)
    _text(payload, "name", required=True, max_len=200)
    for field, limit in (
        ("tax_number", 32),
        ("tax_office", 120),
        ("address", 500),
        ("city", 80),
        ("phone", 40),
        ("email", 200),
        ("admin_name", 200),
        ("admin_email", 200),
    ):
        if field in payload:
            _text(payload, field, max_len=limit)
    if "admin_password" in payload:
        _text(payload, "admin_password", required=True, max_len=200, min_len=6)
    if "separate_login" in payload and not isinstance(payload["separate_login"], bool):
        raise HTTPException(status_code=400, detail="separate_login boolean olmalı.")
    await saas.validate_licensed_company(company_id, payload)
    return _present(payload, _CHILD_FIELDS)


async def _prepare_einvoice(company_id: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, ("provider",))
    provider = _text(payload, "provider", required=True, max_len=40)
    if provider and provider not in einvoice_assign.KNOWN_PROVIDERS:
        raise HTTPException(status_code=400, detail="Desteklenmeyen entegratör.")
    await _company_or_404(company_id)
    return ["provider"]


async def _prepare_notify(company_id: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, _NOTIFY_FIELDS)
    if not payload:
        raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
    if "events" in payload and not isinstance(payload["events"], dict):
        raise HTTPException(status_code=400, detail="events nesne olmalı.")
    if "extra_emails" in payload:
        emails = payload["extra_emails"]
        if not isinstance(emails, list) or any(not isinstance(item, str) for item in emails):
            raise HTTPException(status_code=400, detail="extra_emails metin listesi olmalı.")
        if len(emails) > 30:
            raise HTTPException(status_code=400, detail="extra_emails en çok 30 adres olabilir.")
    if "email_from" in payload and payload["email_from"] not in event_notify.EMAIL_FROM_MODES:
        raise HTTPException(status_code=400, detail="email_from platform veya company olmalı.")
    _int_field(payload, "gib_credits_threshold", min_v=1, max_v=10_000)
    if "daily_email_cap" in payload and payload["daily_email_cap"] is not None:
        _int_field(payload, "daily_email_cap", min_v=1, max_v=100_000)
    await event_notify._require_existing_company(company_id)
    return _present(payload, _NOTIFY_FIELDS)


async def _prepare_addon(company_id: str, addon_key: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, ("enabled", "inherit"))
    if "inherit" in payload:
        if payload["inherit"] is not True:
            raise HTTPException(status_code=400, detail="inherit true olmalı.")
        if "enabled" in payload:
            raise HTTPException(status_code=400, detail="enabled ve inherit birlikte gönderilemez.")
    else:
        _require_bool(payload, "enabled")
    if addon_key not in addons.ADDON_KEYS:
        raise HTTPException(status_code=400, detail="Bilinmeyen araç.")
    await _company_or_404(company_id)
    return _present(payload, ("enabled", "inherit"))


async def _prepare_prices(payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, ("prices",))
    prices = payload.get("prices")
    if not isinstance(prices, dict) or not prices:
        raise HTTPException(status_code=400, detail="prices zorunlu.")
    for key, value in prices.items():
        if not isinstance(key, str):
            raise HTTPException(status_code=400, detail="Modül anahtarı metin olmalı.")
        module = key if key.startswith("/") else "/" + key.lstrip("/")
        if module not in saas._ALL:
            raise HTTPException(status_code=400, detail="Bilinmeyen modül.")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value > 1_000_000_000:
            raise HTTPException(status_code=400, detail="Modül fiyatı 0 veya daha büyük bir sayı olmalı.")
    return ["prices"]


def _reply_ready(payload: Dict[str, Any]) -> None:
    body = payload.get("body") if "body" in payload else ""
    if "body" in payload and not isinstance(body, str):
        raise HTTPException(status_code=400, detail="body metin olmalı.")
    if isinstance(body, str) and len(body) > support_tickets.MAX_BODY:
        raise HTTPException(status_code=400, detail=f"body en çok {support_tickets.MAX_BODY} karakter olabilir.")
    if "attachments" in payload and not isinstance(payload["attachments"], list):
        raise HTTPException(status_code=400, detail="attachments liste olmalı.")
    if "is_internal" in payload and not isinstance(payload["is_internal"], bool):
        raise HTTPException(status_code=400, detail="is_internal boolean olmalı.")
    if "status" in payload and payload["status"] not in support_tickets.STATUSES:
        raise HTTPException(status_code=400, detail="Geçersiz durum.")
    text = str(body or "").strip()
    files = support_tickets.sanitize_attachments(payload.get("attachments"))
    if len(text) < 1 and not files:
        raise HTTPException(status_code=400, detail="Mesaj veya ekran görüntüsü gerekli.")


async def _prepare_reply(ticket_id: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, _REPLY_FIELDS)
    _reply_ready(payload)
    await _operator(payload)
    if not await support_tickets._db.support_tickets.find_one({"_id": ticket_id}):
        raise HTTPException(status_code=404, detail="Destek talebi bulunamadı.")
    return _present(payload, _REPLY_FIELDS)


async def _prepare_status(ticket_id: str, payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, _STATUS_FIELDS)
    if "status" not in payload:
        raise HTTPException(status_code=400, detail="status zorunlu.")
    if payload["status"] not in support_tickets.STATUSES:
        raise HTTPException(status_code=400, detail="Geçersiz durum.")
    await _operator(payload)
    if not await support_tickets._db.support_tickets.find_one({"_id": ticket_id}):
        raise HTTPException(status_code=404, detail="Destek talebi bulunamadı.")
    return _present(payload, _STATUS_FIELDS)


async def _prepare_product_create(payload: Dict[str, Any]) -> List[str]:
    _reject_unknown(payload, _PRODUCT_FIELDS)
    code = _text(payload, "code", required=True, max_len=40)
    if not _CODE_RE.match((code or "").lower()):
        raise HTTPException(status_code=400, detail="code yalnızca küçük harf, rakam, _ ve - içerebilir.")
    if "name" in payload:
        _text(payload, "name", required=True, max_len=200)
    if "kind" in payload and payload["kind"] not in _PRODUCT_KINDS:
        raise HTTPException(status_code=400, detail="kind erp, ecommerce veya other olmalı.")
    if "status" in payload:
        _text(payload, "status", required=True, max_len=40)
    if "base_url" in payload:
        base_url = _text(payload, "base_url", max_len=500)
        if base_url and not _http_url(base_url):
            raise HTTPException(status_code=400, detail="base_url http veya https adresi olmalı.")
    if await store._db.platform_products.find_one({"code": (code or "").lower()}):
        raise HTTPException(status_code=400, detail="Bu ürün kodu zaten var")
    return _present(payload, _PRODUCT_FIELDS)


@router.post("/platform/admin-v1/companies")
async def admin_v1_create_company(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_company(payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        row = await saas.apply_create_company(payload)
        await _audit_created(request, key_doc, "company.create", "company", row.get("id") or "", list(payload))
        return _item(row), None

    return await _write(
        request,
        store.SCOPE_ADMIN_LICENSES_WRITE,
        "company",
        "new",
        apply,
        op="company.create",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/companies/{company_id}/companies")
async def admin_v1_add_child(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_child(company_id, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        doc = await saas.add_licensed_company(company_id, payload)
        row = await saas._company_row(doc)
        await _audit_created(request, key_doc, "company.child.create", "company", row.get("id") or "", list(payload))
        return _item(row), None

    return await _write(
        request,
        store.SCOPE_ADMIN_LICENSES_WRITE,
        "company",
        company_id,
        apply,
        op="company.child.create",
        prepare=prepare,
    )


@router.put("/platform/admin-v1/companies/{company_id}/parent")
async def admin_v1_set_parent(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ("parent_company_id",))
        parent_id = _text(payload, "parent_company_id", required=True, max_len=80)
        await saas.prepare_company_parent(company_id, parent_id or "")
        return ["parent_company_id"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        row = await saas.apply_set_company_parent(company_id, payload["parent_company_id"])
        return _item(row)

    return await _write(
        request,
        store.SCOPE_ADMIN_LICENSES_WRITE,
        "company",
        company_id,
        apply,
        op="company.parent",
        prepare=prepare,
    )


@router.put("/platform/admin-v1/companies/{company_id}/einvoice")
async def admin_v1_assign_einvoice(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_einvoice(company_id, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        doc = await einvoice_assign.assign_company_provider(saas._db, company_id, payload["provider"])
        return _item(einvoice_assign.public_assignment(company_id, doc))

    return await _write(
        request,
        store.SCOPE_ADMIN_INTEGRATORS_WRITE,
        "company",
        company_id,
        apply,
        op="company.einvoice",
        prepare=prepare,
    )


@router.put("/platform/admin-v1/companies/{company_id}/notify-prefs")
async def admin_v1_notify_prefs(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_notify(company_id, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        key_id = str(key_doc.get("_id") or "")
        before = await event_notify.get_prefs(company_id)
        await event_notify.save_prefs(company_id, payload)
        actor = {"id": key_id, "_id": key_id, "email": "", "name": f"api_key:{key_id}"}
        await event_notify._audit_prefs_put(
            company_id, actor, before, await event_notify.get_prefs(company_id),
            f"/api/platform/admin-v1/companies/{company_id}/notify-prefs",
        )
        saved = await event_notify.present_prefs(await event_notify.get_prefs(company_id), with_usage=True)
        return _item(saved)

    return await _write(
        request,
        store.SCOPE_ADMIN_NOTIFICATIONS_WRITE,
        "company",
        company_id,
        apply,
        op="notify.prefs",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/companies/{company_id}/addons/{addon_key}")
async def admin_v1_addon(company_id: str, addon_key: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_addon(company_id, addon_key, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        row = await addons.apply_company_addon(company_id, addon_key, payload)
        return _item(row)

    return await _write(
        request,
        store.SCOPE_ADMIN_LICENSES_WRITE,
        "company",
        company_id,
        apply,
        op="addon.toggle",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/plans")
async def admin_v1_create_plan(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return _plan_shape(payload, create=True)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        body = dict(payload)
        if isinstance(body.get("code"), str):
            body["code"] = body["code"].strip().lower()
        row = await saas.apply_create_plan(body)
        await _audit_created(request, key_doc, "plan.create", "plan", row.get("id") or "", list(body))
        return _item(row), None

    return await _write(
        request,
        store.SCOPE_ADMIN_LICENSES_WRITE,
        "plan",
        "new",
        apply,
        op="plan.create",
        prepare=prepare,
    )


@router.put("/platform/admin-v1/plans/{plan_id}")
async def admin_v1_update_plan(plan_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        changed = _plan_shape(payload, create=False)
        if not await saas._db.saas_plans.find_one({"_id": plan_id}):
            raise HTTPException(status_code=404, detail="Paket bulunamadı.")
        return changed

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await saas.apply_update_plan(plan_id, payload))

    return await _write(
        request,
        store.SCOPE_ADMIN_LICENSES_WRITE,
        "plan",
        plan_id,
        apply,
        op="plan.update",
        prepare=prepare,
    )


@router.put("/platform/admin-v1/modules/prices")
async def admin_v1_module_prices(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_prices(payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        prices: Dict[str, float] = {}
        for key, value in payload["prices"].items():
            module = key if str(key).startswith("/") else "/" + str(key).lstrip("/")
            prices[module] = float(value)
        catalog = await saas.write_module_prices(prices)
        return _item(catalog)

    return await _write(
        request,
        store.SCOPE_ADMIN_LICENSES_WRITE,
        "platform",
        "module_prices",
        apply,
        op="module.prices",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/support/tickets/{ticket_id}/messages")
async def admin_v1_support_reply(ticket_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_reply(ticket_id, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        admin = await _staff(payload, key_doc)
        ticket = await support_tickets.apply_staff_reply(ticket_id, payload, admin)
        return _item(ticket)

    return await _write(
        request,
        store.SCOPE_ADMIN_SUPPORT_WRITE,
        "support_ticket",
        ticket_id,
        apply,
        op="support.reply",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/support/tickets/{ticket_id}/status")
async def admin_v1_support_status(ticket_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_status(ticket_id, payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        admin = await _staff(payload, key_doc)
        ticket = await support_tickets.apply_staff_status(ticket_id, payload, admin)
        return _item(ticket)

    return await _write(
        request,
        store.SCOPE_ADMIN_SUPPORT_WRITE,
        "support_ticket",
        ticket_id,
        apply,
        op="support.status",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/integrators/products")
async def admin_v1_create_product(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        return await _prepare_product_create(payload)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        body = {
            "code": payload["code"].strip().lower(),
            "name": payload["name"].strip() if isinstance(payload.get("name"), str) else payload.get("code"),
            "kind": payload.get("kind") or "other",
            "status": payload["status"].strip() if isinstance(payload.get("status"), str) else "active",
            "base_url": payload["base_url"].strip() if isinstance(payload.get("base_url"), str) else "",
        }
        try:
            doc = await store.create_product(
                body,
                actor_id=str(key_doc.get("_id") or ""),
                ip=request_ip(request),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        await _audit_created(request, key_doc, "product.create", "product", doc.get("id") or "", list(body))
        return _item(doc), None

    return await _write(
        request,
        store.SCOPE_ADMIN_INTEGRATORS_WRITE,
        "product",
        "new",
        apply,
        op="product.create",
        prepare=prepare,
    )
