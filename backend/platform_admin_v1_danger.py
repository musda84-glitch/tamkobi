"""Yönetim paneli kimliğe bürünme API: /api/platform/admin-v1/* (HMAC, platform_admin).

Silme, veri sıfırlama, şifre/2FA ve kullanıcı silme burada yok.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request

from client_ip import request_ip
import saas
import saas_extras
import support_access
import platform_store as store
from platform_admin_v1 import _auth, _item, _redact  # noqa: F401
from platform_admin_v1_write import _company_or_404, _reject_unknown, _write

router = APIRouter(prefix="/api", tags=["platform-admin-v1-danger"])

_START_FIELDS = ("reason", "operator_email", "ttl_minutes")
_END_FIELDS = ("reason",)
_ITEM_FIELDS = (
    "company_name",
    "as_user",
    "session_id",
    "started_at",
    "expires_at",
    "redirect",
    "code",
)


def _clean_reason(payload: Dict[str, Any]) -> str:
    if "reason" not in payload:
        raise HTTPException(status_code=400, detail="reason zorunlu.")
    reason = payload["reason"]
    if not isinstance(reason, str):
        raise HTTPException(status_code=400, detail="reason metin olmalı.")
    cleaned = reason.strip()
    if not 10 <= len(cleaned) <= 500:
        raise HTTPException(
            status_code=400,
            detail="reason 10 ile 500 karakter arasında olmalı.",
        )
    return cleaned


def _ttl_minutes(payload: Dict[str, Any]) -> int:
    if "ttl_minutes" not in payload:
        return 30
    value = payload["ttl_minutes"]
    if isinstance(value, bool) or not isinstance(value, int) or not 5 <= value <= 60:
        raise HTTPException(
            status_code=400,
            detail="ttl_minutes 5 ile 60 arasında bir tamsayı olmalı.",
        )
    return value


async def _operator_or_403(payload: Dict[str, Any]) -> str:
    if "operator_email" not in payload:
        raise HTTPException(status_code=400, detail="operator_email zorunlu.")
    email = payload["operator_email"]
    if not isinstance(email, str) or not email.strip():
        raise HTTPException(status_code=400, detail="operator_email zorunlu.")
    cleaned = email.strip()
    user = await saas._db.users.find_one({"email": cleaned})
    if not user or user.get("is_super_admin") is not True or user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Operatör yetkili değil.")
    return cleaned


def _session_ttl_minutes(doc: dict) -> Optional[int]:
    from datetime import datetime

    try:
        started = datetime.fromisoformat(str(doc.get("started_at")).replace("Z", "+00:00"))
        expires = datetime.fromisoformat(str(doc.get("expires_at")).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return int(round((expires - started).total_seconds() / 60))


def _danger_details(
    *,
    operator: Optional[str],
    reason: str,
    session_id: str,
    ttl_minutes: Optional[int],
    as_user: Optional[str],
) -> Dict[str, Any]:
    return {
        "operator": operator,
        "reason": reason,
        "session_id": session_id,
        "ttl_minutes": ttl_minutes,
        "as_user": as_user,
    }


@router.post("/platform/admin-v1/companies/{company_id}/impersonate")
async def admin_v1_impersonate(company_id: str, request: Request):
    held: Dict[str, Any] = {}

    async def prepare(payload: Dict[str, Any]):
        _reject_unknown(payload, _START_FIELDS)
        reason = _clean_reason(payload)
        minutes = _ttl_minutes(payload)
        operator = await _operator_or_403(payload)
        await saas_extras._impersonation_gate(company_id)
        await _company_or_404(company_id)
        held["reason"] = reason
        held["minutes"] = minutes
        held["operator"] = operator
        return ["operator_email", "reason", "ttl_minutes"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        key_id = str(key_doc.get("_id") or "")
        operator = await saas._db.users.find_one({"email": held["operator"]}) or {}
        result = await saas_extras.start_impersonation(
            company_id,
            actor_email=held["operator"],
            actor_name=operator.get("name"),
            actor_id=key_id,
            actor_type="api_key",
            ip=request_ip(request),
            minutes=held["minutes"],
            sa_return="",
            reason=held["reason"],
        )
        item = {key: result.get(key) for key in _ITEM_FIELDS}
        details = _danger_details(
            operator=held["operator"],
            reason=held["reason"],
            session_id=str(result.get("session_id") or ""),
            ttl_minutes=held["minutes"],
            as_user=result.get("as_user"),
        )
        return _redact(_item(item)), details

    return await _write(
        request,
        store.SCOPE_ADMIN_IMPERSONATE,
        "company",
        company_id,
        apply,
        op="impersonate.start",
        prepare=prepare,
        action="admin_v1.danger.impersonate.start",
    )


@router.post("/platform/admin-v1/impersonation/{session_id}/end")
async def admin_v1_impersonation_end(session_id: str, request: Request):
    held: Dict[str, Any] = {}

    async def prepare(payload: Dict[str, Any]):
        _reject_unknown(payload, _END_FIELDS)
        reason = _clean_reason(payload)
        doc = await support_access.session_by_id(session_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Oturum bulunamadı.")
        held["reason"] = reason
        held["doc"] = doc
        return ["reason"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        key_id = str(key_doc.get("_id") or "")
        doc = held["doc"]
        was_active = doc.get("status") == "active"
        closed = await support_access.close_session(
            session_id,
            ended_by=f"api_key:{key_id}",
            reason="revoked",
        )
        current = closed or doc
        item = {
            "session_id": session_id,
            "status": current.get("status"),
            "company_id": current.get("company_id"),
            "as_user": current.get("target_user_email"),
        }
        if not was_active:
            return _item(item), None
        details = _danger_details(
            operator=doc.get("by_email"),
            reason=held["reason"],
            session_id=session_id,
            ttl_minutes=_session_ttl_minutes(doc),
            as_user=doc.get("target_user_email"),
        )
        return _redact(_item(item)), details

    return await _write(
        request,
        store.SCOPE_ADMIN_IMPERSONATE,
        "session",
        session_id,
        apply,
        op="impersonate.end",
        prepare=prepare,
        action="admin_v1.danger.impersonate.end",
    )
