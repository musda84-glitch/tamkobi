"""Mali müşavir e-belge yedekleme: 62 günlük XML/PDF ZIP ve müşteri hatırlatması."""
import asyncio
import io
import logging
import uuid
import zipfile
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

import ubl_export

router = APIRouter(prefix="/api")
logger = logging.getLogger("TamKobiERP")
_db = None
_deps: Dict[str, Any] = {}

MAX_DAYS = 62
REMIND_AFTER_DAYS = 62
REMIND_COOLDOWN_DAYS = 14
MAX_DOCS = 2000


def init(db, deps=None):
    global _db
    _db = db
    if deps:
        _deps.update(deps)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_range(date_from: str, date_to: str) -> Tuple[str, str, int]:
    try:
        d0 = date.fromisoformat((date_from or "")[:10])
        d1 = date.fromisoformat((date_to or "")[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="Tarih aralığı YYYY-MM-DD formatında olmalıdır.")
    if d1 < d0:
        raise HTTPException(status_code=400, detail="Bitiş tarihi başlangıçtan önce olamaz.")
    days = (d1 - d0).days + 1
    if days > MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"Tarih aralığı en fazla {MAX_DAYS} gün olabilir.")
    return d0.isoformat(), d1.isoformat(), days


def invoice_query(company_id: str, date_from: str, date_to: str) -> Dict[str, Any]:
    nxt = (date.fromisoformat(date_to) + timedelta(days=1)).isoformat()
    return {"company_id": company_id, "issue_date": {"$gte": date_from, "$lt": nxt}, "invoice_type": {"$ne": "dispatch"}}


def _unique(used: set, name: str) -> str:
    if name not in used:
        used.add(name)
        return name
    if "." in name:
        stem, ext = name.rsplit(".", 1)
        ext = "." + ext
    else:
        stem, ext = name, ""
    i = 2
    while f"{stem}_{i}{ext}" in used:
        i += 1
    out = f"{stem}_{i}{ext}"
    used.add(out)
    return out


async def _list_invoices(company_id: str, date_from: str, date_to: str) -> List[dict]:
    rows = await _db.invoices.find(invoice_query(company_id, date_from, date_to)).sort("issue_date", 1).to_list(MAX_DOCS)
    return rows


def _counts(invs: List[dict]) -> Dict[str, int]:
    xml_n = sum(1 for i in invs if ubl_export.is_outgoing_edoc(i))
    return {"invoice_count": len(invs), "xml_count": xml_n, "pdf_count": len(invs)}


async def last_backup(company_id: str) -> Optional[dict]:
    rows = await _db.edoc_backups.find({"company_id": company_id}).sort("created_at", -1).to_list(1)
    if not rows:
        return None
    d = dict(rows[0])
    d["id"] = d.pop("_id", d.get("id"))
    return d


def reminder_due(backup: Optional[dict], now: Optional[datetime] = None) -> bool:
    now = now or datetime.now(timezone.utc)
    if not backup:
        return True
    raw = (backup.get("created_at") or "")[:19]
    try:
        taken = datetime.fromisoformat(raw.replace("Z", ""))
        if taken.tzinfo is None:
            taken = taken.replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return (now - taken).days >= REMIND_AFTER_DAYS


async def build_zip(company_id: str, date_from: str, date_to: str) -> Tuple[bytes, Dict[str, int]]:
    import saas_docs
    invs = await _list_invoices(company_id, date_from, date_to)
    seller = await _db.companies.find_one({"_id": company_id}) or {}
    buf = io.BytesIO()
    used: set = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = [
            f"TamKobi e-belge yedek {date_from} … {date_to}",
            f"Şirket: {seller.get('name') or company_id}",
            f"Belge: {len(invs)}  XML: {_counts(invs)['xml_count']}  PDF: {len(invs)}",
            "",
        ]
        for inv in invs:
            contact = await _db.contacts.find_one({"_id": inv.get("contact_id")}) if inv.get("contact_id") else None
            buyer = ubl_export._buyer_from(inv, contact)
            pdf_name = _unique(used, "pdf/" + ubl_export.invoice_filename(inv, "pdf"))
            zf.writestr(pdf_name, saas_docs.build_invoice_pdf(inv, seller, buyer))
            manifest.append(pdf_name)
            if ubl_export.is_outgoing_edoc(inv):
                xml_name = _unique(used, "xml/" + ubl_export.invoice_filename(inv, "xml"))
                zf.writestr(xml_name, ubl_export.build_invoice_ubl(inv, seller, buyer))
                manifest.append(xml_name)
        zf.writestr("MANIFEST.txt", "\n".join(manifest) + "\n")
    return buf.getvalue(), _counts(invs)


async def record_backup(company_id: str, date_from: str, date_to: str, counts: Dict[str, int]) -> dict:
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "date_from": date_from,
        "date_to": date_to,
        "invoice_count": counts.get("invoice_count", 0),
        "xml_count": counts.get("xml_count", 0),
        "pdf_count": counts.get("pdf_count", 0),
        "created_at": _now(),
    }
    await _db.edoc_backups.insert_one(doc)
    return {**doc, "id": doc["_id"]}


@router.get("/accountant/edocs")
async def edocs_preview(company_id: str = "comp_nexus_main_01", date_from: str = "", date_to: str = ""):
    d0, d1, days = parse_range(date_from, date_to)
    invs = await _list_invoices(company_id, d0, d1)
    backup = await last_backup(company_id)
    return {"date_from": d0, "date_to": d1, "days": days, "max_days": MAX_DAYS, **_counts(invs),
            "last_backup": backup, "reminder_due": reminder_due(backup)}


@router.get("/accountant/edocs/export")
async def edocs_export(company_id: str = "comp_nexus_main_01", date_from: str = "", date_to: str = ""):
    d0, d1, _days = parse_range(date_from, date_to)
    data, counts = await build_zip(company_id, d0, d1)
    if counts["invoice_count"]:
        await record_backup(company_id, d0, d1, counts)
    filename = f"ebelge_yedek_{d0}_{d1}.zip"
    return Response(data, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Invoice-Count": str(counts["invoice_count"]),
        "X-Xml-Count": str(counts["xml_count"]),
        "X-Pdf-Count": str(counts["pdf_count"]),
    })


@router.get("/accountant/edocs/last-backup")
async def edocs_last_backup(company_id: str = "comp_nexus_main_01"):
    backup = await last_backup(company_id)
    return {"last_backup": backup, "reminder_due": reminder_due(backup), "max_days": MAX_DAYS}


async def run_reminders() -> Dict[str, Any]:
    sent = []
    now = datetime.now(timezone.utc)
    cooldown = (now - timedelta(days=REMIND_COOLDOWN_DAYS)).isoformat()
    async for c in _db.companies.find({}):
        cid = c.get("_id") or c.get("id")
        if not cid:
            continue
        sample = await _db.invoices.find_one({"company_id": cid, "invoice_type": "sales", "e_type": {"$in": list(ubl_export.EDOC_TYPES)}})
        if not sample:
            continue
        backup = await last_backup(cid)
        if not reminder_due(backup, now):
            continue
        recent = await _db.edoc_backup_reminders.find_one({"company_id": cid, "created_at": {"$gte": cooldown}})
        if recent:
            continue
        res = await _send_reminder(c, backup)
        rec = {"_id": str(uuid.uuid4()), "company_id": cid, "company_name": c.get("name"), "kind": "edoc_backup",
               "last_backup_at": (backup or {}).get("created_at"), "result": res, "created_at": _now()}
        await _db.edoc_backup_reminders.insert_one(rec)
        sent.append({"company": c.get("name"), "company_id": cid, **res})
    return {"sent": sent, "count": len(sent), "checked_at": _now()}


async def _send_reminder(company: dict, backup: Optional[dict]) -> Dict[str, Any]:
    cid = company.get("_id") or company.get("id")
    last = (backup or {}).get("created_at", "")[:10] if backup else ""
    title = "e-Fatura / e-Arşiv yedekleme hatırlatması"
    if last:
        body = (f"Sayın {company.get('name')}, son e-belge yedeğiniz {last} tarihinde alındı. "
                f"GİB e-Fatura ve e-Arşiv belgelerini en fazla {MAX_DAYS} günlük aralıklarla XML ve PDF olarak "
                f"Mali Müşavir Paneli'nden indirip saklamanız önerilir.")
    else:
        body = (f"Sayın {company.get('name')}, henüz e-belge yedeği alınmamış. "
                f"Giden e-Fatura ve e-Arşiv XML/PDF kopyalarını Mali Müşavir Paneli'nden en fazla {MAX_DAYS} günlük "
                f"tarih aralığıyla indirip yedeklemeniz önerilir.")
    res: Dict[str, Any] = {"notification": True, "email": []}
    await _db.notifications.insert_one({
        "_id": str(uuid.uuid4()), "company_id": cid, "type": "edoc_backup", "title": title, "message": body,
        "link": "/accountant", "ref_type": "edoc_backup", "is_read": False, "created_at": _now(),
    })
    mail_fn = _deps.get("mail_account")
    smtp_fn = _deps.get("smtp_send")
    if mail_fn and smtp_fn:
        admins = await _db.users.find({"company_ids": cid, "role": "admin", "is_super_admin": {"$ne": True}}, {"email": 1}).to_list(20)
        emails = [a["email"] for a in admins if a.get("email")] or ([company["email"]] if company.get("email") else [])
        if emails:
            try:
                acc = await mail_fn(cid)
                html = f"<div style='font-family:Arial,sans-serif;max-width:600px'><h2>{title}</h2><p>{body}</p><p>Panel: Mali Müşavir → e-Belge yedekleme</p></div>"
                await smtp_fn(acc, emails, title, body, html=html)
                res["email"] = emails
            except Exception as e:  # noqa: BLE001
                res["email_error"] = str(getattr(e, "detail", e))[:160]
    return res


@router.post("/accountant/edocs/reminders/run")
async def reminders_run():
    return await run_reminders()


async def reminder_loop():
    await asyncio.sleep(45)
    while True:
        try:
            await run_reminders()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"edoc backup reminders: {e}")
        await asyncio.sleep(3600)
