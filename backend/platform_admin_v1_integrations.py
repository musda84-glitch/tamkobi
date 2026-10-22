"""admin-v1: e-fatura kimliği, SMS, AI, PayTR, SMTP/IMAP.

Parola ve API anahtarı yazılır, okunmaz. Yanıtta configured ve maskeli ipucu vardır.
İşNet testi, destek paketi, sistem gelen kutusu (salt okunur) ve test postası da buradadır.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request

import isnet
import platform_mail
import platform_sms
import platform_store as store
import saas
import saas_billing
import saas_extras
from platform_admin_v1 import _auth, _drop_key, _item, _redact
from platform_admin_v1_write import (
    _company_or_404,
    _present,
    _reject_unknown,
    _require_bool,
    _write,
    audit_field_names,
    body_has_secret,
    require_secret_scope,
)

router = APIRouter(prefix="/api", tags=["platform-admin-v1-integrations"])

_EINVOICE_FIELDS = (
    "mode",
    "username",
    "api_url",
    "alias",
    "corporate_code",
    "company_tax_id",
    "company_vendor_number",
    "series_vendor_map",
    "auto_pull",
    "auto_process",
    "e_dispatch_enabled",
    "despatch_defaults",
    "password",
    "api_key",
    "erp_code",
    "efatura_url",
    "earsiv_url",
)
_SETTINGS_FIELDS = (
    "email_enabled", "whatsapp_enabled", "sender_company_id", "support_email", "support_phone",
    "support_whatsapp", "brand_name", "trial_plan_id", "public_url",
    "legal_name", "legal_address", "legal_city", "legal_tax_number", "legal_tax_office",
    "legal_mersis", "legal_iban", "legal_bank_name", "legal_phone", "legal_email", "legal_website",
    "gib_credits_sales", "require_superadmin_2fa", "notify_order_batch_minutes_default",
    "notify_daily_email_cap_default", "reminder_days", "trial_days", "gib_packs",
)
_PAYTR_FIELDS = ("enabled", "test_mode", "merchant_id", "max_installment", "merchant_key", "merchant_salt")
_AI_FIELDS = ("enabled", "provider", "advisor_model", "extract_model", "base_url", "api_key", "clear_key")
_SMS_FIELDS = ("provider", "usercode", "msgheader", "is_active", "password")
_MAIL_SERVER_FIELDS = ("name", "provider", "smtp_host", "smtp_port", "smtp_user", "email", "password", "is_active")
_MAILBOX_FIELDS = (
    "email", "display_name", "server_id", "smtp_user", "reply_to", "purposes",
    "allow_all_admins", "allowed_user_ids", "is_default", "is_active", "password",
)


_DANGER_PUBLIC_URL = "public_url danger/settings.public_url ile değişir."
_DANGER_SUPERADMIN_2FA = "require_superadmin_2fa danger/settings.require_superadmin_2fa ile değişir."
_ENDPOINT_EINVOICE = ("api_url", "efatura_url", "earsiv_url", "username")
_ENDPOINT_MAIL = ("smtp_host", "smtp_port", "smtp_user")
_SECRET_EINVOICE = ("password", "api_key")


def _hint(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) <= 2:
        return "•••"
    return text[:2] + "•••" + text[-2:]


def _text(value: Any) -> str:
    return str(value or "").strip()


def _nonempty_secret(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _endpoint_changed(current: dict, payload: dict, fields: tuple) -> bool:
    """İstekteki uç, host veya kullanıcı kayıtlı değerden farklı mı."""
    for field in fields:
        if field not in payload:
            continue
        if _text(payload.get(field)) != _text(current.get(field)):
            return True
    return False


def _mailbox_binding_changed(current: dict, payload: dict) -> bool:
    """IMAP kullanıcısı, SMTP kullanıcısı veya bağlı sunucu değişiyor mu.

    E-posta karşılaştırması kayıtla aynı biçimde küçültülür; yalnız harf farkı yeni kullanıcı değildir.
    """
    if "email" in payload and platform_mail._norm_email(str(payload.get("email") or "")) != platform_mail._norm_email(str(current.get("email") or "")):
        return True
    if "smtp_user" in payload and payload.get("smtp_user") is not None and _text(payload.get("smtp_user")) != _text(current.get("smtp_user")):
        return True
    if "server_id" in payload and _text(payload.get("server_id")) != _text(current.get("server_id")):
        return True
    return False


def _sms_binding_changed(current: dict, payload: dict) -> bool:
    """Sağlayıcı sabit satıcı ucunu seçer; kullanıcı kodu o şifrenin hesabıdır.

    Boş sağlayıcı save_platform_sms içinde kayıtlı sağlayıcıda kalır. Özel SMS adresi yoktur.
    """
    import comm_service
    if payload.get("provider") and comm_service.normalize_sms_provider(payload.get("provider")) != comm_service.normalize_sms_provider(current.get("provider")):
        return True
    if "usercode" in payload and payload.get("usercode") is not None and _text(payload.get("usercode")) != _text(current.get("usercode")):
        return True
    return False


def _ai_target_changed(current: dict, payload: dict) -> bool:
    if "provider" in payload and _text(payload.get("provider")) != _text(current.get("provider")):
        return True
    if "base_url" in payload and saas_extras._ai_endpoint(payload.get("base_url")) != saas_extras._ai_endpoint(current.get("base_url")):
        return True
    return False


async def _stored_ai() -> dict:
    st = await saas_billing.settings()
    raw = st.get("ai") or {}
    return raw if isinstance(raw, dict) else {}


def _safe_einvoice(company_id: str, doc: dict) -> dict:
    import server
    view = server._einvoice_view(company_id, doc or {})
    username = str(view.get("username") or "")
    return {
        "company_id": company_id,
        "provider": view.get("provider") or "",
        "provider_name": view.get("provider_name") or "",
        "assigned": bool(view.get("assigned")),
        "configured": view.get("status") == "configured",
        "status": view.get("status") or "simulated",
        "mode": view.get("mode") or "test",
        "username_configured": bool(username),
        "username_hint": _hint(username),
        "has_password": bool(view.get("has_password")),
        "has_api_key": bool(view.get("has_api_key")),
        "alias": view.get("alias") or "",
        "corporate_code": view.get("corporate_code") or "",
        "company_tax_id": view.get("company_tax_id") or "",
        "company_vendor_number": view.get("company_vendor_number") or "",
        "series_vendor_map": view.get("series_vendor_map") or {},
        "erp_code": view.get("erp_code") or "",
        "efatura_url": view.get("efatura_url") or "",
        "earsiv_url": view.get("earsiv_url") or "",
        "api_url": view.get("api_url") or "",
        "auto_pull": view.get("auto_pull"),
        "auto_process": view.get("auto_process"),
        "e_dispatch_enabled": view.get("e_dispatch_enabled"),
        "despatch_defaults": view.get("despatch_defaults") or {},
        "fields": view.get("fields") or [],
    }


def _safe_settings(st: dict) -> dict:
    iban = str(st.get("legal_iban") or "")
    out = {}
    for key in _SETTINGS_FIELDS:
        if key in ("legal_iban", "gib_packs"):
            continue
        if key in st:
            out[key] = st.get(key)
    out["legal_iban_configured"] = bool(iban)
    out["legal_iban_hint"] = _hint(iban)
    packs = st.get("gib_packs")
    out["gib_packs"] = packs if isinstance(packs, list) else []
    out.pop("ai", None)
    out.pop("paytr", None)
    return out


async def _einvoice_doc(company_id: str) -> dict:
    return await saas._db.einvoice_settings.find_one({"company_id": company_id}) or {}


@router.get("/platform/admin-v1/companies/{company_id}/einvoice")
async def admin_v1_einvoice_read(company_id: str, request: Request):
    await _auth(request, store.SCOPE_ADMIN_EINVOICE_READ)
    await _company_or_404(company_id)
    return _redact(_safe_einvoice(company_id, await _einvoice_doc(company_id)))


@router.put("/platform/admin-v1/companies/{company_id}/einvoice/credentials")
async def admin_v1_einvoice_credentials(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _EINVOICE_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        if "mode" in payload and payload["mode"] not in ("test", "live"):
            raise HTTPException(status_code=400, detail="mode test veya live olmalı.")
        if "despatch_defaults" in payload and not isinstance(payload["despatch_defaults"], dict):
            raise HTTPException(status_code=400, detail="despatch_defaults nesne olmalı.")
        for flag in ("auto_pull", "auto_process", "e_dispatch_enabled"):
            if flag in payload and not isinstance(payload[flag], bool):
                raise HTTPException(status_code=400, detail=f"{flag} boolean olmalı.")
        await _company_or_404(company_id)
        current = await _einvoice_doc(company_id)
        if not current.get("provider"):
            raise HTTPException(status_code=400, detail="Önce entegratör atayın.")
        if _endpoint_changed(current, payload, _ENDPOINT_EINVOICE):
            await require_secret_scope(key_doc)
        return audit_field_names(_present(payload, _EINVOICE_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        import server
        current = await _einvoice_doc(company_id)
        changed = _endpoint_changed(current, payload, _ENDPOINT_EINVOICE)
        body = {"company_id": company_id, **payload}
        if changed:
            for secret in _SECRET_EINVOICE:
                if secret in body and not _nonempty_secret(body.get(secret)):
                    body.pop(secret)
        await server.save_einvoice_settings(body, None)
        if changed:
            unset = {
                f"{secret}_enc": ""
                for secret in _SECRET_EINVOICE
                if not _nonempty_secret(payload.get(secret))
            }
            if unset:
                await saas._db.einvoice_settings.update_one({"company_id": company_id}, {"$unset": unset})
        doc = await _einvoice_doc(company_id)
        return _item(_safe_einvoice(company_id, doc)), audit_field_names(_present(payload, _EINVOICE_FIELDS))

    return await _write(
        request,
        store.SCOPE_ADMIN_EINVOICE_WRITE,
        "company",
        company_id,
        apply,
        op="einvoice.credentials",
        prepare=prepare,
    )


@router.get("/platform/admin-v1/einvoice/isnet/egress")
async def admin_v1_isnet_egress(request: Request):
    await _auth(request, store.SCOPE_ADMIN_EINVOICE_READ)
    info = await isnet.isnet_ip_registration_info()
    return _redact({
        "egress_ips": info.get("egress_ips") or [],
        "production_host": info.get("production_host") or "",
        "production_ips": info.get("production_ips") or [],
        "same_as_production": bool(info.get("same_as_production")),
        "support_email": info.get("support_email") or "",
    })


@router.put("/platform/admin-v1/sms/settings")
async def admin_v1_sms_save(request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _SMS_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        if "is_active" in payload:
            _require_bool(payload, "is_active")
        if _sms_binding_changed(await platform_sms.load_settings(), payload):
            await require_secret_scope(key_doc)
        return audit_field_names(_present(payload, _SMS_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        view = await platform_sms.save_platform_sms(payload, {})
        return _item(view), audit_field_names(_present(payload, _SMS_FIELDS))

    return await _write(
        request,
        store.SCOPE_ADMIN_SMS_WRITE,
        "platform",
        "sms",
        apply,
        op="sms.save",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/sms/verify")
async def admin_v1_sms_verify(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        return ["verify"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await platform_sms.verify_platform_sms({}))

    return await _write(
        request, store.SCOPE_ADMIN_SMS_WRITE, "platform", "sms", apply, op="sms.verify", prepare=prepare,
    )


@router.post("/platform/admin-v1/sms/balance")
async def admin_v1_sms_balance(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        return ["balance"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await platform_sms.platform_sms_balance({}))

    return await _write(
        request, store.SCOPE_ADMIN_SMS_WRITE, "platform", "sms", apply, op="sms.balance", prepare=prepare,
    )


@router.post("/platform/admin-v1/sms/send-test")
async def admin_v1_sms_send_test(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ("phone", "message"))
        phone = payload.get("phone")
        if not isinstance(phone, str) or not phone.strip():
            raise HTTPException(status_code=400, detail="phone zorunlu.")
        if "message" in payload and not isinstance(payload["message"], str):
            raise HTTPException(status_code=400, detail="message metin olmalı.")
        return ["phone"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await platform_sms.platform_sms_send_test(payload, {}))

    return await _write(
        request, store.SCOPE_ADMIN_SMS_WRITE, "platform", "sms", apply, op="sms.send_test", prepare=prepare,
    )


@router.get("/platform/admin-v1/ai")
async def admin_v1_ai_read(request: Request):
    await _auth(request, store.SCOPE_ADMIN_AI_READ)
    return _redact(await saas_extras._system_ai_public())


@router.put("/platform/admin-v1/ai")
async def admin_v1_ai_save(request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _AI_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        if "enabled" in payload:
            _require_bool(payload, "enabled")
        if "clear_key" in payload and not isinstance(payload["clear_key"], bool):
            raise HTTPException(status_code=400, detail="clear_key boolean olmalı.")
        if _ai_target_changed(await _stored_ai(), payload):
            await require_secret_scope(key_doc)
        return audit_field_names(_present(payload, _AI_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        body = dict(payload)
        if _ai_target_changed(await _stored_ai(), body) and not _nonempty_secret(body.get("api_key")):
            body.pop("api_key", None)
            body["clear_key"] = True
        view = await saas_extras.put_system_ai(body, {})
        return _item(view), audit_field_names(_present(payload, _AI_FIELDS))

    return await _write(
        request, store.SCOPE_ADMIN_AI_WRITE, "platform", "ai", apply, op="ai.save", prepare=prepare,
    )


@router.post("/platform/admin-v1/ai/test")
async def admin_v1_ai_test(request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _AI_FIELDS)
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        return audit_field_names(_present(payload, _AI_FIELDS) or ["test"])

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await saas_extras.test_system_ai(payload, {})), audit_field_names(_present(payload, _AI_FIELDS) or ["test"])

    return await _write(
        request, store.SCOPE_ADMIN_AI_WRITE, "platform", "ai", apply, op="ai.test", prepare=prepare,
    )


@router.get("/platform/admin-v1/paytr")
async def admin_v1_paytr_read(request: Request):
    await _auth(request, store.SCOPE_ADMIN_SETTINGS_READ)
    return _redact(await saas_extras._paytr_public())


@router.put("/platform/admin-v1/paytr")
async def admin_v1_paytr_save(request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _PAYTR_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        for flag in ("enabled", "test_mode"):
            if flag in payload:
                _require_bool(payload, flag)
        if "max_installment" in payload:
            value = payload["max_installment"]
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise HTTPException(status_code=400, detail="max_installment tamsayı olmalı.")
        return audit_field_names(_present(payload, _PAYTR_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        view = await saas_extras.put_paytr(payload, {})
        return _item(view), audit_field_names(_present(payload, _PAYTR_FIELDS))

    return await _write(
        request, store.SCOPE_ADMIN_SETTINGS_WRITE, "platform", "paytr", apply, op="paytr.save", prepare=prepare,
    )


@router.post("/platform/admin-v1/paytr/test")
async def admin_v1_paytr_test(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        return ["test"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await saas_extras.test_paytr(request, {}))

    return await _write(
        request, store.SCOPE_ADMIN_SETTINGS_WRITE, "platform", "paytr", apply, op="paytr.test", prepare=prepare,
    )


@router.get("/platform/admin-v1/settings")
async def admin_v1_settings_read(request: Request):
    await _auth(request, store.SCOPE_ADMIN_SETTINGS_READ)
    return _redact(_safe_settings(await saas_billing.settings()))


@router.put("/platform/admin-v1/settings")
async def admin_v1_settings_save(request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _SETTINGS_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if "public_url" in payload:
            raise HTTPException(status_code=403, detail=_DANGER_PUBLIC_URL)
        if "require_superadmin_2fa" in payload:
            raise HTTPException(status_code=403, detail=_DANGER_SUPERADMIN_2FA)
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        for flag in ("email_enabled", "whatsapp_enabled", "gib_credits_sales"):
            if flag in payload and not isinstance(payload[flag], bool):
                raise HTTPException(status_code=400, detail=f"{flag} boolean olmalı.")
        return audit_field_names(_present(payload, _SETTINGS_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        body = {key: value for key, value in payload.items() if key not in ("public_url", "require_superadmin_2fa")}
        await saas_billing.put_settings(body, {})
        return _item(_safe_settings(await saas_billing.settings())), audit_field_names(_present(payload, _SETTINGS_FIELDS))

    return await _write(
        request, store.SCOPE_ADMIN_SETTINGS_WRITE, "platform", "settings", apply, op="settings.save", prepare=prepare,
    )


@router.get("/platform/admin-v1/mail")
async def admin_v1_mail_read(request: Request):
    await _auth(request, store.SCOPE_ADMIN_SETTINGS_READ)
    return _redact(await platform_mail.mail_overview({}))


@router.post("/platform/admin-v1/mail/servers")
async def admin_v1_mail_server_create(request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _MAIL_SERVER_FIELDS)
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        if not isinstance(payload.get("password"), str) or not payload["password"].strip():
            raise HTTPException(status_code=400, detail="SMTP şifresi zorunludur.")
        await require_secret_scope(key_doc)
        return audit_field_names(_present(payload, _MAIL_SERVER_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        row = await platform_mail.create_server(payload, {})
        return _item(row), audit_field_names(_present(payload, _MAIL_SERVER_FIELDS))

    return await _write(
        request, store.SCOPE_ADMIN_SETTINGS_WRITE, "mail_server", "new", apply, op="mail.server.create", prepare=prepare,
    )


@router.put("/platform/admin-v1/mail/servers/{server_id}")
async def admin_v1_mail_server_update(server_id: str, request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _MAIL_SERVER_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        current = await platform_mail._server(server_id)
        if _endpoint_changed(current, payload, _ENDPOINT_MAIL):
            await require_secret_scope(key_doc)
        return audit_field_names(_present(payload, _MAIL_SERVER_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        row = await platform_mail.update_server(server_id, payload, {})
        return _item(row), audit_field_names(_present(payload, _MAIL_SERVER_FIELDS))

    return await _write(
        request, store.SCOPE_ADMIN_SETTINGS_WRITE, "mail_server", server_id, apply, op="mail.server.update", prepare=prepare,
    )


@router.post("/platform/admin-v1/mail/servers/{server_id}/delete")
async def admin_v1_mail_server_delete(server_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        await platform_mail._server(server_id)
        return ["delete"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await platform_mail.delete_server(server_id, {}))

    return await _write(
        request, store.SCOPE_ADMIN_SETTINGS_WRITE, "mail_server", server_id, apply, op="mail.server.delete", prepare=prepare,
    )


@router.post("/platform/admin-v1/mail/servers/{server_id}/test")
async def admin_v1_mail_server_test(server_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        await platform_mail._server(server_id)
        return ["test"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await platform_mail.test_server(server_id, {}))

    return await _write(
        request, store.SCOPE_ADMIN_SETTINGS_WRITE, "mail_server", server_id, apply, op="mail.server.test", prepare=prepare,
    )


@router.post("/platform/admin-v1/mail/mailboxes")
async def admin_v1_mailbox_create(request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _MAILBOX_FIELDS)
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        if not isinstance(payload.get("email"), str):
            raise HTTPException(status_code=400, detail="email zorunlu.")
        if not isinstance(payload.get("server_id"), str) or not payload["server_id"].strip():
            raise HTTPException(status_code=400, detail="Posta sunucusu seçin.")
        return audit_field_names(_present(payload, _MAILBOX_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        row = await platform_mail.create_mailbox(payload, {"email": "api"})
        return _item(row), audit_field_names(_present(payload, _MAILBOX_FIELDS))

    return await _write(
        request, store.SCOPE_ADMIN_SETTINGS_WRITE, "mailbox", "new", apply, op="mail.mailbox.create", prepare=prepare,
    )


@router.put("/platform/admin-v1/mail/mailboxes/{box_id}")
async def admin_v1_mailbox_update(box_id: str, request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _MAILBOX_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        current = await platform_mail._box(box_id)
        if _mailbox_binding_changed(current, payload):
            await require_secret_scope(key_doc)
        return audit_field_names(_present(payload, _MAILBOX_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        row = await platform_mail.update_mailbox(box_id, payload, {})
        return _item(row), audit_field_names(_present(payload, _MAILBOX_FIELDS))

    return await _write(
        request, store.SCOPE_ADMIN_SETTINGS_WRITE, "mailbox", box_id, apply, op="mail.mailbox.update", prepare=prepare,
    )


@router.post("/platform/admin-v1/mail/mailboxes/{box_id}/delete")
async def admin_v1_mailbox_delete(box_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        await platform_mail._box(box_id)
        return ["delete"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await platform_mail.delete_mailbox(box_id, {}))

    return await _write(
        request, store.SCOPE_ADMIN_SETTINGS_WRITE, "mailbox", box_id, apply, op="mail.mailbox.delete", prepare=prepare,
    )


_ISNET_TEST_FIELDS = (
    "operator_email",
    "mode",
    "test_mode",
    "username",
    "corporate_code",
    "client_code",
    "alias",
    "gib_alias",
    "company_tax_id",
    "vkn",
    "company_vendor_number",
    "e_dispatch_enabled",
    "despatch_defaults",
    "series_vendor_map",
)
_EGRESS_FIELDS = (
    "egress_ips",
    "production_host",
    "production_ips",
    "same_as_production",
    "support_email",
    "message",
)
_PACK_FIELDS = (
    "request_xml",
    "request_headers",
    "endpoint",
    "response_txt",
    "egress_ips",
    "live_path",
    "http_status",
    "error",
    "elapsed_ms",
    "support_email",
)
_PACK_HEADER_KEEP = {"content-type", "soapaction"}
_SEND_TEST_FIELDS = ("operator_email", "mailbox_id", "to", "subject", "body")


def _egress_public(info: Dict[str, Any]) -> dict:
    out = {}
    for key in _EGRESS_FIELDS:
        if key in info:
            out[key] = info.get(key)
    out["egress_ips"] = list(out.get("egress_ips") or [])
    out["production_ips"] = list(out.get("production_ips") or [])
    out["same_as_production"] = bool(info.get("same_as_production"))
    return out


def _secret_needles(existing: dict) -> List[str]:
    """Kayıtlı sır değerleri ve İşNet deneme portal parolası. Kısa diziler metni bozmasın."""
    found: List[str] = []

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            for key, value in obj.items():
                if isinstance(value, str) and _drop_secret_key(key) and len(value.strip()) >= 8:
                    found.append(value.strip())
                elif isinstance(value, (dict, list)):
                    walk(value)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(existing or {})
    for key in ("password_enc", "api_key_enc"):
        stored = (existing or {}).get(key)
        if not isinstance(stored, str) or not stored.strip():
            continue
        try:
            import comm_service
            plain = comm_service.decrypt(stored)
        except Exception:
            plain = ""
        if isinstance(plain, str) and len(plain.strip()) >= 8:
            found.append(plain.strip())
    portal = str(getattr(isnet, "TEST_PORTAL_PASSWORD", "") or "")
    user = str(getattr(isnet, "TEST_PORTAL_USER", "") or "")
    if portal and user:
        found.append(f"{user} / {portal}")
    if portal:
        found.append(f" / {portal}")
    uniq: List[str] = []
    for value in sorted(set(found), key=len, reverse=True):
        if value not in uniq:
            uniq.append(value)
    return uniq


def _drop_secret_key(name: str) -> bool:
    return _drop_key(name, "")


def _scrub_text(text: str, needles: List[str]) -> str:
    for needle in needles:
        if needle and needle in text:
            text = text.replace(needle, "•••")
    return text


def _scrub_obj(obj: Any, needles: List[str]) -> Any:
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if _drop_secret_key(str(key)) or str(key).lower() in ("authorization", "cookie", "set-cookie"):
                continue
            out[key] = _scrub_obj(value, needles)
        return out
    if isinstance(obj, list):
        return [_scrub_obj(item, needles) for item in obj]
    if isinstance(obj, str):
        return _scrub_text(obj, needles)
    return obj


def _pack_headers(headers: Any) -> dict:
    if not isinstance(headers, dict):
        return {}
    out = {}
    for key, value in headers.items():
        if str(key).lower() not in _PACK_HEADER_KEEP:
            continue
        out[str(key)] = value
    return out


def _support_pack_public(pack: Dict[str, Any], existing: dict) -> dict:
    needles = _secret_needles(existing)
    raw = {key: pack.get(key) for key in _PACK_FIELDS if key in pack}
    raw["request_headers"] = _pack_headers(raw.get("request_headers"))
    return _scrub_obj(_redact(raw), needles)


async def _operator_user(payload: Dict[str, Any]) -> dict:
    from platform_admin_v1_danger import _operator_or_403

    email = await _operator_or_403(payload)
    user = await saas._db.users.find_one({"email": email}) or {}
    uid = user.get("_id") or ""
    return {
        "id": uid,
        "_id": uid,
        "email": email,
        "name": user.get("name") or email,
        "is_super_admin": True,
        "is_active": True,
    }


def _prepare_isnet_test(payload: Dict[str, Any]) -> None:
    _reject_unknown(payload, _ISNET_TEST_FIELDS)
    if "test_mode" in payload and not isinstance(payload["test_mode"], bool):
        raise HTTPException(status_code=400, detail="test_mode boolean olmalı.")
    if "e_dispatch_enabled" in payload and not isinstance(payload["e_dispatch_enabled"], bool):
        raise HTTPException(status_code=400, detail="e_dispatch_enabled boolean olmalı.")
    if "despatch_defaults" in payload and not isinstance(payload["despatch_defaults"], dict):
        raise HTTPException(status_code=400, detail="despatch_defaults nesne olmalı.")
    if "series_vendor_map" in payload and not isinstance(payload["series_vendor_map"], dict):
        raise HTTPException(status_code=400, detail="series_vendor_map nesne olmalı.")
    for field in (
        "mode", "username", "corporate_code", "client_code", "alias", "gib_alias",
        "company_tax_id", "vkn", "company_vendor_number",
    ):
        if field in payload and not isinstance(payload[field], str):
            raise HTTPException(status_code=400, detail=f"{field} metin olmalı.")


@router.post("/platform/admin-v1/companies/{company_id}/isnet/test")
async def admin_v1_isnet_test(company_id: str, request: Request):
    """Kayıtlı veya gövdedeki İşNet SOAP alanlarıyla bağlantı testi ve çıkış IP bilgisi.

    server.isnet_test_connection + server.isnet_egress_ips. Parola kabul edilmez.
    """
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _prepare_isnet_test(payload)
        await _operator_user(payload)
        await _company_or_404(company_id)
        return audit_field_names(_present(payload, _ISNET_TEST_FIELDS) or ["test"])

    async def apply(payload: Dict[str, Any], key_doc: dict):
        import server
        body = {key: value for key, value in payload.items() if key != "operator_email"}
        body["company_id"] = company_id
        caller = {"is_super_admin": True}
        existing = await server.db.einvoice_settings.find_one({"company_id": company_id}) or {}
        needles = _secret_needles(existing)
        try:
            info = await server.isnet_test_connection(body, caller)
        except HTTPException as exc:
            egress = _egress_public(await server.isnet_egress_ips())
            detail = exc.detail
            if isinstance(detail, str):
                detail = _scrub_text(detail, needles)
            raise HTTPException(
                status_code=exc.status_code,
                detail={"message": detail, "egress": _scrub_obj(egress, needles)},
            ) from exc
        merged = dict(info)
        merged["egress"] = _egress_public(await server.isnet_egress_ips())
        return _item(_scrub_obj(merged, needles)), audit_field_names(_present(payload, _ISNET_TEST_FIELDS) or ["test"])

    return await _write(
        request,
        store.SCOPE_ADMIN_EINVOICE_WRITE,
        "company",
        company_id,
        apply,
        op="isnet.test",
        prepare=prepare,
    )


@router.get("/platform/admin-v1/companies/{company_id}/isnet/support-pack")
async def admin_v1_isnet_support_pack(company_id: str, request: Request):
    """İşNet HealthCheck destek paketi. Eski /integrations/isnet/support-pack.

    Parola, password_enc ve yetki başlığı yanıta girmez.
    """
    await _auth(request, store.SCOPE_ADMIN_EINVOICE_READ)
    await _company_or_404(company_id)
    import server
    existing = await server.db.einvoice_settings.find_one({"company_id": company_id}) or {}
    caller = {"is_super_admin": True, "active_company_id": company_id}
    pack = await server.isnet_support_pack(company_id, caller)
    if not isinstance(pack, dict):
        pack = {}
    return _support_pack_public(pack, existing)


@router.get("/platform/admin-v1/mail/mailboxes/{box_id}/messages")
async def admin_v1_mailbox_messages(
    box_id: str,
    request: Request,
    page: int = Query(1, ge=1, le=1000),
    operator_email: Optional[str] = Query(None),
):
    """Sistem gelen kutusu listesi. IMAP salt okunur; okundu işareti yazılmaz."""
    await _auth(request, store.SCOPE_ADMIN_MAIL_READ)
    import platform_mail_inbox as inbox

    user = await _operator_user({"operator_email": operator_email})
    box = await inbox._authorized_box(box_id, user)
    password = await inbox._imap_password(box)
    try:
        listed = await inbox._run_imap(inbox.imap_list_inbox, inbox._imap_user(box), password, page)
    except inbox.InboxImapError as exc:
        inbox._raise_imap(box_id, exc)
    return _redact(listed)


@router.get("/platform/admin-v1/mail/mailboxes/{box_id}/messages/{uid}")
async def admin_v1_mailbox_message(
    box_id: str,
    uid: str,
    request: Request,
    operator_email: Optional[str] = Query(None),
    images: bool = Query(False),
):
    """Tek ileti. Eski gelen kutusu okuması; IMAP salt okunur."""
    await _auth(request, store.SCOPE_ADMIN_MAIL_READ)
    import platform_mail_inbox as inbox

    uid = inbox._check_uid(uid)
    user = await _operator_user({"operator_email": operator_email})
    box = await inbox._authorized_box(box_id, user)
    password = await inbox._imap_password(box)
    try:
        body = await inbox._run_imap(
            inbox.imap_read_inbox, inbox._imap_user(box), password, uid, images,
        )
    except inbox.InboxNotFound:
        raise HTTPException(status_code=404, detail="İleti bulunamadı.")
    except inbox.InboxImapError as exc:
        inbox._raise_imap(box_id, exc)
    await inbox._audit_open(user, box, uid, request)
    return _redact(body)


@router.post("/platform/admin-v1/mail/send-test")
async def admin_v1_mail_send_test(request: Request):
    """Seçilen sistem SMTP göndericisinden test postası. platform_mail.send_test."""
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _SEND_TEST_FIELDS)
        await _operator_user(payload)
        mailbox_id = payload.get("mailbox_id")
        if not isinstance(mailbox_id, str) or not mailbox_id.strip():
            raise HTTPException(status_code=400, detail="mailbox_id zorunlu.")
        to = payload.get("to")
        if not isinstance(to, str) or not to.strip():
            raise HTTPException(status_code=400, detail="to zorunlu.")
        if "subject" in payload:
            if not isinstance(payload["subject"], str):
                raise HTTPException(status_code=400, detail="subject metin olmalı.")
            if len(payload["subject"]) > 200:
                raise HTTPException(status_code=400, detail="subject en çok 200 karakter olabilir.")
        if "body" in payload:
            if not isinstance(payload["body"], str):
                raise HTTPException(status_code=400, detail="body metin olmalı.")
            if len(payload["body"]) > 4000:
                raise HTTPException(status_code=400, detail="body en çok 4000 karakter olabilir.")
        return ["mailbox_id", "to"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        user = await _operator_user(payload)
        req = {
            "mailbox_id": payload["mailbox_id"].strip(),
            "to": payload["to"],
        }
        if "subject" in payload:
            req["subject"] = payload["subject"]
        if "body" in payload:
            req["body"] = payload["body"]
        result = await platform_mail.send_test(req, user)
        return _item(result), {
            "fields": ["mailbox_id", "to"],
            "mailbox_id": req["mailbox_id"],
            "to": result.get("to"),
            "idempotency": True,
        }

    return await _write(
        request,
        store.SCOPE_ADMIN_SETTINGS_WRITE,
        "mailbox",
        "send-test",
        apply,
        op="mail.send_test",
        prepare=prepare,
        action="admin_v1.write.mail.send_test",
    )
