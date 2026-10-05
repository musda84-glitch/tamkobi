"""Cashless ortak (partner) current-account movements used as a payment source."""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from models import PartnerTransaction

TX_LABELS = {
    "capital_in": "Ortak Sermaye Girişi",
    "withdrawal": "Ortak Para Çekişi",
    "profit_share": "Ortak Kâr Payı Ödemesi",
    "credit": "Ortak Alacak Fişi",
    "debit": "Ortak Borç Fişi",
    "salary": "Ortak Aylık Maaş",
}
CASH_TYPES = ("capital_in", "withdrawal")
LEDGER_TYPES = ("credit", "debit", "salary")
MUTABLE_TYPES = CASH_TYPES + LEDGER_TYPES
MONTHS_TR = ("Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
             "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık")


def salary_period_label(period: str) -> str:
    """2026-10 → Ekim 2026."""
    raw = (period or "").strip()
    try:
        year, month = raw.split("-", 1)
        return f"{MONTHS_TR[int(month) - 1]} {year}"
    except (ValueError, IndexError):
        return raw or "dönem"


def normalize_period(period: Optional[str] = None) -> str:
    raw = (period or "").strip()
    if len(raw) >= 7 and raw[4] == "-":
        return raw[:7]
    return datetime.now(timezone.utc).strftime("%Y-%m")


def balance_inc(tx_type: str, amount: float) -> Dict[str, float]:
    """Ortak bakiyesi: artı = şirket ortağa borçlu. credit/capital_in/salary +, debit/withdrawal −."""
    if tx_type in ("capital_in", "credit", "salary"):
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


async def accrue_monthly_salaries(
    db, company_id: str, period: Optional[str] = None, partner_id: Optional[str] = None
) -> Dict[str, Any]:
    """Aylık maaşı ortak alacağına yazar (kasa dokunmaz). Aynı dönem ikinci kez yazılmaz."""
    period = normalize_period(period)
    q: Dict[str, Any] = {"company_id": company_id}
    if partner_id:
        q["_id"] = partner_id
    cursor = db.partners.find(q)
    partners = await cursor.to_list(100) if hasattr(cursor, "to_list") else list(cursor)
    posted: List[dict] = []
    skipped: List[dict] = []
    date = f"{period}-01"
    label = salary_period_label(period)
    for p in partners:
        if p.get("is_active") is False:
            skipped.append({"partner_id": p["_id"], "partner_name": p.get("name"), "reason": "inactive"})
            continue
        try:
            amount = float(p.get("monthly_salary") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        if amount <= 0:
            skipped.append({"partner_id": p["_id"], "partner_name": p.get("name"), "reason": "no_salary"})
            continue
        exists = await db.partner_transactions.find_one({
            "company_id": company_id,
            "partner_id": p["_id"],
            "type": "salary",
            "salary_period": period,
        })
        if exists:
            skipped.append({"partner_id": p["_id"], "partner_name": p.get("name"), "reason": "already"})
            continue
        desc = f"{label} aylık ortak maaşı"
        await move(
            db, company_id, p["_id"], amount, "salary", desc, date=date,
            extra={"salary_period": period, "source": "monthly_salary"},
        )
        posted.append({"partner_id": p["_id"], "partner_name": p.get("name"), "amount": round(amount, 2)})
    n = len(posted)
    message = f"{n} ortağa {label} maaşı alacağa yazıldı." if n else f"{label} için yazılacak yeni maaş yok."
    return {"status": "success", "period": period, "posted": posted, "skipped": skipped, "posted_count": n, "message": message}
