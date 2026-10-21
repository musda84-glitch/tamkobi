"""Normalized phone helpers for forgot-SMS lookup and user/employee records."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import comm_service

logger = logging.getLogger(__name__)

# Global uniqueness on users.phone_norm (forgot-SMS lookup is also global).
PHONE_TAKEN_MSG = "Bu telefon numarası başka bir kullanıcıya ait."
# Cap for unindexed phone scan fallback (enumeration / load bound).
PHONE_SCAN_LIMIT = 300


def phone_norm_of(value: Any) -> Optional[str]:
    return comm_service.normalize_phone(str(value or "").strip())


def phone_update_fields(raw: Any, *, allow_empty: bool = True) -> Dict[str, Any]:
    """Build {phone, phone_norm} for $set. Raises ValueError on invalid non-empty phone."""
    text = str(raw or "").strip()
    if not text:
        if not allow_empty:
            raise ValueError("Telefon numarası gerekli.")
        return {"phone": "", "phone_norm": None}
    norm = phone_norm_of(text)
    if not norm:
        raise ValueError("Geçerli bir cep telefonu girin (05XXXXXXXXX).")
    return {"phone": text, "phone_norm": norm}


async def ensure_unique_phone_norm(
    db,
    phone_norm: Optional[str],
    *,
    exclude_user_id: Optional[str] = None,
) -> None:
    """Raise ValueError if phone_norm is already used by another user (global)."""
    if not phone_norm:
        return
    other = await db.users.find_one({"phone_norm": phone_norm})
    if not other:
        return
    if exclude_user_id and str(other.get("_id")) == str(exclude_user_id):
        return
    raise ValueError(PHONE_TAKEN_MSG)


async def backfill_phone_norm(db, company_id: Optional[str] = None) -> Dict[str, int]:
    """Idempotent: set phone_norm on users/employees where missing and phone normalizes."""
    updated_users = updated_emps = 0
    cid = str(company_id or "").strip()
    phone_q: Dict[str, Any] = {
        "phone": {"$exists": True, "$nin": [None, ""]},
        "$or": [{"phone_norm": {"$exists": False}}, {"phone_norm": None}, {"phone_norm": ""}],
    }
    try:
        rows = await db.users.find(phone_q).to_list(5000)
    except Exception:
        rows = []
    for u in rows:
        norm = phone_norm_of(u.get("phone"))
        if not norm:
            continue
        try:
            await db.users.update_one({"_id": u["_id"]}, {"$set": {"phone_norm": norm}})
            updated_users += 1
        except Exception:
            pass
    try:
        if cid:
            erows = await db.employees.find({**phone_q, "company_id": cid}).to_list(5000)
        else:
            # tenant-ok: açılış backfill'i company_id almaz, tüm personel telefonlarını normalize eder
            erows = await db.employees.find(phone_q).to_list(5000)
    except Exception:
        erows = []
    for e in erows:
        norm = phone_norm_of(e.get("phone"))
        if not norm:
            continue
        try:
            await db.employees.update_one(
                {"_id": e["_id"], "company_id": str(e.get("company_id") or cid)},
                {"$set": {"phone_norm": norm}},
            )
            updated_emps += 1
        except Exception:
            pass
    if updated_users or updated_emps:
        logger.info("phone_norm backfill: users=%s employees=%s", updated_users, updated_emps)
    return {"users": updated_users, "employees": updated_emps}


async def find_user_by_phone(db, phone_raw: Any) -> Optional[dict]:
    """Resolve active user with password by normalized phone (users then employees→user)."""
    phone = phone_norm_of(phone_raw)
    if not phone:
        return None
    active_q = {
        "is_active": {"$ne": False},
        "password_hash": {"$exists": True, "$nin": [None, ""]},
    }
    user = await db.users.find_one({**active_q, "phone_norm": phone})
    if user:
        return user
    # Fallback: compare normalize_phone on stored phone (spaces/dashes / +90)
    candidates = await db.users.find({
        **active_q,
        "phone": {"$exists": True, "$nin": [None, ""]},
    }).to_list(PHONE_SCAN_LIMIT)
    for u in candidates:
        if phone_norm_of(u.get("phone")) == phone:
            # heal phone_norm for next time
            try:
                await db.users.update_one({"_id": u["_id"]}, {"$set": {"phone_norm": phone}})
            except Exception:
                pass
            return u
    # Employee phone → user_id
    # tenant-ok: şifremi unuttum telefon araması şirket seçmeden kullanıcıyı bulur
    emp = await db.employees.find_one({"phone_norm": phone})
    if not emp:
        # tenant-ok: şifremi unuttum telefon araması şirket seçmeden kullanıcıyı bulur
        emps = await db.employees.find({"phone": {"$exists": True, "$nin": [None, ""]}}).to_list(PHONE_SCAN_LIMIT)
        for e in emps:
            if phone_norm_of(e.get("phone")) == phone:
                emp = e
                try:
                    await db.employees.update_one(
                        {"_id": e["_id"], "company_id": str(e.get("company_id") or "")},
                        {"$set": {"phone_norm": phone}},
                    )
                except Exception:
                    pass
                break
    if not emp:
        return None
    uid = emp.get("user_id")
    if not uid:
        return None
    user = await db.users.find_one({"_id": uid, **active_q})
    return user
