"""Yönetim paneli kimliğe bürünme ve tehlikeli işlem API: /api/platform/admin-v1/*.

İki adımlı silme, veri sıfırlama, şifre ve 2FA sıfırlama prepare/confirm uçlarındadır.
"""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, HTTPException, Request

from client_ip import request_ip
import applog
import company_reset
import saas
import saas_extras
import superadmin_2fa
import support_access
import user_erase
import platform_store as store
from platform_admin_v1 import _auth, _item, _redact  # noqa: F401
from platform_admin_v1_write import _canonical, _company_or_404, _reject_unknown, _write

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


_TOKEN_INVALID = "Onay kodu geçersiz veya süresi dolmuş."
_TARGET_CHANGED = "Hedef değişti, yeniden hazırlayın."
_CONFIRM_MINUTES = 5
_COMPANY_HINT = "şirket adını birebir yazın"
_USER_HINT = "kullanıcı e-postasını birebir yazın"
_COMPANY_TEXT_ERROR = "Onay için şirket adını birebir yazın."
_USER_TEXT_ERROR = "Onay için kullanıcının e-postasını birebir yazın."

_PLAN_HINT = "paket adını birebir yazın"
_PRODUCT_HINT = "ürün adını birebir yazın"
_PLAN_TEXT_ERROR = "Onay için paket adını birebir yazın."
_PRODUCT_TEXT_ERROR = "Onay için ürün adını birebir yazın."

_ACTIONS = (
    "company.reset_data",
    "company.delete",
    "user.erase",
    "user.password_reset",
    "superadmin.2fa_reset",
    "plan.delete",
    "product.delete",
)
_PREPARE_COMMON = ("target_id", "reason", "operator_email")
_PREPARE_EXTRA = {
    "company.reset_data": ("scopes",),
    "company.delete": (),
    "user.erase": (),
    "user.password_reset": ("user_id", "email"),
    "superadmin.2fa_reset": (),
    "plan.delete": (),
    "product.delete": (),
}
_PHRASE_ACTIONS = ("company.reset_data", "user.erase")
_CONFIRM_COMMON = ("confirmation_token", "confirm_text", "operator_otp")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_dt(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _target_type(action: str) -> str:
    if action in ("user.erase", "superadmin.2fa_reset"):
        return "user"
    if action == "plan.delete":
        return "plan"
    if action == "product.delete":
        return "product"
    return "company"


def _phrase_for(action: str) -> Optional[str]:
    if action == "company.reset_data":
        return company_reset.RESET_CONFIRM_PHRASE
    if action == "user.erase":
        return user_erase.ERASE_CONFIRM_PHRASE
    return None


def _hint_for(action: str) -> str:
    if action.startswith("company."):
        return _COMPANY_HINT
    if action == "plan.delete":
        return _PLAN_HINT
    if action == "product.delete":
        return _PRODUCT_HINT
    return _USER_HINT


def _text_error(action: str) -> str:
    if action.startswith("company."):
        return _COMPANY_TEXT_ERROR
    if action == "plan.delete":
        return _PLAN_TEXT_ERROR
    if action == "product.delete":
        return _PRODUCT_TEXT_ERROR
    return _USER_TEXT_ERROR


def _fp(data: Dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(data).encode("utf-8")).hexdigest()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _params_hash(payload: Dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


async def _read_json(request: Request) -> Dict[str, Any]:
    raw = await request.body()
    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _require_target(payload: Dict[str, Any]) -> str:
    if "target_id" not in payload:
        raise HTTPException(status_code=400, detail="target_id zorunlu.")
    value = payload["target_id"]
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=400, detail="target_id zorunlu.")
    return value.strip()


def _known_action(action: str) -> str:
    if action not in _ACTIONS:
        raise HTTPException(status_code=404, detail="İşlem bulunamadı.")
    return action


def _preview_summary(action: str, preview: Dict[str, Any]) -> Dict[str, Any]:
    if action == "company.reset_data":
        return {"total_docs": preview.get("total_docs") or 0, "scopes": preview.get("scopes")}
    if action == "company.delete":
        return {"documents": preview.get("documents") or 0, "users": preview.get("users") or 0}
    if action == "user.erase":
        return dict(preview)
    if action == "plan.delete":
        return {"companies": preview.get("companies") or 0}
    if action == "product.delete":
        return {"code": preview.get("code")}
    return {"email": preview.get("email")}


def _result_summary(action: str, result: Dict[str, Any]) -> Dict[str, Any]:
    if action == "company.reset_data":
        return {"total_deleted": result.get("total_deleted") or 0, "scopes": result.get("scopes")}
    if action == "company.delete":
        return {"deleted_docs": result.get("deleted_docs") or 0, "users": result.get("users") or {}}
    if action == "user.erase":
        return {"deleted": result.get("deleted") or {}}
    if action == "user.password_reset":
        return {"email": result.get("email"), "mail_status": result.get("mail_status")}
    if action == "plan.delete":
        return {"status": result.get("status")}
    if action == "product.delete":
        return {"code": result.get("code")}
    return {"email": result.get("email")}


async def _delete_preview(company_id: str) -> Dict[str, Any]:
    names = await saas._db.list_collection_names()
    documents = 0
    for name in names:
        if name in saas._SKIP_ON_COMPANY_DELETE:
            continue
        documents += int(await saas._db[name].count_documents({"company_id": company_id}) or 0)
    users = int(await saas._db.users.count_documents({"company_ids": company_id}) or 0)
    return {"documents": documents, "users": users}


async def _validate_reset(company_id: str, scopes: Any) -> dict:
    company, scopes_n = await company_reset.validate_reset_request(company_id, scopes)
    if company_id in saas.PROTECTED_COMPANY_IDS:
        raise HTTPException(status_code=400, detail="Platform demo şirketleri silinemez.")
    preview = await company_reset.preview_counts(company_id, scopes_n)
    label = (company.get("name") or "").strip()
    return {
        "label": label,
        "fp": _fp({"id": company_id, "name": label}),
        "preview": preview,
        "scopes": scopes_n,
    }


async def _validate_delete(company_id: str) -> dict:
    company = await saas.validate_company_delete(company_id)
    label = (company.get("name") or "").strip()
    preview = await _delete_preview(company_id)
    return {
        "label": label,
        "fp": _fp({"id": company_id, "name": label}),
        "preview": preview,
        "scopes": None,
    }


async def _validate_erase(user_id: str, operator_email: str) -> dict:
    operator = await saas._db.users.find_one({"email": operator_email}) or {}
    found = await user_erase.validate_erase_target(user_id, actor_id=str(operator.get("_id") or ""))
    email = found["email"]
    return {
        "label": email,
        "fp": _fp({"id": user_id, "email": email}),
        "preview": found["counts"],
        "scopes": None,
        "user": found["user"],
    }


async def _validate_password(company_id: str, user_id: str, email: str) -> dict:
    found = await saas.validate_password_reset(company_id, user_id, email)
    to = found["to"]
    return {
        "label": to,
        "fp": _fp({"id": str(found["user"].get("_id") or ""), "email": to, "company_id": company_id}),
        "preview": {"email": to},
        "scopes": None,
        "user_id": user_id,
        "email": email,
    }


async def _validate_2fa(user_id: str, operator_email: str) -> dict:
    user = await saas._db.users.find_one({"_id": user_id})
    if not user or user.get("is_super_admin") is not True:
        raise HTTPException(status_code=404, detail="Panel yöneticisi bulunamadı.")
    email = (user.get("email") or "").strip().lower()
    if email and email == (operator_email or "").strip().lower():
        raise HTTPException(status_code=400, detail="Kendi 2FA'nızı bu yolla sıfırlayamazsınız.")
    return {
        "label": email,
        "fp": _fp({"id": user_id, "email": email}),
        "preview": {"email": email},
        "scopes": None,
    }


async def _validate_plan(plan_id: str) -> dict:
    plan = await saas.validate_plan_delete(plan_id)
    label = (plan.get("name") or "").strip()
    return {
        "label": label,
        "fp": _fp({"id": plan_id, "name": label}),
        "preview": {"companies": 0},
        "scopes": None,
    }


async def _validate_product(product_id: str) -> dict:
    doc = await store._get_product_doc(product_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    if doc.get("code") == store.PRODUCT_TAMKOBI:
        raise HTTPException(status_code=400, detail="tamkobi ürünü silinemez")
    label = (doc.get("name") or doc.get("code") or "").strip()
    return {
        "label": label,
        "fp": _fp({"id": str(doc.get("_id") or ""), "name": label, "code": doc.get("code") or ""}),
        "preview": {"code": doc.get("code")},
        "scopes": None,
    }


async def _validate_action(action: str, target_id: str, operator_email: str, params: Dict[str, Any]) -> dict:
    if action == "company.reset_data":
        return await _validate_reset(target_id, params.get("scopes"))
    if action == "company.delete":
        return await _validate_delete(target_id)
    if action == "user.erase":
        return await _validate_erase(target_id, operator_email)
    if action == "user.password_reset":
        return await _validate_password(target_id, params.get("user_id") or "", params.get("email") or "")
    if action == "plan.delete":
        return await _validate_plan(target_id)
    if action == "product.delete":
        return await _validate_product(target_id)
    return await _validate_2fa(target_id, operator_email)


def _text_matches(action: str, label: str, text: Any) -> bool:
    if not isinstance(text, str):
        return False
    if action.startswith("company.") or action in ("plan.delete", "product.delete"):
        return text.strip() == (label or "").strip()
    return text.strip().lower() == (label or "").strip().lower()


def _token_usable(doc: Optional[dict], action: str, key_id: str) -> bool:
    if not doc or doc.get("used_at") is not None:
        return False
    if str(doc.get("key_id") or "") != str(key_id):
        return False
    if str(doc.get("action") or "") != action:
        return False
    expires = _as_dt(doc.get("expires_at"))
    if expires is None or _now() >= expires:
        return False
    return True


async def _consume_token(digest: str) -> bool:
    coll = store._db.platform_danger_confirmations
    query = {"_id": digest, "used_at": None}
    update = {"$set": {"used_at": _now().isoformat()}}
    atomic = getattr(coll, "update_one_atomic", None)
    if atomic is not None:
        result = await atomic(query, update)
    else:
        result = await coll.update_one(query, update)  # tenant-ok: platform onay kaydı, şirket verisi değil, _id token hash'i
    return int(getattr(result, "modified_count", 0) or 0) == 1


async def _lock_active(user: dict) -> bool:
    uid = str(user.get("_id") or "")
    lock = await saas._db.login_attempts.find_one({"identifier": superadmin_2fa.twofa_lock_identifier(uid)})
    if not lock or int(lock.get("count") or 0) < superadmin_2fa.MAX_2FA_ATTEMPTS:
        return False
    last = _as_dt(lock.get("last_attempt")) or _now()
    return _now() - last < timedelta(minutes=superadmin_2fa.LOCKOUT_MINUTES)


async def _note_otp_failure(user: dict) -> None:
    uid = str(user.get("_id") or "")
    await saas._db.login_attempts.update_one(
        {"identifier": superadmin_2fa.twofa_lock_identifier(uid)},
        {"$inc": {"count": 1}, "$set": {"last_attempt": _now().isoformat()}},
        upsert=True,
    )


async def _check_operator_otp(operator_email: str, code: Any) -> Tuple[dict, int]:
    user = await saas._db.users.find_one({"email": operator_email})
    if not user or not superadmin_2fa.user_totp_enabled(user):
        raise HTTPException(status_code=403, detail="Operatör 2FA kurulu değil.")
    if await _lock_active(user):
        raise HTTPException(status_code=429, detail="Çok fazla hatalı kod. 15 dakika sonra tekrar deneyin.")
    if not isinstance(code, str):
        await _note_otp_failure(user)
        raise HTTPException(status_code=403, detail="Doğrulama kodu hatalı.")
    try:
        secret = superadmin_2fa.decrypt_totp_secret(user.get("totp_secret") or "")
    except Exception:
        secret = ""
    counter = superadmin_2fa.matching_totp_counter(secret, code) if secret else None
    last = user.get("totp_last_counter")
    try:
        last_i = int(last) if last is not None and last != "" else None
    except (TypeError, ValueError):
        last_i = None
    if counter is None or (last_i is not None and counter <= last_i):
        await _note_otp_failure(user)
        raise HTTPException(status_code=403, detail="Doğrulama kodu hatalı.")
    return user, counter


async def _commit_otp(user: dict, counter: int) -> None:
    uid = str(user.get("_id") or "")
    await saas._db.users.update_one({"_id": user["_id"]}, {"$set": {"totp_last_counter": counter}})
    await saas._db.login_attempts.delete_one({"identifier": superadmin_2fa.twofa_lock_identifier(uid)})


def _actor(key_id: str, operator_email: str) -> dict:
    return {
        "_id": key_id,
        "email": operator_email,
        "name": f"api_key:{key_id}",
        "via": "api",
    }


async def _execute(action: str, target_id: str, params: Dict[str, Any], actor: dict, request: Request) -> dict:
    ip = request_ip(request)
    if action == "company.reset_data":
        return await company_reset.apply_reset(target_id, params.get("scopes"), actor=actor, ip=ip)
    if action == "company.delete":
        return await saas.apply_company_delete(target_id)
    if action == "user.erase":
        user = await saas._db.users.find_one({"_id": target_id})
        if not user:
            raise HTTPException(status_code=409, detail=_TARGET_CHANGED)
        return await user_erase.apply_erase(user, actor=actor, ip=ip)
    if action == "user.password_reset":
        return await saas.send_password_reset_for(
            target_id,
            params.get("user_id") or "",
            params.get("email") or "",
            request,
            requested_by=str(actor.get("email") or ""),
            deliver="outbox",
        )
    if action == "plan.delete":
        return await saas.apply_delete_plan(target_id)
    if action == "product.delete":
        doc = await store._get_product_doc(target_id)
        code = (doc or {}).get("code")
        try:
            await store.delete_product(target_id, actor_id=str(actor.get("_id") or ""), ip=ip)
        except LookupError:
            raise HTTPException(status_code=409, detail=_TARGET_CHANGED) from None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        return {"status": "success", "id": (doc or {}).get("_id"), "code": code}
    result = await superadmin_2fa.reset_user_totp(saas._db, target_id)
    return {
        "status": "success",
        "id": result.get("id"),
        "email": result.get("email"),
        "message": f"{result.get('email') or ''} 2FA sıfırlandı.",
    }


async def _trail(actor: dict, action: str, target_id: str, company_id: str, summary: Dict[str, Any]) -> None:
    applog.log_event(
        "admin_v1_danger",
        f"{action} via api",
        via="api",
        operator_email=actor.get("email"),
        action=action,
        target_id=target_id,
    )
    await saas._db.activity_logs.insert_one({
        "_id": secrets.token_hex(16),
        "company_id": company_id or "platform",
        "user_id": actor.get("_id"),
        "user_name": actor.get("name"),
        "method": "POST",
        "path": f"/api/platform/admin-v1/danger/{action}/confirm",
        "module": "/platform/admin-v1",
        "status": 200,
        "detail": action,
        "via": "api",
        "operator_email": actor.get("email"),
        "summary": summary,
        "created_at": _now().isoformat(),
    })


def _audit_details(operator: str, reason: str, action: str, scopes: Any, summary: Dict[str, Any], *, preview: bool) -> Dict[str, Any]:
    key = "preview" if preview else "result"
    return {
        "operator": operator,
        "reason": reason,
        "action": action,
        "scopes": scopes,
        key: summary,
    }


@router.post("/platform/admin-v1/danger/{action}/prepare")
async def admin_v1_danger_prepare(action: str, request: Request):
    peeked = await _read_json(request)
    target_id = peeked.get("target_id") if isinstance(peeked.get("target_id"), str) else ""
    held: Dict[str, Any] = {}

    async def prepare(payload: Dict[str, Any]):
        _known_action(action)
        _reject_unknown(payload, _PREPARE_COMMON + _PREPARE_EXTRA[action])
        reason = _clean_reason(payload)
        operator = await _operator_or_403(payload)
        tid = _require_target(payload)
        params: Dict[str, Any] = {}
        if action == "company.reset_data" and "scopes" in payload:
            scopes = payload["scopes"]
            if not isinstance(scopes, (str, list, tuple)):
                raise HTTPException(status_code=400, detail="scopes liste olmalı.")
            params["scopes"] = scopes
        if action == "user.password_reset":
            if "user_id" in payload:
                if not isinstance(payload["user_id"], str):
                    raise HTTPException(status_code=400, detail="user_id metin olmalı.")
                params["user_id"] = payload["user_id"]
            if "email" in payload:
                if not isinstance(payload["email"], str):
                    raise HTTPException(status_code=400, detail="email metin olmalı.")
                params["email"] = payload["email"]
        snap = await _validate_action(action, tid, operator, params)
        held.update(reason=reason, operator=operator, target_id=tid, params=params, snap=snap, payload=payload)
        return ["operator_email", "reason", "target_id"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        snap = held["snap"]
        key_id = str(key_doc.get("_id") or "")
        token = secrets.token_urlsafe(32)
        created = _now()
        expires = created + timedelta(minutes=_CONFIRM_MINUTES)
        params = held["params"]
        if action == "company.reset_data":
            params = {"scopes": snap.get("scopes")}
        await store._db.platform_danger_confirmations.insert_one({  # tenant-ok: platform onay kaydı, şirket verisi değil, _id token hash'i
            "_id": _token_hash(token),
            "action": action,
            "target_id": held["target_id"],
            "key_id": key_id,
            "operator_email": held["operator"],
            "reason": held["reason"],
            "params_hash": _params_hash(payload),
            "params": params,
            "target_label": snap["label"],
            "target_fp": snap["fp"],
            "scopes": snap.get("scopes"),
            "created_at": created.isoformat(),
            "expires_at": expires.isoformat(),
            "used_at": None,
        })
        response = {
            "action": action,
            "target_id": held["target_id"],
            "target_label": snap["label"],
            "preview": snap["preview"],
            "confirm_text_hint": _hint_for(action),
            "confirm_phrase": _phrase_for(action),
            "confirmation_token": token,
            "expires_at": expires.isoformat(),
        }
        details = _audit_details(
            held["operator"],
            held["reason"],
            action,
            snap.get("scopes"),
            _preview_summary(action, snap["preview"]),
            preview=True,
        )
        return response, details

    return await _write(
        request,
        store.SCOPE_ADMIN_DANGEROUS,
        _target_type(action),
        str(target_id or "").strip(),
        apply,
        op=f"danger.{action}.prepare",
        prepare=prepare,
        action=f"admin_v1.danger.{action}.prepare",
    )


@router.post("/platform/admin-v1/danger/{action}/confirm")
async def admin_v1_danger_confirm(action: str, request: Request):
    peeked = await _read_json(request)
    token = peeked.get("confirmation_token") if isinstance(peeked.get("confirmation_token"), str) else ""
    target_id = ""
    if token:
        doc = await store._db.platform_danger_confirmations.find_one({"_id": _token_hash(token)})  # tenant-ok: platform onay kaydı, şirket verisi değil, _id token hash'i
        if doc:
            target_id = str(doc.get("target_id") or "")

    async def prepare(payload: Dict[str, Any]):
        _known_action(action)
        allowed = _CONFIRM_COMMON + (("confirm_phrase",) if action in _PHRASE_ACTIONS else ())
        _reject_unknown(payload, allowed)
        if not isinstance(payload.get("confirmation_token"), str) or not payload["confirmation_token"].strip():
            raise HTTPException(status_code=400, detail="confirmation_token zorunlu.")
        if not isinstance(payload.get("confirm_text"), str):
            raise HTTPException(status_code=400, detail="confirm_text zorunlu.")
        if not isinstance(payload.get("operator_otp"), str) or not payload["operator_otp"].strip():
            raise HTTPException(status_code=400, detail="operator_otp zorunlu.")
        if action in _PHRASE_ACTIONS:
            if not isinstance(payload.get("confirm_phrase"), str):
                expected = _phrase_for(action)
                raise HTTPException(status_code=400, detail=f'Onay cümlesi "{expected}" olmalıdır.')
        return ["confirmation_token", "confirm_text", "operator_otp"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        key_id = str(key_doc.get("_id") or "")
        digest = _token_hash(payload["confirmation_token"].strip())
        doc = await store._db.platform_danger_confirmations.find_one({"_id": digest})  # tenant-ok: platform onay kaydı, şirket verisi değil, _id token hash'i
        if not _token_usable(doc, action, key_id):
            raise HTTPException(status_code=400, detail=_TOKEN_INVALID)
        label = str(doc.get("target_label") or "")
        if not _text_matches(action, label, payload.get("confirm_text")):
            raise HTTPException(status_code=400, detail=_text_error(action))
        if action in _PHRASE_ACTIONS:
            expected = _phrase_for(action) or ""
            given = payload.get("confirm_phrase")
            if not isinstance(given, str) or given.strip() != expected:
                raise HTTPException(status_code=400, detail=f'Onay cümlesi "{expected}" olmalıdır.')
        otp_user, counter = await _check_operator_otp(str(doc.get("operator_email") or ""), payload.get("operator_otp"))
        if not await _consume_token(digest):
            raise HTTPException(status_code=400, detail=_TOKEN_INVALID)
        await _commit_otp(otp_user, counter)
        params = dict(doc.get("params") or {})
        try:
            snap = await _validate_action(action, str(doc.get("target_id") or ""), str(doc.get("operator_email") or ""), params)
        except HTTPException:
            raise HTTPException(status_code=409, detail=_TARGET_CHANGED) from None
        if snap.get("fp") != doc.get("target_fp"):
            raise HTTPException(status_code=409, detail=_TARGET_CHANGED)
        actor = _actor(key_id, str(doc.get("operator_email") or ""))
        result = await _execute(action, str(doc.get("target_id") or ""), params, actor, request)
        summary = _result_summary(action, result)
        company_id = str(doc.get("target_id") or "") if _target_type(action) == "company" else "platform"
        await _trail(actor, action, str(doc.get("target_id") or ""), company_id, summary)
        details = _audit_details(
            str(doc.get("operator_email") or ""),
            str(doc.get("reason") or ""),
            action,
            doc.get("scopes"),
            summary,
            preview=False,
        )
        return _item(result), details

    return await _write(
        request,
        store.SCOPE_ADMIN_DANGEROUS,
        _target_type(action),
        target_id,
        apply,
        op=f"danger.{action}.confirm",
        prepare=prepare,
        action=f"admin_v1.danger.{action}.confirm",
    )
