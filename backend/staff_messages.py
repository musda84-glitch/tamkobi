"""Personel ↔ yönetici uygulama içi mesajlaşma."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException

import attendance
import notify as _notify

router = APIRouter(prefix="/api")
_db = None
_bound = False

MANAGER_ROLES = frozenset({"admin", "manager"})
MAX_BODY = 2000
PREVIEW = 4


def user_id_of(user: Optional[Dict[str, Any]]) -> str:
    if not user:
        return ""
    return str(user.get("_id") or user.get("id") or "").strip()


def user_company_id(user: Optional[Dict[str, Any]]) -> str:
    if not user:
        return ""
    cid = user.get("active_company_id")
    if cid:
        return str(cid)
    ids = user.get("company_ids") or []
    return str(ids[0]) if ids else ""


def is_manager(user: Optional[Dict[str, Any]]) -> bool:
    if not user:
        return False
    if user.get("is_super_admin"):
        return True
    return str(user.get("role") or "").lower() in MANAGER_ROLES


def normalize_body(text: Any) -> str:
    raw = str(text or "").replace("\r\n", "\n").strip()
    lines = [line.strip() for line in raw.split("\n")]
    compact: List[str] = []
    blank = 0
    for line in lines:
        if line:
            compact.append(line)
            blank = 0
        elif blank < 1:
            compact.append("")
            blank += 1
    return "\n".join(compact).strip()[:MAX_BODY]


def validate_body(text: Any) -> Tuple[Optional[str], Optional[str]]:
    body = normalize_body(text)
    if not body:
        return None, "Mesaj yazın."
    return body, None


def public_message(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    out = dict(doc)
    out["id"] = str(out.pop("_id", out.get("id") or ""))
    return out


def unread_for_reader(rows: List[Dict[str, Any]], reader_side: str) -> int:
    want = "manager" if reader_side == "staff" else "staff"
    return sum(1 for r in rows if not r.get("read_at") and r.get("from_side") == want)


def preview_messages(rows: List[Dict[str, Any]], limit: int = PREVIEW) -> List[Dict[str, Any]]:
    return [public_message(r) for r in (rows or [])[: max(0, limit)] if r]


def inbox_from_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Son mesaja göre personel konuşmaları; okunmamış = personelden gelenler."""
    by: Dict[str, Dict[str, Any]] = {}
    unread: Dict[str, int] = {}
    for r in rows or []:
        eid = str(r.get("employee_id") or "")
        if not eid:
            continue
        if eid not in by:
            by[eid] = r
        if not r.get("read_at") and r.get("from_side") == "staff":
            unread[eid] = unread.get(eid, 0) + 1
    return [{
        "employee_id": eid,
        "employee_name": last.get("employee_name") or "",
        "last": public_message(last),
        "unread": unread.get(eid, 0),
    } for eid, last in by.items()]


def message_doc(
    *,
    company_id: str,
    employee_id: str,
    employee_name: str,
    from_side: str,
    from_user_id: str,
    from_name: str,
    body: str,
) -> Dict[str, Any]:
    return {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "employee_id": employee_id,
        "employee_name": employee_name,
        "from_side": from_side if from_side in ("manager", "staff") else "staff",
        "from_user_id": from_user_id,
        "from_name": from_name,
        "body": body,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "read_at": None,
        "read_by": None,
    }


def _clean_emp(emp: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": emp.get("_id") or emp.get("id"),
        "full_name": emp.get("full_name") or "",
        "department": emp.get("department") or "",
        "position": emp.get("position") or "",
    }


async def _thread_rows(company_id: str, employee_id: str, limit: int = 80) -> List[Dict[str, Any]]:
    return await _db.staff_messages.find({
        "company_id": company_id,
        "employee_id": employee_id,
    }).sort("created_at", -1).to_list(limit)


async def _notify_new(doc: Dict[str, Any], emp: Dict[str, Any]):
    body = (doc.get("body") or "")[:140]
    if doc.get("from_side") == "manager":
        await _notify.insert_notification(_db, _notify.notification_doc(
            doc["company_id"], "staff_message",
            f"Yönetici mesajı: {doc.get('from_name') or 'Yönetici'}",
            body,
            link="/",
            user_id=emp.get("user_id"),
            employee_id=emp.get("_id") or emp.get("id"),
            roles=(),
            ref_type="staff_message",
            ref_id=doc.get("_id"),
        ))
        return
    await _notify.insert_notification(_db, _notify.notification_doc(
        doc["company_id"], "staff_message",
        f"Personel mesajı: {doc.get('employee_name') or emp.get('full_name') or 'Personel'}",
        body,
        link="/personnel",
        roles=("admin", "manager"),
        ref_type="staff_message",
        ref_id=doc.get("_id"),
        employee_id=emp.get("_id") or emp.get("id"),
    ))


async def _list_messages(employee_id: Optional[str] = None, user: dict = None):
    company_id = user_company_id(user)
    own = await attendance.employee_for_user(user)
    manager = is_manager(user)
    wanted = str(employee_id or "").strip()
    if wanted:
        if not manager:
            raise HTTPException(status_code=403, detail="Bu konuşmayı görme yetkiniz yok.")
        emp = await _db.employees.find_one({"_id": wanted, "company_id": company_id})
        if not emp:
            raise HTTPException(status_code=404, detail="Personel bulunamadı.")
        rows = await _thread_rows(company_id, wanted)
        return {
            "mode": "thread",
            "employee": _clean_emp(emp),
            "thread": [public_message(r) for r in rows],
            "unread": unread_for_reader(rows, "manager"),
            "inbox": [],
        }
    if own and str(own.get("company_id") or "") == company_id:
        rows = await _thread_rows(company_id, own["_id"])
        inbox = []
        if manager:
            all_rows = await _db.staff_messages.find({"company_id": company_id}).sort("created_at", -1).to_list(300)
            inbox = inbox_from_rows(all_rows)
        return {
            "mode": "both" if manager else "staff",
            "employee": _clean_emp(own),
            "thread": [public_message(r) for r in rows],
            "unread": unread_for_reader(rows, "staff"),
            "inbox": inbox,
        }
    if manager:
        all_rows = await _db.staff_messages.find({"company_id": company_id}).sort("created_at", -1).to_list(300)
        inbox = inbox_from_rows(all_rows)
        return {
            "mode": "manager",
            "employee": None,
            "thread": [],
            "unread": sum(x["unread"] for x in inbox),
            "inbox": inbox,
        }
    raise HTTPException(status_code=403, detail="Mesajları görmek için personel kartı veya yönetici yetkisi gerekir.")


async def _post_message(req: Dict[str, Any], user: dict):
    body, err = validate_body((req or {}).get("body"))
    if err:
        raise HTTPException(status_code=400, detail=err)
    company_id = user_company_id(user)
    own = await attendance.employee_for_user(user)
    manager = is_manager(user)
    wanted = str((req or {}).get("employee_id") or "").strip()
    from_name = str(user.get("name") or user.get("full_name") or "Kullanıcı").strip() or "Kullanıcı"
    uid = user_id_of(user)
    if wanted and manager:
        emp = await _db.employees.find_one({"_id": wanted, "company_id": company_id})
        if not emp:
            raise HTTPException(status_code=404, detail="Personel bulunamadı.")
        side = "manager"
    elif own and str(own.get("company_id") or "") == company_id:
        emp = own
        side = "staff"
    else:
        raise HTTPException(status_code=403, detail="Mesaj göndermek için personel kartı veya yönetici yetkisi gerekir.")
    doc = message_doc(
        company_id=company_id,
        employee_id=str(emp["_id"]),
        employee_name=str(emp.get("full_name") or ""),
        from_side=side,
        from_user_id=uid,
        from_name=from_name,
        body=body,
    )
    await _db.staff_messages.insert_one(doc)
    try:
        await _notify_new(doc, emp)
    except Exception:
        pass
    return {"status": "success", "message": public_message(doc)}


async def _read_messages(req: Dict[str, Any], user: dict):
    company_id = user_company_id(user)
    own = await attendance.employee_for_user(user)
    manager = is_manager(user)
    wanted = str((req or {}).get("employee_id") or "").strip()
    if wanted and manager:
        emp_id = wanted
        reader = "manager"
    elif own and str(own.get("company_id") or "") == company_id:
        emp_id = str(own["_id"])
        reader = "staff"
    else:
        raise HTTPException(status_code=403, detail="Konuşma işaretlenemedi.")
    want_side = "manager" if reader == "staff" else "staff"
    now = datetime.now(timezone.utc).isoformat()
    uid = user_id_of(user)
    result = await _db.staff_messages.update_many(
        {
            "company_id": company_id,
            "employee_id": emp_id,
            "from_side": want_side,
            "read_at": None,
        },
        {"$set": {"read_at": now, "read_by": uid}},
    )
    return {"status": "success", "updated": int(getattr(result, "modified_count", 0) or 0)}


def init(db, current_user_dep):
    global _db, _bound
    _db = db
    if _bound:
        return
    _bound = True

    @router.get("/personnel/messages")
    async def list_messages(employee_id: Optional[str] = None, user: dict = Depends(current_user_dep)):
        return await _list_messages(employee_id, user)

    @router.post("/personnel/messages")
    async def post_message(req: Dict[str, Any], user: dict = Depends(current_user_dep)):
        return await _post_message(req, user)

    @router.post("/personnel/messages/read")
    async def read_messages(req: Dict[str, Any], user: dict = Depends(current_user_dep)):
        return await _read_messages(req, user)
