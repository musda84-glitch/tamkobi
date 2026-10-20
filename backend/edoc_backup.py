"""Mali müşavir e-belge yedekleme: 62 günlük XML/PDF ZIP ve müşteri hatırlatması."""
import asyncio
import io
import logging
import re
import time
import uuid
import zipfile
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

import tenant_access
import ubl_export

router = APIRouter(prefix="/api")
logger = logging.getLogger("TamKobiERP")
_db = None
_current_user = None
_deps: Dict[str, Any] = {}

MAX_DAYS = 62
REMIND_AFTER_DAYS = 62
REMIND_COOLDOWN_DAYS = 14
MAX_DOCS = 2000
# Entegratörü yormamak için istekler arasında kısa ara. Testler 0'a çekebilir.
FETCH_GAP_SECONDS = 0.05
INVOICE_TIMEOUT_SECONDS = 45
_EXCLUDED_E_TYPES = frozenset({"paper", "proforma", "expense_slip", "e_dispatch", "dispatch"})
_EXCLUDED_INVOICE_TYPES = frozenset({"dispatch", "proforma", "expense_slip", "paper"})
_GIB_ERROR_RE = re.compile(r"^\s*hata\s*:", re.IGNORECASE)
_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def init(db, deps=None, get_current_user=None):
    global _db, _current_user
    _db = db
    if deps:
        _deps.update(deps)
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Edoc backup auth bağlanmadı.")
    return await _current_user(request)


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


def backup_e_types() -> Tuple[str, ...]:
    """e-Fatura / e-Arşiv (EDOC_TYPES) ve e-İhracat. Kağıt ve irsaliye yok."""
    seen: List[str] = []
    for name in (*ubl_export.EDOC_TYPES, "e_export", "e_ihracat"):
        if name and name not in seen and name not in _EXCLUDED_E_TYPES:
            seen.append(name)
    return tuple(seen)


def invoice_query(company_id: str, date_from: str, date_to: str) -> Dict[str, Any]:
    nxt = (date.fromisoformat(date_to) + timedelta(days=1)).isoformat()
    return {
        "company_id": company_id,
        "issue_date": {"$gte": date_from, "$lt": nxt},
        "e_type": {"$in": list(backup_e_types())},
        "invoice_type": {"$nin": ["dispatch", "proforma", "expense_slip"]},
        "status": {"$nin": ["draft", "cancelled", "canceled", "void"]},
        "einvoice_state": {"$nin": ["error"]},
        "gib_status": {"$not": {"$regex": r"^\s*hata\s*:", "$options": "i"}},
        "$or": [
            {"einvoice_state": "sent"},
            {"source": "edoc_inbox"},
            {"direction": "incoming"},
        ],
    }


def _is_incoming(inv: dict) -> bool:
    return str(inv.get("direction") or "") == "incoming" or str(inv.get("source") or "") == "edoc_inbox"


def _gib_error(inv: dict) -> bool:
    return bool(_GIB_ERROR_RE.match(str(inv.get("gib_status") or "")))


def _ettn(inv: dict) -> str:
    return str(inv.get("gib_uuid") or inv.get("gib_tracking_id") or "").strip()


def _issue_day(inv: dict) -> str:
    raw = inv.get("issue_date")
    if hasattr(raw, "isoformat"):
        return raw.isoformat()[:10]
    return str(raw or "")[:10]


def _inv_id(inv: dict) -> str:
    return str(inv.get("_id") or inv.get("id") or "")


def invoice_in_scope(inv: dict) -> bool:
    """GİB'e iletilmiş e-belge. Taslak, hatalı, kağıt, proforma, gider pusulası, irsaliye ve iptal yok."""
    from invoice_status import is_cancelled_invoice

    if not inv:
        return False
    et = str(inv.get("e_type") or "").strip()
    if et not in backup_e_types() or et in _EXCLUDED_E_TYPES:
        return False
    itype = str(inv.get("invoice_type") or "").strip().lower()
    if itype in _EXCLUDED_INVOICE_TYPES:
        return False
    status = str(inv.get("status") or "").strip().lower()
    if status == "draft" or status in {"cancelled", "canceled", "void"}:
        return False
    if is_cancelled_invoice(inv):
        return False
    if str(inv.get("einvoice_state") or "").strip().lower() == "error" or _gib_error(inv):
        return False
    if str(inv.get("einvoice_state") or "").strip() == "sent":
        return True
    return _is_incoming(inv)


def backup_filename(inv: dict, ext: str, *, local: bool = False) -> str:
    """GİB fatura no, yoksa yerel numara. Yerel üretim dosya adına _YEREL ekler."""
    raw = str(inv.get("gib_invoice_id") or "").strip() or str(inv.get("invoice_number") or "").strip() or "fatura"
    stem = _NAME_RE.sub("_", raw).strip("._") or "fatura"
    if local:
        stem = f"{stem}_YEREL"
    return f"{stem}.{ext.lstrip('.')}"


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
    cid = str(company_id or "").strip()
    if not cid:
        return []
    query = {**invoice_query(cid, date_from, date_to), "company_id": cid}
    rows = await _db.invoices.find(query).sort("issue_date", 1).to_list(MAX_DOCS)
    out = []
    for row in rows:
        if str(row.get("company_id") or "") != cid:
            continue
        day = _issue_day(row)
        if not day or day < date_from or day > date_to:
            continue
        if invoice_in_scope(row):
            out.append(row)
    return out


def _has_integrator_ettn(inv: dict) -> bool:
    """Geçerli UUID ETTN. Simüle GİB takip no (GIB-…) entegratör sayılmaz."""
    import isnet

    for key in ("gib_uuid", "gib_tracking_id"):
        if isnet.is_ettn_uuid(inv.get(key)):
            return True
    return False


def _counts(invs: List[dict]) -> Dict[str, int]:
    """Önizleme: UUID ETTN entegratörden alınacak, diğerleri yerel sayılır."""
    n = len(invs)
    integ = sum(1 for inv in invs if _has_integrator_ettn(inv))
    return {
        "invoice_count": n,
        "xml_count": n,
        "pdf_count": n,
        "integrator_count": integ,
        "local_count": n - integ,
    }


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


def _fault(exc: BaseException) -> Tuple[str, str]:
    from safe_error import mask_sensitive_text, provider_error_code

    if isinstance(exc, HTTPException):
        code = str(exc.status_code or "error")
        detail: Any = exc.detail
    elif isinstance(exc, TimeoutError):
        code, detail = "timeout", "zaman aşımı"
    else:
        detail = exc
        code = provider_error_code(detail) or "error"
    msg = mask_sensitive_text(detail).replace("\r", " ").replace("\n", " ")
    msg = " ".join(msg.split())[:180]
    return code, msg


def _log_fetch(kind: str, invoice_id: str, exc: BaseException) -> None:
    code, msg = _fault(exc)
    logger.warning("edoc backup %s %s hata=%s %s", kind, invoice_id, code, msg)


async def _pace(lock: asyncio.Lock, last: Dict[str, float]) -> None:
    gap = FETCH_GAP_SECONDS
    if gap <= 0:
        return
    async with lock:
        wait = gap - (time.monotonic() - last["t"])
        if wait > 0:
            await asyncio.sleep(wait)
        last["t"] = time.monotonic()


def _as_bytes(data: Any) -> Optional[bytes]:
    if data is None:
        return None
    if isinstance(data, bytes):
        return data or None
    if isinstance(data, str):
        raw = data.encode("utf-8")
        return raw or None
    try:
        raw = bytes(data)
    except Exception:
        return None
    return raw or None


async def _buyer(inv: dict) -> dict:
    contact = None
    cid = inv.get("contact_id")
    company_id = inv.get("company_id")
    if cid and company_id:
        contact = await _db.contacts.find_one({"_id": cid, "company_id": company_id})
    return ubl_export._buyer_from(inv, contact)


async def _stored_xml(invoice_id: str, *, company_id: str) -> Optional[bytes]:
    cid = str(company_id or "").strip()
    if not invoice_id or not cid:
        return None
    stored = await _db.outgoing_einvoice_xml.find_one({"_id": invoice_id, "company_id": cid})
    if not stored or not stored.get("xml"):
        return None
    xml = stored["xml"]
    return xml.encode("utf-8") if isinstance(xml, str) else _as_bytes(xml)


async def _local_xml(inv: dict, seller: dict) -> Optional[bytes]:
    try:
        buyer = await _buyer(inv)
        return _as_bytes(ubl_export.build_invoice_ubl(inv, seller, buyer))
    except Exception as exc:  # noqa: BLE001
        _log_fetch("xml-local", _inv_id(inv), exc)
        return None


async def _local_pdf(inv: dict, seller: dict, saas_docs) -> Optional[bytes]:
    try:
        buyer = await _buyer(inv)
        return _as_bytes(saas_docs.build_invoice_pdf(inv, seller, buyer))
    except Exception as exc:  # noqa: BLE001
        _log_fetch("pdf-local", _inv_id(inv), exc)
        return None


def _file(kind: str, data: Optional[bytes], source: str, error_code: str = "", error_message: str = "") -> dict:
    return {"kind": kind, "data": data, "source": source, "error_code": error_code, "error_message": error_message}


async def _xml_from_integrator(inv: dict, seller: dict, lock: asyncio.Lock, last: Dict[str, float], e_invoice) -> dict:
    iid = _inv_id(inv)
    err_code = err_msg = ""
    try:
        if _ettn(inv):
            await _pace(lock, last)
        remote = await e_invoice.fetch_integrator_xml(iid, company_id=str(inv.get("company_id") or ""))
        blob = _as_bytes(remote)
        if blob:
            return _file("xml", blob, "integrator")
    except Exception as exc:  # noqa: BLE001
        err_code, err_msg = _fault(exc)
        _log_fetch("xml", iid, exc)
    return await _xml_fallback(inv, seller, err_code, err_msg)


async def _pdf_from_integrator(inv: dict, seller: dict, lock: asyncio.Lock, last: Dict[str, float], e_invoice, saas_docs) -> dict:
    iid = _inv_id(inv)
    err_code = err_msg = ""
    try:
        if _ettn(inv):
            await _pace(lock, last)
        remote = await e_invoice.fetch_integrator_pdf(iid, company_id=str(inv.get("company_id") or ""))
        blob = _as_bytes(remote)
        if blob:
            return _file("pdf", blob, "integrator")
    except Exception as exc:  # noqa: BLE001
        err_code, err_msg = _fault(exc)
        _log_fetch("pdf", iid, exc)
    return _file("pdf", await _local_pdf(inv, seller, saas_docs), "local", err_code, err_msg)


async def _xml_fallback(inv: dict, seller: dict, error_code: str = "", error_message: str = "") -> dict:
    try:
        if not _is_incoming(inv):
            stored = await _stored_xml(_inv_id(inv), company_id=str(inv.get("company_id") or ""))
            if stored:
                return _file("xml", stored, "stored", error_code, error_message)
        return _file("xml", await _local_xml(inv, seller), "local", error_code, error_message)
    except Exception as exc:  # noqa: BLE001
        code, msg = _fault(exc)
        _log_fetch("xml", _inv_id(inv), exc)
        return _file("xml", None, "local", error_code or code, error_message or msg)


async def _fill_invoice(inv, seller, lock, last, e_invoice, saas_docs, holder: dict) -> None:
    holder["xml"] = await _xml_from_integrator(inv, seller, lock, last, e_invoice)
    holder["pdf"] = await _pdf_from_integrator(inv, seller, lock, last, e_invoice, saas_docs)


async def _collect_invoice(inv: dict, seller: dict, sem: asyncio.Semaphore, lock: asyncio.Lock, last: Dict[str, float], e_invoice, saas_docs) -> Tuple[dict, dict]:
    """Bir faturanın hatası ZIP'i düşürmesin. Semaphore aynı anda en fazla 3 fatura çeker."""
    holder: Dict[str, dict] = {}
    async with sem:
        try:
            await asyncio.wait_for(
                _fill_invoice(inv, seller, lock, last, e_invoice, saas_docs, holder),
                INVOICE_TIMEOUT_SECONDS,
            )
        except TimeoutError as exc:
            _log_fetch("invoice", _inv_id(inv), exc)
            if "xml" not in holder:
                holder["xml"] = await _xml_fallback(inv, seller, "timeout", "zaman aşımı")
            if "pdf" not in holder:
                holder["pdf"] = _file("pdf", await _local_pdf(inv, seller, saas_docs), "local", "timeout", "zaman aşımı")
        except Exception as exc:  # noqa: BLE001
            code, msg = _fault(exc)
            _log_fetch("invoice", _inv_id(inv), exc)
            if "xml" not in holder:
                holder["xml"] = await _xml_fallback(inv, seller, code, msg)
            if "pdf" not in holder:
                holder["pdf"] = _file("pdf", await _local_pdf(inv, seller, saas_docs), "local", code, msg)
    holder.setdefault("xml", _file("xml", None, "local", "error", ""))
    holder.setdefault("pdf", _file("pdf", None, "local", "error", ""))
    return holder["xml"], holder["pdf"]


def _manifest_line(path: str, source: str, ettn: str, error_code: str = "", error_message: str = "") -> str:
    parts = [path, f"kaynak={source}", f"ettn={ettn}"]
    if error_code:
        parts.append(f"hata={error_code}")
    if error_message:
        parts.append(f"mesaj={error_message}")
    return "  ".join(parts)


async def build_zip(company_id: str, date_from: str, date_to: str) -> Tuple[bytes, Dict[str, int]]:
    import e_invoice
    import saas_docs

    invs = await _list_invoices(company_id, date_from, date_to)
    seller = await _db.companies.find_one({"_id": company_id}) or {}
    sem = asyncio.Semaphore(3)
    lock = asyncio.Lock()
    last = {"t": 0.0}
    resolved = await asyncio.gather(*(
        _collect_invoice(inv, seller, sem, lock, last, e_invoice, saas_docs) for inv in invs
    ))
    buf = io.BytesIO()
    used: set = set()
    integ = local = stored = 0
    lines: List[str] = []
    base = _counts(invs)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for inv, (xml, pdf) in zip(invs, resolved):
            folder = "gelen" if _is_incoming(inv) else "giden"
            ettn = _ettn(inv)
            for item in (xml, pdf):
                local_name = item["source"] == "local"
                name = _unique(used, f"{folder}/{item['kind']}/" + backup_filename(inv, item["kind"], local=local_name))
                if item["data"]:
                    zf.writestr(name, item["data"])
                    if item["source"] == "integrator":
                        integ += 1
                    elif item["source"] == "local":
                        local += 1
                    elif item["source"] == "stored":
                        stored += 1
                lines.append(_manifest_line(name, item["source"], ettn, item["error_code"], item["error_message"]))
        manifest = [
            f"TamKobi e-belge yedek {date_from} … {date_to}",
            f"Şirket: {seller.get('name') or company_id}",
            f"Belge: {base['invoice_count']}  XML: {base['xml_count']}  PDF: {base['pdf_count']}  integrator={integ}  local={local}  stored={stored}",
            "",
            *lines,
        ]
        zf.writestr("MANIFEST.txt", "\n".join(manifest) + "\n")
    base["integrator_count"] = integ
    base["local_count"] = local
    return buf.getvalue(), base


async def record_backup(company_id: str, date_from: str, date_to: str, counts: Dict[str, int]) -> dict:
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "date_from": date_from,
        "date_to": date_to,
        "invoice_count": counts.get("invoice_count", 0),
        "xml_count": counts.get("xml_count", 0),
        "pdf_count": counts.get("pdf_count", 0),
        "integrator_count": counts.get("integrator_count", 0),
        "local_count": counts.get("local_count", 0),
        "created_at": _now(),
    }
    await _db.edoc_backups.insert_one(doc)
    return {**doc, "id": doc["_id"]}


@router.get("/accountant/edocs")
async def edocs_preview(company_id: Optional[str] = None, date_from: str = "", date_to: str = "", user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    d0, d1, days = parse_range(date_from, date_to)
    invs = await _list_invoices(cid, d0, d1)
    backup = await last_backup(cid)
    return {"date_from": d0, "date_to": d1, "days": days, "max_days": MAX_DAYS, **_counts(invs),
            "last_backup": backup, "reminder_due": reminder_due(backup)}


@router.get("/accountant/edocs/export")
async def edocs_export(company_id: Optional[str] = None, date_from: str = "", date_to: str = "", user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    d0, d1, _days = parse_range(date_from, date_to)
    data, counts = await build_zip(cid, d0, d1)
    if counts["invoice_count"]:
        await record_backup(cid, d0, d1, counts)
    filename = f"ebelge_yedek_{d0}_{d1}.zip"
    return Response(data, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Invoice-Count": str(counts["invoice_count"]),
        "X-Xml-Count": str(counts["xml_count"]),
        "X-Pdf-Count": str(counts["pdf_count"]),
        "X-Integrator-Count": str(counts.get("integrator_count", 0)),
        "X-Local-Count": str(counts.get("local_count", 0)),
        "Access-Control-Expose-Headers": "Content-Disposition, X-Invoice-Count, X-Xml-Count, X-Pdf-Count, X-Integrator-Count, X-Local-Count",
    })


@router.get("/accountant/edocs/last-backup")
async def edocs_last_backup(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    backup = await last_backup(cid)
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
    import notify as _notify
    await _notify.insert_notification(_db, {
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
