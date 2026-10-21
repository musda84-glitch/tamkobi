"""In-app notification targeting: role codes assigned to personnel, or a specific user."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
import logging
import os
import re
import uuid

logger = logging.getLogger("TamKobiERP")

EXPO_PUSH_URL = os.environ.get("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
EXPO_TOKEN_RE = re.compile(r"^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$")
PUSH_RECEIPT_TTL = timedelta(hours=24)
PUSH_RECEIPT_BATCH = 300
PUSH_SOUND = "tamkobi.wav"
PUSH_CHANNEL_ID = "tamkobi_chime"

TYPE_ROLES: Dict[str, tuple[str, ...]] = {
    "order_pick_missing": ("admin", "manager", "warehouse"),
    "order_pick_production": ("admin", "manager", "warehouse", "production"),
    "attendance_late": ("admin", "manager", "accountant"),
    "attendance_missing": ("admin", "manager", "accountant"),
    "attendance_checkin_reminder": (),
    "attendance_checkout_reminder": (),
    "attendance_device": ("admin", "manager", "accountant"),
    "attendance_habit": ("admin", "manager", "accountant"),
    "attendance_time_edit": (),
    "attendance_dispute": ("admin", "manager", "accountant"),
    "attendance_dispute_decision": (),
    "early_leave_request": ("admin", "manager", "accountant"),
    "early_leave_decision": (),
    "intraday_leave_request": ("admin", "manager", "accountant"),
    "intraday_leave_decision": (),
    "leave_request": ("admin", "manager", "accountant"),
    "advance_request": ("admin", "manager", "accountant"),
    "yevmiye_adjustment": ("admin", "manager", "accountant"),
    "location_exit": ("admin", "manager", "accountant"),
    "location_unavailable": ("admin", "manager", "accountant"),
    "geo_confirm_request": ("admin", "manager", "accountant"),
    "geo_confirm_decision": (),
    "overtime_confirm": ("admin", "manager", "accountant"),
    "overtime_confirm_decision": (),
    "project_photo_pending": ("admin", "manager"),
    "role_assigned": ("admin", "manager"),
    "task_assigned": (),
    "staff_message": (),
    "staff_announcement": (),
    "overtime_assigned": (),
    "b2b_order": ("admin", "manager", "sales"),
    "order_new": ("admin", "manager", "sales"),
    "einvoice_incoming": ("admin", "manager", "accountant"),
    "gib_credits_low": ("admin",),
    "receivable_overdue": ("admin", "accountant"),
    "quote_response": ("admin", "manager", "sales"),
    "cash_approval": ("admin", "manager", "accountant"),
    "pos_approval": ("admin", "manager"),
    "pos_approval_decision": (),
    "pos_daily_summary": ("admin", "manager"),
    "bank_sync": ("admin", "manager", "accountant"),
    "license": ("admin",),
}

ROLE_LABELS = {
    "admin": "Yönetici",
    "owner": "Yönetici",
    "manager": "Müdür",
    "accountant": "Muhasebe",
    "sales": "Satış",
    "warehouse": "Depo",
    "production": "Üretim",
    "personel": "Personel",
    "advisor": "Mali Müşavir",
}

# Personel kartı bağlı yönetici depo/üretim yayınlarını görmez; kasa-banka kritik.
STAFF_ADMIN_BROADCAST_TYPES = frozenset({"bank_sync", "cash_approval", "license", "pos_approval", "pos_daily_summary"})


def roles_for_type(ntype: str) -> List[str]:
    return list(TYPE_ROLES.get((ntype or "").strip(), ("admin",)))


def role_label(code: str) -> str:
    return ROLE_LABELS.get(code, code or "rol")


def _ids_of(user: Dict[str, Any]) -> set[str]:
    return {str(v) for v in (user.get("_id"), user.get("id"), user.get("employee_id")) if v}


def notification_visible(note: Dict[str, Any], user: Optional[Dict[str, Any]]) -> bool:
    """Şirket yöneticisi (personel kartı yok) her şeyi görür.
    Personel kartı bağlıysa yalnız kendisine atanan veya rolüne düşen kayıt;
    personelli admin ayrıca banka/kasa yayınlarını alır (uygulama kapalıyken push)."""
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
    ntype = str(note.get("type") or "").strip()
    if role == "admin" and staff and ntype not in STAFF_ADMIN_BROADCAST_TYPES:
        return False
    stored = note.get("roles")
    roles = list(stored) if stored is not None else roles_for_type(ntype)
    if role and role in roles:
        return True
    return False


def filter_notifications(rows: Iterable[Dict[str, Any]], user: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [n for n in rows if notification_visible(n, user)]


MISSING_RECORD = "Kayıt bulunamadı"

_REF_KIND = {
    "order": "order",
    "order_batch": "order",
    "invoice": "invoice",
    "contact": "contact",
    "cari": "contact",
    "payment": "payment",
    "expense": "payment",
    "task": "task",
    "quote": "quote",
    "project": "project",
    "survey": "survey",
    "edoc": "edoc",
    "edoc_batch": "edoc",
    "bank": "bank_account",
    "bank_tx": "bank_tx",
    "bank_account": "bank_account",
    "cash_approval": "cash_approval",
    "pos_approval": "pos_approval",
    "leave_request": "leave_request",
    "advance_request": "advance_request",
    "overtime_request": "overtime_request",
    "employee": "employee",
    "cheque": "cheque",
    "support": "support",
    "work_order": "work_order",
    "production": "work_order",
    "license": "license",
    "receivable": "invoice",
}

_TYPE_KIND = {
    "bank_sync": "bank_account",
    "einvoice_incoming": "edoc",
    "b2b_order": "order",
    "order_new": "order",
    "order_pick_missing": "order",
    "order_pick_production": "order",
    "quote_response": "quote",
    "task_assigned": "task",
    "cash_approval": "cash_approval",
    "pos_approval": "pos_approval",
    "pos_approval_decision": "pos_approval",
    "leave_request": "leave_request",
    "advance_request": "advance_request",
    "overtime_confirm": "overtime_request",
    "yevmiye_adjustment": "overtime_request",
    "overtime_request": "overtime_request",
    "receivable_overdue": "invoice",
    "project_photo_pending": "project",
    "role_assigned": "employee",
    "staff_message": "staff_message",
    "staff_announcement": "staff_announcement",
    "license": "license",
}

_ID_COLLECTIONS = {
    "order": "orders",
    "invoice": "invoices",
    "contact": "contacts",
    "payment": "expenses",
    "quote": "quotes",
    "project": "projects",
    "survey": "surveys",
    "bank_tx": "bank_transactions",
    "bank_account": "bank_accounts",
    "cash_approval": "cash_approval_requests",
    "pos_approval": "pos_approvals",
    "leave_request": "leave_requests",
    "advance_request": "bonus_payments",
    "overtime_request": "attendance",
    "employee": "employees",
    "cheque": "cheques",
    "support": "support_tickets",
    "license": "companies",
    "work_order": "work_orders",
}

_LINK_KIND = (
    ("/edoc-inbox", "edoc"),
    ("/orders", "order"),
    ("/invoices", "invoice"),
    ("/contacts", "contact"),
    ("/expenses", "payment"),
    ("/quotes", "quote"),
    ("/projects", "project"),
    ("/surveys", "survey"),
    ("/cheques", "cheque"),
    ("/personelim", "task"),
    ("/personnel", "employee"),
    ("/banking", "bank_account"),
    ("/hizli-satis", "pos_approval"),
    ("/atolye", "work_order"),
    ("/support", "support"),
    ("/hesap", "license"),
)

_ETTN_RE = re.compile(r"ETTN\s+([0-9A-Fa-f-]{8,})", re.I)
_ACCOUNT_RE = re.compile(r"^([^:\n]{2,80}?):\s+\d+\s+yeni hareket", re.I)
_ORDER_NO_RE = re.compile(r"\b([A-Z]{1,8}-\d{4}-\d{3,})\b")


def _fold(value: Any) -> str:
    return str(value or "").replace("İ", "i").replace("I", "ı").casefold().strip()


def _parse_query(link: str) -> Dict[str, str]:
    raw = str(link or "")
    if "?" not in raw:
        return {}
    from urllib.parse import parse_qs, urlsplit
    parsed = parse_qs(urlsplit(raw).query)
    return {k: v[0] for k, v in parsed.items() if v}


def _q(params: Dict[str, Any]) -> str:
    from urllib.parse import urlencode
    clean = {k: str(v) for k, v in params.items() if v not in (None, "")}
    if not clean:
        return ""
    return "?" + urlencode(clean)


def normalize_target(raw: Optional[Dict[str, Any]]) -> Dict[str, str]:
    src = raw or {}
    return {
        "type": str(src.get("type") or ""),
        "id": str(src.get("id") or ""),
        "route": str(src.get("route") or ""),
    }


def _ettn_of(*chunks: str) -> str:
    for chunk in chunks:
        match = _ETTN_RE.search(str(chunk or ""))
        if match:
            return match.group(1).strip("-")
    return ""


def _account_name_of(message: str, title: str = "") -> str:
    text = str(message or "").strip()
    match = _ACCOUNT_RE.search(text)
    if match:
        return match.group(1).strip()
    if text and "₺" not in text and len(text) <= 80 and "\n" not in text and not text.lower().startswith("ettn"):
        # Eski banka bildirimi: mesajın kendisi hesap adı.
        if ":" not in text and not re.search(r"\d+\s+yeni", text, re.I):
            return text.strip(" .")
    return ""


def _kind_of(ntype: str, ref_type: str, link: str) -> str:
    ref = (ref_type or "").strip().lower()
    if ref in _REF_KIND:
        return _REF_KIND[ref]
    kind = _TYPE_KIND.get((ntype or "").strip())
    if kind:
        return kind
    path = str(link or "").split("?", 1)[0]
    if (path == "/personnel" or path.startswith("/personnel/")) and _parse_query(link).get("tab"):
        return ""
    for prefix, mapped in _LINK_KIND:
        if path == prefix or path.startswith(prefix + "/"):
            return mapped
    return ""


def _personnel_open(link: str, default_tab: str, key: str, rid: str) -> str:
    query = _parse_query(link)
    params: Dict[str, Any] = {"tab": query.get("tab") or default_tab}
    ident = str(query.get(key) or rid or "")
    if ident:
        params[key] = ident
    return "/personnel" + _q(params)


def _route_for(
    kind: str,
    ref_id: str = "",
    *,
    link: str = "",
    account_id: str = "",
    account_name: str = "",
    tx_id: str = "",
    ettn: str = "",
    project_id: str = "",
    pending: bool = False,
) -> str:
    rid = str(ref_id or "")
    if kind == "order":
        return f"/orders?open={rid}" if rid else (link or "/orders")
    if kind == "invoice":
        return f"/invoices?open={rid}" if rid else (link or "/invoices")
    if kind == "contact":
        return f"/contacts?contact_id={rid}" if rid else (link or "/contacts")
    if kind == "payment":
        return f"/expenses?open={rid}" if rid else (link or "/expenses")
    if kind == "task":
        if not rid and not project_id:
            return link or "/personelim?tab=gorevler"
        params: Dict[str, Any] = {"tab": "gorevler"}
        if rid:
            params["task"] = rid
        if project_id:
            params["project"] = project_id
        return "/personelim" + _q(params)
    if kind == "quote":
        return f"/quotes?focus={rid}" if rid else (link or "/quotes")
    if kind == "project":
        return f"/projects?focus={rid}" if rid else (link or "/projects")
    if kind == "survey":
        return f"/surveys?focus={rid}" if rid else (link or "/surveys")
    if kind == "edoc":
        params = {}
        if ettn:
            params["ettn"] = ettn
        if rid:
            params["id"] = rid
        if not params:
            return link or "/edoc-inbox"
        return "/edoc-inbox" + _q(params)
    if kind == "bank_tx":
        params = {}
        if pending:
            params["pending"] = "1"
        if account_id:
            params["account_id"] = account_id
        elif account_name:
            params["account"] = account_name
        if rid or tx_id:
            params["tx"] = tx_id or rid
        if not params:
            return link or "/banking"
        return "/banking" + _q(params)
    if kind == "bank_account":
        params = {}
        if pending:
            params["pending"] = "1"
        if rid:
            params["account_id"] = rid
        elif account_name:
            params["account"] = account_name
        if tx_id:
            params["tx"] = tx_id
        if not params:
            return link or "/banking"
        return "/banking" + _q(params)
    if kind == "cash_approval":
        query = _parse_query(link)
        approval = str(query.get("approval") or rid or "")
        params: Dict[str, Any] = {}
        if query.get("tab"):
            params["tab"] = query["tab"]
        if approval:
            params["approval"] = approval
        if not params:
            return link or "/banking"
        path = str(link or "/banking").split("?", 1)[0] or "/banking"
        return path + _q(params)
    if kind == "pos_approval":
        onay = str(_parse_query(link).get("onay") or rid or "")
        if onay:
            return f"/hizli-satis?onay={onay}"
        return link or "/hizli-satis"
    if kind == "leave_request":
        return _personnel_open(link, "leaves", "leave", rid)
    if kind == "advance_request":
        return _personnel_open(link, "payroll", "advance", rid)
    if kind == "overtime_request":
        return _personnel_open(link, "attendance", "overtime", rid)
    if kind == "employee":
        return f"/personnel?employee={rid}" if rid else (link or "/personnel")
    if kind == "cheque":
        return f"/cheques?open={rid}" if rid else (link or "/cheques")
    if kind == "support":
        return link or ("/support?ticket=" + rid if rid else "/support")
    if kind == "work_order":
        return f"/atolye?open={rid}" if rid else (link or "/atolye")
    if kind == "license":
        return link or "/hesap"
    if kind in ("staff_message", "staff_announcement"):
        return link or "/"
    return link or ""


def bank_movement_target(
    *,
    account_id: str = "",
    tx_id: str = "",
    account_name: str = "",
    pending: bool = True,
) -> Dict[str, str]:
    """Banka hareketi: ilgili hesap + eşleşme bekleyen satır."""
    kind = "bank_tx" if tx_id else "bank_account"
    route = _route_for(
        kind,
        tx_id or account_id,
        account_id=account_id,
        account_name=account_name,
        tx_id=tx_id,
        pending=pending,
    )
    return {"type": kind, "id": str(tx_id or account_id or ""), "route": route}


def build_notification_target(
    ntype: str = "",
    *,
    title: str = "",
    message: str = "",
    link: str = "",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    account_id: str = "",
    account_name: str = "",
    tx_id: str = "",
    ettn: str = "",
    project_id: str = "",
    pending: Optional[bool] = None,
) -> Dict[str, str]:
    """Yeni bildirim için type + id + route. Metindeki ETTN / hesap adı yedek ipucudur."""
    query = _parse_query(link)
    kind = _kind_of(ntype, ref_type or "", link)
    text = f"{title or ''}\n{message or ''}"
    found_ettn = ettn or query.get("ettn") or _ettn_of(text, link)
    found_account = account_name or query.get("account") or ""
    if kind in ("bank_account", "bank_tx") and not found_account:
        found_account = _account_name_of(message, title)
    rid = str(ref_id or query.get("id") or query.get("open") or query.get("edit") or query.get("contact_id") or query.get("focus") or query.get("tx") or "")
    if kind == "bank_tx":
        rid = str(tx_id or query.get("tx") or ref_id or "")
    elif kind == "bank_account":
        rid = str(account_id or query.get("account_id") or (ref_id if (ref_type or "") in ("bank", "bank_account") else "") or "")
        tx_id = tx_id or query.get("tx") or ""
    elif kind == "contact":
        rid = str(query.get("contact_id") or ref_id or "")
    elif kind == "task":
        rid = str(query.get("task") or ref_id or "")
    elif kind == "cash_approval":
        rid = str(query.get("approval") or ref_id or "")
    elif kind == "pos_approval":
        rid = str(query.get("onay") or ref_id or "")
    elif kind == "leave_request":
        rid = str(query.get("leave") or ref_id or "")
    elif kind == "advance_request":
        rid = str(query.get("advance") or ref_id or "")
    elif kind == "overtime_request":
        rid = str(query.get("overtime") or ref_id or "")
    elif kind == "order" and not rid:
        numbered = _ORDER_NO_RE.search(text)
        if numbered:
            return {"type": "order", "id": "", "route": "/orders?q=" + numbered.group(1)}
    if pending is None:
        blob = f"{link} {message}".lower()
        pending = "tab=match" in blob or "eşleşme bekliyor" in blob or query.get("pending") == "1"
    route = _route_for(
        kind,
        rid,
        link=link,
        account_id=account_id or query.get("account_id") or "",
        account_name=found_account,
        tx_id=tx_id or (query.get("tx") or ""),
        ettn=found_ettn,
        project_id=project_id or query.get("project") or "",
        pending=bool(pending),
    )
    if kind == "bank_tx" and not rid and (account_id or query.get("account_id")):
        kind = "bank_account"
        rid = account_id or query.get("account_id") or ""
    return {"type": kind, "id": rid, "route": route}


_RECORD_OPEN = {
    "cash_approval": ("approval", "/banking"),
    "pos_approval": ("onay", "/hizli-satis"),
    "leave_request": ("leave", "/personnel?tab=leaves"),
    "advance_request": ("advance", "/personnel?tab=payroll"),
    "overtime_request": ("overtime", "/personnel?tab=attendance"),
}


def _complete_record_route(note: Optional[Dict[str, Any]], target: Dict[str, str]) -> Dict[str, str]:
    """Linkte kayıt id yoksa ref_id ile tamamlar. Linksiz eski kayıt liste sayfasına düşer."""
    src = note or {}
    kind = str(target.get("type") or "")
    spec = _RECORD_OPEN.get(kind)
    if not spec:
        if not target.get("route"):
            typed = _TYPE_KIND.get(str(src.get("type") or "")) or ""
            if typed in _RECORD_OPEN:
                rid = str(src.get("ref_id") or "")
                route = _route_for(typed, rid, link=str(src.get("link") or ""))
                return {"type": typed, "id": rid, "route": route or _RECORD_OPEN[typed][1]}
        return target
    key, fallback = spec
    route = str(target.get("route") or src.get("link") or "")
    query = _parse_query(route)
    rid = str(target.get("id") or src.get("ref_id") or query.get(key) or "")
    if rid and not query.get(key):
        route = _route_for(kind, rid, link=route or fallback)
    elif not route:
        route = fallback
    return {"type": kind, "id": rid, "route": route}


def infer_notification_target(note: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Kayıtlı target varsa onu kullan; eski bildirimde type + metinden route üret (yazmaz)."""
    src = note or {}
    stored = src.get("target")
    if isinstance(stored, dict) and stored.get("type") and stored.get("route"):
        base = normalize_target(stored)
    else:
        base = build_notification_target(
            str(src.get("type") or ""),
            title=str(src.get("title") or ""),
            message=str(src.get("message") or ""),
            link=str(src.get("link") or ""),
            ref_type=src.get("ref_type"),
            ref_id=src.get("ref_id"),
            account_id=str(src.get("account_id") or ""),
            account_name=str(src.get("account_name") or ""),
            tx_id=str(src.get("tx_id") or ""),
            ettn=str(src.get("ettn") or ""),
            project_id=str(src.get("project_id") or ""),
            pending=src.get("pending") if "pending" in src else None,
        )
    return _complete_record_route(src, base)


def present_notification(note: Dict[str, Any]) -> Dict[str, Any]:
    """Liste yanıtına target ekler. Cihaz damgasını çıkarır; saklanan belge değişmez."""
    out = dict(note or {})
    out.pop("pushed_device_ids", None)
    out.pop("pushed_at", None)
    out["target"] = infer_notification_target(out)
    return out


async def _find_by_id(db, collection: str, company_id: str, rid: str):
    col = getattr(db, collection, None)
    if col is None or not rid:
        return None
    if company_id:
        doc = await col.find_one({"_id": rid, "company_id": company_id})
        if doc:
            return doc
    return await col.find_one({"_id": rid})


async def _rows(db, collection: str, company_id: str, limit: int = 400):
    col = getattr(db, collection, None)
    if col is None:
        return None
    query = {"company_id": company_id} if company_id else {}
    try:
        return await col.find(query).to_list(limit)
    except Exception:
        return None


def _open_result(target: Dict[str, str], exists: bool) -> Dict[str, Any]:
    return {"target": target, "exists": bool(exists), "message": None if exists else MISSING_RECORD}


async def resolve_notification_open(db, note: Dict[str, Any]) -> Dict[str, Any]:
    """Tıklama anında hedefi netleştirir ve kaydın durup durmadığına bakar. Veritabanına yazmaz."""
    target = infer_notification_target(note)
    company_id = str((note or {}).get("company_id") or "")
    kind = target.get("type") or ""
    rid = target.get("id") or ""
    query = _parse_query(target.get("route") or "")
    if kind in ("", "staff_message", "staff_announcement", "license") and not rid:
        return _open_result(target, True)
    if kind == "edoc":
        rows = await _rows(db, "incoming_edocs", company_id)
        if rows is None:
            return _open_result(target, True)
        needle = (query.get("ettn") or _ettn_of(note.get("message") or "", note.get("title") or "")).lower()
        found = None
        for doc in rows:
            doc_id = str(doc.get("_id") or doc.get("id") or "")
            uuid = str(doc.get("uuid") or doc.get("ettn") or "").lower()
            if rid and doc_id == rid:
                found = doc
                break
            if needle and uuid.startswith(needle):
                found = doc
                break
        if not found and (rid or needle):
            return _open_result(target, False)
        if not found:
            return _open_result(target, True)
        eid = str(found.get("_id") or found.get("id") or rid)
        refined = {
            "type": "edoc",
            "id": eid,
            "route": _route_for("edoc", eid, ettn=str(found.get("uuid") or found.get("ettn") or needle)),
        }
        return _open_result(refined, True)
    if kind in ("bank_tx", "bank_account"):
        tx_id = query.get("tx") or (rid if kind == "bank_tx" else "")
        account_id = query.get("account_id") or (rid if kind == "bank_account" else "")
        if tx_id:
            tx = await _find_by_id(db, "bank_transactions", company_id, tx_id)
            if not tx:
                return _open_result(target, False)
            account_id = str(tx.get("account_id") or account_id)
            pending = query.get("pending") == "1" or tx.get("match_status") == "unmatched"
            refined = bank_movement_target(account_id=account_id, tx_id=str(tx.get("_id") or tx_id), pending=pending)
            return _open_result(refined, True)
        if account_id:
            acc = await _find_by_id(db, "bank_accounts", company_id, account_id)
            if not acc:
                return _open_result(target, False)
            refined = bank_movement_target(
                account_id=str(acc.get("_id") or account_id),
                account_name=str(acc.get("account_name") or ""),
                pending=query.get("pending") == "1",
            )
            return _open_result(refined, True)
        name = query.get("account") or _account_name_of(str(note.get("message") or ""), str(note.get("title") or ""))
        if name:
            rows = await _rows(db, "bank_accounts", company_id, 200)
            if rows is None:
                return _open_result(target, True)
            folded = _fold(name)
            hits = [a for a in rows if folded and (folded == _fold(a.get("account_name")) or folded in _fold(a.get("account_name")))]
            if not hits:
                return _open_result(target, False)
            acc = hits[0]
            refined = bank_movement_target(
                account_id=str(acc.get("_id") or ""),
                account_name=str(acc.get("account_name") or name),
                pending=query.get("pending") == "1",
            )
            return _open_result(refined, True)
        return _open_result(target, True)
    if kind == "task":
        rows = await _rows(db, "projects", company_id, 300)
        if rows is None:
            return _open_result(target, True)
        project_id = query.get("project") or str(note.get("project_id") or "")
        task_id = query.get("task") or rid
        if project_id:
            proj = next((p for p in rows if str(p.get("_id") or p.get("id") or "") == project_id), None)
            if not proj:
                proj = await _find_by_id(db, "projects", company_id, project_id)
            if not proj:
                return _open_result(target, False)
            if task_id and not any(isinstance(t, dict) and str(t.get("id") or "") == task_id for t in (proj.get("tasks") or [])):
                return _open_result(target, False)
            return _open_result(target, True)
        if not task_id:
            return _open_result(target, True)
        for proj in rows:
            if any(isinstance(t, dict) and str(t.get("id") or "") == task_id for t in (proj.get("tasks") or [])):
                return _open_result(target, True)
        return _open_result(target, False)
    collection = _ID_COLLECTIONS.get(kind)
    if not collection or not rid:
        return _open_result(target, True)
    doc = await _find_by_id(db, collection, company_id, rid)
    return _open_result(target, doc is not None)


def notification_can_delete(note: Optional[Dict[str, Any]], user: Optional[Dict[str, Any]] = None) -> bool:
    """Yalnız okunmuş ve kullanıcının görebileceği bildirim silinir."""
    if not note:
        return False
    if not note.get("is_read"):
        return False
    return notification_visible(note, user)


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
    target: Optional[Dict[str, Any]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    extras = dict(extra or {})
    explicit = target if isinstance(target, dict) else extras.pop("target", None)
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
    if extras:
        doc.update(extras)
    if isinstance(explicit, dict) and explicit.get("type") and explicit.get("route"):
        built = normalize_target(explicit)
    else:
        built = build_notification_target(
            ntype,
            title=title,
            message=message,
            link=link or "",
            ref_type=ref_type,
            ref_id=ref_id,
            account_id=str(extras.get("account_id") or ""),
            account_name=str(extras.get("account_name") or ""),
            tx_id=str(extras.get("tx_id") or ""),
            ettn=str(extras.get("ettn") or ""),
            project_id=str(extras.get("project_id") or ""),
            pending=extras.get("pending") if "pending" in extras else None,
        )
    doc["target"] = built
    if not doc.get("link") and built.get("route"):
        doc["link"] = built["route"]
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


def expo_push_messages(
    tokens: Iterable[str],
    note: Dict[str, Any],
    token_users: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """Expo Push API gövdesi — başlık/metin + uygulama içi yönlendirme verisi.

    token_users: cihaz token'ı → o satırın user_id'si. Her mesaj kendi data
    kopyasını taşır; data.user_id o token'ın kullanıcısı, data.company_id
    bildirimin şirketidir.
    """
    title = str(note.get("title") or "TamKobi").strip() or "TamKobi"
    body = str(note.get("message") or note.get("body") or "").strip()
    target = note.get("target") if isinstance(note.get("target"), dict) else {}
    data = {
        "type": str(note.get("type") or ""),
        "link": str(note.get("link") or ""),
        "ref_type": str(note.get("ref_type") or ""),
        "ref_id": str(note.get("ref_id") or ""),
        "notification_id": str(note.get("_id") or note.get("id") or ""),
        "target_type": str(target.get("type") or ""),
        "target_id": str(target.get("id") or ""),
        "target_route": str(target.get("route") or ""),
        "company_id": str(note.get("company_id") or ""),
    }
    users = {str(key or "").strip(): str(value or "") for key, value in (token_users or {}).items()}
    msgs: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for raw in tokens:
        token = str(raw or "").strip()
        if not is_expo_push_token(token) or token in seen:
            continue
        seen.add(token)
        payload = dict(data)
        payload["user_id"] = users.get(token, "")
        msgs.append({
            "to": token,
            "title": title,
            "body": body,
            "sound": PUSH_SOUND,
            "channelId": PUSH_CHANNEL_ID,
            "priority": "high",
            "badge": 1,
            "data": payload,
        })
    return msgs


async def direct_recipient_ids(db, note: Dict[str, Any]) -> List[str]:
    """Kişisel bildirimin alıcısı: user_id ve personel kartına bağlı kullanıcı."""
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
    return ids


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


def _dedupe_token_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        token = str(row.get("token") or "").strip()
        if not is_expo_push_token(token) or token in seen:
            continue
        seen.add(token)
        out.append(row)
    return out


def _token_user_map(rows: Iterable[Dict[str, Any]]) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        token = str(row.get("token") or "").strip()
        uid = str(row.get("user_id") or "").strip()
        if token and uid and token not in mapping:
            mapping[token] = uid
    return mapping


async def _users_by_push_ids(db, user_ids: Iterable[str]) -> Dict[str, Dict[str, Any]]:
    ids: List[str] = []
    seen: set[str] = set()
    for raw in user_ids:
        uid = str(raw or "").strip()
        if uid and uid not in seen:
            seen.add(uid)
            ids.append(uid)
    if not ids:
        return {}
    rows = await db.users.find({
        "$or": [{"_id": {"$in": ids}}, {"id": {"$in": ids}}],
    }).to_list(400)
    found: Dict[str, Dict[str, Any]] = {}
    for user in rows or []:
        if not isinstance(user, dict):
            continue
        for key in user_ids_of(user):
            found.setdefault(key, user)
    return found


async def _visible_token_rows(db, rows: Iterable[Dict[str, Any]], note: Dict[str, Any]) -> List[Dict[str, Any]]:
    """user_id boş ya da bildirimi göremeyen token'ı şirket yayınından çıkar."""
    pending = [row for row in rows if isinstance(row, dict)]
    users = await _users_by_push_ids(db, (row.get("user_id") for row in pending))
    kept: List[Dict[str, Any]] = []
    for row in pending:
        uid = str(row.get("user_id") or "").strip()
        if not uid:
            continue
        user = users.get(uid)
        if not user or not notification_visible(note, user):
            continue
        kept.append(row)
    return kept


async def tokens_for_users(db, user_ids: Iterable[str], company_id: Optional[str] = None) -> List[Dict[str, Any]]:
    ids = [str(i) for i in user_ids if i]
    if not ids:
        return []
    cid = str(company_id or "").strip()
    if cid:
        rows = await db.push_tokens.find({"user_id": {"$in": ids}, "company_id": cid}).to_list(400)
    else:
        # tenant-ok: company_id verilmeyen çağrı kullanıcı kimlikleriyle token arar
        rows = await db.push_tokens.find({"user_id": {"$in": ids}}).to_list(400)
    return _dedupe_token_rows(rows)


async def tokens_for_company(
    db,
    company_id: Optional[str],
    *,
    note: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Şirket cihazları: company_id eşleşen + o şirketteki kullanıcıların token satırları.

    note verilirse satır, token'daki user_id bildirimi görebiliyorsa kalır.
    """
    cid = str(company_id or "").strip()
    if not cid:
        return []
    rows = await db.push_tokens.find({"company_id": cid}).to_list(400)
    deduped = _dedupe_token_rows(rows)
    if note is None:
        return deduped
    return await _visible_token_rows(db, deduped, note)


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


def push_device_id(raw: Any) -> str:
    """Cihaz kimliği. Boşluk kırpılır, kayıtla aynı 80 karakter sınırında tutulur."""
    return str(raw or "").strip()[:80]


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
    existing = await db.push_tokens.find_one({"token": token, "company_id": company_id})
    should_replay = not (existing or {}).get("replayed_at")
    sets: Dict[str, Any] = {
        "user_id": user_id,
        "company_id": company_id,
        "token": token,
        "platform": (platform or "")[:20],
        "device_id": push_device_id(device_id),
        "updated_at": now,
    }
    if should_replay:
        sets["replayed_at"] = now
    await db.push_tokens.update_one(
        {"token": token, "company_id": company_id},
        {
            "$set": sets,
            "$setOnInsert": {"_id": str(uuid.uuid4()), "created_at": now},
        },
        upsert=True,
    )
    return {"status": "ok", "token": token, "replay": should_replay}


async def remove_push_token(db, token: str, user_id: Optional[str] = None, company_id: Optional[str] = None) -> int:
    token = str(token or "").strip()
    if not token:
        return 0
    cid = str(company_id or "").strip()
    q: Dict[str, Any] = {"token": token}
    if user_id:
        q["user_id"] = str(user_id)
    if cid:
        q["company_id"] = cid
        r = await db.push_tokens.delete_many(q)
    else:
        # tenant-ok: company_id verilmeyen eski çağrı token ile siler
        r = await db.push_tokens.delete_many(q)
    return int(getattr(r, "deleted_count", 0) or 0)


def expo_push_headers() -> Dict[str, str]:
    """Expo push isteği. EXPO_ACCESS_TOKEN doluysa Bearer eklenir; değer loglanmaz."""
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    token = str(os.environ.get("EXPO_ACCESS_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def expo_receipts_url() -> str:
    """getReceipts adresi. EXPO_PUSH_RECEIPTS_URL varsa o, yoksa EXPO_PUSH_URL'den türetilir."""
    explicit = str(os.environ.get("EXPO_PUSH_RECEIPTS_URL") or "").strip()
    if explicit:
        return explicit
    base = str(EXPO_PUSH_URL or "").strip() or "https://exp.host/--/api/v2/push/send"
    if base.endswith("/send"):
        return base[: -len("/send")] + "/getReceipts"
    return base.rstrip("/") + "/getReceipts"


def ticket_error_code(ticket: Any) -> str:
    if not isinstance(ticket, dict):
        return ""
    details = ticket.get("details")
    if isinstance(details, dict):
        return str(details.get("error") or "").strip()
    return str(details or "").strip()


def push_token_tail(token: str) -> str:
    raw = str(token or "")
    if len(raw) < 6:
        return ""
    return raw[-6:]


def log_push_ticket_errors(messages: List[Dict[str, Any]], tickets: Iterable[Any]) -> int:
    """status=error ticket'larını sayar. Logda yalnız hata kodu ve token'ın son 6 karakteri."""
    found: List[tuple[str, str]] = []
    msg_list = list(messages or [])
    for i, ticket in enumerate(tickets or []):
        if not isinstance(ticket, dict) or ticket.get("status") != "error":
            continue
        token = ""
        if i < len(msg_list) and isinstance(msg_list[i], dict):
            token = str(msg_list[i].get("to") or "")
        found.append((ticket_error_code(ticket), token))
    count = len(found)
    for code, token in found:
        logger.warning(
            "expo push ticket error=%s token_tail=%s error_count=%s",
            code or "unknown",
            push_token_tail(token),
            count,
        )
    return count


async def send_expo_push(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not messages:
        return {"sent": 0, "tickets": [], "errors": 0}
    import httpx
    tickets: List[Any] = []
    headers = expo_push_headers()
    async with httpx.AsyncClient(timeout=12.0) as client:
        for i in range(0, len(messages), 100):
            chunk = messages[i:i + 100]
            res = await client.post(
                EXPO_PUSH_URL,
                json=chunk,
                headers=headers,
            )
            res.raise_for_status()
            payload = res.json() if res.content else {}
            data = payload.get("data") if isinstance(payload, dict) else payload
            if isinstance(data, list):
                tickets.extend(data)
            elif data is not None:
                tickets.append(data)
    errors = log_push_ticket_errors(messages, tickets)
    return {"sent": len(messages), "tickets": tickets, "errors": errors}


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
    # tenant-ok: Expo DeviceNotRegistered ticket'ındaki token listesi; şirket alanı yok
    r = await db.push_tokens.delete_many({"token": {"$in": doomed}})
    return int(getattr(r, "deleted_count", 0) or 0)


async def remember_push_receipts(db, messages: List[Dict[str, Any]], tickets: Iterable[Any]) -> int:
    """status=ok ticket id'lerini 24 saat TTL ile push_receipts_pending'e yazar."""
    if db is None:
        return 0
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    expires = (now + PUSH_RECEIPT_TTL).isoformat()
    saved = 0
    msg_list = list(messages or [])
    for i, ticket in enumerate(tickets or []):
        if not isinstance(ticket, dict) or ticket.get("status") != "ok":
            continue
        ticket_id = str(ticket.get("id") or "").strip()
        if not ticket_id:
            continue
        token = ""
        if i < len(msg_list) and isinstance(msg_list[i], dict):
            token = str(msg_list[i].get("to") or "")
        await db.push_receipts_pending.update_one(
            {"_id": ticket_id},
            {
                "$set": {"ticket_id": ticket_id, "token": token},
                "$setOnInsert": {"created_at": now_iso, "expires_at": expires},
            },
            upsert=True,
        )
        saved += 1
    return saved


async def _finish_push_delivery(db, messages: List[Dict[str, Any]], result: Dict[str, Any]) -> Dict[str, Any]:
    tickets = result.get("tickets") or []
    try:
        await drop_invalid_push_tokens(db, [m["to"] for m in messages], tickets)
    except Exception:
        logger.exception("invalid push token cleanup failed")
    try:
        await remember_push_receipts(db, messages, tickets)
    except Exception:
        logger.exception("push receipt queue failed")
    return result


def _receipt_expired(row: Dict[str, Any], now_iso: str) -> bool:
    exp = str(row.get("expires_at") or "").strip()
    return bool(exp) and exp < now_iso


def _receipt_token(row: Dict[str, Any], receipt: Dict[str, Any]) -> str:
    stored = str(row.get("token") or "").strip()
    if stored:
        return stored
    details = receipt.get("details")
    if isinstance(details, dict):
        return str(details.get("expoPushToken") or "").strip()
    return ""


async def _delete_ids(db, collection: str, ids: List[str]) -> int:
    uniq = []
    seen: set[str] = set()
    for raw in ids:
        item = str(raw or "").strip()
        if item and item not in seen:
            seen.add(item)
            uniq.append(item)
    if not uniq:
        return 0
    coll = getattr(db, collection)
    r = await coll.delete_many({"_id": {"$in": uniq}})
    return int(getattr(r, "deleted_count", 0) or 0)


async def check_push_receipts(db, *, limit: int = PUSH_RECEIPT_BATCH) -> Dict[str, Any]:
    """Bekleyen ticket id'leri için Expo receipt kontrolü. En fazla 300 id.

    DeviceNotRegistered token'ı siler. Diğer hatalar warning loglanır.
    Silme yalnız süresi dolan veya receipt'i işlenen kayıtlar içindir.
    """
    empty = {"checked": 0, "cleared": 0, "expired": 0, "dropped_tokens": 0}
    if db is None:
        return empty
    cap = max(0, min(int(limit or 0), PUSH_RECEIPT_BATCH))
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        cursor = db.push_receipts_pending.find({})
        sorter = getattr(cursor, "sort", None)
        if callable(sorter):
            cursor = sorter("created_at", 1)
        rows = await cursor.to_list(1000)
    except Exception:
        logger.exception("push receipt pending scan failed")
        return empty
    expired_ids: List[str] = []
    active: List[Dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if _receipt_expired(row, now_iso):
            expired_ids.append(str(row.get("_id") or row.get("ticket_id") or ""))
        else:
            active.append(row)
    expired_n = 0
    try:
        expired_n = await _delete_ids(db, "push_receipts_pending", expired_ids)
    except Exception:
        logger.exception("push receipt ttl cleanup failed")
    batch = active[:cap]
    by_id: Dict[str, Dict[str, Any]] = {}
    ids: List[str] = []
    for row in batch:
        ticket_id = str(row.get("ticket_id") or row.get("_id") or "").strip()
        if not ticket_id:
            continue
        by_id[ticket_id] = row
        ids.append(ticket_id)
    if not ids:
        return {"checked": 0, "cleared": 0, "expired": expired_n, "dropped_tokens": 0}
    import httpx
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.post(
                expo_receipts_url(),
                json={"ids": ids},
                headers=expo_push_headers(),
            )
            res.raise_for_status()
            payload = res.json() if res.content else {}
    except Exception:
        logger.exception("push receipt check failed")
        return {"checked": len(ids), "cleared": 0, "expired": expired_n, "dropped_tokens": 0}
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        data = {}
    processed: List[str] = []
    drop_tokens: List[str] = []
    for ticket_id in ids:
        receipt = data.get(ticket_id)
        if not isinstance(receipt, dict):
            continue
        status = str(receipt.get("status") or "")
        if status == "ok":
            processed.append(ticket_id)
            continue
        if status != "error":
            continue
        code = ticket_error_code(receipt)
        token = _receipt_token(by_id.get(ticket_id) or {}, receipt)
        if "DeviceNotRegistered" in code:
            if token:
                drop_tokens.append(token)
        else:
            logger.warning(
                "expo push receipt error=%s token_tail=%s",
                code or "unknown",
                push_token_tail(token),
            )
        processed.append(ticket_id)
    dropped = 0
    try:
        uniq_tokens = []
        seen_tokens: set[str] = set()
        for token in drop_tokens:
            if token not in seen_tokens:
                seen_tokens.add(token)
                uniq_tokens.append(token)
        if uniq_tokens:
            # tenant-ok: Expo receipt DeviceNotRegistered token listesi; şirket alanı yok
            r = await db.push_tokens.delete_many({"token": {"$in": uniq_tokens}})
            dropped = int(getattr(r, "deleted_count", 0) or 0)
    except Exception:
        logger.exception("push receipt token cleanup failed")
    cleared = 0
    try:
        cleared = await _delete_ids(db, "push_receipts_pending", processed)
    except Exception:
        logger.exception("push receipt pending cleanup failed")
    return {"checked": len(ids), "cleared": cleared, "expired": expired_n, "dropped_tokens": dropped}


def pushed_device_ids_of(note: Optional[Dict[str, Any]]) -> List[str]:
    if not isinstance(note, dict):
        return []
    raw = note.get("pushed_device_ids")
    if not isinstance(raw, list):
        return []
    return _unique_device_ids(raw)


def _unique_device_ids(values: Iterable[Any]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for item in values or []:
        device_id = push_device_id(item)
        if not device_id or device_id in seen:
            continue
        seen.add(device_id)
        out.append(device_id)
    return out


def _ok_message_indexes(messages: List[Dict[str, Any]], tickets: Iterable[Any]) -> List[int]:
    """Expo status=ok ticket'larının mesaj sırası. Hata ve ticketsiz gönderim başarılı sayılmaz."""
    ticket_list = list(tickets or [])
    indexes: List[int] = []
    for i, msg in enumerate(messages or []):
        if not isinstance(msg, dict):
            continue
        if i >= len(ticket_list) or not isinstance(ticket_list[i], dict):
            continue
        if str(ticket_list[i].get("status") or "") != "ok":
            continue
        if not str(msg.get("to") or "").strip():
            continue
        indexes.append(i)
    return indexes


def _device_ids_for_tokens(rows: Iterable[Dict[str, Any]], tokens: Iterable[str]) -> List[str]:
    wanted = {str(token or "").strip() for token in tokens if str(token or "").strip()}
    if not wanted:
        return []
    found: List[Any] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        token = str(row.get("token") or "").strip()
        if token in wanted:
            found.append(row.get("device_id"))
    return _unique_device_ids(found)


async def _stamp_pushed_devices(db, note: Dict[str, Any], device_ids: Iterable[str]) -> None:
    """Başarılı push sonrası bildirime cihaz listesini ve zamanı yazar.

    Yazma tek update_one ile $addToSet kullanır; eşzamanlı damgalar birbirini silmez.
    """
    fresh = _unique_device_ids(device_ids)
    note_id = str((note or {}).get("_id") or (note or {}).get("id") or "").strip()
    company_id = str((note or {}).get("company_id") or "").strip()
    if not fresh or not note_id or not company_id or getattr(db, "notifications", None) is None:
        return
    merged = _unique_device_ids([*pushed_device_ids_of(note), *fresh])
    now = datetime.now(timezone.utc).isoformat()
    note["pushed_device_ids"] = merged
    note["pushed_at"] = now
    try:
        await db.notifications.update_one(
            {"_id": note_id, "company_id": company_id},
            {"$addToSet": {"pushed_device_ids": {"$each": fresh}}, "$set": {"pushed_at": now}},
        )
    except Exception:
        logger.warning("push device stamp failed")


async def replay_unread_to_token(
    db,
    *,
    user: Optional[Dict[str, Any]],
    company_id: str,
    token: str,
    device_id: str = "",
    limit: int = UNREAD_PUSH_LIMIT,
) -> Dict[str, Any]:
    """Kayıtlı telefon ilk kez bağlanınca, paneldeki okunmamışları da push et.

    Aynı device_id bu bildirime daha önce başarılı gittiyse kayıt atlanır.
    Yeni cihaz okunmamışları almaya devam eder.
    """
    if not is_expo_push_token(token) or not company_id:
        return {"sent": 0}
    device = push_device_id(device_id)
    rows = await db.notifications.find({
        "company_id": company_id,
        "is_read": {"$ne": True},
    }).sort("created_at", -1).to_list(80)
    notes = pick_unread_for_push(rows, user, limit=limit)
    actor = str((user or {}).get("id") or (user or {}).get("_id") or "").strip()
    clean_token = str(token or "").strip()
    messages: List[Dict[str, Any]] = []
    selected: List[Dict[str, Any]] = []
    for note in notes:
        if device and device in pushed_device_ids_of(note):
            continue
        built = expo_push_messages([clean_token], note, {clean_token: actor})
        for msg in built:
            messages.append(msg)
            selected.append(note)
    if not messages:
        return {"sent": 0, "count": 0}
    result = await send_expo_push(messages)
    await _finish_push_delivery(db, messages, result)
    if device:
        for index in _ok_message_indexes(messages, result.get("tickets") or []):
            if index < len(selected):
                await _stamp_pushed_devices(db, selected[index], [device])
    return {"sent": int(result.get("sent") or 0), "count": len(selected)}


async def dispatch_push(db, note: Dict[str, Any]) -> Dict[str, Any]:
    targeted = is_targeted_note(note)
    if targeted:
        recipients = await direct_recipient_ids(db, note)
    else:
        recipients = await recipient_user_ids(db, note)
    user_rows = await tokens_for_users(db, recipients, str(note.get("company_id") or ""))
    # Kişisel bildirim yalnız alıcının token'ına gider. Şirket yayını, token
    # satırındaki kullanıcının görebildiği cihazlarla sınırlıdır.
    company_rows: List[Dict[str, Any]] = []
    if not targeted:
        try:
            company_rows = await tokens_for_company(db, note.get("company_id"), note=note)
        except Exception:
            logger.exception("company push visibility filter failed")
            company_rows = []
    mapping = _token_user_map(list(user_rows) + list(company_rows))
    tokens = collect_dispatch_tokens(
        (str(row.get("token") or "") for row in user_rows),
        (str(row.get("token") or "") for row in company_rows),
        targeted,
    )
    tokens = [token for token in tokens if mapping.get(token)]
    messages = expo_push_messages(tokens, note, mapping)
    if not messages:
        logger.warning(
            "push skipped (no tokens) type=%s company=%s recipients=%s",
            note.get("type"),
            note.get("company_id"),
            len(recipients),
        )
        return {"sent": 0}
    result = await send_expo_push(messages)
    finished = await _finish_push_delivery(db, messages, result)
    ok_indexes = _ok_message_indexes(messages, result.get("tickets") or [])
    ok_tokens = [str(messages[i].get("to") or "") for i in ok_indexes]
    device_ids = _device_ids_for_tokens(list(user_rows) + list(company_rows), ok_tokens)
    if device_ids:
        await _stamp_pushed_devices(db, note, device_ids)
    return finished


async def insert_notification(db, doc: Dict[str, Any]) -> Dict[str, Any]:
    """Uygulama içi kaydı yazar ve kayıtlı telefonlara Expo push gönderir."""
    stored = {**doc, "company_id": str(doc.get("company_id") or "").strip()}
    if not stored.get("_id"):
        stored["_id"] = str(uuid.uuid4())
    if not stored.get("created_at"):
        stored["created_at"] = datetime.now(timezone.utc).isoformat()
    if "is_read" not in stored:
        stored["is_read"] = False
    if "roles" not in stored:
        stored["roles"] = roles_for_type(stored.get("type") or "")
    if not (isinstance(stored.get("target"), dict) and stored["target"].get("type") and stored["target"].get("route")):
        stored["target"] = infer_notification_target(stored)
        if not stored.get("link") and stored["target"].get("route"):
            stored["link"] = stored["target"]["route"]
    await db.notifications.insert_one(stored)
    doc = stored
    try:
        await dispatch_push(db, doc)
    except Exception:
        logger.exception("push dispatch failed")
    return doc
