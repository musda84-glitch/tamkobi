"""Çek / senet girişleri: alınan-verilen portföy, tahsil, ciro, karşılıksız."""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
import account_balance
from bank_guard import assert_manual_allowed, assert_collection_allowed
import partner_pay
import trash
import tenant_access

router = APIRouter(prefix="/api")
_db = None
_current_user = None

OPEN_STATUSES = {"open"}
STATUS_TR = {
    "open": "Portföy / Açık",
    "collected": "Tahsil edildi",
    "paid": "Ödendi",
    "endorsed": "Ciro edildi",
    "bounced": "Karşılıksız",
    "cancelled": "İptal",
}


def init(db, get_current_user=None):
    global _db, _current_user
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Cheques auth bağlanmadı.")
    return await _current_user(request)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


_ISTANBUL = ZoneInfo("Europe/Istanbul")


def _portfolio_entry_day() -> str:
    """Portföy hareketinin günü: giriş anının İstanbul takvim günü. Keşide tarihi değildir."""
    return datetime.now(_ISTANBUL).strftime("%Y-%m-%d")


def _istanbul_day(value) -> str:
    """ISO string veya datetime → Europe/Istanbul takvim günü. Okunamazsa boş."""
    if isinstance(value, datetime):
        dt = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    else:
        text = str(value or "").strip()
        if not text:
            return ""
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return ""
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_ISTANBUL).strftime("%Y-%m-%d")


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


def _portfolio_prefix(instrument: str) -> str:
    return "SNT" if instrument == "promissory" else "CEK"


def _portfolio_seq(number: Any, prefix: str, year: str) -> Optional[int]:
    """{prefix}-YYYY-NNNN sonekini sayıya çevirir. Sayısal olmayan sonek yok sayılır."""
    head = f"{prefix}-{year}-"
    text = str(number or "")
    if not text.startswith(head):
        return None
    suffix = text[len(head):]
    if not suffix.isdigit():
        return None
    return int(suffix)


async def _max_portfolio_seq(company_id: str, prefix: str, year: str) -> int:
    """O yılın ^{prefix}-{yıl}-\\d+$ numaralarının sayısal en büyüğü. Kayıt yoksa 0."""
    pattern = rf"^{prefix}-{year}-\d+$"
    cursor = _db.cheques.find(
        {"company_id": company_id, "number": {"$regex": pattern}},
        {"number": 1},
    )
    rows = await cursor.to_list(None) if hasattr(cursor, "to_list") else list(cursor)
    best = 0
    for row in rows or []:
        seq = _portfolio_seq((row or {}).get("number"), prefix, year)
        if seq is not None and seq > best:
            best = seq
    return best


async def _next_number(company_id: str, instrument: str) -> str:
    """Atomik portföy numarası. Silinen kayıt ve eşzamanlı giriş aynı numarayı vermez.

    Anahtar {CEK|SNT}-{yıl}-{company_id}. İlk çağrı o yılın sayısal en büyük
    numarasından $setOnInsert ile tohumlanır; sonraki çağrılar $inc ile ilerler.
    """
    year = datetime.now(timezone.utc).strftime("%Y")
    prefix = _portfolio_prefix(instrument)
    key = f"{prefix}-{year}-{company_id}"
    if not await _db.counters.find_one({"_id": key}):
        seed = await _max_portfolio_seq(company_id, prefix, year)
        await _db.counters.update_one({"_id": key}, {"$setOnInsert": {"seq": seed}}, upsert=True)
    doc = await _db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = int((doc or {}).get("seq") or 1)
    return f"{prefix}-{year}-{seq:04d}"


def _due_passed(row: dict, today: str) -> bool:
    due = str((row or {}).get("due_date") or "")
    return bool(due) and due < str(today or "")


def open_portfolio_balance(rows, today: Optional[str] = None) -> float:
    """Açık alınan − açık verilen + ciro ile gelen (vadesi gelmemiş).

    role=endorsee satırlar yalnız hedef (alan) cariye aittir ve pozitif eklenir.
    İlk carinin ciro edilmiş çeki açık alınandan çıkar; kartına ikinci kez yazılmaz.
    BizimHesap snapshot'ı yok sayılır.
    """
    day = today or _today()
    received = 0.0
    issued = 0.0
    endorsed_in = 0.0
    for r in rows or []:
        amt = float(r.get("amount") or 0)
        if r.get("role") == "endorsee":
            if (r.get("status") or "") == "endorsed" and not _due_passed(r, day):
                endorsed_in += amt
            continue
        if (r.get("status") or "open") != "open":
            continue
        if r.get("direction") == "received":
            received += amt
        elif r.get("direction") == "issued":
            issued += amt
    return round(received - issued + endorsed_in, 2)


def annotate_contact_cheques(rows, contact_id: str, today: Optional[str] = None) -> list:
    """Cariye ait çekler. Başkasına ait olup bu cariye ciro edilenler role=endorsee."""
    day = today or _today()
    cid = str(contact_id or "")
    out = []
    for raw in rows or []:
        row = dict(raw or {})
        if str(row.get("endorsed_to_contact_id") or "") == cid and str(row.get("contact_id") or "") != cid:
            row["role"] = "endorsee"
        out.append(_annotate(row, day))
    return out


async def fetch_contact_cheques(db, contact_id: str, company_id: str):
    """Kendi çekleri ve bu cariye ciro edilmiş (endorsed) çekler. Şirket filtresi zorunlu."""
    cid = str(company_id or "").strip()
    if not contact_id or not cid or db is None:
        return []
    rows = await db.cheques.find({
        "company_id": cid,
        "$or": [
            {"contact_id": contact_id},
            {"endorsed_to_contact_id": contact_id, "status": "endorsed"},
        ],
    }).sort("due_date", 1).to_list(2000)
    return annotate_contact_cheques(rows, contact_id, _today())


def _tr_date(value) -> str:
    text = str(value or "")[:10]
    parts = text.split("-")
    if len(parts) == 3 and len(parts[0]) == 4 and all(part.isdigit() for part in parts):
        return f"{parts[2]}.{parts[1]}.{parts[0]}"
    return text


def _pay_day(value, fallback: str = "") -> str:
    text = str(value or "").strip()
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    return fallback


def endorsement_description(doc: dict) -> str:
    """Ödemeler açıklaması: no · vade · banka seri · asıl cari."""
    number = str((doc or {}).get("number") or "").strip()
    due = _tr_date((doc or {}).get("due_date"))
    bank = " ".join(
        part for part in (
            str((doc or {}).get("bank_name") or "").strip(),
            str((doc or {}).get("serial_no") or "").strip(),
        ) if part
    )
    drawer = str((doc or {}).get("drawer_name") or (doc or {}).get("contact_name") or "").strip()
    parts = [number]
    if due:
        parts.append(f"vade {due}")
    if bank:
        parts.append(bank)
    if drawer:
        parts.append(f"asıl cari {drawer}")
    return " · ".join(part for part in parts if part)


def endorsement_category(doc: dict) -> str:
    return "Ciro edilen senet" if (doc or {}).get("instrument") == "promissory" else "Ciro edilen çek"


def is_noncash_cheque_movement(tx: Optional[dict]) -> bool:
    """Banka veya kasa hesabı olmayan portföy/ciro satırı nakit akışına girmez.

    Hesabı olan tahsil/ödeme (cheque_bank) nakit kalır. Hesapsız diğer
    hareketler (cari fişi vb.) bu elemenin dışındadır.
    """
    if not tx or str(tx.get("account_id") or "").strip():
        return False
    kind = str(tx.get("cheque_kind") or "")
    if kind in ("portfolio", "endorsement"):
        return True
    if str(tx.get("source") or "") == "cheque":
        return True
    if str(tx.get("account_name") or "") == "Çek Portföyü":
        return True
    if str(tx.get("category") or "").startswith("Ciro edilen") and (
        str(tx.get("source") or "") == "cheque" or str(tx.get("cheque_id") or "").strip()
    ):
        return True
    return False


def cheque_ledger_lock_detail(tx: Optional[dict]) -> Optional[str]:
    """Kasa ekranından değiştirilemeyen ciro ve Çek Portföyü satırı.

    cheque_id taşıyan ciro reddedilir. Çek Portföyü / portfolio satırları da
    reddedilir. Hesaba işlenmiş cheque_bank tahsil/ödeme bu kilitte değildir.
    """
    if not tx:
        return None
    cheque_id = str(tx.get("cheque_id") or "").strip()
    kind = str(tx.get("cheque_kind") or "")
    category = str(tx.get("category") or "")
    source = str(tx.get("source") or "")
    account_name = str(tx.get("account_name") or "")
    has_account = bool(str(tx.get("account_id") or "").strip())
    endorsement = bool(cheque_id) and (kind == "endorsement" or category.startswith("Ciro edilen"))
    portfolio = not has_account and (
        kind == "portfolio"
        or account_name == "Çek Portföyü"
        or (source == "cheque" and kind not in ("bank", "endorsement") and bool(cheque_id))
    )
    if endorsement:
        return f"Kaynak kayıttan geri alın (çek/senet ciro). Kaynak: /cheques · id={cheque_id}"
    if portfolio:
        ident = f" · id={cheque_id}" if cheque_id else ""
        return f"Kaynak kayıttan geri alın (çek portföyü). Kaynak: /cheques{ident}"
    return None


def endorsement_tx_body(doc: dict, target: dict, pay_date: str) -> dict:
    """Görünürlük satırı. account_id daima None; bakiyeye ayrıca $inc yapılmaz."""
    return {
        "_id": str(uuid.uuid4()),
        "company_id": doc.get("company_id"),
        "account_id": None,
        "account_name": "Çek Portföyü",
        "type": "outflow",
        "category": endorsement_category(doc),
        "amount": float(doc.get("amount") or 0),
        "currency": doc.get("currency") or "TRY",
        "description": endorsement_description(doc),
        "contact_id": (target or {}).get("_id") or doc.get("endorsed_to_contact_id"),
        "contact_name": (target or {}).get("name") or doc.get("endorsed_to_name"),
        "source": "cheque",
        "cheque_id": doc.get("_id") or doc.get("id"),
        "cheque_kind": "endorsement",
        "date": pay_date,
        "created_at": _now(),
    }


def _payment_has_endorsement(payments, cheque_id: str) -> bool:
    cid = str(cheque_id or "")
    if not cid:
        return False
    for pay in payments or []:
        if str((pay or {}).get("cheque_id") or "") != cid:
            continue
        if (pay or {}).get("cheque_kind") == "endorsement":
            return True
        if str((pay or {}).get("category") or "").startswith("Ciro edilen"):
            return True
    return False


def append_endorsement_virtuals(payments, cheques_rows, contact_id: str) -> list:
    """Endorsement satırı yoksa sanal satır. Bakiyeye yazılmaz."""
    out = list(payments or [])
    cid = str(contact_id or "")
    for ch in cheques_rows or []:
        if str(ch.get("endorsed_to_contact_id") or "") != cid:
            continue
        if ch.get("status") != "endorsed":
            continue
        cheque_id = ch.get("_id") or ch.get("id")
        if _payment_has_endorsement(out, cheque_id):
            continue
        pay_date = _pay_day(ch.get("settled_at")) or _pay_day(ch.get("updated_at")) or _today()
        row = endorsement_tx_body(
            ch,
            {"_id": cid, "name": ch.get("endorsed_to_name")},
            pay_date,
        )
        row["_id"] = f"cheque-endorse-virt-{cheque_id}"
        row["virtual"] = True
        row["contact_id"] = cid
        out.append(row)
    return out


async def payments_with_endorsement_virtuals(db, payments, *, contact_id: str, company_id: str):
    cid = str(company_id or "").strip()
    if not cid or not contact_id or db is None:
        return list(payments or [])
    rows = await db.cheques.find({
        "company_id": cid,
        "endorsed_to_contact_id": contact_id,
        "status": "endorsed",
    }).to_list(500)
    return append_endorsement_virtuals(payments, rows, contact_id)


async def missing_endorsement_movements(db, contact_id: str, company_id: str, bank_txs) -> list:
    """Satırı olmayan geçmiş ciro. Yalnız hesap; veritabanına yazılmaz."""
    cid = str(company_id or "").strip()
    if not cid or not contact_id or db is None:
        return []
    have = set()
    for tx in bank_txs or []:
        cheque_id = str((tx or {}).get("cheque_id") or "")
        if not cheque_id:
            continue
        if (tx or {}).get("cheque_kind") == "endorsement" or str((tx or {}).get("category") or "").startswith("Ciro edilen"):
            have.add(cheque_id)
    rows = await db.cheques.find({
        "company_id": cid,
        "endorsed_to_contact_id": contact_id,
        "status": "endorsed",
    }).to_list(5000)
    out = []
    for ch in rows or []:
        cheque_id = str(ch.get("_id") or "")
        if not cheque_id or cheque_id in have:
            continue
        out.append({
            "contact_id": contact_id,
            "type": "outflow",
            "amount": float(ch.get("amount") or 0),
            "source": "cheque",
            "cheque_kind": "endorsement",
        })
    return out


async def _refresh_contact_cheque(contact_id: str, *, company_id: str):
    cid = str(company_id or "").strip()
    if not contact_id or not cid:
        return
    rows = await fetch_contact_cheques(_db, contact_id, cid)
    await _db.contacts.update_one(
        {"_id": contact_id, "company_id": cid},
        {"$set": {"cheque_bond_balance": open_portfolio_balance(rows, _today())}},
    )


async def _insert_endorsement_tx(db, doc: dict, target: dict, pay_date: str):
    """Hedef cari görünürlük satırı. İkinci bakiye $inc yok."""
    body = endorsement_tx_body(doc, target, pay_date)
    body["company_id"] = doc.get("company_id")
    await db.bank_transactions.insert_one(body)
    return body


async def _post_endorsement_payment(doc: dict, target: dict, pay_date: str):
    return await _insert_endorsement_tx(_db, doc, target, pay_date)


async def backfill_endorsement_rows(db, *, company_id: str, apply: bool = False) -> dict:
    """Eksik ciro satırını ekler. Dry-run varsayılan. Bakiyeye $inc yapmaz. İkinci tur 0 yazar."""
    cid = str(company_id or "").strip()
    if not cid or db is None:
        return {"dry_run": not apply, "company_id": cid, "candidates": 0, "inserted": 0, "skipped": 0}
    rows = await db.cheques.find({
        "company_id": cid,
        "status": "endorsed",
    }).to_list(5000)
    inserted = 0
    skipped = 0
    candidates = 0
    for ch in rows or []:
        if not ch.get("endorsed_to_contact_id"):
            skipped += 1
            continue
        existing = await db.bank_transactions.find_one({
            "company_id": cid,
            "cheque_id": ch.get("_id"),
            "cheque_kind": "endorsement",
        })
        if existing:
            skipped += 1
            continue
        candidates += 1
        if not apply:
            continue
        target = await db.contacts.find_one({
            "_id": ch.get("endorsed_to_contact_id"),
            "company_id": cid,
        })
        pay_date = _pay_day(ch.get("settled_at")) or _today()
        await _insert_endorsement_tx(db, ch, target or {
            "_id": ch.get("endorsed_to_contact_id"),
            "name": ch.get("endorsed_to_name"),
        }, pay_date)
        inserted += 1
    return {
        "dry_run": not apply,
        "company_id": cid,
        "candidates": candidates,
        "inserted": inserted,
        "skipped": skipped,
    }


def _contact_delta_on_create(direction: str, amount: float) -> float:
    # received: customer paid us with cheque → receivable down
    # issued: we paid supplier with cheque → payable down (balance up if negative)
    return -amount if direction == "received" else amount


async def _apply_contact(contact_id: str, delta: float, *, company_id: str):
    cid = str(company_id or "").strip()
    if not cid:
        return
    if contact_id and delta:
        await _db.contacts.update_one({"_id": contact_id, "company_id": cid}, {"$inc": {"balance": delta}})


def _account_id(req: Dict[str, Any]) -> Optional[str]:
    return req.get("account_id") or req.get("bank_account_id")


def _instrument(req: Dict[str, Any]) -> str:
    raw = (req.get("instrument") or req.get("kind") or "cheque").strip().lower()
    if raw in ("promissory", "bond", "senet", "snt"):
        return "promissory"
    if raw in ("cheque", "cek", "çek", "check"):
        return "cheque"
    return raw


_GROUP_ID_MAX = 64


def _normalize_group_id(raw) -> str:
    """Boşsa yeni uuid. Metin, kırpılmış, en fazla 64 karakter."""
    if raw is None:
        return str(uuid.uuid4())
    if not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="receipt_group_id metin olmalı.")
    gid = raw.strip()
    if not gid:
        return str(uuid.uuid4())
    if len(gid) > _GROUP_ID_MAX:
        raise HTTPException(status_code=400, detail="receipt_group_id en fazla 64 karakter olabilir.")
    return gid


def _validate_cheque_req(req: Dict[str, Any]) -> Dict[str, Any]:
    """Tekli ve toplu çek/senet girişi aynı alan kurallarını kullanır."""
    direction = req.get("direction") or "received"
    instrument = _instrument(req)
    if direction not in ("received", "issued"):
        raise HTTPException(status_code=400, detail="Yön alınan veya verilen olmalı.")
    if instrument not in ("cheque", "promissory"):
        raise HTTPException(status_code=400, detail="Tür çek veya senet olmalı.")
    amount = round(float(req.get("amount") or 0), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalı.")
    return {
        "direction": direction,
        "instrument": instrument,
        "amount": amount,
        "issue_date": req.get("issue_date") or _today(),
        "due_date": req.get("due_date") or _today(),
        "serial_no": (req.get("serial_no") or "").strip(),
        "bank_name": (req.get("bank_name") or "").strip(),
        "bank_branch": (req.get("bank_branch") or "").strip(),
        "account_no": (req.get("account_no") or "").strip(),
        "drawer_name": (req.get("drawer_name") or "").strip(),
        "notes": (req.get("notes") or "").strip(),
        "related_invoice_id": req.get("related_invoice_id"),
        "installment_id": req.get("installment_id"),
        "skip_ledger": bool(req.get("skip_ledger") or req.get("from_installment")),
    }


async def _load_cheque_contact(company_id: str, contact_id, *, missing_status: int = 400) -> dict:
    if not contact_id:
        if missing_status == 404:
            raise HTTPException(status_code=404, detail="Cari bulunamadı.")
        raise HTTPException(status_code=400, detail="Cari seçin.")
    contact = await _db.contacts.find_one({"_id": contact_id, "company_id": company_id})
    if not contact:
        raise HTTPException(status_code=404, detail="Cari bulunamadı.")
    return contact


async def _build_cheque_doc(*, company_id: str, contact: dict, receipt_group_id: str, fields: Dict[str, Any]) -> dict:
    skip_ledger = fields["skip_ledger"]
    return {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "receipt_group_id": receipt_group_id,
        "number": await _next_number(company_id, fields["instrument"]),
        "instrument": fields["instrument"],
        "direction": fields["direction"],
        "status": "open",
        "contact_id": contact["_id"],
        "contact_name": contact.get("name"),
        "amount": fields["amount"],
        "currency": "TRY",
        "issue_date": fields["issue_date"],
        "due_date": fields["due_date"],
        "serial_no": fields["serial_no"],
        "bank_name": fields["bank_name"],
        "bank_branch": fields["bank_branch"],
        "account_no": fields["account_no"],
        "drawer_name": (fields["drawer_name"] or contact.get("name") or "").strip(),
        "notes": fields["notes"],
        "related_invoice_id": fields["related_invoice_id"],
        "installment_id": fields["installment_id"],
        "skip_ledger": skip_ledger,
        "endorsed_to_contact_id": None,
        "endorsed_to_name": None,
        "account_id": None,
        "account_name": None,
        "settled_at": None,
        "events": [{"at": _now(), "action": "created", "note": "Taksitten senet" if skip_ledger else "Giriş kaydı"}],
        "created_at": _now(),
    }


def _batch_item_error(index: int, exc: HTTPException) -> HTTPException:
    detail = exc.detail if isinstance(exc.detail, str) else "Kalem geçersiz."
    if not detail.startswith("Kalem "):
        detail = f"Kalem {index}: {detail}"
    return HTTPException(status_code=400, detail=detail)


async def _rollback_cheque_group(company_id: str, receipt_group_id: str, contact_id: str, delta: float):
    """Yarım kalan toplu girişi company_id + receipt_group_id ile geri al."""
    try:
        await _db.cheques.delete_many({"company_id": company_id, "receipt_group_id": receipt_group_id})
        await _db.bank_transactions.delete_many({"company_id": company_id, "receipt_group_id": receipt_group_id})
        if delta:
            await _apply_contact(contact_id, -delta, company_id=company_id)
    except Exception:
        return


async def _post_cari_payment(doc: dict):
    """Alınan/verilen çeki cari Ödemeler sekmesine düşür (kasa bakiyesine dokunmaz)."""
    direction = doc.get("direction") or "received"
    instrument = "Senet" if doc.get("instrument") == "promissory" else "Çek"
    kind = "Alınan" if direction == "received" else "Verilen"
    due = doc.get("due_date") or ""
    await _db.bank_transactions.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": doc["company_id"],
        "account_id": None,
        "account_name": "Çek Portföyü",
        "type": "inflow" if direction == "received" else "outflow",
        "category": f"{kind} {instrument}",
        "amount": float(doc.get("amount") or 0),
        "currency": doc.get("currency") or "TRY",
        "description": f"{doc.get('number')} · vade {due}".strip(" ·"),
        "contact_id": doc.get("contact_id"),
        "contact_name": doc.get("contact_name"),
        "source": "cheque",
        "cheque_id": doc["_id"],
        "cheque_kind": "portfolio",
        "receipt_group_id": doc.get("receipt_group_id"),
        "date": _portfolio_entry_day(),
        "created_at": _now(),
    })


async def _bank_move(company_id: str, account_id: str, *, inflow: bool, amount: float, category: str, description: str, date: str, cheque_id: str, contact_name=None):
    acc = await _db.bank_accounts.find_one({"_id": account_id, "company_id": company_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Kasa/Banka hesabı bulunamadı.")
    await assert_manual_allowed(_db, account_id)
    change = amount if inflow else -amount
    await account_balance.apply_balance_delta(_db, account_id, change, company_id=company_id)
    # contact_id yok: tahsil/ödeme kasa hareketidir; cari zaten çek girişinde işlendi.
    await _db.bank_transactions.insert_one({
        "_id": str(uuid.uuid4()), "company_id": company_id, "account_id": account_id,
        "account_name": acc.get("account_name"), "type": "inflow" if inflow else "outflow",
        "category": category, "amount": amount, "currency": acc.get("currency", "TRY"),
        "description": description, "contact_name": contact_name,
        "source": "cheque_bank", "cheque_id": cheque_id, "cheque_kind": "bank",
        "date": date, "created_at": _now(),
    })
    return acc.get("account_name")


async def _unwind_bank(cheque_id: str, *, company_id: str):
    """Çeke bağlı portföy (cari) ve tahsil/ödeme (kasa) hareketlerini geri al."""
    cid = str(company_id or "").strip()
    if not cid:
        return
    txs = await _db.bank_transactions.find({"cheque_id": cheque_id, "company_id": cid}).to_list(50)
    for tx in txs:
        amt = float(tx.get("amount") or 0)
        kind = tx.get("cheque_kind")
        if tx.get("account_id") and amt and kind not in ("portfolio", "endorsement"):
            change = -amt if tx.get("type") == "inflow" else amt
            await account_balance.apply_balance_delta(
                _db, tx["account_id"], change, company_id=cid,
            )
        await _db.bank_transactions.delete_one({"_id": tx["_id"], "company_id": cid})


def _open_only(doc: dict):
    if not doc:
        raise HTTPException(status_code=404, detail="Çek/senet bulunamadı.")
    if doc.get("status") != "open":
        raise HTTPException(status_code=400, detail=f"Bu kayıt {STATUS_TR.get(doc.get('status'), doc.get('status'))} durumunda; işlem yapılamaz.")


def _doc_cid(doc: Optional[dict], detail: str = "Çek/senet bulunamadı.") -> str:
    cid = str((doc or {}).get("company_id") or "").strip()
    if not cid:
        raise HTTPException(status_code=404, detail=detail)
    return cid


async def _cheques_summary(company_id: str):
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


@router.get("/cheques/summary")
async def cheques_summary(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    return await _cheques_summary(cid)


@router.get("/cheques")
async def list_cheques(
    company_id: Optional[str] = None,
    direction: Optional[str] = None,
    instrument: Optional[str] = None,
    status: Optional[str] = None,
    contact_id: Optional[str] = None,
    q: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    cid = tenant_access.resolve_company_id(user, company_id)
    query: Dict[str, Any] = {"company_id": cid}
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
    summary = await _cheques_summary(cid)
    return {"cheques": rows, "summary": summary}


@router.get("/cheques/receipt")
async def cheque_receipt_group(group_id: str = "", company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    """Aynı tahsilat grubundaki çek/senetler. Başka şirketin kaydı dönmez."""
    cid = tenant_access.resolve_caller_company(user, company_id)
    gid = str(group_id or "").strip()
    if not gid or len(gid) > _GROUP_ID_MAX:
        raise HTTPException(status_code=404, detail="Bu gruba ait çek/senet bulunamadı.")
    rows = await _db.cheques.find(
        {"company_id": cid, "receipt_group_id": gid},
    ).sort([("issue_date", 1), ("number", 1)]).to_list(200)
    if not rows:
        raise HTTPException(status_code=404, detail="Bu gruba ait çek/senet bulunamadı.")
    today = _today()
    annotated = [_annotate(row, today) for row in rows]
    total = round(sum(float(row.get("amount") or 0) for row in annotated), 2)
    return {"receipt_group_id": gid, "cheques": annotated, "total": total}


@router.post("/cheques/batch")
async def create_cheques_batch(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    """Aynı cariye N çek/senet, tek receipt_group_id. Kalem hatasında hiçbir şey yazılmaz."""
    company_id = tenant_access.resolve_caller_company(user, req.get("company_id"))
    items = req.get("items")
    if not isinstance(items, list) or not (1 <= len(items) <= 50):
        raise HTTPException(status_code=400, detail="Kalem sayısı 1 ile 50 arasında olmalı.")
    direction = req.get("direction") or "received"
    if direction not in ("received", "issued"):
        raise HTTPException(status_code=400, detail="Yön alınan veya verilen olmalı.")
    contact = await _load_cheque_contact(company_id, req.get("contact_id"), missing_status=404)
    prepared = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail=f"Kalem {index}: geçersiz.")
        notes = item.get("notes")
        if notes is None or not str(notes).strip():
            notes = req.get("notes") or ""
        merged = {
            "instrument": item.get("instrument"),
            "amount": item.get("amount"),
            "due_date": item.get("due_date"),
            "issue_date": item.get("issue_date"),
            "serial_no": item.get("serial_no"),
            "bank_name": item.get("bank_name"),
            "bank_branch": item.get("bank_branch"),
            "account_no": item.get("account_no"),
            "drawer_name": item.get("drawer_name"),
            "notes": notes,
            "direction": direction,
            "contact_id": contact["_id"],
        }
        try:
            prepared.append(_validate_cheque_req(merged))
        except HTTPException as exc:
            raise _batch_item_error(index, exc) from exc
    gid = str(uuid.uuid4())
    created = []
    applied_delta = 0.0
    try:
        for fields in prepared:
            doc = await _build_cheque_doc(
                company_id=company_id, contact=contact, receipt_group_id=gid, fields=fields,
            )
            doc["company_id"] = company_id
            await _db.cheques.insert_one(doc)
            created.append(doc)
            delta = _contact_delta_on_create(fields["direction"], fields["amount"])
            await _apply_contact(contact["_id"], delta, company_id=doc["company_id"])
            applied_delta = round(applied_delta + delta, 2)
            await _post_cari_payment(doc)
    except Exception:
        await _rollback_cheque_group(company_id, gid, contact["_id"], applied_delta)
        raise
    await _refresh_contact_cheque(contact["_id"], company_id=company_id)
    today = _today()
    annotated = [_annotate(dict(doc), today) for doc in created]
    total = round(sum(float(doc.get("amount") or 0) for doc in created), 2)
    return {"receipt_group_id": gid, "items": annotated, "total": total}


@router.get("/cheques/{cheque_id}")
async def get_cheque(cheque_id: str, user: dict = Depends(_user_dep)):
    doc = await tenant_access.get_tenant_doc(_db, "cheques", cheque_id, user, not_found="Çek/senet bulunamadı.")
    return _annotate(doc, _today())


def _sync_portfolio_tx(doc: dict):
    instrument = "Senet" if doc.get("instrument") == "promissory" else "Çek"
    kind = "Alınan" if doc.get("direction") == "received" else "Verilen"
    due = doc.get("due_date") or ""
    return {
        "amount": float(doc.get("amount") or 0),
        "contact_id": doc.get("contact_id"),
        "contact_name": doc.get("contact_name"),
        "type": "inflow" if doc.get("direction") == "received" else "outflow",
        "category": f"{kind} {instrument}",
        "description": f"{doc.get('number')} · vade {due}".strip(" ·"),
    }


@router.put("/cheques/{cheque_id}")
async def update_cheque(cheque_id: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    doc = await tenant_access.get_tenant_doc(_db, "cheques", cheque_id, user, not_found="Çek/senet bulunamadı.")
    cid = _doc_cid(doc)
    notes = (req.get("notes") if "notes" in req else doc.get("notes") or "") or ""
    serial = (req.get("serial_no") if "serial_no" in req else doc.get("serial_no") or "") or ""
    patch = {
        "serial_no": str(serial).strip(),
        "bank_name": str(req.get("bank_name") if "bank_name" in req else doc.get("bank_name") or "").strip(),
        "bank_branch": str(req.get("bank_branch") if "bank_branch" in req else doc.get("bank_branch") or "").strip(),
        "account_no": str(req.get("account_no") if "account_no" in req else doc.get("account_no") or "").strip(),
        "drawer_name": str(req.get("drawer_name") if "drawer_name" in req else doc.get("drawer_name") or "").strip(),
        "notes": str(notes).strip(),
        "updated_at": _now(),
    }
    if req.get("issue_date"):
        patch["issue_date"] = req.get("issue_date")
    if req.get("due_date"):
        patch["due_date"] = req.get("due_date")
        if patch["due_date"] < (patch.get("issue_date") or doc.get("issue_date") or ""):
            raise HTTPException(status_code=400, detail="Vade, keşide tarihinden önce olamaz.")

    if doc.get("status") == "open":
        old_amount = float(doc.get("amount") or 0)
        old_direction = doc.get("direction") or "received"
        old_contact = doc.get("contact_id")
        amount = round(float(req.get("amount") if req.get("amount") is not None else old_amount), 2)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalı.")
        direction = req.get("direction") or old_direction
        if direction not in ("received", "issued"):
            raise HTTPException(status_code=400, detail="Yön alınan veya verilen olmalı.")
        instrument = _instrument({**doc, **req}) if ("instrument" in req or "kind" in req) else (doc.get("instrument") or "cheque")
        if instrument not in ("cheque", "promissory"):
            raise HTTPException(status_code=400, detail="Tür çek veya senet olmalı.")
        contact_id = req.get("contact_id") or old_contact
        if not contact_id:
            raise HTTPException(status_code=400, detail="Cari seçin.")
        contact = await _db.contacts.find_one({"_id": contact_id, "company_id": cid})
        if not contact:
            raise HTTPException(status_code=404, detail="Cari bulunamadı.")
        patch.update({
            "amount": amount,
            "direction": direction,
            "instrument": instrument,
            "contact_id": contact["_id"],
            "contact_name": contact.get("name"),
        })
        if not patch.get("drawer_name"):
            patch["drawer_name"] = (contact.get("name") or "").strip()
        ledger_changed = (
            amount != old_amount
            or direction != old_direction
            or contact["_id"] != old_contact
        )
        if ledger_changed and not doc.get("skip_ledger"):
            await _apply_contact(old_contact, -_contact_delta_on_create(old_direction, old_amount), company_id=cid)
            await _apply_contact(contact["_id"], _contact_delta_on_create(direction, amount), company_id=cid)
        merged = {**doc, **patch}
        if not doc.get("skip_ledger"):
            await _db.bank_transactions.update_one(
                {"company_id": cid, "cheque_id": cheque_id, "cheque_kind": "portfolio"},
                {"$set": _sync_portfolio_tx(merged)},
            )
        if old_contact != contact["_id"]:
            await _refresh_contact_cheque(old_contact, company_id=cid)
        await _refresh_contact_cheque(contact["_id"], company_id=cid)

    await _db.cheques.update_one({"_id": cheque_id, "company_id": cid}, {"$set": patch})
    await _append_event(cheque_id, "updated", "Düzenleme", company_id=cid)
    return _annotate(await _db.cheques.find_one({"_id": cheque_id, "company_id": cid}), _today())


@router.post("/cheques")
async def create_cheque(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    company_id = tenant_access.resolve_caller_company(user, req.get("company_id"))
    fields = _validate_cheque_req(req)
    contact = await _load_cheque_contact(company_id, req.get("contact_id"))
    gid = _normalize_group_id(req.get("receipt_group_id"))
    doc = await _build_cheque_doc(company_id=company_id, contact=contact, receipt_group_id=gid, fields=fields)
    doc["company_id"] = company_id
    await _db.cheques.insert_one(doc)
    cid = doc["company_id"]
    if not fields["skip_ledger"]:
        await _apply_contact(contact["_id"], _contact_delta_on_create(fields["direction"], fields["amount"]), company_id=cid)
        await _post_cari_payment(doc)
    await _refresh_contact_cheque(contact["_id"], company_id=cid)
    return _annotate(await _db.cheques.find_one({"_id": doc["_id"], "company_id": cid}), _today())


async def _append_event(cheque_id: str, action: str, note: str = "", *, company_id: str):
    cid = str(company_id or "").strip()
    if not cid:
        return
    await _db.cheques.update_one(
        {"_id": cheque_id, "company_id": cid},
        {"$push": {"events": {"at": _now(), "action": action, "note": note}}},
    )


@router.post("/cheques/{cheque_id}/collect")
async def collect_cheque(cheque_id: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    doc = await tenant_access.get_tenant_doc(_db, "cheques", cheque_id, user, not_found="Çek/senet bulunamadı.")
    cid = _doc_cid(doc)
    _open_only(doc)
    if doc.get("direction") != "received":
        raise HTTPException(status_code=400, detail="Tahsil yalnızca alınan çek/senet için.")
    partner_id = req.get("partner_id")
    account_id = _account_id(req)
    if partner_id and account_id:
        raise HTTPException(status_code=400, detail="Hesap veya ortak seçin, ikisi birden değil.")
    if not partner_id and not account_id:
        raise HTTPException(status_code=400, detail="Tahsil hesabı veya ortak seçin.")
    pay_date = req.get("date") or _today()
    amount = float(doc["amount"])
    if partner_id:
        name = await partner_pay.move(_db, cid, partner_id, amount, "withdrawal", f"{doc['number']} {doc.get('contact_name') or ''} tahsil", pay_date, extra={"cheque_id": cheque_id})
        name = f"{name} (Ortak)"
        account_id = None
    else:
        await assert_collection_allowed(_db, account_id)
        name = await _bank_move(
            cid, account_id, inflow=True, amount=amount,
            category="Çek/Senet Tahsilatı", description=f"{doc['number']} {doc.get('contact_name') or ''} tahsil",
            date=pay_date, cheque_id=cheque_id, contact_name=doc.get("contact_name"),
        )
    await _db.cheques.update_one({"_id": cheque_id, "company_id": cid}, {"$set": {"status": "collected", "account_id": account_id, "partner_id": partner_id, "account_name": name, "settled_at": pay_date, "updated_at": _now()}})
    await _append_event(cheque_id, "collected", f"{name} · {pay_date}", company_id=cid)
    await _refresh_contact_cheque(doc.get("contact_id"), company_id=cid)
    return _annotate(await _db.cheques.find_one({"_id": cheque_id, "company_id": cid}), _today())



@router.post("/cheques/{cheque_id}/pay")
async def pay_issued_cheque(cheque_id: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    doc = await tenant_access.get_tenant_doc(_db, "cheques", cheque_id, user, not_found="Çek/senet bulunamadı.")
    cid = _doc_cid(doc)
    _open_only(doc)
    if doc.get("direction") != "issued":
        raise HTTPException(status_code=400, detail="Ödeme yalnızca verilen çek/senet için.")
    partner_id = req.get("partner_id")
    account_id = _account_id(req)
    if partner_id and account_id:
        raise HTTPException(status_code=400, detail="Hesap veya ortak seçin, ikisi birden değil.")
    if not partner_id and not account_id:
        raise HTTPException(status_code=400, detail="Ödeme hesabı veya ortak seçin.")
    pay_date = req.get("date") or _today()
    amount = float(doc["amount"])
    if partner_id:
        name = await partner_pay.withdraw(_db, cid, partner_id, amount, f"{doc['number']} {doc.get('contact_name') or ''} ödeme", pay_date, extra={"cheque_id": cheque_id})
        name = f"{name} (Ortak)"
        account_id = None
    else:
        name = await _bank_move(
            cid, account_id, inflow=False, amount=amount,
            category="Çek/Senet Ödemesi", description=f"{doc['number']} {doc.get('contact_name') or ''} ödeme",
            date=pay_date, cheque_id=cheque_id, contact_name=doc.get("contact_name"),
        )
    await _db.cheques.update_one({"_id": cheque_id, "company_id": cid}, {"$set": {"status": "paid", "account_id": account_id, "partner_id": partner_id, "account_name": name, "settled_at": pay_date, "updated_at": _now()}})
    await _append_event(cheque_id, "paid", f"{name} · {pay_date}", company_id=cid)
    await _refresh_contact_cheque(doc.get("contact_id"), company_id=cid)
    return _annotate(await _db.cheques.find_one({"_id": cheque_id, "company_id": cid}), _today())



@router.post("/cheques/{cheque_id}/endorse")
async def endorse_cheque(cheque_id: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    doc = await tenant_access.get_tenant_doc(_db, "cheques", cheque_id, user, not_found="Çek/senet bulunamadı.")
    cid = _doc_cid(doc)
    if doc.get("direction") != "received":
        raise HTTPException(status_code=400, detail="Ciro yalnızca alınan çek/senet için.")
    contact_id = req.get("contact_id")
    if not contact_id:
        raise HTTPException(status_code=400, detail="Ciro edilecek cariyi seçin.")
    target = await _db.contacts.find_one({"_id": contact_id, "company_id": cid})
    if not target:
        raise HTTPException(status_code=404, detail="Cari bulunamadı.")
    if target["_id"] == doc.get("contact_id"):
        raise HTTPException(status_code=400, detail="Aynı cariye ciro edilemez.")
    pay_date = _pay_day(req.get("date")) or _today()
    note = str(req.get("description") or req.get("note") or "").strip() or f"Ciro → {target.get('name')}"
    # SELECT … FOR UPDATE. Yalnızca open→endorsed geçişini kazanan istek bakiye ve satır yazar.
    claim = await _db.cheques.update_one_atomic(
        {"_id": cheque_id, "company_id": cid, "status": "open", "direction": "received"},
        {"$set": {
            "status": "endorsed",
            "endorsed_to_contact_id": target["_id"],
            "endorsed_to_name": target.get("name"),
            "settled_at": pay_date,
            "updated_at": _now(),
        }, "$push": {"events": {"at": _now(), "action": "endorsed", "note": note}}},
    )
    if not getattr(claim, "matched_count", 0):
        raise HTTPException(status_code=409, detail="Bu çek/senet artık açık değil; ciro edilemedi.")
    fresh = await _db.cheques.find_one({"_id": cheque_id, "company_id": cid})
    if not fresh or fresh.get("status") != "endorsed":
        raise HTTPException(status_code=409, detail="Bu çek/senet artık açık değil; ciro edilemedi.")
    amount = float(fresh.get("amount") or 0)
    await _apply_contact(target["_id"], amount, company_id=cid)
    await _post_endorsement_payment(fresh, target, pay_date)
    await _refresh_contact_cheque(doc.get("contact_id"), company_id=cid)
    await _refresh_contact_cheque(target["_id"], company_id=cid)
    return _annotate(fresh, _today())


@router.post("/cheques/{cheque_id}/bounce")
async def bounce_cheque(cheque_id: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    doc = await tenant_access.get_tenant_doc(_db, "cheques", cheque_id, user, not_found="Çek/senet bulunamadı.")
    cid = _doc_cid(doc)
    st = doc.get("status")
    if st not in ("open", "collected", "paid", "endorsed"):
        raise HTTPException(status_code=400, detail=f"Bu kayıt {STATUS_TR.get(st, st)} durumunda; karşılıksız işlenemez.")
    amount = float(doc["amount"])
    # Portföy (cari Ödemeler) + varsa tahsil/ödeme kasa hareketlerini geri al.
    await _unwind_bank(cheque_id, company_id=cid)
    endorsed_to = doc.get("endorsed_to_contact_id") if st == "endorsed" else None
    if endorsed_to:
        await _apply_contact(endorsed_to, -amount, company_id=cid)
    await _apply_contact(doc.get("contact_id"), -_contact_delta_on_create(doc["direction"], amount), company_id=cid)
    reason = (req.get("reason") or "Karşılıksız").strip()
    await _db.cheques.update_one({"_id": cheque_id, "company_id": cid}, {"$set": {"status": "bounced", "bounce_reason": reason, "settled_at": req.get("date") or _today(), "updated_at": _now()}})
    await _append_event(cheque_id, "bounced", reason, company_id=cid)
    if endorsed_to:
        await _refresh_contact_cheque(endorsed_to, company_id=cid)
    await _refresh_contact_cheque(doc.get("contact_id"), company_id=cid)
    return _annotate(await _db.cheques.find_one({"_id": cheque_id, "company_id": cid}), _today())


async def _cancel_cheque_core(cheque_id: str, req: Optional[Dict[str, Any]] = None, *, doc: Optional[dict] = None):
    """Senet/çek iptali. Sistem çağrıları (taksit planı silme) doc ile kullanıcı gerektirmeden kullanır."""
    cid = str((doc or {}).get("company_id") or "").strip()
    if not doc or not cid:
        raise HTTPException(status_code=404, detail="Çek/senet bulunamadı.")
    loaded = await _db.cheques.find_one({"_id": cheque_id, "company_id": cid})
    if not loaded:
        raise HTTPException(status_code=404, detail="Çek/senet bulunamadı.")
    doc = loaded
    _open_only(doc)
    amount = float(doc["amount"])
    await _unwind_bank(cheque_id, company_id=cid)
    if not doc.get("skip_ledger"):
        await _apply_contact(doc.get("contact_id"), -_contact_delta_on_create(doc["direction"], amount), company_id=cid)
    await _db.cheques.update_one({"_id": cheque_id, "company_id": cid}, {"$set": {"status": "cancelled", "updated_at": _now()}})
    await _append_event(cheque_id, "cancelled", (req or {}).get("reason") or "İptal", company_id=cid)
    await _refresh_contact_cheque(doc.get("contact_id"), company_id=cid)
    return _annotate(await _db.cheques.find_one({"_id": cheque_id, "company_id": cid}), _today())


@router.post("/cheques/{cheque_id}/cancel")
async def cancel_cheque(cheque_id: str, req: Optional[Dict[str, Any]] = None, user: dict = Depends(_user_dep)):
    doc = await tenant_access.get_tenant_doc(_db, "cheques", cheque_id, user, not_found="Çek/senet bulunamadı.")
    return await _cancel_cheque_core(cheque_id, req, doc=doc)


@router.delete("/cheques/{cheque_id}")
async def delete_cheque(cheque_id: str, user: dict = Depends(_user_dep)):
    doc = await tenant_access.get_tenant_doc(_db, "cheques", cheque_id, user, not_found="Çek/senet bulunamadı.")
    cid = _doc_cid(doc)
    if doc.get("status") not in ("open", "cancelled", "bounced"):
        raise HTTPException(status_code=400, detail="Tahsil/ödeme/ciro edilmiş kayıt silinemez. Banka hareketinden geri alın.")
    if doc.get("status") == "open" and not doc.get("skip_ledger"):
        await _apply_contact(doc.get("contact_id"), -_contact_delta_on_create(doc["direction"], float(doc["amount"])), company_id=cid)
    related = []
    txs = await _db.bank_transactions.find({"cheque_id": cheque_id, "company_id": cid}).to_list(20)
    if txs:
        related.append({"collection": "bank_transactions", "docs": txs})
    await trash.soft_delete("cheques", doc, "cheque", f"{doc.get('number')} · {doc.get('contact_name')} · {float(doc.get('amount') or 0):,.2f} ₺", related=related, note=doc.get("serial_no") or "")
    await _refresh_contact_cheque(doc.get("contact_id"), company_id=cid)
    return {"status": "success", "message": "Çek/senet çöp kutusuna taşındı."}


async def restore_cheque(doc: dict, _related):
    cid = str((doc or {}).get("company_id") or "").strip()
    if not cid:
        return
    if doc.get("status") == "open" and not doc.get("skip_ledger"):
        await _apply_contact(doc.get("contact_id"), _contact_delta_on_create(doc.get("direction"), float(doc.get("amount") or 0)), company_id=cid)
        # Eski silmelerde portföy satırı yoksa cari Ödemeler'e yeniden yaz.
        if not await _db.bank_transactions.find_one({"cheque_id": doc["_id"], "cheque_kind": "portfolio", "company_id": cid}):
            await _post_cari_payment(doc)
    await _refresh_contact_cheque(doc.get("contact_id"), company_id=cid)


async def create_promissory_for_installments(installments: list, *, include_down_payment: bool = False) -> list:
    """Taksit satırlarından senet portföy kaydı üretir; cari bakiyeye dokunmaz (skip_ledger)."""
    notes = []
    for inst in installments:
        no = int(inst.get("no") or 0)
        if no == 0 and not include_down_payment:
            continue
        amount = round(float(inst.get("amount") or 0), 2)
        if amount <= 0:
            continue
        if not str(inst.get("company_id") or "").strip():
            continue
        direction = "received" if inst.get("direction") == "receivable" else "issued"
        inv_no = inst.get("invoice_number") or "Taksit"
        label = inst.get("label") or f"{no}. Taksit"
        note = await create_cheque({
            "company_id": inst.get("company_id"),
            "direction": direction,
            "instrument": "promissory",
            "contact_id": inst.get("contact_id"),
            "amount": amount,
            "due_date": inst.get("due_date"),
            "issue_date": _today(),
            "related_invoice_id": inst.get("invoice_id"),
            "installment_id": inst.get("_id") or inst.get("id"),
            "skip_ledger": True,
            "notes": f"{inv_no} · {label}",
            "drawer_name": inst.get("contact_name") or "",
        })
        iid = inst.get("_id") or inst.get("id")
        if iid:
            await _db.installments.update_one(
                {"_id": iid, "company_id": inst["company_id"]},
                {"$set": {"cheque_id": note.get("id"), "cheque_number": note.get("number")}},
            )
        notes.append(note)
    return notes


# tenant-ok değil: id listesi server.py _cancel_promissory_for_query (company_id'li sorgu) sonucundan gelir; server.py taksit PR'ında company_id kwarg ile kapanacak.
async def cancel_promissory_for_installments(installment_ids: list) -> int:
    """Plan silinince bağlı açık senetleri iptal eder."""
    if not installment_ids:
        return 0
    n = 0
    async for ch in _db.cheques.find({"installment_id": {"$in": list(installment_ids)}, "status": "open", "instrument": "promissory"}):
        await _cancel_cheque_core(ch["_id"], {"reason": "Taksit planı kaldırıldı"}, doc=ch)
        n += 1
    return n
