"""Krediler (loans) + kredi kartı ekstresi: AI ile PDF'den ödeme planı / ekstre hareketi aktarımı."""
import io
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from bank_guard import assert_manual_allowed
from emergentintegrations.llm.chat import LlmChat, UserMessage

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
    key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY tanımlı değil.")
    chat = LlmChat(api_key=key, session_id=f"fin-{uuid.uuid4().hex[:8]}", system_message=system).with_model("anthropic", "claude-sonnet-4-6")
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
"transactions": [{"date": "YYYY-MM-DD", "description": str, "amount": number (harcama pozitif, ödeme/iade negatif), "installment": str|null, "category": "Yakıt"|"Yemek"|"Market"|"Ofis Malzemesi"|"Yol / Ulaşım"|"Yazılım / Abonelik"|"Pazarlama / Reklam"|"Kargo / Nakliye"|"Vergi / Harç / SGK"|"Diğer"}], "confidence": number}
Türkçe sayı formatını çevir, tarihleri ISO yap. Ödeme/iade satırlarını negatif tutar ile ver."""


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
    r = await _db.loans.delete_one({"_id": loan_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Kredi bulunamadı.")
    return {"status": "success"}


# ---------------- Credit card statement import ----------------
@router.post("/banking/accounts/{account_id}/import-statement")
async def import_statement(account_id: str, file: UploadFile = File(...), dry_run: bool = Query(True)):
    acc = await _db.bank_accounts.find_one({"_id": account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Hesap bulunamadı.")
    text = await _pdf_text(file)
    d = await _ask_json(CARD_SYSTEM, text)
    txs = [{"date": t.get("date"), "description": (t.get("description") or "")[:200], "amount": float(t.get("amount") or 0), "installment": t.get("installment"), "category": t.get("category") or "Diğer"} for t in (d.get("transactions") or []) if t.get("amount") is not None]
    existing = {(b.get("date"), b.get("description"), round(abs(b.get("amount", 0)), 2)) for b in await _db.bank_transactions.find({"account_id": account_id, "source": "card_statement"}, {"date": 1, "description": 1, "amount": 1}).to_list(5000)}
    for t in txs:
        t["duplicate"] = (t["date"], t["description"], round(abs(t["amount"]), 2)) in existing
    result = {"statement": {k: d.get(k) for k in ("bank", "card_last4", "statement_date", "due_date", "total_debt", "minimum_payment", "limit", "confidence")}, "transactions": txs, "filename": file.filename}
    if dry_run:
        return result
    inserted = 0
    for t in txs:
        if t["duplicate"] or not t["date"]:
            continue
        outflow = t["amount"] > 0
        await _db.bank_transactions.insert_one({"_id": str(uuid.uuid4()), "company_id": acc["company_id"], "account_id": account_id, "account_name": acc.get("account_name"), "type": "outflow" if outflow else "inflow", "category": f"Kart: {t['category']}" if outflow else "Kart Ödemesi / İade",
                                                "amount": abs(t["amount"]), "currency": acc.get("currency", "TRY"), "description": t["description"] + (f" ({t['installment']})" if t.get("installment") else ""), "source": "card_statement", "date": t["date"], "created_at": _now()})
        inserted += 1
    upd = {"last_statement": result["statement"], "last_statement_at": _now()}
    if d.get("total_debt") is not None:
        upd["current_balance"] = -abs(float(d["total_debt"]))
    if d.get("limit"):
        upd["card_limit"] = float(d["limit"])
    await _db.bank_accounts.update_one({"_id": account_id}, {"$set": upd})
    return {**result, "inserted": inserted, "message": f"{inserted} hareket aktarıldı" + (f", kart borcu {d['total_debt']} ₺ olarak güncellendi." if d.get("total_debt") is not None else ".")}
