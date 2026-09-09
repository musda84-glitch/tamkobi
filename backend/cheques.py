"""Çek / senet girişleri: alınan-verilen portföy, tahsil, ciro, karşılıksız."""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from bank_guard import assert_manual_allowed
import trash

router = APIRouter(prefix="/api")
_db = None

OPEN_STATUSES = {"open"}
STATUS_TR = {
    "open": "Portföy / Açık",
    "collected": "Tahsil edildi",
    "paid": "Ödendi",
    "endorsed": "Ciro edildi",
    "bounced": "Karşılıksız",
    "cancelled": "İptal",
}


def init(db):
    global _db
    _db = db


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _clean(d):
    if d and "_id" in d:
        d["id"] = str(d.pop("_id"))
    return d


def _annotate(row: dict, today: str) -> dict:
    d = _clean(row)
    due = d.get("due_date") or ""
    d["status_label"] = STATUS_TR.get(d.get("status"), d.get("status"))
    d["overdue"] = d.get("status") == "open" and bool(due) and due < today
    d["due_soon"] = False
    return d


async def _next_number(company_id: str, instrument: str) -> str:
    year = datetime.now(timezone.utc).strftime("%Y")
    prefix = "SNT" if instrument == "promissory" else "CEK"
    n = await _db.cheques.count_documents({"company_id": company_id, "number": {"$regex": f"^{prefix}-{year}"}}) + 1
    return f"{prefix}-{year}-{n:04d}"


async def _refresh_contact_cheque(contact_id: str):
    if not contact_id:
        return
    rows = await _db.cheques.find({"contact_id": contact_id, "status": "open"}).to_list(5000)
    received = round(sum(float(r.get("amount") or 0) for r in rows if r.get("direction") == "received"), 2)
    issued = round(sum(float(r.get("amount") or 0) for r in rows if r.get("direction") == "issued"), 2)
    await _db.contacts.update_one({"_id": contact_id}, {"$set": {"cheque_bond_balance": round(received - issued, 2)}})


def _contact_delta_on_create(direction: str, amount: float) -> float:
    # received: customer paid us with cheque → receivable down
    # issued: we paid supplier with cheque → payable down (balance up if negative)
    return -amount if direction == "received" else amount


async def _apply_contact(contact_id: str, delta: float):
    if contact_id and delta:
        await _db.contacts.update_one({"_id": contact_id}, {"$inc": {"balance": delta}})


def _account_id(req: Dict[str, Any]) -> Optional[str]:
    return req.get("account_id") or req.get("bank_account_id")


def _instrument(req: Dict[str, Any]) -> str:
    raw = (req.get("instrument") or req.get("kind") or "cheque").strip().lower()
    if raw in ("promissory", "bond", "senet", "snt"):
        return "promissory"
    if raw in ("cheque", "cek", "çek", "check"):
        return "cheque"
    return raw


async def _bank_move(company_id: str, account_id: str, *, inflow: bool, amount: float, category: str, description: str, date: str, cheque_id: str, contact_name=None):
    acc = await _db.bank_accounts.find_one({"_id": account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Kasa/Banka hesabı bulunamadı.")
    await assert_manual_allowed(_db, account_id)
    change = amount if inflow else -amount
    await _db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": change}})
    await _db.bank_transactions.insert_one({
        "_id": str(uuid.uuid4()), "company_id": company_id, "account_id": account_id,
        "account_name": acc.get("account_name"), "type": "inflow" if inflow else "outflow",
        "category": category, "amount": amount, "currency": acc.get("currency", "TRY"),
        "description": description, "contact_name": contact_name,
        "source": "cheque", "cheque_id": cheque_id, "date": date, "created_at": _now(),
    })
    return acc.get("account_name")


async def _unwind_bank(cheque_id: str):
    """Tahsil/ödeme banka hareketini geri al; cari etkisi çek kaydında kalır."""
    txs = await _db.bank_transactions.find({"cheque_id": cheque_id}).to_list(50)
    for tx in txs:
        amt = float(tx.get("amount") or 0)
        change = -amt if tx.get("type") == "inflow" else amt
        if tx.get("account_id") and amt:
            await _db.bank_accounts.update_one({"_id": tx["account_id"]}, {"$inc": {"current_balance": change}})
        await _db.bank_transactions.delete_one({"_id": tx["_id"]})


def _open_only(doc: dict):
    if not doc:
        raise HTTPException(status_code=404, detail="Çek/senet bulunamadı.")
    if doc.get("status") != "open":
        raise HTTPException(status_code=400, detail=f"Bu kayıt {STATUS_TR.get(doc.get('status'), doc.get('status'))} durumunda; işlem yapılamaz.")


@router.get("/cheques/summary")
async def cheques_summary(company_id: str = "comp_nexus_main_01"):
    from datetime import date, timedelta
    today = _today()
    rows = await _db.cheques.find({"company_id": company_id}).to_list(5000)
    def amt(pred):
        return round(sum(float(r.get("amount") or 0) for r in rows if pred(r)), 2)
    week_end = (date.fromisoformat(today) + timedelta(days=7)).isoformat()
    portfolio = amt(lambda r: r.get("direction") == "received" and r.get("status") == "open")
    issued_open = amt(lambda r: r.get("direction") == "issued" and r.get("status") == "open")
    overdue_r = amt(lambda r: r.get("direction") == "received" and r.get("status") == "open" and (r.get("due_date") or "") < today)
    overdue_i = amt(lambda r: r.get("direction") == "issued" and r.get("status") == "open" and (r.get("due_date") or "") < today)
    bounced = amt(lambda r: r.get("status") == "bounced")
    due_week = amt(lambda r: r.get("status") == "open" and today <= (r.get("due_date") or "") <= week_end)
    return {
        "count": len(rows),
        "open_count": sum(1 for r in rows if r.get("status") == "open"),
        "portfolio": portfolio,
        "issued_open": issued_open,
        "overdue_received": overdue_r,
        "overdue_issued": overdue_i,
        "due_this_week": due_week,
        "bounced": bounced,
        "received_count": sum(1 for r in rows if r.get("direction") == "received"),
        "issued_count": sum(1 for r in rows if r.get("direction") == "issued"),
    }


@router.get("/cheques")
async def list_cheques(
    company_id: str = "comp_nexus_main_01",
    direction: Optional[str] = None,
    instrument: Optional[str] = None,
    status: Optional[str] = None,
    contact_id: Optional[str] = None,
    q: Optional[str] = None,
):
    query: Dict[str, Any] = {"company_id": company_id}
    if direction in ("received", "issued"):
        query["direction"] = direction
    if instrument in ("cheque", "promissory"):
        query["instrument"] = instrument
    if status and status != "all":
        query["status"] = status
    if contact_id:
        query["contact_id"] = contact_id
    if q:
        query["$or"] = [
            {"number": {"$regex": q, "$options": "i"}},
            {"serial_no": {"$regex": q, "$options": "i"}},
            {"contact_name": {"$regex": q, "$options": "i"}},
            {"bank_name": {"$regex": q, "$options": "i"}},
            {"drawer_name": {"$regex": q, "$options": "i"}},
        ]
    today = _today()
    from datetime import date, timedelta
    week_end = (date.fromisoformat(today) + timedelta(days=7)).isoformat()
    rows = [_annotate(x, today) for x in await _db.cheques.find(query).sort("due_date", 1).to_list(3000)]
    for d in rows:
        due = d.get("due_date") or ""
        d["due_soon"] = d.get("status") == "open" and today <= due <= week_end
    summary = await cheques_summary(company_id)
    return {"cheques": rows, "summary": summary}


@router.post("/cheques")
async def create_cheque(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    direction = req.get("direction") or "received"
    instrument = _instrument(req)
    if direction not in ("received", "issued"):
        raise HTTPException(status_code=400, detail="Yön alınan veya verilen olmalı.")
    if instrument not in ("cheque", "promissory"):
        raise HTTPException(status_code=400, detail="Tür çek veya senet olmalı.")
    amount = round(float(req.get("amount") or 0), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalı.")
    contact = await _db.contacts.find_one({"_id": req["contact_id"]}) if req.get("contact_id") else None
    if not contact:
        raise HTTPException(status_code=400, detail="Cari seçin.")
    due = req.get("due_date") or _today()
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "number": await _next_number(company_id, instrument),
        "instrument": instrument,
        "direction": direction,
        "status": "open",
        "contact_id": contact["_id"],
        "contact_name": contact.get("name"),
        "amount": amount,
        "currency": "TRY",
        "issue_date": req.get("issue_date") or _today(),
        "due_date": due,
        "serial_no": (req.get("serial_no") or "").strip(),
        "bank_name": (req.get("bank_name") or "").strip(),
        "bank_branch": (req.get("bank_branch") or "").strip(),
        "account_no": (req.get("account_no") or "").strip(),
        "drawer_name": (req.get("drawer_name") or contact.get("name") or "").strip(),
        "notes": (req.get("notes") or "").strip(),
        "related_invoice_id": req.get("related_invoice_id"),
        "endorsed_to_contact_id": None,
        "endorsed_to_name": None,
        "account_id": None,
        "account_name": None,
        "settled_at": None,
        "events": [{"at": _now(), "action": "created", "note": "Giriş kaydı"}],
        "created_at": _now(),
    }
    await _db.cheques.insert_one(doc)
    await _apply_contact(contact["_id"], _contact_delta_on_create(direction, amount))
    await _refresh_contact_cheque(contact["_id"])
    return _annotate(await _db.cheques.find_one({"_id": doc["_id"]}), _today())


async def _append_event(cheque_id: str, action: str, note: str = ""):
    await _db.cheques.update_one({"_id": cheque_id}, {"$push": {"events": {"at": _now(), "action": action, "note": note}}})


@router.post("/cheques/{cheque_id}/collect")
async def collect_cheque(cheque_id: str, req: Dict[str, Any]):
    doc = await _db.cheques.find_one({"_id": cheque_id})
    _open_only(doc)
    if doc.get("direction") != "received":
        raise HTTPException(status_code=400, detail="Tahsil yalnızca alınan çek/senet için.")
    account_id = _account_id(req)
    if not account_id:
        raise HTTPException(status_code=400, detail="Tahsil hesabı seçin.")
    pay_date = req.get("date") or _today()
    name = await _bank_move(
        doc["company_id"], account_id, inflow=True, amount=float(doc["amount"]),
        category="Çek/Senet Tahsilatı", description=f"{doc['number']} {doc.get('contact_name') or ''} tahsil",
        date=pay_date, cheque_id=cheque_id, contact_name=doc.get("contact_name"),
    )
    await _db.cheques.update_one({"_id": cheque_id}, {"$set": {"status": "collected", "account_id": account_id, "account_name": name, "settled_at": pay_date, "updated_at": _now()}})
    await _append_event(cheque_id, "collected", f"{name} · {pay_date}")
    await _refresh_contact_cheque(doc.get("contact_id"))
    return _annotate(await _db.cheques.find_one({"_id": cheque_id}), _today())


@router.post("/cheques/{cheque_id}/pay")
async def pay_issued_cheque(cheque_id: str, req: Dict[str, Any]):
    doc = await _db.cheques.find_one({"_id": cheque_id})
    _open_only(doc)
    if doc.get("direction") != "issued":
        raise HTTPException(status_code=400, detail="Ödeme yalnızca verilen çek/senet için.")
    account_id = _account_id(req)
    if not account_id:
        raise HTTPException(status_code=400, detail="Ödeme hesabı seçin.")
    pay_date = req.get("date") or _today()
    name = await _bank_move(
        doc["company_id"], account_id, inflow=False, amount=float(doc["amount"]),
        category="Çek/Senet Ödemesi", description=f"{doc['number']} {doc.get('contact_name') or ''} ödeme",
        date=pay_date, cheque_id=cheque_id, contact_name=doc.get("contact_name"),
    )
    await _db.cheques.update_one({"_id": cheque_id}, {"$set": {"status": "paid", "account_id": account_id, "account_name": name, "settled_at": pay_date, "updated_at": _now()}})
    await _append_event(cheque_id, "paid", f"{name} · {pay_date}")
    await _refresh_contact_cheque(doc.get("contact_id"))
    return _annotate(await _db.cheques.find_one({"_id": cheque_id}), _today())


@router.post("/cheques/{cheque_id}/endorse")
async def endorse_cheque(cheque_id: str, req: Dict[str, Any]):
    doc = await _db.cheques.find_one({"_id": cheque_id})
    _open_only(doc)
    if doc.get("direction") != "received":
        raise HTTPException(status_code=400, detail="Ciro yalnızca alınan çek/senet için.")
    target = await _db.contacts.find_one({"_id": req.get("contact_id")}) if req.get("contact_id") else None
    if not target:
        raise HTTPException(status_code=400, detail="Ciro edilecek cariyi seçin.")
    if target["_id"] == doc.get("contact_id"):
        raise HTTPException(status_code=400, detail="Aynı cariye ciro edilemez.")
    amount = float(doc["amount"])
    await _apply_contact(target["_id"], amount)
    await _db.cheques.update_one({"_id": cheque_id}, {"$set": {
        "status": "endorsed", "endorsed_to_contact_id": target["_id"], "endorsed_to_name": target.get("name"),
        "settled_at": req.get("date") or _today(), "updated_at": _now(),
    }})
    await _append_event(cheque_id, "endorsed", f"Ciro → {target.get('name')}")
    await _refresh_contact_cheque(doc.get("contact_id"))
    await _refresh_contact_cheque(target["_id"])
    return _annotate(await _db.cheques.find_one({"_id": cheque_id}), _today())


@router.post("/cheques/{cheque_id}/bounce")
async def bounce_cheque(cheque_id: str, req: Dict[str, Any]):
    doc = await _db.cheques.find_one({"_id": cheque_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Çek/senet bulunamadı.")
    st = doc.get("status")
    if st not in ("open", "collected", "paid", "endorsed"):
        raise HTTPException(status_code=400, detail=f"Bu kayıt {STATUS_TR.get(st, st)} durumunda; karşılıksız işlenemez.")
    amount = float(doc["amount"])
    if st in ("collected", "paid"):
        await _unwind_bank(cheque_id)
    if st == "endorsed" and doc.get("endorsed_to_contact_id"):
        await _apply_contact(doc["endorsed_to_contact_id"], -amount)
        await _refresh_contact_cheque(doc["endorsed_to_contact_id"])
    await _apply_contact(doc.get("contact_id"), -_contact_delta_on_create(doc["direction"], amount))
    reason = (req.get("reason") or "Karşılıksız").strip()
    await _db.cheques.update_one({"_id": cheque_id}, {"$set": {"status": "bounced", "bounce_reason": reason, "settled_at": req.get("date") or _today(), "updated_at": _now()}})
    await _append_event(cheque_id, "bounced", reason)
    await _refresh_contact_cheque(doc.get("contact_id"))
    return _annotate(await _db.cheques.find_one({"_id": cheque_id}), _today())


@router.post("/cheques/{cheque_id}/cancel")
async def cancel_cheque(cheque_id: str, req: Optional[Dict[str, Any]] = None):
    doc = await _db.cheques.find_one({"_id": cheque_id})
    _open_only(doc)
    amount = float(doc["amount"])
    await _apply_contact(doc.get("contact_id"), -_contact_delta_on_create(doc["direction"], amount))
    await _db.cheques.update_one({"_id": cheque_id}, {"$set": {"status": "cancelled", "updated_at": _now()}})
    await _append_event(cheque_id, "cancelled", (req or {}).get("reason") or "İptal")
    await _refresh_contact_cheque(doc.get("contact_id"))
    return _annotate(await _db.cheques.find_one({"_id": cheque_id}), _today())


@router.delete("/cheques/{cheque_id}")
async def delete_cheque(cheque_id: str):
    doc = await _db.cheques.find_one({"_id": cheque_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Çek/senet bulunamadı.")
    if doc.get("status") not in ("open", "cancelled", "bounced"):
        raise HTTPException(status_code=400, detail="Tahsil/ödeme/ciro edilmiş kayıt silinemez. Banka hareketinden geri alın.")
    if doc.get("status") == "open":
        await _apply_contact(doc.get("contact_id"), -_contact_delta_on_create(doc["direction"], float(doc["amount"])))
    related = []
    txs = await _db.bank_transactions.find({"cheque_id": cheque_id}).to_list(20)
    if txs:
        related.append({"collection": "bank_transactions", "docs": txs})
    await trash.soft_delete("cheques", doc, "cheque", f"{doc.get('number')} · {doc.get('contact_name')} · {float(doc.get('amount') or 0):,.2f} ₺", related=related, note=doc.get("serial_no") or "")
    await _refresh_contact_cheque(doc.get("contact_id"))
    return {"status": "success", "message": "Çek/senet çöp kutusuna taşındı."}


async def restore_cheque(doc: dict, _related):
    if doc.get("status") == "open":
        await _apply_contact(doc.get("contact_id"), _contact_delta_on_create(doc.get("direction"), float(doc.get("amount") or 0)))
    await _refresh_contact_cheque(doc.get("contact_id"))
