"""In-app notification targeting: role codes assigned to personnel, or a specific user."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
import logging
import os
import re
import uuid

logger = logging.getLogger("TamKobiERP")

EXPO_PUSH_URL = os.environ.get("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
EXPO_TOKEN_RE = re.compile(r"^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$")

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
    """Şirket yöneticisi (personel kartı yok) her şeyi görür.
    Personel kartı bağlıysa yalnız kendisine atanan veya rolüne düşen kayıt."""
    if not user:
        return True
    role = (user.get("role") or "").lower()
    staff = bool(user.get("employee_id"))
    if user.get("is_super_admin") or (role == "admin" and not staff):
        return True
    mine = _ids_of(user)
    target_user = str(note.get("user_id") or "")
    target_emp = str(note.get("employee_id") or "")
    targeted = bool(target_user or target_emp)
    if targeted:
        return bool((target_user and target_user in mine) or (target_emp and target_emp in mine))
    if role == "admin" and staff:
        return False
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


def is_expo_push_token(token: Optional[str]) -> bool:
    return bool(EXPO_TOKEN_RE.match(str(token or "").strip()))


def user_ids_of(user: Optional[Dict[str, Any]]) -> List[str]:
    if not user:
        return []
    out: List[str] = []
    for key in ("_id", "id"):
        val = str(user.get(key) or "").strip()
        if val and val not in out:
            out.append(val)
    return out


def expo_push_messages(tokens: Iterable[str], note: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Expo Push API gövdesi — başlık/metin + uygulama içi yönlendirme verisi."""
    title = str(note.get("title") or "TamKobi").strip() or "TamKobi"
    body = str(note.get("message") or note.get("body") or "").strip()
    data = {
        "type": str(note.get("type") or ""),
        "link": str(note.get("link") or ""),
        "ref_type": str(note.get("ref_type") or ""),
        "ref_id": str(note.get("ref_id") or ""),
        "notification_id": str(note.get("_id") or note.get("id") or ""),
    }
    msgs: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for raw in tokens:
        token = str(raw or "").strip()
        if not is_expo_push_token(token) or token in seen:
            continue
        seen.add(token)
        msgs.append({
            "to": token,
            "title": title,
            "body": body,
            "sound": "default",
            "channelId": "tamkobi",
            "priority": "high",
            "badge": 1,
            "data": data,
        })
    return msgs


async def recipient_user_ids(db, note: Dict[str, Any]) -> List[str]:
    """Bildirimi görmesi gereken kullanıcı id'leri (rol + doğrudan atama)."""
    ids: List[str] = []
    seen: set[str] = set()

    def add(value: Optional[str]) -> None:
        v = str(value or "").strip()
        if v and v not in seen:
            seen.add(v)
            ids.append(v)

    add(note.get("user_id"))
    emp_id = str(note.get("employee_id") or "").strip()
    if emp_id:
        add(emp_id)
        emp_user = await db.users.find_one({"employee_id": emp_id})
        if emp_user:
            for uid in user_ids_of(emp_user):
                add(uid)
    roles = note.get("roles")
    if roles is None:
        roles = roles_for_type(note.get("type") or "")
    company_id = str(note.get("company_id") or "")
    if company_id and roles:
        for user in await users_with_roles(db, company_id, roles):
            for uid in user_ids_of(user):
                add(uid)
    if company_id:
        company_users = await db.users.find({
            "is_active": {"$ne": False},
            "is_super_admin": {"$ne": True},
            "$or": [{"active_company_id": company_id}, {"company_ids": company_id}],
        }).to_list(300)
        for user in company_users:
            if notification_visible(note, user):
                for uid in user_ids_of(user):
                    add(uid)
    return ids


async def tokens_for_users(db, user_ids: Iterable[str]) -> List[str]:
    ids = [str(i) for i in user_ids if i]
    if not ids:
        return []
    rows = await db.push_tokens.find({"user_id": {"$in": ids}}).to_list(400)
    return [str(r.get("token") or "") for r in rows if is_expo_push_token(r.get("token"))]


async def tokens_for_company(db, company_id: Optional[str]) -> List[str]:
    """Şirket cihazları: company_id eşleşen + o şirketteki kullanıcıların token'ları."""
    cid = str(company_id or "").strip()
    if not cid:
        return []
    users = await db.users.find({
        "is_active": {"$ne": False},
        "is_super_admin": {"$ne": True},
        "$or": [{"active_company_id": cid}, {"company_ids": cid}],
    }).to_list(300)
    uids: List[str] = []
    for user in users:
        uids.extend(user_ids_of(user))
    query: Dict[str, Any] = {"$or": [{"company_id": cid}]}
    if uids:
        query["$or"].append({"user_id": {"$in": uids}})
    rows = await db.push_tokens.find(query).to_list(400)
    return merge_push_tokens(r.get("token") for r in rows)


def is_targeted_note(note: Optional[Dict[str, Any]]) -> bool:
    if not note:
        return False
    return bool(str(note.get("user_id") or "").strip() or str(note.get("employee_id") or "").strip())


def merge_push_tokens(*groups: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for group in groups:
        for raw in group or []:
            token = str(raw or "").strip()
            if not is_expo_push_token(token) or token in seen:
                continue
            seen.add(token)
            out.append(token)
    return out


def collect_dispatch_tokens(user_tokens: Iterable[str], company_tokens: Iterable[str], targeted: bool) -> List[str]:
    """Kişisel bildirimde yalnız alıcı token'ı; şirket yayınında tüm kayıtlı cihazlar."""
    if targeted:
        return merge_push_tokens(user_tokens)
    return merge_push_tokens(user_tokens, company_tokens)


UNREAD_PUSH_LIMIT = 12


def pick_unread_for_push(
    rows: Iterable[Dict[str, Any]],
    user: Optional[Dict[str, Any]],
    limit: int = UNREAD_PUSH_LIMIT,
) -> List[Dict[str, Any]]:
    """Ana ekranda görünen okunmamış kayıtlar — telefona bir kez iletilir."""
    visible = [n for n in filter_notifications(rows or [], user) if not n.get("is_read")]
    return visible[: max(0, int(limit or 0))]


async def upsert_push_token(
    db,
    *,
    user_id: str,
    company_id: str,
    token: str,
    platform: str = "",
    device_id: str = "",
) -> Dict[str, Any]:
    token = str(token or "").strip()
    if not is_expo_push_token(token):
        raise ValueError("Geçerli bir Expo push token gerekli.")
    now = datetime.now(timezone.utc).isoformat()
    user_id = str(user_id or "").strip()
    existing = await db.push_tokens.find_one({"token": token})
    should_replay = not (existing or {}).get("replayed_at")
    sets: Dict[str, Any] = {
        "user_id": user_id,
        "company_id": company_id,
        "token": token,
        "platform": (platform or "")[:20],
        "device_id": (device_id or "")[:80],
        "updated_at": now,
    }
    if should_replay:
        sets["replayed_at"] = now
    await db.push_tokens.update_one(
        {"token": token},
        {
            "$set": sets,
            "$setOnInsert": {"_id": str(uuid.uuid4()), "created_at": now},
        },
        upsert=True,
    )
    return {"status": "ok", "token": token, "replay": should_replay}


async def remove_push_token(db, token: str, user_id: Optional[str] = None) -> int:
    token = str(token or "").strip()
    if not token:
        return 0
    q: Dict[str, Any] = {"token": token}
    if user_id:
        q["user_id"] = str(user_id)
    r = await db.push_tokens.delete_many(q)
    return int(getattr(r, "deleted_count", 0) or 0)


async def send_expo_push(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not messages:
        return {"sent": 0, "tickets": []}
    import httpx
    tickets: List[Any] = []
    async with httpx.AsyncClient(timeout=12.0) as client:
        for i in range(0, len(messages), 100):
            chunk = messages[i:i + 100]
            res = await client.post(
                EXPO_PUSH_URL,
                json=chunk,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            res.raise_for_status()
            payload = res.json() if res.content else {}
            data = payload.get("data") if isinstance(payload, dict) else payload
            if isinstance(data, list):
                tickets.extend(data)
            elif data is not None:
                tickets.append(data)
    return {"sent": len(messages), "tickets": tickets}


async def drop_invalid_push_tokens(db, tokens: Iterable[str], tickets: Iterable[Any]) -> int:
    doomed: List[str] = []
    token_list = [str(t) for t in tokens]
    for i, ticket in enumerate(tickets):
        if not isinstance(ticket, dict):
            continue
        details = str(ticket.get("details", {}).get("error") if isinstance(ticket.get("details"), dict) else ticket.get("details") or "")
        if ticket.get("status") == "error" and "DeviceNotRegistered" in details:
            if i < len(token_list):
                doomed.append(token_list[i])
    if not doomed:
        return 0
    r = await db.push_tokens.delete_many({"token": {"$in": doomed}})
    return int(getattr(r, "deleted_count", 0) or 0)


async def replay_unread_to_token(
    db,
    *,
    user: Optional[Dict[str, Any]],
    company_id: str,
    token: str,
    limit: int = UNREAD_PUSH_LIMIT,
) -> Dict[str, Any]:
    """Kayıtlı telefon ilk kez bağlanınca, paneldeki okunmamışları da push et."""
    if not is_expo_push_token(token) or not company_id:
        return {"sent": 0}
    rows = await db.notifications.find({
        "company_id": company_id,
        "is_read": {"$ne": True},
    }).sort("created_at", -1).to_list(80)
    notes = pick_unread_for_push(rows, user, limit=limit)
    messages: List[Dict[str, Any]] = []
    for note in notes:
        messages.extend(expo_push_messages([token], note))
    if not messages:
        return {"sent": 0, "count": 0}
    result = await send_expo_push(messages)
    try:
        await drop_invalid_push_tokens(db, [m["to"] for m in messages], result.get("tickets") or [])
    except Exception:
        logger.exception("invalid push token cleanup failed")
    return {"sent": int(result.get("sent") or 0), "count": len(notes)}


async def dispatch_push(db, note: Dict[str, Any]) -> Dict[str, Any]:
    recipients = await recipient_user_ids(db, note)
    user_tokens = await tokens_for_users(db, recipients)
    company_tokens = [] if is_targeted_note(note) else await tokens_for_company(db, note.get("company_id"))
    tokens = collect_dispatch_tokens(user_tokens, company_tokens, is_targeted_note(note))
    messages = expo_push_messages(tokens, note)
    if not messages:
        return {"sent": 0}
    result = await send_expo_push(messages)
    try:
        await drop_invalid_push_tokens(db, [m["to"] for m in messages], result.get("tickets") or [])
    except Exception:
        logger.exception("invalid push token cleanup failed")
    return result


async def insert_notification(db, doc: Dict[str, Any]) -> Dict[str, Any]:
    """Uygulama içi kaydı yazar ve kayıtlı telefonlara Expo push gönderir."""
    if not doc.get("_id"):
        doc["_id"] = str(uuid.uuid4())
    if not doc.get("created_at"):
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
    if "is_read" not in doc:
        doc["is_read"] = False
    if "roles" not in doc:
        doc["roles"] = roles_for_type(doc.get("type") or "")
    await db.notifications.insert_one(doc)
    try:
        await dispatch_push(db, doc)
    except Exception:
        logger.exception("push dispatch failed")
    return doc
