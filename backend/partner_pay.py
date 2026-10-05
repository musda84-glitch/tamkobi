"""Cashless ortak (partner) current-account movements used as a payment source."""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException

from models import PartnerTransaction

TX_LABELS = {
    "capital_in": "Ortak Sermaye Girişi",
    "withdrawal": "Ortak Para Çekişi",
    "profit_share": "Ortak Kâr Payı Ödemesi",
    "credit": "Ortak Alacak Fişi",
    "debit": "Ortak Borç Fişi",
}
CASH_TYPES = ("capital_in", "withdrawal")
LEDGER_TYPES = ("credit", "debit")
MUTABLE_TYPES = CASH_TYPES + LEDGER_TYPES


def balance_inc(tx_type: str, amount: float) -> Dict[str, float]:
    """Ortak bakiyesi: artı = şirket ortağa borçlu. credit/capital_in +, debit/withdrawal −."""
    if tx_type in ("capital_in", "credit"):
        return {"balance": amount, "total_capital_in": amount}
    if tx_type in ("withdrawal", "debit"):
        return {"balance": -amount, "total_withdrawn": amount}
    raise HTTPException(status_code=400, detail="Geçersiz işlem türü.")


async def move(db, company_id: str, partner_id: str, amount: float, tx_type: str, description: str, date: Optional[str] = None, extra: Optional[Dict[str, Any]] = None) -> str:
    """Adjust partner balance without touching kasa/banka. Returns partner name."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalıdır.")
    partner = await db.partners.find_one({"_id": partner_id})
    if not partner:
        raise HTTPException(status_code=404, detail="Ortak bulunamadı.")
    if tx_type not in MUTABLE_TYPES:
        raise HTTPException(status_code=400, detail="Geçersiz ortak hareketi.")
    await db.partners.update_one({"_id": partner["_id"]}, {"$inc": balance_inc(tx_type, amount)})
    ptx = PartnerTransaction(
        company_id=company_id,
        partner_id=partner["_id"],
        partner_name=partner["name"],
        type=tx_type,
        amount=amount,
        account_id=None,
        account_name="Ortaklar Hesabı",
        description=description,
        date=date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    )
    doc = ptx.to_mongo()
    if extra:
        doc.update({k: v for k, v in extra.items() if v is not None})
    await db.partner_transactions.insert_one(doc)
    return partner["name"]


async def withdraw(db, company_id: str, partner_id: str, amount: float, description: str, date: Optional[str] = None, extra: Optional[Dict[str, Any]] = None) -> str:
    """Company pays from the partner current account (balance decreases)."""
    return await move(db, company_id, partner_id, amount, "withdrawal", description, date, extra)


async def reverse_one(db, query: Dict[str, Any]) -> bool:
    ptx = await db.partner_transactions.find_one(query)
    if not ptx:
        return False
    amount = float(ptx.get("amount") or 0)
    t = ptx.get("type")
    if t in MUTABLE_TYPES:
        inc = {k: -v for k, v in balance_inc(t, amount).items()}
        await db.partners.update_one({"_id": ptx["partner_id"]}, {"$inc": inc})
    await db.partner_transactions.delete_one({"_id": ptx["_id"]})
    return True
