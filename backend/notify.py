"""In-app notification targeting: role codes assigned to personnel, or a specific user."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
import uuid

TYPE_ROLES: Dict[str, tuple[str, ...]] = {
    "order_pick_missing": ("admin", "manager", "warehouse"),
    "order_pick_production": ("admin", "manager", "warehouse", "production"),
    "attendance_late": ("admin", "manager", "accountant"),
    "attendance_missing": ("admin", "manager", "accountant"),
    "attendance_dispute": ("admin", "manager", "accountant"),
    "early_leave_decision": (),
    "intraday_leave_request": ("admin", "manager", "accountant"),
    "intraday_leave_decision": (),
    "leave_request": ("admin", "manager", "accountant"),
    "advance_request": ("admin", "manager", "accountant"),
    "role_assigned": ("admin", "manager"),
    "task_assigned": (),
    "overtime_assigned": (),
    "b2b_order": ("admin", "manager", "sales"),
    "quote_response": ("admin", "manager", "sales"),
    "cash_approval": ("admin", "manager", "accountant"),
    "bank_sync": ("admin", "manager", "accountant"),
    "license": ("admin",),
}

ROLE_LABELS = {
    "admin": "Yönetici",
    "manager": "Müdür",
    "accountant": "Muhasebe",
    "sales": "Satış",
    "warehouse": "Depo",
    "production": "Üretim",
    "personel": "Personel",
    "advisor": "Mali Müşavir",
}


def roles_for_type(ntype: str) -> List[str]:
    return list(TYPE_ROLES.get((ntype or "").strip(), ("admin",)))


def role_label(code: str) -> str:
    return ROLE_LABELS.get(code, code or "rol")


def _ids_of(user: Dict[str, Any]) -> set[str]:
    return {str(v) for v in (user.get("_id"), user.get("id"), user.get("employee_id")) if v}


def notification_visible(note: Dict[str, Any], user: Optional[Dict[str, Any]]) -> bool:
    """Admin sees everything. Others see notes for their role or addressed to them."""
    if not user:
        return True
    if user.get("is_super_admin") or (user.get("role") or "").lower() == "admin":
        return True
    role = (user.get("role") or "").lower()
    mine = _ids_of(user)
    target_user = str(note.get("user_id") or "")
    target_emp = str(note.get("employee_id") or "")
    if target_user and target_user in mine:
        return True
    if target_emp and target_emp in mine:
        return True
    stored = note.get("roles")
    roles = list(stored) if stored is not None else roles_for_type(note.get("type") or "")
    if role and role in roles:
        return True
    return False


def filter_notifications(rows: Iterable[Dict[str, Any]], user: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [n for n in rows if notification_visible(n, user)]


def notification_doc(
    company_id: str,
    ntype: str,
    title: str,
    message: str,
    *,
    link: str = "",
    user_id: Optional[str] = None,
    employee_id: Optional[str] = None,
    roles: Optional[Iterable[str]] = None,
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    doc: Dict[str, Any] = {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "type": ntype,
        "title": title,
        "message": message,
        "link": link or None,
        "roles": list(roles) if roles is not None else roles_for_type(ntype),
        "user_id": user_id,
        "employee_id": employee_id,
        "ref_type": ref_type,
        "ref_id": ref_id,
        "is_read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if extra:
        doc.update(extra)
    return doc


async def users_with_roles(db, company_id: str, roles: Iterable[str]) -> List[Dict[str, Any]]:
    role_list = [r for r in roles if r]
    if not role_list:
        return []
    return await db.users.find({
        "role": {"$in": role_list},
        "is_active": {"$ne": False},
        "is_super_admin": {"$ne": True},
        "$or": [{"active_company_id": company_id}, {"company_ids": company_id}],
    }).to_list(100)
