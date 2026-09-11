"""Krediler (loans) + kredi kartı ekstresi: AI ile PDF'den ödeme planı / ekstre hareketi aktarımı."""
import io
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from bank_guard import assert_manual_allowed
from ai_service import make_chat
from emergentintegrations.llm.chat import UserMessage
from emergentintegrations.llm.chat import LlmChat, UserMessage
from card_match import match_statement_contact, sanitize_card_fields
import expenses as expenses_mod

router = APIRouter(prefix="/api")
_db = None


def init(db):
    global _db
    _db = db


def _now():
    return datetime.now(timezone.utc).isoformat()


def _clean(d):
    if d and "_id" in d:
        d["id"] = str(d.pop("_id"))
    return d


async def _pdf_text(file: UploadFile) -> str:
    if file.content_type not in ("application/pdf", "text/plain"):
        raise HTTPException(status_code=400, detail="Sadece PDF yükleyebilirsiniz.")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dosya en fazla 10 MB olabilir.")
    if file.content_type == "text/plain":
        return data.decode("utf-8", "ignore")
    from pypdf import PdfReader
    try:
        text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages[:15])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF okunamadı: {str(e)[:100]}")
    if len(text.strip()) < 30:
        raise HTTPException(status_code=400, detail="PDF'de okunabilir metin yok (taranmış görüntü). Bankanızın metin tabanlı PDF'ini yükleyin.")
    return text


async def _ask_json(system: str, text: str) -> dict:
    try:
        chat = await make_chat(f"fin-{uuid.uuid4().hex[:8]}", system, purpose="extract")
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    raw = str(await chat.send_message(UserMessage(text=f"METİN:\n\n{text[:25000]}"))).strip()
    a, b = raw.find("{"), raw.rfind("}")
    if a == -1:
        raise HTTPException(status_code=502, detail="AI yanıtı JSON içermiyor.")
    try:
        return json.loads(raw[a:b + 1])
    except ValueError:
        raise HTTPException(status_code=502, detail="AI yanıtı çözümlenemedi, tekrar deneyin.")


LOAN_SYSTEM = """Sen Türk bankacılık belgelerini okuyan bir finans asistanısın. Sana bir KREDİ SÖZLEŞMESİ / GERİ ÖDEME PLANI PDF metni verilecek.
Sadece şu JSON'u döndür (markdown yok): {"bank": str|null, "loan_type": "ticari"|"tasit"|"konut"|"ihtiyac"|"kmh"|"diger", "principal": number, "interest_rate": number|null (aylık %), "term_months": int, "start_date": "YYYY-MM-DD"|null, "monthly_payment": number|null, "total_payment": number|null,
"installments": [{"no": int, "due_date": "YYYY-MM-DD", "principal": number, "interest": number, "kkdf_bsmv": number, "amount": number, "remaining_principal": number|null}], "confidence": number}
Kurallar: Türkçe sayı formatını (1.234,56) number'a çevir. Tarihleri ISO yap. Taksit satırı yoksa term_months ve monthly_payment'tan eşit taksitli plan üret. Bulamadığın alan null."""

CARD_SYSTEM = """Sen Türk bankası KREDİ KARTI EKSTRESİ okuyan bir asistansın. Sadece şu JSON'u döndür (markdown yok):
{"bank": str|null, "card_last4": str|null, "statement_date": "YYYY-MM-DD"|null, "due_date": "YYYY-MM-DD"|null, "total_debt": number|null, "minimum_payment": number|null, "limit": number|null,
"transactions": [{"date": "YYYY-MM-DD", "description": str, "amount": number (harcama pozitif, ödeme/iade negatif), "installment": str|null, "category": "Yakıt"|"Yemek"|"Market"|"Ofis Malzemesi"|"Yol / Ulaşım"|"Yazılım / Abonelik"|"Pazarlama / Reklam"|"Kargo / Nakliye"|"Vergi / Harç / SGK"|"Diğer", "merchant": str|null}], "confidence": number}
Türkçe sayı formatını çevir, tarihleri ISO yap. Ödeme/iade satırlarını negatif tutar ile ver. merchant alanına üye işyeri / cari adayını yaz."""


def _kind_for_line(amount: float, contact: Optional[Dict[str, Any]]) -> str:
    if float(amount or 0) < 0:
        return "islem"
    if contact:
        return "cari_odeme"
    return "masraf"


def _tx_key(t: Dict[str, Any]):
    return (t.get("date"), (t.get("description") or "")[:200], round(abs(float(t.get("amount") or 0)), 2))


async def _existing_statement_keys(account_id: str):
    rows = await _db.bank_transactions.find(
        {"account_id": account_id, "source": "card_statement"},
        {"date": 1, "description": 1, "amount": 1},
    ).to_list(5000)
    return {_tx_key(b) for b in rows}


async def _enrich_statement_lines(company_id: str, txs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    contacts = await _db.contacts.find({"company_id": company_id}).to_list(10000)
    out = []
    for t in txs:
        blob = " ".join(filter(None, [t.get("description"), t.get("merchant")]))
        hit = match_statement_contact(blob, contacts)
        kind = _kind_for_line(t.get("amount") or 0, hit)
        out.append({
            **t,
            "kind": kind,
            "suggested_contact_id": hit.get("_id") if hit else None,
            "suggested_contact_name": hit.get("name") if hit else None,
            "contact_id": hit.get("_id") if hit else None,
            "contact_name": hit.get("name") if hit else None,
            "included": (not t.get("duplicate")) and float(t.get("amount") or 0) != 0,
        })
    return out


async def _apply_statement_account(account_id: str, statement: Dict[str, Any], acc: Dict[str, Any]):
    upd: Dict[str, Any] = {"last_statement": statement, "last_statement_at": _now()}
    if statement.get("total_debt") is not None:
        upd["current_balance"] = -abs(float(statement["total_debt"]))
    if statement.get("limit"):
        upd["card_limit"] = float(statement["limit"])
    last4 = sanitize_card_fields({"card_last4": statement.get("card_last4")}).get("card_last4")
    if last4 and not acc.get("card_last4"):
        upd["card_last4"] = last4
    await _db.bank_accounts.update_one({"_id": account_id}, {"$set": upd})


async def _insert_statement_line(acc: Dict[str, Any], t: Dict[str, Any]) -> Dict[str, Any]:
    account_id = acc["_id"]
    amount = float(t.get("amount") or 0)
    outflow = amount > 0
    abs_amt = abs(amount)
    kind = t.get("kind") or _kind_for_line(amount, None)
    contact_id = t.get("contact_id") or None
    contact = await _db.contacts.find_one({"_id": contact_id}) if contact_id else None
    contact_name = contact["name"] if contact else (t.get("contact_name") or None)
    category = (t.get("category") or "Diğer").strip() or "Diğer"
    desc = ((t.get("description") or "") + (f" ({t['installment']})" if t.get("installment") else ""))[:200]
    tx_id = str(uuid.uuid4())
    matched = bool(contact) or kind == "masraf"
    await _db.bank_transactions.insert_one({
        "_id": tx_id,
        "company_id": acc["company_id"],
        "account_id": account_id,
        "account_name": acc.get("account_name"),
        "type": "outflow" if outflow else "inflow",
        "category": f"Kart: {category}" if outflow else "Kart Ödemesi / İade",
        "amount": abs_amt,
        "currency": acc.get("currency", "TRY"),
        "description": desc,
        "contact_id": contact["_id"] if contact else None,
        "contact_name": contact_name,
        "source": "card_statement",
        "match_status": "matched" if matched else "unmatched",
        "kind": kind,
        "date": t.get("date"),
        "created_at": _now(),
    })
    created: Dict[str, Any] = {"tx_id": tx_id, "kind": kind}
    if kind == "cari_odeme" and contact:
        c_change = abs_amt if outflow else -abs_amt
        await _db.contacts.update_one({"_id": contact["_id"]}, {"$inc": {"balance": c_change}})
        created["contact_id"] = contact["_id"]
    elif kind == "masraf" and outflow:
        exp = await expenses_mod.record_card_spend(
            acc["company_id"],
            date=t.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            category=category,
            description=desc,
            amount=abs_amt,
            account_id=account_id,
            account_name=acc.get("account_name"),
            contact_id=contact["_id"] if contact else None,
            contact_name=contact_name,
            bank_tx_id=tx_id,
        )
        if exp:
            await _db.bank_transactions.update_one({"_id": tx_id}, {"$set": {"expense_id": exp.get("id")}})
            created["expense_id"] = exp.get("id")
    return created


# ---------------- Loans ----------------
@router.get("/loans")
async def list_loans(company_id: str = "comp_nexus_main_01"):
    loans = [_clean(x) for x in await _db.loans.find({"company_id": company_id}).sort("start_date", -1).to_list(200)]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for l in loans:
        ins = l.get("installments", [])
        l["paid_count"] = sum(1 for i in ins if i.get("paid"))
        l["remaining_debt"] = round(sum(i["amount"] for i in ins if not i.get("paid")), 2)
        l["overdue_count"] = sum(1 for i in ins if not i.get("paid") and i["due_date"] < today)
        nxt = next((i for i in ins if not i.get("paid")), None)
        l["next_installment"] = nxt
    total_debt = round(sum(l["remaining_debt"] for l in loans), 2)
    month = today[:7]
    due_month = round(sum(i["amount"] for l in loans for i in l.get("installments", []) if not i.get("paid") and i["due_date"].startswith(month)), 2)
    return {"loans": loans, "summary": {"count": len(loans), "total_debt": total_debt, "due_this_month": due_month, "overdue": sum(l["overdue_count"] for l in loans)}}


@router.post("/loans/extract")
async def extract_loan(file: UploadFile = File(...)):
    text = await _pdf_text(file)
    d = await _ask_json(LOAN_SYSTEM, text)
    ins = d.get("installments") or []
    if not ins and d.get("term_months") and d.get("monthly_payment"):
        from datetime import date, timedelta
        start = date.fromisoformat(d.get("start_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        for n in range(1, int(d["term_months"]) + 1):
            due = (start.replace(day=1) + timedelta(days=32 * n)).replace(day=min(start.day, 28))
            ins.append({"no": n, "due_date": due.isoformat(), "principal": 0, "interest": 0, "kkdf_bsmv": 0, "amount": float(d["monthly_payment"]), "remaining_principal": None})
    d["installments"] = [{"no": int(i.get("no") or k + 1), "due_date": i.get("due_date"), "principal": float(i.get("principal") or 0), "interest": float(i.get("interest") or 0), "kkdf_bsmv": float(i.get("kkdf_bsmv") or 0), "amount": float(i.get("amount") or 0), "remaining_principal": i.get("remaining_principal"), "paid": False} for k, i in enumerate(ins)]
    d["total_payment"] = d.get("total_payment") or round(sum(i["amount"] for i in d["installments"]), 2)
    return {"draft": d, "filename": file.filename, "text_preview": text[:800]}


@router.post("/loans")
async def create_loan(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    ins = req.get("installments") or []
    if not ins:
        raise HTTPException(status_code=400, detail="Ödeme planı (taksitler) gerekli.")
    doc = {"_id": str(uuid.uuid4()), "company_id": company_id, "name": (req.get("name") or f"{req.get('bank') or 'Banka'} Kredisi").strip(), "bank": req.get("bank"), "loan_type": req.get("loan_type") or "ticari", "principal": float(req.get("principal") or 0), "interest_rate": req.get("interest_rate"),
           "term_months": int(req.get("term_months") or len(ins)), "start_date": req.get("start_date") or ins[0].get("due_date"), "monthly_payment": req.get("monthly_payment"), "total_payment": float(req.get("total_payment") or sum(float(i.get("amount") or 0) for i in ins)),
           "account_id": req.get("account_id"), "installments": [{**i, "amount": float(i.get("amount") or 0), "paid": bool(i.get("paid"))} for i in ins], "notes": req.get("notes") or "", "created_at": _now()}
    await _db.loans.insert_one(doc)
    if req.get("account_id") and req.get("credit_to_account"):
        acc = await _db.bank_accounts.find_one({"_id": req["account_id"]})
        if acc:
            await assert_manual_allowed(_db, acc["_id"])
            await _db.bank_accounts.update_one({"_id": acc["_id"]}, {"$inc": {"current_balance": doc["principal"]}})
            await _db.bank_transactions.insert_one({"_id": str(uuid.uuid4()), "company_id": company_id, "account_id": acc["_id"], "account_name": acc.get("account_name"), "type": "inflow", "category": "Kredi Kullanımı", "amount": doc["principal"], "currency": "TRY", "description": f"{doc['name']} anapara girişi", "source": "loan", "loan_id": doc["_id"], "date": doc["start_date"], "created_at": _now()})
    return _clean(doc)


@router.post("/loans/{loan_id}/installments/{no}/pay")
async def pay_installment(loan_id: str, no: int, req: Dict[str, Any]):
    loan = await _db.loans.find_one({"_id": loan_id})
    if not loan:
        raise HTTPException(status_code=404, detail="Kredi bulunamadı.")
    ins = next((i for i in loan["installments"] if int(i["no"]) == no), None)
    if not ins or ins.get("paid"):
        raise HTTPException(status_code=400, detail="Taksit bulunamadı veya zaten ödendi.")
    account_id = req.get("account_id") or loan.get("account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="Ödeme yapılacak kasa/banka seçin.")
    acc = await _db.bank_accounts.find_one({"_id": account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Hesap bulunamadı.")
    pay_date = req.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await assert_manual_allowed(_db, account_id)
    await _db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": -ins["amount"]}})
    await _db.bank_transactions.insert_one({"_id": str(uuid.uuid4()), "company_id": loan["company_id"], "account_id": account_id, "account_name": acc.get("account_name"), "type": "outflow", "category": "Kredi Taksiti", "amount": ins["amount"], "currency": "TRY", "description": f"{loan['name']} {no}. taksit", "source": "loan", "loan_id": loan_id, "date": pay_date, "created_at": _now()})
    await _db.loans.update_one({"_id": loan_id, "installments.no": ins["no"]}, {"$set": {"installments.$.paid": True, "installments.$.paid_date": pay_date, "installments.$.account_name": acc.get("account_name")}})
    if ins.get("interest") or ins.get("kkdf_bsmv"):
        cost = round(float(ins.get("interest") or 0) + float(ins.get("kkdf_bsmv") or 0), 2)
        await _db.expenses.insert_one({"_id": str(uuid.uuid4()), "company_id": loan["company_id"], "expense_number": f"KRD-{loan_id[:4].upper()}-{no:02d}", "date": pay_date, "category": "Kredi Faizi / Finansman", "description": f"{loan['name']} {no}. taksit faiz+KKDF/BSMV", "amount": cost, "vat_rate": 0, "vat_amount": 0, "total": cost, "currency": "TRY", "payment_status": "paid", "account_id": account_id, "account_name": acc.get("account_name"), "paid_date": pay_date, "loan_id": loan_id, "notes": "Kredi modülünden otomatik", "is_recurring": False, "created_at": _now()})
    return _clean(await _db.loans.find_one({"_id": loan_id}))


@router.delete("/loans/{loan_id}")
async def delete_loan(loan_id: str):
    loan = await _db.loans.find_one({"_id": loan_id})
    if not loan:
        raise HTTPException(status_code=404, detail="Kredi bulunamadı.")
    import trash
    await trash.soft_delete("loans", loan, "loan", loan.get("name") or loan_id, note=f"{loan.get('bank_name') or ''} · {float(loan.get('principal') or loan.get('amount') or 0):,.2f} ₺")
    return {"status": "success", "message": "Kredi çöp kutusuna taşındı."}


# ---------------- Credit card statement import ----------------
@router.post("/banking/accounts/{account_id}/import-statement")
async def import_statement(account_id: str, file: UploadFile = File(...), dry_run: bool = Query(True)):
    acc = await _db.bank_accounts.find_one({"_id": account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Hesap bulunamadı.")
    text = await _pdf_text(file)
    d = await _ask_json(CARD_SYSTEM, text)
    txs = [{"date": t.get("date"), "description": (t.get("description") or "")[:200], "amount": float(t.get("amount") or 0), "installment": t.get("installment"), "category": t.get("category") or "Diğer", "merchant": t.get("merchant")} for t in (d.get("transactions") or []) if t.get("amount") is not None]
    existing = await _existing_statement_keys(account_id)
    for t in txs:
        t["duplicate"] = _tx_key(t) in existing
    txs = await _enrich_statement_lines(acc["company_id"], txs)
    result = {"statement": {k: d.get(k) for k in ("bank", "card_last4", "statement_date", "due_date", "total_debt", "minimum_payment", "limit", "confidence")}, "transactions": txs, "filename": file.filename}
    if dry_run:
        return result
    inserted = 0
    for t in txs:
        if t.get("duplicate") or not t.get("date") or not t.get("included", True):
            continue
        await _insert_statement_line(acc, t)
        inserted += 1
    await _apply_statement_account(account_id, result["statement"], acc)
    return {**result, "inserted": inserted, "message": f"{inserted} hareket aktarıldı" + (f", kart borcu {d['total_debt']} ₺ olarak güncellendi." if d.get("total_debt") is not None else ".")}


@router.post("/banking/accounts/{account_id}/import-statement/confirm")
async def confirm_statement(account_id: str, req: Dict[str, Any]):
    acc = await _db.bank_accounts.find_one({"_id": account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Hesap bulunamadı.")
    statement = req.get("statement") or {}
    lines = req.get("lines") or req.get("transactions") or []
    existing = await _existing_statement_keys(account_id)
    inserted, expenses_n, contacts_n = 0, 0, 0
    details = []
    for raw in lines:
        t = {
            "date": raw.get("date"),
            "description": (raw.get("description") or "")[:200],
            "amount": float(raw.get("amount") or 0),
            "installment": raw.get("installment"),
            "category": raw.get("category") or "Diğer",
            "kind": raw.get("kind") or "masraf",
            "contact_id": raw.get("contact_id") or None,
            "contact_name": raw.get("contact_name"),
            "included": bool(raw.get("included", True)),
        }
        if not t["included"] or not t["date"] or t["amount"] == 0 or _tx_key(t) in existing:
            continue
        created = await _insert_statement_line(acc, t)
        inserted += 1
        if created.get("expense_id"):
            expenses_n += 1
        if created.get("contact_id"):
            contacts_n += 1
        details.append(created)
        existing.add(_tx_key(t))
    await _apply_statement_account(account_id, statement, acc)
    return {
        "inserted": inserted,
        "expenses_created": expenses_n,
        "contacts_matched": contacts_n,
        "details": details,
        "statement": statement,
        "message": f"{inserted} hareket aktarıldı" + (f", {expenses_n} masraf oluşturuldu" if expenses_n else "") + (f", {contacts_n} cari eşleşti" if contacts_n else "") + ".",
    }
