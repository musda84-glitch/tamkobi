"""Customer support tickets: create, status flow, screenshots, staff replies."""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import saas

router = APIRouter(prefix="/api")
_db = None
_current_user = None

STATUSES = ("open", "in_progress", "waiting_customer", "resolved", "closed")
STATUS_LABELS = {
    "open": "Açık",
    "in_progress": "İnceleniyor",
    "waiting_customer": "Yanıtınız bekleniyor",
    "resolved": "Çözüldü",
    "closed": "Kapatıldı",
}
CATEGORIES = {
    "teknik": "Teknik / hata",
    "fatura": "Fatura / e-belge",
    "lisans": "Lisans / paket",
    "stok": "Stok / sipariş",
    "diger": "Diğer",
}
PRIORITIES = {"low": "Düşük", "normal": "Normal", "high": "Yüksek"}
MAX_ATTACH = 8
MAX_BODY = 8000
MAX_SUBJECT = 200


def init(db, current_user_dep):
    global _db, _current_user
    _db, _current_user = db, current_user_dep


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: Optional[dict]) -> Optional[dict]:
    if not d:
        return d
    out = dict(d)
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    out["status_label"] = STATUS_LABELS.get(out.get("status"), out.get("status"))
    out["category_label"] = CATEGORIES.get(out.get("category"), out.get("category"))
    out["priority_label"] = PRIORITIES.get(out.get("priority"), out.get("priority"))
    return out


def sanitize_attachments(raw: Any) -> List[dict]:
    out = []
    for a in (raw or [])[:MAX_ATTACH]:
        if not isinstance(a, dict):
            continue
        url = str(a.get("url") or "").strip()
        if not url.startswith("/api/files/"):
            continue
        ct = str(a.get("content_type") or "")
        if ct and not (ct.startswith("image/") or ct == "application/pdf"):
            continue
        try:
            size = int(a.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        out.append({
            "url": url[:500],
            "filename": str(a.get("filename") or "ekran")[:180],
            "content_type": ct or "image/png",
            "size": max(0, min(size, 10 * 1024 * 1024)),
        })
    return out


def status_after_customer_reply(status: str) -> str:
    if status in ("closed", "resolved", "waiting_customer"):
        return "open"
    return status if status in STATUSES else "open"


def status_after_staff_reply(status: str) -> str:
    if status in ("open", "waiting_customer", "resolved", "closed"):
        return "in_progress"
    return status if status in STATUSES else "in_progress"


def public_ticket(doc: dict, *, staff: bool, include_messages: bool = True) -> dict:
    row = _clean(dict(doc))
    msgs = []
    for m in (doc.get("messages") or []):
        if m.get("is_internal") and not staff:
            continue
        msgs.append(dict(m))
    if include_messages:
        row["messages"] = msgs
    else:
        row.pop("messages", None)
        row["message_count"] = len(msgs)
    return row


def meta() -> dict:
    return {
        "statuses": [{"key": k, "label": STATUS_LABELS[k]} for k in STATUSES],
        "categories": [{"key": k, "label": v} for k, v in CATEGORIES.items()],
        "priorities": [{"key": k, "label": v} for k, v in PRIORITIES.items()],
    }


async def _require_addon(company_id: str):
    import addons
    await addons.require(company_id, "support.tickets")


async def _user(request: Request) -> dict:
    if not _current_user:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    return await _current_user(request)


def _in_company(user: dict, company_id: str) -> bool:
    if user.get("is_super_admin"):
        return True
    return company_id in (user.get("company_ids") or [])


async def _company_ticket(ticket_id: str, user: dict, *, staff: bool) -> dict:
    doc = await _db.support_tickets.find_one({"_id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Destek talebi bulunamadı.")
    if not staff and not _in_company(user, doc.get("company_id")):
        raise HTTPException(status_code=403, detail="Bu talebe erişiminiz yok.")
    return doc


async def _next_number(company_id: str) -> str:
    year = datetime.now(timezone.utc).year
    key = f"DST-{year}-{company_id}"
    c = await _db.counters.find_one_and_update({"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return f"DST-{year}-{int(c.get('seq') or 1):04d}"


def _preview(text: str) -> str:
    t = " ".join((text or "").split())
    return t[:140]


def _message(user: dict, body: str, attachments: list, *, is_staff: bool, is_internal: bool = False) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "author_id": user.get("id") or user.get("_id"),
        "author_name": user.get("name") or user.get("email"),
        "author_email": user.get("email"),
        "is_staff": bool(is_staff),
        "is_internal": bool(is_internal and is_staff),
        "body": body,
        "attachments": attachments,
        "created_at": _now(),
    }


async def _notify(company_id: str, title: str, message: str, ticket_id: str):
    import notify as _notify
    await _notify.insert_notification(_db, {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "type": "support",
        "title": title,
        "message": message,
        "ref_type": "support",
        "ref_id": ticket_id,
        "link": "/support",
        "is_read": False,
        "created_at": _now(),
    })


@router.get("/support/meta")
async def support_meta():
    return meta()


@router.get("/support/tickets")
async def list_mine(request: Request, company_id: str = "comp_nexus_main_01", status: Optional[str] = None):
    user = await _user(request)
    if not _in_company(user, company_id):
        raise HTTPException(status_code=403, detail="Bu şirket hesabına erişiminiz yok.")
    await _require_addon(company_id)
    q: Dict[str, Any] = {"company_id": company_id}
    if status:
        q["status"] = status
    rows = await _db.support_tickets.find(q).sort("updated_at", -1).to_list(200)
    return [public_ticket(r, staff=False, include_messages=False) for r in rows]


@router.get("/support/tickets/{ticket_id}")
async def get_mine(ticket_id: str, request: Request):
    user = await _user(request)
    doc = await _company_ticket(ticket_id, user, staff=False)
    await _require_addon(doc["company_id"])
    return public_ticket(doc, staff=False)


@router.post("/support/tickets")
async def create_ticket(req: Dict[str, Any], request: Request):
    user = await _user(request)
    company_id = (req.get("company_id") or user.get("active_company_id") or "comp_nexus_main_01").strip()
    if not _in_company(user, company_id):
        raise HTTPException(status_code=403, detail="Bu şirket hesabına erişiminiz yok.")
    await _require_addon(company_id)
    subject = str(req.get("subject") or "").strip()[:MAX_SUBJECT]
    body = str(req.get("body") or "").strip()[:MAX_BODY]
    if len(subject) < 3:
        raise HTTPException(status_code=400, detail="Konu en az 3 karakter olmalı.")
    if len(body) < 8:
        raise HTTPException(status_code=400, detail="Açıklama en az 8 karakter olmalı.")
    category = req.get("category") if req.get("category") in CATEGORIES else "diger"
    priority = req.get("priority") if req.get("priority") in PRIORITIES else "normal"
    attachments = sanitize_attachments(req.get("attachments"))
    company = await _db.companies.find_one({"_id": company_id}) or {}
    now = _now()
    msg = _message(user, body, attachments, is_staff=False)
    doc = {
        "_id": str(uuid.uuid4()),
        "number": await _next_number(company_id),
        "company_id": company_id,
        "company_name": company.get("name") or company_id,
        "subject": subject,
        "category": category,
        "priority": priority,
        "status": "open",
        "created_by_id": user.get("id") or user.get("_id"),
        "created_by_name": user.get("name") or user.get("email"),
        "created_by_email": user.get("email"),
        "messages": [msg],
        "last_message_at": now,
        "last_message_preview": _preview(body),
        "created_at": now,
        "updated_at": now,
    }
    await _db.support_tickets.insert_one(doc)
    return public_ticket(doc, staff=False)


@router.post("/support/tickets/{ticket_id}/messages")
async def customer_reply(ticket_id: str, req: Dict[str, Any], request: Request):
    user = await _user(request)
    doc = await _company_ticket(ticket_id, user, staff=False)
    await _require_addon(doc["company_id"])
    if doc.get("status") == "closed":
        raise HTTPException(status_code=400, detail="Kapatılmış talebe mesaj eklenemez. Yeni talep açın.")
    body = str(req.get("body") or "").strip()[:MAX_BODY]
    attachments = sanitize_attachments(req.get("attachments"))
    if len(body) < 1 and not attachments:
        raise HTTPException(status_code=400, detail="Mesaj veya ekran görüntüsü gerekli.")
    msg = _message(user, body or "(ekran görüntüsü)", attachments, is_staff=False)
    new_status = status_after_customer_reply(doc.get("status") or "open")
    now = _now()
    msgs = list(doc.get("messages") or []) + [msg]
    await _db.support_tickets.update_one({"_id": ticket_id}, {"$set": {
        "messages": msgs, "status": new_status, "updated_at": now,
        "last_message_at": now, "last_message_preview": _preview(body or "Ekran görüntüsü"),
    }})
    return public_ticket(await _db.support_tickets.find_one({"_id": ticket_id}), staff=False)


@router.post("/support/tickets/{ticket_id}/close")
async def customer_close(ticket_id: str, request: Request):
    user = await _user(request)
    doc = await _company_ticket(ticket_id, user, staff=False)
    await _require_addon(doc["company_id"])
    now = _now()
    await _db.support_tickets.update_one({"_id": ticket_id}, {"$set": {"status": "closed", "updated_at": now, "closed_at": now}})
    return public_ticket(await _db.support_tickets.find_one({"_id": ticket_id}), staff=False)


@router.get("/system/support-tickets")
async def admin_list(status: Optional[str] = None, company_id: Optional[str] = None, q: Optional[str] = None, _: dict = Depends(saas.require_super_admin)):
    filt: Dict[str, Any] = {}
    if status:
        filt["status"] = status
    if company_id:
        filt["company_id"] = company_id
    rows = await _db.support_tickets.find(filt).sort("updated_at", -1).to_list(300)
    needle = (q or "").strip().lower()
    if needle:
        rows = [r for r in rows if needle in f"{r.get('number')} {r.get('subject')} {r.get('company_name')} {r.get('created_by_email')}".lower()]
    counts = {k: await _db.support_tickets.count_documents({"status": k}) for k in STATUSES}
    return {"tickets": [public_ticket(r, staff=True, include_messages=False) for r in rows], "counts": counts, "open_count": counts["open"] + counts["in_progress"] + counts["waiting_customer"], **meta()}


@router.get("/system/support-tickets/{ticket_id}")
async def admin_get(ticket_id: str, _: dict = Depends(saas.require_super_admin)):
    doc = await _db.support_tickets.find_one({"_id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Destek talebi bulunamadı.")
    return public_ticket(doc, staff=True)


@router.post("/system/support-tickets/{ticket_id}/messages")
async def admin_reply(ticket_id: str, req: Dict[str, Any], request: Request, admin: dict = Depends(saas.require_super_admin)):
    doc = await _db.support_tickets.find_one({"_id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Destek talebi bulunamadı.")
    body = str(req.get("body") or "").strip()[:MAX_BODY]
    attachments = sanitize_attachments(req.get("attachments"))
    if len(body) < 1 and not attachments:
        raise HTTPException(status_code=400, detail="Mesaj veya ekran görüntüsü gerekli.")
    is_internal = bool(req.get("is_internal"))
    msg = _message(admin, body or "(ekran görüntüsü)", attachments, is_staff=True, is_internal=is_internal)
    want = req.get("status")
    new_status = want if want in STATUSES else status_after_staff_reply(doc.get("status") or "open")
    now = _now()
    msgs = list(doc.get("messages") or []) + [msg]
    await _db.support_tickets.update_one({"_id": ticket_id}, {"$set": {
        "messages": msgs, "status": new_status, "updated_at": now,
        "last_message_at": now, "last_message_preview": _preview(body or "Ekran görüntüsü"),
        "assigned_to": admin.get("email"), "assigned_name": admin.get("name"),
    }})
    if not is_internal:
        await _notify(doc["company_id"], f"Destek {doc.get('number')}", "Destek ekibi talebinize yanıt verdi.", ticket_id)
    return public_ticket(await _db.support_tickets.find_one({"_id": ticket_id}), staff=True)


@router.post("/system/support-tickets/{ticket_id}/status")
async def admin_status(ticket_id: str, req: Dict[str, Any], admin: dict = Depends(saas.require_super_admin)):
    doc = await _db.support_tickets.find_one({"_id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Destek talebi bulunamadı.")
    status = req.get("status")
    if status not in STATUSES:
        raise HTTPException(status_code=400, detail="Geçersiz durum.")
    now = _now()
    patch = {"status": status, "updated_at": now, "assigned_to": admin.get("email"), "assigned_name": admin.get("name")}
    if status == "closed":
        patch["closed_at"] = now
    await _db.support_tickets.update_one({"_id": ticket_id}, {"$set": patch})
    if status != doc.get("status"):
        await _notify(doc["company_id"], f"Destek {doc.get('number')}", f"Talep durumu: {STATUS_LABELS[status]}.", ticket_id)
    return public_ticket(await _db.support_tickets.find_one({"_id": ticket_id}), staff=True)
