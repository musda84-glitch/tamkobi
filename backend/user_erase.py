"""Sistem paneli: müşteri şirket kullanıcılarının kişisel verilerini güvenli silme.

Şirket iş kayıtlarını (fatura, sipariş vb.) silmez; hesap, oturum izleri,
davetler ve aktivite PII'sini temizler. Ek güvenlik: süper admin + şifre
yeniden doğrulama + e-posta onayı + onay cümlesi.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import applog
import saas
from auth_utils import verify_password

router = APIRouter(prefix="/api")
_db = None

ERASE_CONFIRM_PHRASE = "VERİLERİ SİL"
_ANON = "[silindi]"


def init(db):
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user: dict) -> str:
    return str(user.get("_id") or user.get("id") or "")


async def _load_tenant_user(user_id: str) -> dict:
    u = await _db.users.find_one({"_id": user_id})
    if not u:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    if u.get("is_super_admin"):
        raise HTTPException(
            status_code=400,
            detail="Platform yöneticileri bu modülden silinemez. Panel Yöneticileri ekranını kullanın.",
        )
    return u


async def _company_names(cids: List[str]) -> List[Dict[str, str]]:
    out = []
    for cid in cids:
        c = await _db.companies.find_one({"_id": cid}, {"name": 1})
        out.append({"id": cid, "name": (c or {}).get("name") or cid})
    return out


async def _last_admin_blocks(u: dict) -> List[Dict[str, str]]:
    """Şirkette tek admin kalan kullanıcılar silinemez."""
    blocks = []
    uid = _uid(u)
    for cid in u.get("company_ids") or []:
        if (u.get("role") or "") != "admin":
            continue
        others = await _db.users.count_documents({
            **saas.tenant_user_query(cid),
            "role": "admin",
            "_id": {"$ne": uid},
        })
        if others == 0:
            c = await _db.companies.find_one({"_id": cid}, {"name": 1})
            blocks.append({"id": cid, "name": (c or {}).get("name") or cid})
    return blocks


async def _linked_employee(u: dict) -> Optional[dict]:
    uid = _uid(u)
    emp = None
    if u.get("employee_id"):
        emp = await _db.employees.find_one({"_id": u["employee_id"]})
    if not emp:
        emp = await _db.employees.find_one({"user_id": uid})
    if not emp and u.get("email"):
        emp = await _db.employees.find_one({"email": (u.get("email") or "").strip().lower()})
    return emp


async def _erase_counts(u: dict) -> Dict[str, int]:
    uid = _uid(u)
    email = (u.get("email") or "").strip().lower()
    emp = await _linked_employee(u)
    invites = await _db.user_invites.count_documents({"email": email}) if email else 0
    logins = (
        await _db.login_attempts.count_documents({"identifier": {"$regex": f":{re.escape(email)}$"}})
        if email else 0
    )
    activity = await _db.activity_logs.count_documents({"user_id": uid})
    tickets = await _db.support_tickets.count_documents({"created_by_id": uid}) if uid else 0
    return {
        "invites": int(invites or 0),
        "login_attempts": int(logins or 0),
        "activity_logs": int(activity or 0),
        "support_tickets": int(tickets or 0),
        "employee_linked": 1 if emp else 0,
    }


def _public_user(u: dict, companies: List[Dict[str, str]], counts: Dict[str, int], blocks: List[Dict[str, str]]) -> dict:
    email = (u.get("email") or "").strip().lower()
    protected = email in saas.PROTECTED_USER_EMAILS
    return {
        "id": _uid(u),
        "name": u.get("name"),
        "email": email,
        "user_number": u.get("user_number"),
        "role": u.get("role") or "user",
        "is_active": u.get("is_active", True) is not False,
        "company_ids": list(u.get("company_ids") or []),
        "companies": companies,
        "last_login_at": u.get("last_login_at"),
        "created_at": u.get("created_at"),
        "protected": protected,
        "can_erase": not protected and not blocks,
        "block_reasons": (
            (["Korumalı hesap silinemez."] if protected else [])
            + ([f"Şirketin son yöneticisi: {b['name']}" for b in blocks] if blocks else [])
        ),
        "last_admin_of": blocks,
        "counts": counts,
        "confirm_phrase": ERASE_CONFIRM_PHRASE,
    }


async def _verify_admin_password(admin: dict, password: str) -> None:
    pwd = (password or "").strip()
    if not pwd:
        raise HTTPException(status_code=400, detail="Silme işlemi için yönetici şifrenizi girin.")
    raw = await _db.users.find_one({"_id": _uid(admin)})
    if not raw or not verify_password(pwd, raw.get("password_hash", "")):
        raise HTTPException(status_code=403, detail="Yönetici şifresi hatalı.")


@router.get("/system/tenant-users")
async def search_tenant_users(q: Optional[str] = None, limit: int = 50, _: dict = Depends(saas.require_super_admin)):
    """Müşteri şirket kullanıcılarını ara (platform yöneticileri hariç)."""
    ql = (q or "").strip().lower()
    if len(ql) < 2:
        return {"users": [], "hint": "En az 2 karakter yazın.", "confirm_phrase": ERASE_CONFIRM_PHRASE}
    lim = max(1, min(int(limit or 50), 100))
    raw = await _db.users.find({"is_super_admin": {"$ne": True}}, {"password_hash": 0}).sort("name", 1).to_list(2000)
    rows = []
    for u in raw:
        email = (u.get("email") or "").lower()
        name = (u.get("name") or "").lower()
        num = (u.get("user_number") or "").lower()
        if ql not in email and ql not in name and ql not in num:
            continue
        cids = list(u.get("company_ids") or [])
        companies = await _company_names(cids)
        blocks = await _last_admin_blocks(u)
        counts = await _erase_counts(u)
        rows.append(_public_user(u, companies, counts, blocks))
        if len(rows) >= lim:
            break
    return {"users": rows, "confirm_phrase": ERASE_CONFIRM_PHRASE}


@router.get("/system/users/{user_id}/erase-preview")
async def erase_preview(user_id: str, _: dict = Depends(saas.require_super_admin)):
    u = await _load_tenant_user(user_id)
    companies = await _company_names(list(u.get("company_ids") or []))
    blocks = await _last_admin_blocks(u)
    counts = await _erase_counts(u)
    return _public_user(u, companies, counts, blocks)


@router.post("/system/users/{user_id}/erase")
async def erase_user(user_id: str, req: Dict[str, Any], request: Request, admin: dict = Depends(saas.require_super_admin)):
    u = await _load_tenant_user(user_id)
    if _uid(admin) == _uid(u):
        raise HTTPException(status_code=400, detail="Kendi hesabınızı bu modülden silemezsiniz.")

    email = (u.get("email") or "").strip().lower()
    if email in saas.PROTECTED_USER_EMAILS:
        raise HTTPException(status_code=400, detail="Korumalı hesap silinemez.")

    blocks = await _last_admin_blocks(u)
    if blocks:
        names = ", ".join(b["name"] for b in blocks)
        raise HTTPException(
            status_code=400,
            detail=f"Kullanıcı şu şirket(ler)in son yöneticisi: {names}. Önce başka bir yönetici atayın veya şirketi silin.",
        )

    confirm_email = (req.get("confirm_email") or "").strip().lower()
    if confirm_email != email:
        raise HTTPException(status_code=400, detail="Onay için kullanıcının e-postasını birebir yazın.")

    phrase = (req.get("confirm_phrase") or "").strip()
    if phrase != ERASE_CONFIRM_PHRASE:
        raise HTTPException(status_code=400, detail=f'Onay cümlesi "{ERASE_CONFIRM_PHRASE}" olmalıdır.')

    await _verify_admin_password(admin, req.get("admin_password") or "")

    uid = _uid(u)
    deleted: Dict[str, int] = {
        "user": 0,
        "invites": 0,
        "login_attempts": 0,
        "activity_logs": 0,
        "employees_unlinked": 0,
        "tickets_anonymized": 0,
    }

    if email:
        deleted["invites"] = int((await _db.user_invites.delete_many({"email": email})).deleted_count or 0)
        deleted["login_attempts"] = int(
            (await _db.login_attempts.delete_many({"identifier": {"$regex": f":{re.escape(email)}$"}})).deleted_count or 0
        )

    deleted["activity_logs"] = int((await _db.activity_logs.delete_many({"user_id": uid})).deleted_count or 0)

    emp = await _linked_employee(u)
    if emp:
        await _db.employees.update_one(
            {"_id": emp["_id"]},
            {"$set": {"user_id": None, "updated_at": _now()}, "$unset": {"portal_user_id": ""}},
        )
        deleted["employees_unlinked"] = 1

    tick = await _db.support_tickets.update_many(
        {"created_by_id": uid},
        {"$set": {
            "created_by_name": _ANON,
            "created_by_email": _ANON,
            "created_by_id": None,
            "updated_at": _now(),
        }},
    )
    deleted["tickets_anonymized"] = int(tick.modified_count or 0)

    await _db.users.delete_one({"_id": uid})
    deleted["user"] = 1

    applog.log_event(
        "user_erase",
        f"{email} erased by {admin.get('email')}",
        target_user_id=uid,
        target_email=email,
        admin_id=_uid(admin),
        admin_email=admin.get("email"),
        ip=getattr(request.client, "host", None) if request.client else None,
        deleted=deleted,
    )
    await _db.activity_logs.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": (u.get("active_company_id") or (u.get("company_ids") or [None])[0] or "platform"),
        "user_id": _uid(admin),
        "user_name": admin.get("name") or admin.get("email"),
        "method": "ERASE",
        "path": f"/system/users/{uid}/erase",
        "module": "/sistem/veri-silme",
        "status": 200,
        "detail": f"user_erase:{email}",
        "created_at": _now(),
    })

    return {
        "status": "success",
        "id": uid,
        "email": email,
        "deleted": deleted,
        "message": f"{email} hesabı ve ilişkili kişisel veriler silindi.",
    }
