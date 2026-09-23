"""Yönetim paneli destek oturumu + veri silme onay talepleri.

- Destek oturumu: 'Şirket Olarak Gir' açılınca şirket panelinde görünür;
  süre ve 'Bağlantıyı kapat' ile müşteri veya destek ekibi bitirebilir.
- Veri silme onayı: platform talep oluşturur; müşteri Destek Talepleri'nden
  yazılı yanıt (onay/red) verir.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import saas

router = APIRouter(prefix="/api")
_db = None
_get_user = None

SESSION_HOURS = 2
DELETION_KINDS = ("user_erase", "company_reset")


def init(db, get_current_user):
    global _db, _get_user
    _db = db
    _get_user = get_current_user


async def current_user(request: Request):
    if _get_user is None:
        raise HTTPException(status_code=500, detail="support_access not initialized")
    return await _get_user(request)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("_id") or "")


def _require_member(user: dict, company_id: str):
    if company_id not in (user.get("company_ids") or []):
        raise HTTPException(status_code=403, detail="Bu şirkete erişiminiz yok.")


def _require_admin(user: dict):
    if user.get("role") != "admin" and not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Yalnızca şirket yöneticisi bu işlemi yapabilir.")


def public_session(doc: Optional[dict]) -> Optional[dict]:
    if not doc or doc.get("status") != "active":
        return None
    expires = doc.get("expires_at")
    try:
        exp_dt = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        if exp_dt <= _now():
            return None
    except Exception:
        pass
    return {
        "id": doc.get("_id"),
        "company_id": doc.get("company_id"),
        "by": doc.get("by_email"),
        "name": doc.get("by_name"),
        "started_at": doc.get("started_at"),
        "expires_at": expires,
        "status": "active",
    }


async def create_session(
    *,
    company_id: str,
    by_email: str,
    by_name: Optional[str] = None,
    target_user_email: Optional[str] = None,
    hours: int = SESSION_HOURS,
) -> dict:
    now = _now()
    await _db.support_sessions.update_many(
        {"company_id": company_id, "status": "active"},
        {"$set": {"status": "superseded", "ended_at": now.isoformat(), "ended_by": "system"}},
    )
    sid = f"ss_{uuid.uuid4().hex[:12]}"
    doc = {
        "_id": sid,
        "company_id": company_id,
        "by_email": by_email,
        "by_name": by_name or by_email,
        "target_user_email": target_user_email,
        "started_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=hours)).isoformat(),
        "status": "active",
        "created_at": now.isoformat(),
    }
    await _db.support_sessions.insert_one(doc)
    return doc


async def get_active_session(company_id: str) -> Optional[dict]:
    doc = await _db.support_sessions.find_one(
        {"company_id": company_id, "status": "active"},
        sort=[("started_at", -1)],
    )
    pub = public_session(doc)
    if not pub and doc:
        await _db.support_sessions.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "expired", "ended_at": _now_iso()}},
        )
        return None
    return doc if pub else None


async def session_by_id(session_id: str) -> Optional[dict]:
    if not session_id:
        return None
    return await _db.support_sessions.find_one({"_id": session_id})


async def close_session(session_id: str, *, ended_by: str, reason: str = "closed") -> Optional[dict]:
    doc = await _db.support_sessions.find_one({"_id": session_id})
    if not doc:
        return None
    if doc.get("status") != "active":
        return doc
    status = reason if reason in ("revoked", "closed", "exited", "expired") else "closed"
    await _db.support_sessions.update_one(
        {"_id": session_id},
        {"$set": {"status": status, "ended_at": _now_iso(), "ended_by": ended_by}},
    )
    return await _db.support_sessions.find_one({"_id": session_id})


def public_deletion_request(doc: dict) -> dict:
    return {
        "id": doc.get("_id"),
        "company_id": doc.get("company_id"),
        "kind": doc.get("kind"),
        "kind_label": "Kullanıcı verisi silme" if doc.get("kind") == "user_erase" else "Şirket veri sıfırlama",
        "subject": doc.get("subject") or "Veri silme onayı",
        "body": doc.get("body") or "",
        "target_label": doc.get("target_label") or "",
        "status": doc.get("status") or "pending",
        "created_at": doc.get("created_at"),
        "created_by_name": doc.get("created_by_name"),
        "reply_message": doc.get("reply_message"),
        "reply_at": doc.get("reply_at"),
        "replied_by_name": doc.get("replied_by_name"),
        "decision": doc.get("decision"),
    }


@router.get("/companies/{company_id}/support-session")
async def get_company_support_session(company_id: str, user: dict = Depends(current_user)):
    _require_member(user, company_id)
    doc = await get_active_session(company_id)
    return {"session": public_session(doc)}


@router.post("/companies/{company_id}/support-session/close")
async def close_company_support_session(company_id: str, user: dict = Depends(current_user)):
    _require_member(user, company_id)
    _require_admin(user)
    doc = await get_active_session(company_id)
    if not doc:
        return {"status": "success", "message": "Aktif yönetim paneli bağlantısı yok.", "session": None}
    await close_session(doc["_id"], ended_by=_uid(user), reason="revoked")
    await _db.activity_logs.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "user_id": _uid(user),
        "user_name": user.get("name"),
        "method": "POST",
        "path": f"/companies/{company_id}/support-session/close",
        "module": "/support",
        "status": 200,
        "detail": f"support_session_revoked:{doc.get('by_email')}",
        "created_at": _now_iso(),
    })
    return {
        "status": "success",
        "message": "Yönetim paneli bağlantısı kapatıldı.",
        "session": None,
        "revoked_session_id": doc["_id"],
    }


@router.get("/companies/{company_id}/deletion-confirmations")
async def list_deletion_confirmations(company_id: str, user: dict = Depends(current_user)):
    _require_member(user, company_id)
    rows = await _db.deletion_confirmations.find({"company_id": company_id}).sort("created_at", -1).to_list(50)
    return {"items": [public_deletion_request(x) for x in rows]}


@router.post("/companies/{company_id}/deletion-confirmations/{req_id}/reply")
async def reply_deletion_confirmation(
    company_id: str,
    req_id: str,
    body: Dict[str, Any],
    user: dict = Depends(current_user),
):
    _require_member(user, company_id)
    _require_admin(user)
    doc = await _db.deletion_confirmations.find_one({"_id": req_id, "company_id": company_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Onay talebi bulunamadı.")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Bu talep zaten yanıtlanmış.")
    decision = (body.get("decision") or "").strip().lower()
    if decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="decision: approve veya reject olmalı.")
    message = (body.get("message") or "").strip()
    if len(message) < 3:
        raise HTTPException(status_code=400, detail="Onay yanıtı en az 3 karakter olmalı.")
    now = _now_iso()
    status = "approved" if decision == "approve" else "rejected"
    await _db.deletion_confirmations.update_one(
        {"_id": req_id},
        {"$set": {
            "status": status,
            "decision": decision,
            "reply_message": message,
            "reply_at": now,
            "replied_by": _uid(user),
            "replied_by_name": user.get("name") or user.get("email"),
        }},
    )
    updated = await _db.deletion_confirmations.find_one({"_id": req_id})
    await _db.activity_logs.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "user_id": _uid(user),
        "user_name": user.get("name"),
        "method": "POST",
        "path": f"/companies/{company_id}/deletion-confirmations/{req_id}/reply",
        "module": "/support",
        "status": 200,
        "detail": f"deletion_{status}",
        "created_at": now,
    })
    label = "onaylandı" if decision == "approve" else "reddedildi"
    return {"status": "success", "message": f"Veri silme talebi {label}.", "item": public_deletion_request(updated)}


@router.post("/system/companies/{company_id}/deletion-confirmations")
async def create_deletion_confirmation(
    company_id: str,
    body: Dict[str, Any],
    admin: dict = Depends(saas.require_super_admin),
):
    company = await _db.companies.find_one({"_id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    kind = (body.get("kind") or "company_reset").strip()
    if kind not in DELETION_KINDS:
        raise HTTPException(status_code=400, detail=f"kind: {', '.join(DELETION_KINDS)}")
    subject = (body.get("subject") or "").strip() or (
        "Kullanıcı verisi silme onayı" if kind == "user_erase" else "Şirket veri sıfırlama onayı"
    )
    text = (body.get("body") or "").strip() or (
        "Platform yönetimi veri silme işlemi için şirket onayınızı istiyor. "
        "Lütfen Destek Talepleri ekranından onay veya red yanıtınızı yazın."
    )
    rid = f"dc_{uuid.uuid4().hex[:12]}"
    doc = {
        "_id": rid,
        "company_id": company_id,
        "company_name": company.get("name"),
        "kind": kind,
        "subject": subject,
        "body": text,
        "target_label": (body.get("target_label") or "").strip(),
        "target_user_id": body.get("target_user_id"),
        "status": "pending",
        "created_at": _now_iso(),
        "created_by": _uid(admin),
        "created_by_name": admin.get("name") or admin.get("email"),
        "created_by_email": admin.get("email"),
    }
    await _db.deletion_confirmations.insert_one(doc)
    return {
        "status": "success",
        "message": "Müşteriye veri silme onay talebi gönderildi.",
        "item": public_deletion_request(doc),
    }


@router.get("/system/companies/{company_id}/deletion-confirmations")
async def admin_list_deletion_confirmations(
    company_id: str,
    admin: dict = Depends(saas.require_super_admin),
):
    rows = await _db.deletion_confirmations.find({"company_id": company_id}).sort("created_at", -1).to_list(50)
    return {"items": [public_deletion_request(x) for x in rows]}
