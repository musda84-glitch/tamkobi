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
MANAGER_ROLE_ALIASES = frozenset({
    "admin", "manager",
    "yönetici", "yonetici", "yönetıci",
    "müdür", "mudur",
})
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


def is_manager_role(code: Any = None, name: Any = None, permissions: Any = None) -> bool:
    """Sistem admin/manager + 'Yönetici' adlı veya tam yetkili özel roller."""
    raw = str(code or "").strip().lower()
    label = str(name or "").strip().lower()
    if raw in MANAGER_ROLES or raw in MANAGER_ROLE_ALIASES:
        return True
    if label in MANAGER_ROLE_ALIASES:
        return True
    perms = permissions if isinstance(permissions, dict) else {}
    if perms.get("/personnel") == "edit" and perms.get("/settings") == "edit":
        return True
    return False


def is_manager(user: Optional[Dict[str, Any]], role_doc: Optional[Dict[str, Any]] = None) -> bool:
    if not user:
        return False
    if user.get("is_super_admin"):
        return True
    if is_manager_role(user.get("role"), user.get("role_name"), (role_doc or {}).get("permissions")):
        return True
    if role_doc:
        return is_manager_role(role_doc.get("code"), role_doc.get("name"), role_doc.get("permissions"))
    return False


async def _manager_role_codes(company_id: str) -> set[str]:
    codes = set(MANAGER_ROLES)
    if not company_id or _db is None:
        return codes
    rows = await _db.roles.find({"company_id": company_id}).to_list(200)
    for r in rows or []:
        if is_manager_role(r.get("code"), r.get("name"), r.get("permissions")):
            code = str(r.get("code") or "").strip()
            if code:
                codes.add(code)
    return codes


async def user_is_manager(user: Optional[Dict[str, Any]], company_id: str = "") -> bool:
    if is_manager(user):
        return True
    cid = str(company_id or user_company_id(user) or "")
    if not user or not cid:
        return False
    codes = {c.lower() for c in await _manager_role_codes(cid)}
    return str(user.get("role") or "").strip().lower() in codes


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


def inbox_from_rows(rows: List[Dict[str, Any]], reader_user_id: str = "") -> List[Dict[str, Any]]:
    """Son mesaja göre personel konuşmaları; okunmamış = personelden gelenler.

    to_user_id dolu DM'ler yalnızca ilgili yöneticiye (veya gönderene) görünür.
    """
    by: Dict[str, Dict[str, Any]] = {}
    unread: Dict[str, int] = {}
    reader = str(reader_user_id or "")
    for r in rows or []:
        if r.get("group_id"):
            continue
        eid = str(r.get("employee_id") or "")
        if not eid:
            continue
        to_uid = str(r.get("to_user_id") or "")
        from_uid = str(r.get("from_user_id") or "")
        if to_uid and reader and to_uid != reader and from_uid != reader:
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
    to_user_id: str = "",
    to_name: str = "",
    group_id: str = "",
) -> Dict[str, Any]:
    kind = "group" if group_id else ("dm" if to_user_id else "legacy")
    return {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "employee_id": employee_id,
        "employee_name": employee_name,
        "from_side": from_side if from_side in ("manager", "staff") else "staff",
        "from_user_id": from_user_id,
        "from_name": from_name,
        "to_user_id": to_user_id or "",
        "to_name": to_name or "",
        "group_id": group_id or "",
        "thread_kind": kind,
        "body": body,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "read_at": None,
        "read_by": None,
    }


def clean_manager(user: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not user:
        return None
    uid = user_id_of(user)
    if not uid:
        return None
    return {
        "id": uid,
        "name": user.get("name") or user.get("full_name") or "Yönetici",
        "role": user.get("role") or "manager",
    }


def user_in_group(group: Optional[Dict[str, Any]], user_id: str = "", employee_id: str = "") -> bool:
    if not group:
        return False
    uid = str(user_id or "")
    eid = str(employee_id or "")
    users = [str(x) for x in (group.get("member_user_ids") or [])]
    emps = [str(x) for x in (group.get("member_employee_ids") or [])]
    if uid and uid in users:
        return True
    if eid and eid in emps:
        return True
    return False


def unique_ids(values: Any) -> List[str]:
    seen = set()
    out: List[str] = []
    for raw in values or []:
        v = str(raw or "").strip()
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def group_title(title: Any) -> str:
    return str(title or "").strip()[:80] or "Grup"


def public_group(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    return {
        "id": str(doc.get("_id") or doc.get("id") or ""),
        "title": doc.get("title") or "Grup",
        "member_user_ids": list(doc.get("member_user_ids") or []),
        "member_employee_ids": list(doc.get("member_employee_ids") or []),
        "created_by": doc.get("created_by") or "",
    }


def manager_inbox_from_rows(rows: List[Dict[str, Any]], managers: List[Dict[str, Any]], reader_user_id: str = "") -> List[Dict[str, Any]]:
    """Staff view: one row per yönetici DM. Legacy messages (no to_user_id) stay under _all."""
    names = {str(m.get("id")): (m.get("name") or "Yönetici") for m in managers or []}
    by: Dict[str, Dict[str, Any]] = {}
    unread: Dict[str, int] = {}
    for r in rows or []:
        if r.get("group_id"):
            continue
        mid = str(r.get("to_user_id") or "")
        if not mid and r.get("from_side") == "manager":
            mid = str(r.get("from_user_id") or "")
        if not mid:
            mid = "_all"
        if mid == reader_user_id:
            mid = str(r.get("from_user_id") or mid)
        if mid not in by:
            by[mid] = r
        if not r.get("read_at") and r.get("from_side") == "manager":
            unread[mid] = unread.get(mid, 0) + 1
    out = []
    for mid, last in by.items():
        out.append({
            "kind": "manager",
            "user_id": mid,
            "name": names.get(mid) or last.get("to_name") or last.get("from_name") or ("Tüm yöneticiler" if mid == "_all" else "Yönetici"),
            "last": public_message(last),
            "unread": unread.get(mid, 0),
        })
    for m in managers or []:
        mid = str(m.get("id") or "")
        if mid and mid not in by:
            out.append({"kind": "manager", "user_id": mid, "name": m.get("name") or "Yönetici", "last": None, "unread": 0})
    out.sort(key=lambda x: (-int(x.get("unread") or 0), 0 if x.get("last") else 1, str(x.get("name") or "")))
    return out


def group_inbox_from_rows(rows: List[Dict[str, Any]], groups: List[Dict[str, Any]], reader_user_id: str = "") -> List[Dict[str, Any]]:
    by: Dict[str, Dict[str, Any]] = {}
    unread: Dict[str, int] = {}
    for r in rows or []:
        gid = str(r.get("group_id") or "")
        if not gid:
            continue
        if gid not in by:
            by[gid] = r
        if not r.get("read_at") and str(r.get("from_user_id") or "") != str(reader_user_id or ""):
            unread[gid] = unread.get(gid, 0) + 1
    titles = {str(g.get("id") or g.get("_id")): (g.get("title") or "Grup") for g in groups or []}
    out = []
    for g in groups or []:
        gid = str(g.get("id") or g.get("_id") or "")
        if not gid:
            continue
        last = by.get(gid)
        out.append({
            "kind": "group",
            "group_id": gid,
            "name": titles.get(gid) or "Grup",
            "last": public_message(last) if last else None,
            "unread": unread.get(gid, 0),
        })
    return out


def announce_title(title: Any) -> str:
    return str(title or "").strip()[:80] or "Duyuru"


def announce_visible(doc: Optional[Dict[str, Any]], employee_id: str = "", manager: bool = False) -> bool:
    if not doc:
        return False
    if manager:
        return True
    targets = [str(x) for x in (doc.get("employee_ids") or []) if x]
    if not targets:
        return True
    return str(employee_id or "") in targets


def public_announce(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    return {
        "id": str(doc.get("_id") or doc.get("id") or ""),
        "title": doc.get("title") or "Duyuru",
        "body": doc.get("body") or "",
        "from_user_id": doc.get("from_user_id") or "",
        "from_name": doc.get("from_name") or "Yönetici",
        "employee_ids": list(doc.get("employee_ids") or []),
        "created_at": doc.get("created_at") or "",
        "read_by": list(doc.get("read_by") or []),
    }


def merge_manager_directory(inbox: List[Dict[str, Any]], managers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by = {str(r.get("user_id")): r for r in inbox or [] if r.get("user_id")}
    for m in managers or []:
        mid = str(m.get("id") or "")
        if mid and mid not in by:
            by[mid] = {"kind": "manager", "user_id": mid, "name": m.get("name") or "Yönetici", "last": None, "unread": 0}
    return sorted(by.values(), key=lambda x: (-int(x.get("unread") or 0), 0 if x.get("last") else 1, str(x.get("name") or "")))


def _clean_emp(emp: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": emp.get("_id") or emp.get("id"),
        "full_name": emp.get("full_name") or "",
        "department": emp.get("department") or "",
        "position": emp.get("position") or "",
    }


INACTIVE = frozenset({"terminated", "passive", "inactive", "left"})


async def _employee_directory(company_id: str, skip_id: Optional[str] = None) -> List[Dict[str, Any]]:
    rows = await _db.employees.find({"company_id": company_id}).to_list(400)
    out = []
    skip = str(skip_id or "")
    for e in rows:
        if str(e.get("status") or "").lower() in INACTIVE:
            continue
        eid = str(e.get("_id") or e.get("id") or "")
        if skip and eid == skip:
            continue
        out.append(_clean_emp(e))
    out.sort(key=lambda x: str(x.get("full_name") or "").lower())
    return out


async def _manager_directory(company_id: str, skip_id: Optional[str] = None) -> List[Dict[str, Any]]:
    rows = await _db.users.find({
        "$or": [
            {"active_company_id": company_id},
            {"company_ids": company_id},
            {"company_id": company_id},
        ],
    }).to_list(300)
    role_codes = {c.lower() for c in await _manager_role_codes(company_id)}
    skip = str(skip_id or "")
    out = []
    for u in rows:
        if u.get("is_active") is False:
            continue
        role = str(u.get("role") or "").strip().lower()
        if not is_manager(u) and role not in role_codes:
            continue
        uid = user_id_of(u)
        if skip and uid == skip:
            continue
        cleaned = clean_manager(u)
        if cleaned:
            out.append(cleaned)
    out.sort(key=lambda x: str(x.get("name") or "").lower())
    return out


async def _groups_for(company_id: str, user_id: str = "", employee_id: str = "") -> List[Dict[str, Any]]:
    rows = await _db.staff_groups.find({"company_id": company_id}).to_list(200)
    return [g for g in rows if user_in_group(g, user_id, employee_id)]


async def _thread_rows(
    company_id: str,
    employee_id: str = "",
    to_user_id: str = "",
    group_id: str = "",
    peer_user_id: str = "",
    self_user_id: str = "",
    limit: int = 80,
) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {"company_id": company_id}
    if group_id:
        q["group_id"] = group_id
        return await _db.staff_messages.find(q).sort("created_at", -1).to_list(limit)
    q["$or"] = [{"group_id": ""}, {"group_id": {"$exists": False}}]
    if peer_user_id and self_user_id:
        q["$and"] = [{
            "$or": [
                {"from_user_id": self_user_id, "to_user_id": peer_user_id},
                {"from_user_id": peer_user_id, "to_user_id": self_user_id},
            ]
        }]
        return await _db.staff_messages.find(q).sort("created_at", -1).to_list(limit)
    if employee_id:
        q["employee_id"] = employee_id
    if to_user_id and to_user_id != "_all":
        q["$and"] = [{
            "$or": [
                {"to_user_id": to_user_id},
                {"from_user_id": to_user_id, "from_side": "manager"},
            ]
        }]
    return await _db.staff_messages.find(q).sort("created_at", -1).to_list(limit)


async def _notify_new(doc: Dict[str, Any], emp: Optional[Dict[str, Any]] = None, target_user_ids: Optional[List[str]] = None):
    body = (doc.get("body") or "")[:140]
    title = f"{'Grup' if doc.get('group_id') else 'Mesaj'}: {doc.get('from_name') or 'Kullanıcı'}"
    targets = unique_ids(target_user_ids or [])
    if targets:
        for uid in targets:
            if uid == str(doc.get("from_user_id") or ""):
                continue
            await _notify.insert_notification(_db, _notify.notification_doc(
                doc["company_id"], "staff_message",
                title, body, link="/", user_id=uid, roles=(),
                ref_type="staff_message", ref_id=doc.get("_id"),
                employee_id=(emp or {}).get("_id") or (emp or {}).get("id"),
            ))
        return
    if doc.get("from_side") == "manager":
        await _notify.insert_notification(_db, _notify.notification_doc(
            doc["company_id"], "staff_message",
            f"Yönetici mesajı: {doc.get('from_name') or 'Yönetici'}",
            body,
            link="/",
            user_id=(emp or {}).get("user_id") or doc.get("to_user_id"),
            employee_id=(emp or {}).get("_id") or (emp or {}).get("id"),
            roles=(),
            ref_type="staff_message",
            ref_id=doc.get("_id"),
        ))
        return
    to_uid = str(doc.get("to_user_id") or "")
    await _notify.insert_notification(_db, _notify.notification_doc(
        doc["company_id"], "staff_message",
        f"Personel mesajı: {doc.get('employee_name') or (emp or {}).get('full_name') or 'Personel'}",
        body,
        link="/personnel" if not to_uid else "/",
        user_id=to_uid or None,
        roles=() if to_uid else ("admin", "manager"),
        ref_type="staff_message",
        ref_id=doc.get("_id"),
        employee_id=(emp or {}).get("_id") or (emp or {}).get("id"),
    ))


async def _list_messages(
    employee_id: Optional[str] = None,
    user: dict = None,
    to_user_id: Optional[str] = None,
    group_id: Optional[str] = None,
):
    company_id = user_company_id(user)
    own = await attendance.employee_for_user(user)
    manager = await user_is_manager(user, company_id)
    uid = user_id_of(user)
    own_id = str((own or {}).get("_id") or "")
    wanted = str(employee_id or "").strip()
    peer = str(to_user_id or "").strip()
    gid = str(group_id or "").strip()
    managers = await _manager_directory(company_id)
    groups = await _groups_for(company_id, uid, own_id)
    pub_groups = [public_group(g) for g in groups if public_group(g)]
    announcements = await _list_announcements(company_id, own_id, manager)

    if gid:
        group = next((g for g in groups if str(g.get("_id")) == gid), None)
        if not group and manager:
            group = await _db.staff_groups.find_one({"_id": gid, "company_id": company_id})
        if not group:
            raise HTTPException(status_code=403, detail="Bu grubu görme yetkiniz yok.")
        if not user_in_group(group, uid, own_id) and not manager:
            raise HTTPException(status_code=403, detail="Bu grubu görme yetkiniz yok.")
        rows = await _thread_rows(company_id, group_id=gid)
        return {
            "mode": "group",
            "employee": _clean_emp(own) if own else None,
            "thread": [public_message(r) for r in rows],
            "unread": sum(1 for r in rows if not r.get("read_at") and str(r.get("from_user_id") or "") != uid),
            "inbox": [],
            "directory": [],
            "managers": managers,
            "groups": pub_groups,
            "group": public_group(group),
            "self_user_id": uid,
        }

    if wanted:
        if not manager:
            raise HTTPException(status_code=403, detail="Bu konuşmayı görme yetkiniz yok.")
        emp = await _db.employees.find_one({"_id": wanted, "company_id": company_id})
        if not emp:
            raise HTTPException(status_code=404, detail="Personel bulunamadı.")
        rows = [
            r for r in await _thread_rows(company_id, employee_id=wanted)
            if not r.get("to_user_id")
            or str(r.get("to_user_id")) == uid
            or str(r.get("from_user_id") or "") == uid
        ]
        return {
            "mode": "thread",
            "employee": _clean_emp(emp),
            "thread": [public_message(r) for r in rows],
            "unread": unread_for_reader(rows, "manager"),
            "inbox": [],
            "directory": [],
            "managers": managers,
            "groups": pub_groups,
            "self_user_id": uid,
        }

    if peer and own and str(own.get("company_id") or "") == company_id:
        rows = await _thread_rows(company_id, employee_id=own["_id"], to_user_id=peer)
        return {
            "mode": "staff",
            "employee": _clean_emp(own),
            "thread": [public_message(r) for r in rows],
            "unread": unread_for_reader(rows, "staff"),
            "inbox": [],
            "directory": [],
            "managers": managers,
            "groups": pub_groups,
            "to_user": next((m for m in managers if str(m.get("id")) == peer), {"id": peer, "name": "Yönetici"}),
            "self_user_id": uid,
        }

    if peer and manager and (not own or peer != own_id):
        rows = await _thread_rows(company_id, peer_user_id=peer, self_user_id=uid)
        return {
            "mode": "thread",
            "employee": None,
            "thread": [public_message(r) for r in rows],
            "unread": sum(1 for r in rows if not r.get("read_at") and str(r.get("from_user_id") or "") != uid),
            "inbox": [],
            "directory": [],
            "managers": managers,
            "groups": pub_groups,
            "to_user": next((m for m in managers if str(m.get("id")) == peer), {"id": peer, "name": "Yönetici"}),
            "self_user_id": uid,
        }

    if own and str(own.get("company_id") or "") == company_id:
        rows = await _thread_rows(company_id, employee_id=own["_id"])
        staff_inbox = manager_inbox_from_rows(rows, managers, uid)
        inbox = []
        directory = await _employee_directory(company_id, own.get("_id"))
        if manager:
            all_rows = await _db.staff_messages.find({"company_id": company_id}).sort("created_at", -1).to_list(400)
            inbox = inbox_from_rows(all_rows, uid)
        group_inbox = group_inbox_from_rows(
            await _db.staff_messages.find({"company_id": company_id, "group_id": {"$in": [g.get("_id") for g in groups]}}).sort("created_at", -1).to_list(200) if groups else [],
            pub_groups,
            uid,
        )
        return {
            "mode": "both" if manager else "staff",
            "employee": _clean_emp(own),
            "thread": [public_message(r) for r in rows if not r.get("group_id")],
            "unread": unread_for_reader([r for r in rows if not r.get("group_id")], "staff"),
            "inbox": inbox,
            "directory": directory,
            "managers": managers,
            "manager_inbox": staff_inbox,
            "groups": pub_groups,
            "group_inbox": group_inbox,
            "announcements": announcements,
            "self_user_id": uid,
        }
    if manager:
        all_rows = await _db.staff_messages.find({"company_id": company_id}).sort("created_at", -1).to_list(400)
        inbox = inbox_from_rows(all_rows, uid)
        directory = await _employee_directory(company_id)
        group_inbox = group_inbox_from_rows(all_rows, pub_groups, uid)
        return {
            "mode": "manager",
            "employee": None,
            "thread": [],
            "unread": sum(x["unread"] for x in inbox),
            "inbox": inbox,
            "directory": directory,
            "managers": [m for m in managers if str(m.get("id")) != uid],
            "groups": pub_groups,
            "group_inbox": group_inbox,
            "announcements": announcements,
            "self_user_id": uid,
        }
    raise HTTPException(status_code=403, detail="Mesajları görmek için personel kartı veya yönetici yetkisi gerekir.")


async def _post_message(req: Dict[str, Any], user: dict):
    body, err = validate_body((req or {}).get("body"))
    if err:
        raise HTTPException(status_code=400, detail=err)
    company_id = user_company_id(user)
    own = await attendance.employee_for_user(user)
    manager = await user_is_manager(user, company_id)
    wanted = str((req or {}).get("employee_id") or "").strip()
    peer = str((req or {}).get("to_user_id") or "").strip()
    gid = str((req or {}).get("group_id") or "").strip()
    from_name = str(user.get("name") or user.get("full_name") or "Kullanıcı").strip() or "Kullanıcı"
    uid = user_id_of(user)
    own_id = str((own or {}).get("_id") or "")
    emp = None
    side = "manager" if manager else "staff"
    to_name = ""
    notify_users: List[str] = []

    if gid:
        group = await _db.staff_groups.find_one({"_id": gid, "company_id": company_id})
        if not group or (not user_in_group(group, uid, own_id) and not manager):
            raise HTTPException(status_code=403, detail="Bu gruba yazamazsınız.")
        emp = own
        notify_users = list(group.get("member_user_ids") or [])
        doc = message_doc(
            company_id=company_id,
            employee_id=own_id,
            employee_name=str((own or {}).get("full_name") or from_name),
            from_side=side,
            from_user_id=uid,
            from_name=from_name,
            body=body,
            group_id=gid,
        )
        await _db.staff_messages.insert_one(doc)
        try:
            await _notify_new(doc, emp, notify_users)
        except Exception:
            pass
        return {"status": "success", "message": public_message(doc)}

    if wanted and manager:
        emp = await _db.employees.find_one({"_id": wanted, "company_id": company_id})
        if not emp:
            raise HTTPException(status_code=404, detail="Personel bulunamadı.")
        side = "manager"
    elif peer and manager and not wanted:
        target = await _db.users.find_one({"_id": peer})
        if not target or not await user_is_manager(target, company_id):
            raise HTTPException(status_code=404, detail="Yönetici bulunamadı.")
        to_name = str(target.get("name") or "Yönetici")
        emp = own
        side = "manager"
    elif own and str(own.get("company_id") or "") == company_id:
        emp = own
        side = "staff"
        if peer and peer != "_all":
            target = await _db.users.find_one({"_id": peer})
            if not target or not await user_is_manager(target, company_id):
                raise HTTPException(status_code=404, detail="Yönetici bulunamadı.")
            to_name = str(target.get("name") or "Yönetici")
    else:
        raise HTTPException(status_code=403, detail="Mesaj göndermek için personel kartı veya yönetici yetkisi gerekir.")
    doc = message_doc(
        company_id=company_id,
        employee_id=str((emp or {}).get("_id") or ""),
        employee_name=str((emp or {}).get("full_name") or from_name),
        from_side=side,
        from_user_id=uid,
        from_name=from_name,
        body=body,
        to_user_id=peer if peer != "_all" else "",
        to_name=to_name,
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
    manager = await user_is_manager(user, company_id)
    wanted = str((req or {}).get("employee_id") or "").strip()
    peer = str((req or {}).get("to_user_id") or "").strip()
    gid = str((req or {}).get("group_id") or "").strip()
    uid = user_id_of(user)
    now = datetime.now(timezone.utc).isoformat()
    q: Dict[str, Any] = {"company_id": company_id, "read_at": None, "from_user_id": {"$ne": uid}}
    if gid:
        q["group_id"] = gid
    elif wanted and manager:
        q["employee_id"] = wanted
        q["from_side"] = "staff"
    elif peer and own and not manager:
        q["employee_id"] = str(own["_id"])
        q["from_side"] = "manager"
        q["$or"] = [{"to_user_id": peer}, {"from_user_id": peer}]
    elif peer:
        q["$or"] = [
            {"to_user_id": uid, "from_user_id": peer},
            {"from_user_id": peer, "from_side": "manager"},
        ]
    elif own and str(own.get("company_id") or "") == company_id:
        q["employee_id"] = str(own["_id"])
        q["from_side"] = "manager"
    else:
        raise HTTPException(status_code=403, detail="Konuşma işaretlenemedi.")
    result = await _db.staff_messages.update_many(q, {"$set": {"read_at": now, "read_by": uid}})
    return {"status": "success", "updated": int(getattr(result, "modified_count", 0) or 0)}


async def _list_announcements(company_id: str, employee_id: str = "", manager: bool = False) -> List[Dict[str, Any]]:
    rows = await _db.staff_announcements.find({"company_id": company_id}).sort("created_at", -1).to_list(40)
    return [public_announce(r) for r in rows if announce_visible(r, employee_id, manager) and public_announce(r)]


async def _create_announce(req: Dict[str, Any], user: dict):
    if not await user_is_manager(user):
        raise HTTPException(status_code=403, detail="Duyuru göndermek için yönetici yetkisi gerekir.")
    body, err = validate_body((req or {}).get("body"))
    if err:
        raise HTTPException(status_code=400, detail=err)
    company_id = user_company_id(user)
    uid = user_id_of(user)
    title = announce_title((req or {}).get("title"))
    wanted = unique_ids((req or {}).get("employee_ids") or [])
    directory = await _employee_directory(company_id)
    valid = {str(e.get("id")) for e in directory if e.get("id")}
    employee_ids = [eid for eid in wanted if eid in valid]
    if wanted and not employee_ids:
        raise HTTPException(status_code=400, detail="Duyuru için personel seçin.")
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "title": title,
        "body": body,
        "from_user_id": uid,
        "from_name": str(user.get("name") or user.get("full_name") or "Yönetici"),
        "employee_ids": employee_ids,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "read_by": [uid] if uid else [],
    }
    await _db.staff_announcements.insert_one(doc)
    targets = employee_ids or [str(e.get("id")) for e in directory if e.get("id")]
    if targets:
        emps = await _db.employees.find({"company_id": company_id, "_id": {"$in": targets}}).to_list(400)
        for emp in emps:
            try:
                await _notify.insert_notification(_db, _notify.notification_doc(
                    company_id, "staff_announcement",
                    title,
                    body[:140],
                    link="/",
                    user_id=emp.get("user_id") or None,
                    employee_id=emp.get("_id") or emp.get("id"),
                    roles=(),
                    ref_type="staff_announcement",
                    ref_id=doc.get("_id"),
                ))
            except Exception:
                pass
    return {"status": "success", "announcement": public_announce(doc)}


async def _read_announce(req: Dict[str, Any], user: dict):
    company_id = user_company_id(user)
    uid = user_id_of(user)
    aid = str((req or {}).get("id") or "").strip()
    if not aid or not uid:
        raise HTTPException(status_code=400, detail="Duyuru bulunamadı.")
    result = await _db.staff_announcements.update_one(
        {"_id": aid, "company_id": company_id},
        {"$addToSet": {"read_by": uid}},
    )
    if not int(getattr(result, "matched_count", 0) or 0):
        raise HTTPException(status_code=404, detail="Duyuru bulunamadı.")
    return {"status": "success"}


async def _create_group(req: Dict[str, Any], user: dict):
    company_id = user_company_id(user)
    own = await attendance.employee_for_user(user)
    manager = await user_is_manager(user, company_id)
    if not manager and not own:
        raise HTTPException(status_code=403, detail="Grup oluşturmak için giriş yapın.")
    uid = user_id_of(user)
    title = group_title((req or {}).get("title"))
    member_users = unique_ids((req or {}).get("member_user_ids") or [])
    member_emps = unique_ids((req or {}).get("member_employee_ids") or [])
    if uid:
        member_users = unique_ids([*member_users, uid])
    if own and own.get("_id"):
        member_emps = unique_ids([*member_emps, own["_id"]])
    if member_emps:
        emps = await _db.employees.find({"company_id": company_id, "_id": {"$in": member_emps}}).to_list(200)
        valid_emps: List[str] = []
        for emp in emps:
            eid = str(emp.get("_id") or "")
            if eid:
                valid_emps.append(eid)
            linked = str(emp.get("user_id") or "")
            if linked:
                member_users.append(linked)
        member_emps = unique_ids(valid_emps)
    if member_users:
        users = await _db.users.find({"_id": {"$in": member_users}}).to_list(200)
        valid_users: List[str] = []
        for u in users:
            if user_company_id(u) == company_id or company_id in [str(x) for x in (u.get("company_ids") or [])]:
                valid_users.append(user_id_of(u))
        member_users = unique_ids([*valid_users, uid] if uid else valid_users)
    if len(member_users) + len(member_emps) < 2:
        raise HTTPException(status_code=400, detail="Gruba en az bir kişi daha ekleyin.")
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "title": title,
        "member_user_ids": member_users,
        "member_employee_ids": member_emps,
        "created_by": uid,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await _db.staff_groups.insert_one(doc)
    return {"status": "success", "group": public_group(doc)}


def init(db, current_user_dep):
    global _db, _bound
    _db = db
    if _bound:
        return
    _bound = True

    @router.get("/personnel/messages")
    async def list_messages(
        employee_id: Optional[str] = None,
        to_user_id: Optional[str] = None,
        group_id: Optional[str] = None,
        user: dict = Depends(current_user_dep),
    ):
        return await _list_messages(employee_id, user, to_user_id, group_id)

    @router.post("/personnel/messages")
    async def post_message(req: Dict[str, Any], user: dict = Depends(current_user_dep)):
        return await _post_message(req, user)

    @router.post("/personnel/messages/read")
    async def read_messages(req: Dict[str, Any], user: dict = Depends(current_user_dep)):
        return await _read_messages(req, user)

    @router.post("/personnel/messages/groups")
    async def create_group(req: Dict[str, Any], user: dict = Depends(current_user_dep)):
        return await _create_group(req, user)

    @router.post("/personnel/messages/announce")
    async def create_announce(req: Dict[str, Any], user: dict = Depends(current_user_dep)):
        return await _create_announce(req, user)

    @router.post("/personnel/messages/announce/read")
    async def read_announce(req: Dict[str, Any], user: dict = Depends(current_user_dep)):
        return await _read_announce(req, user)
