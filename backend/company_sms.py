"""Üye şirket SMS operatörü: ynt salt okunur, düzenleme firma panelinde (RBAC)."""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

YNT_SMS_WRITE_DENIED = (
    "Şirket SMS ayarları platform yönetiminden değiştirilemez. Firma paneli: Ayarlar → SMS."
)
YNT_SMS_READ_DENIED = (
    "Şirket SMS ayrıntısı platform yönetiminden okunamaz. Firma detayında yalnız özet görünür."
)


def is_ynt_sms_actor(request: Any, user: Optional[dict]) -> bool:
    """ynt host veya aud=ynt oturumu şirket SMS uçlarına yazamaz / sır okuyamaz."""
    import host_audience as ha

    aud = str((user or {}).get("_token_aud") or "")
    if aud == ha.AUD_YNT:
        return True
    if request is not None and ha.host_kind(request) == ha.KIND_YNT:
        return True
    return False


def settings_allows(role_code: Optional[str], permissions: Optional[dict], need: str) -> bool:
    """Firma Ayarları (/settings) seviyesi. Yönetici her zaman geçer."""
    import rbac

    if rbac.normalize_role_code(role_code) == "admin":
        return True
    return rbac.level_allows((permissions or {}).get("/settings"), need)


async def require_company_sms_settings(user: dict, company_id: str, need: str = "view") -> None:
    """Operatör ayarı, doğrula ve bakiye: Firma Ayarları yetkisi."""
    import rbac

    if settings_allows((user or {}).get("role"), None, need) and rbac.normalize_role_code(
        (user or {}).get("role")
    ) == "admin":
        return
    role = await rbac.role_for(user, company_id)
    if not settings_allows((user or {}).get("role"), role.get("permissions") or {}, need):
        raise HTTPException(
            status_code=403,
            detail="Firma Ayarları yetkisi gerekir (Ayarlar → SMS).",
        )


async def reject_ynt_company_sms(
    request: Any,
    user: Optional[dict],
    *,
    write: bool,
    action: str,
    company_id: str = "",
    method: str = "",
    path: str = "",
) -> None:
    """ynt oturumu şirket SMS uçlarına erişemez. Yazmada platform audit log yazılır."""
    if not is_ynt_sms_actor(request, user):
        return
    if write:
        try:
            import platform_store as store
            from client_ip import request_ip

            actor = user or {}
            await store.write_audit(
                actor_type="superadmin" if actor.get("is_super_admin") else "user",
                actor_id=str(actor.get("id") or actor.get("email") or ""),
                action="company_sms.write_denied",
                target_type="company",
                target_id=str(company_id or ""),
                details={
                    "reason": "ynt_readonly",
                    "attempt": action,
                    "method": method,
                    "path": path,
                },
                ip=request_ip(request) if request is not None else "",
            )
        except Exception:
            logger.exception("company sms ynt audit failed")
        raise HTTPException(status_code=403, detail=YNT_SMS_WRITE_DENIED)
    raise HTTPException(status_code=403, detail=YNT_SMS_READ_DENIED)


def _connected(settings: dict) -> bool:
    enc = settings.get("password_enc") or ""
    configured = bool(settings.get("is_active") and settings.get("usercode") and enc)
    return bool(configured and settings.get("verified"))


async def company_sms_summary(db: Any, company_id: str) -> dict:
    """ynt firma detayı: bağlı mı, operatör, son gönderim, hata sayısı. Sır yok."""
    import comm_service

    cid = str(company_id or "").strip()
    settings = await db.sms_settings.find_one({"company_id": cid}) or {}
    provider = comm_service.normalize_sms_provider(settings.get("provider"))
    last_rows = await db.sms_logs.find({"company_id": cid}).sort("created_at", -1).to_list(1)
    last = last_rows[0] if last_rows else None
    error_count = await db.sms_logs.count_documents({"company_id": cid, "status": "failed"})
    return {
        "company_id": cid,
        "connected": _connected(settings),
        "operator": comm_service.provider_display_name(provider) if settings else "",
        "provider": provider if settings else "",
        "last_sent_at": (last or {}).get("created_at"),
        "error_count": int(error_count or 0),
        "readonly": True,
    }
