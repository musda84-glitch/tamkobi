"""Cashless ortak (partner) current-account movements used as a payment source."""
import asyncio
import calendar
import logging
from datetime import datetime, timezone, date as dt_date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from models import PartnerTransaction

logger = logging.getLogger("partner_pay")

TX_LABELS = {
    "capital_in": "Ortak Sermaye Girişi",
    "withdrawal": "Ortak Para Çekişi",
    "profit_share": "Ortak Kâr Payı Ödemesi",
    "credit": "Ortak Alacak Fişi",
    "debit": "Ortak Borç Fişi",
    "salary": "Ortak Aylık Maaş",
}


def tx_display_label(tx: Optional[Dict[str, Any]]) -> str:
    """Şirket masrafını ortağın ödemesi — 'Para Çekişi' değil 'Masraf Ödemesi' (ortak alacak)."""
    if not tx:
        return "İşlem"
    if tx.get("expense_id") or tx.get("source") == "expense":
        return "Ortak Masraf Ödemesi"
    return TX_LABELS.get(tx.get("type"), tx.get("type") or "İşlem")
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


def parse_iso_date(raw: Optional[str]) -> Optional[dt_date]:
    s = (raw or "").strip()[:10]
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        return None
    try:
        return dt_date.fromisoformat(s)
    except ValueError:
        return None


def period_of(d: dt_date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def add_months(period: str, n: int = 1) -> str:
    y, m = int(period[:4]), int(period[5:7])
    idx = y * 12 + (m - 1) + n
    return f"{idx // 12:04d}-{(idx % 12) + 1:02d}"


def periods_inclusive(start: str, end: str, cap: int = 36) -> List[str]:
    if start > end:
        return []
    out: List[str] = []
    cur = start
    for _ in range(max(1, cap)):
        out.append(cur)
        if cur >= end:
            break
        cur = add_months(cur, 1)
    return out


def salary_day_of(partner: Dict[str, Any]) -> int:
    start = parse_iso_date(partner.get("salary_start_date"))
    if start:
        return start.day
    try:
        n = int(partner.get("salary_day") or 1)
    except (TypeError, ValueError):
        n = 1
    return min(max(n, 1), 31)


def salary_due_on(period: str, day: int) -> dt_date:
    y, m = int(period[:4]), int(period[5:7])
    last = calendar.monthrange(y, m)[1]
    return dt_date(y, m, min(max(int(day or 1), 1), last))


def salary_slots(
    partner: Dict[str, Any],
    as_of: dt_date,
    *,
    explicit_period: Optional[str] = None,
    force_start: bool = False,
) -> List[Tuple[str, dt_date]]:
    """Dönem + hak ediş tarihi. Tekrar kapalıysa yalnızca başlangıç ayı."""
    day = salary_day_of(partner)
    start = parse_iso_date(partner.get("salary_start_date"))
    recurring = partner.get("salary_recurring") is not False

    def due_for(per: str) -> dt_date:
        due = salary_due_on(per, day)
        if start and per == period_of(start):
            return start
        return due

    if explicit_period:
        per = normalize_period(explicit_period)
        if start and period_of(start) > per:
            return []
        return [(per, due_for(per))]

    end_p = period_of(as_of)
    start_p = period_of(start) if start else end_p
    last_p = end_p if recurring else start_p
    slots: List[Tuple[str, dt_date]] = []
    for per in periods_inclusive(start_p, last_p):
        due = due_for(per)
        if due > as_of and not (force_start and start and per == period_of(start)):
            continue
        slots.append((per, due))
    if force_start and start and period_of(start) > end_p:
        slots.append((period_of(start), start))
    return slots


def prepare_partner_salary(doc: Dict[str, Any], *, fill_start: bool = True) -> Dict[str, Any]:
    """Aylık maaş / hak ediş alanlarını doğrula. fill_start: tutar varken tarih yoksa bugün yaz."""
    if "monthly_salary" in doc:
        try:
            doc["monthly_salary"] = max(0.0, float(doc.get("monthly_salary") or 0))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Aylık maaş geçersiz.")
    if "salary_recurring" in doc:
        doc["salary_recurring"] = bool(doc["salary_recurring"])
    if "salary_start_date" in doc:
        raw = doc.get("salary_start_date")
        if raw in ("", None):
            doc["salary_start_date"] = None
        else:
            d = parse_iso_date(raw)
            if not d:
                raise HTTPException(status_code=400, detail="Hak ediş tarihi geçersiz.")
            doc["salary_start_date"] = d.isoformat()
            doc["salary_day"] = d.day
    elif "salary_day" in doc:
        try:
            doc["salary_day"] = min(31, max(1, int(doc["salary_day"])))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Hak ediş günü geçersiz.")
    if fill_start and float(doc.get("monthly_salary") or 0) > 0 and not doc.get("salary_start_date"):
        today = datetime.now(timezone.utc).date()
        doc["salary_start_date"] = today.isoformat()
        doc["salary_day"] = today.day
        doc.setdefault("salary_recurring", True)
    return doc


def balance_inc(tx_type: str, amount: float) -> Dict[str, float]:
    """Ortak bakiyesi: artı = şirket ortağa borçlu. credit/capital_in/salary +, debit/withdrawal −.

    Sermaye / çekiş sayaçları yalnızca para koy / para çek hareketlerinde artar;
    alacak/borç fişi ve maaş bakiyeyi etkiler ama Giriş/Çekiş özetini şişirmez.
    """
    if tx_type == "capital_in":
        return {"balance": amount, "total_capital_in": amount}
    if tx_type == "withdrawal":
        return {"balance": -amount, "total_withdrawn": amount}
    if tx_type in ("credit", "salary"):
        return {"balance": amount}
    if tx_type == "debit":
        return {"balance": -amount}
    raise HTTPException(status_code=400, detail="Geçersiz işlem türü.")


def tx_balance_delta(tx: Dict[str, Any]) -> float:
    """Tek hareketin ortak bakiyesine etkisi (tahakkuk kâr payı +, peşin ödenen 0).

    Masraf ödemesi tip withdrawal kalsa bile alacak (+); sync onarımı öncesi de doğru.
    """
    try:
        amount = float(tx.get("amount") or 0)
    except (TypeError, ValueError):
        return 0.0
    t = tx.get("type")
    # Masraf / expense kaynağı — eski withdrawal yazılmış olsa bile alacak
    if tx.get("expense_id") or tx.get("source") == "expense" or t == "credit":
        return amount
    if t in ("capital_in", "salary"):
        return amount
    if t in ("withdrawal", "debit"):
        return -amount
    if t == "profit_share":
        return 0.0 if tx.get("is_paid") else amount
    return 0.0


def profit_share_inc(amount: float, is_paid: bool, *, applying: bool) -> Dict[str, float]:
    """Kâr payı tahakkuk/ödeme: applying=True oluştur/geri getir, False geri al.

    Tahakkuk (is_paid=False) bakiyeyi artırır; peşin ödeme yalnızca total_profit_share yazar.
    """
    try:
        amt = float(amount or 0)
    except (TypeError, ValueError):
        amt = 0.0
    sign = 1.0 if applying else -1.0
    inc: Dict[str, float] = {"total_profit_share": sign * amt}
    if not is_paid:
        inc["balance"] = sign * amt
    return inc


def ledger_totals(txs: List[Dict[str, Any]]) -> Dict[str, float]:
    """Hareket listesinden bakiye + özet sayaçları."""
    balance = 0.0
    capital = 0.0
    withdrawn = 0.0
    profit = 0.0
    for tx in txs or []:
        balance += tx_balance_delta(tx)
        try:
            amt = float(tx.get("amount") or 0)
        except (TypeError, ValueError):
            amt = 0.0
        t = tx.get("type")
        if t == "capital_in":
            capital += amt
        elif t == "withdrawal":
            withdrawn += amt
        elif t == "profit_share":
            profit += amt
    return {
        "balance": round(balance, 2),
        "total_capital_in": round(capital, 2),
        "total_withdrawn": round(withdrawn, 2),
        "total_profit_share": round(profit, 2),
    }


def is_legacy_expense_withdrawal(tx: Optional[Dict[str, Any]]) -> bool:
    """Eski masraf ödemesi yanlışlıkla withdrawal yazılmış mı? (doğrusu credit)."""
    if not tx or tx.get("type") != "withdrawal":
        return False
    if tx.get("expense_id"):
        return True
    return tx.get("source") == "expense"


async def repair_legacy_expense_withdrawals(db, partner_id: Optional[str] = None) -> int:
    """Masraf → ortak satırlarını withdrawal→credit çevir (alacak +2× tutar onarımı).

    Eski kod şirket masrafını ortaktan `withdraw` ile düşüyordu; doğrusu `credit`
    (şirket ortağa borçlanır). Tip düzeltilmeden ledger sync yanlış bakiyeyi kalıcılaştırır.
    """
    q: Dict[str, Any] = {"type": "withdrawal"}
    if partner_id:
        q["partner_id"] = partner_id
    txs = await db.partner_transactions.find(q).to_list(20000)
    fixed = 0
    now = datetime.now(timezone.utc).isoformat()
    for tx in txs:
        if not is_legacy_expense_withdrawal(tx):
            continue
        await db.partner_transactions.update_one(
            {"_id": tx["_id"]},
            {"$set": {"type": "credit", "legacy_expense_repaired_at": now}},
        )
        fixed += 1
    return fixed


async def sync_partner_from_ledger(db, partner_id: str) -> Optional[Dict[str, Any]]:
    """Kayıtlı bakiyeyi hareketlerden yeniden hesapla; kaymayı onar."""
    # Lazy: bank_match_target → partner_pay döngüsünü kırma
    from bank_match_target import repair_legacy_bank_match_directions

    partner = await db.partners.find_one({"_id": partner_id})
    if not partner:
        return None
    expense_rows_repaired = await repair_legacy_expense_withdrawals(db, partner_id)
    bank_match_rows_repaired = await repair_legacy_bank_match_directions(db, partner_id)
    txs = await db.partner_transactions.find({"partner_id": partner_id}).to_list(20000)
    live = ledger_totals(txs)
    prev = {
        "balance": float(partner.get("balance") or 0),
        "total_capital_in": float(partner.get("total_capital_in") or 0),
        "total_withdrawn": float(partner.get("total_withdrawn") or 0),
        "total_profit_share": float(partner.get("total_profit_share") or 0),
    }
    repaired = (
        expense_rows_repaired > 0
        or bank_match_rows_repaired > 0
        or any(abs(live[k] - prev[k]) > 0.005 for k in live)
    )
    if repaired:
        await db.partners.update_one(
            {"_id": partner_id},
            {"$set": {**live, "balance_synced_at": datetime.now(timezone.utc).isoformat()}},
        )
    return {
        **live,
        "previous": prev,
        "repaired": repaired,
        "expense_rows_repaired": expense_rows_repaired,
        "bank_match_rows_repaired": bank_match_rows_repaired,
    }


async def sync_company_partners(db, company_id: str) -> List[Dict[str, Any]]:
    partners = await db.partners.find({"company_id": company_id}).to_list(200)
    out: List[Dict[str, Any]] = []
    for p in partners:
        meta = await sync_partner_from_ledger(db, p["_id"])
        if meta:
            out.append({"partner_id": p["_id"], **meta})
    return out


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


async def credit_expense(
    db,
    company_id: str,
    partner_id: str,
    amount: float,
    description: str,
    date: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    """Şirket masrafını ortak ödedi → şirket ortağa borçlanır (ortak alacaklı, bakiye artar)."""
    return await move(db, company_id, partner_id, amount, "credit", description, date, extra)


async def reverse_one(db, query: Dict[str, Any]) -> bool:
    ptx = await db.partner_transactions.find_one(query)
    if not ptx:
        return False
    amount = float(ptx.get("amount") or 0)
    t = ptx.get("type")
    if t in MUTABLE_TYPES:
        inc = {k: -v for k, v in balance_inc(t, amount).items()}
        await db.partners.update_one({"_id": ptx["partner_id"]}, {"$inc": inc})
    elif t == "profit_share":
        await db.partners.update_one(
            {"_id": ptx["partner_id"]},
            {"$inc": profit_share_inc(amount, bool(ptx.get("is_paid")), applying=False)},
        )
    await db.partner_transactions.delete_one({"_id": ptx["_id"]})
    return True


async def accrue_monthly_salaries(
    db,
    company_id: str,
    period: Optional[str] = None,
    partner_id: Optional[str] = None,
    as_of: Optional[str] = None,
    force_start: bool = False,
) -> Dict[str, Any]:
    """Aylık maaşı hak ediş tarihinde ortak alacağına yazar. Aynı dönem ikinci kez yazılmaz.

    period verilirse yalnızca o ay. Aksi halde salary_start_date'den bugüne vadesi gelen aylar
    (tekrar açıksa) yazılır. force_start, henüz gelmemiş ilk hak ediş ayını da kaydeder.
    """
    today = parse_iso_date(as_of) or datetime.now(timezone.utc).date()
    explicit = normalize_period(period) if period else None
    q: Dict[str, Any] = {"company_id": company_id}
    if partner_id:
        q["_id"] = partner_id
    cursor = db.partners.find(q)
    partners = await cursor.to_list(100) if hasattr(cursor, "to_list") else list(cursor)
    posted: List[dict] = []
    skipped: List[dict] = []
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
        slots = salary_slots(p, today, explicit_period=explicit, force_start=force_start)
        if not slots:
            start = parse_iso_date(p.get("salary_start_date"))
            due_date = start.isoformat() if start and start > today else None
            skipped.append({
                "partner_id": p["_id"], "partner_name": p.get("name"),
                "reason": "not_due", "due_date": due_date,
            })
            continue
        for per, due in slots:
            exists = await db.partner_transactions.find_one({
                "company_id": company_id,
                "partner_id": p["_id"],
                "type": "salary",
                "salary_period": per,
            })
            if exists:
                skipped.append({"partner_id": p["_id"], "partner_name": p.get("name"), "reason": "already", "period": per})
                continue
            label = salary_period_label(per)
            desc = f"{label} aylık ortak maaşı"
            await move(
                db, company_id, p["_id"], amount, "salary", desc, date=due.isoformat(),
                extra={"salary_period": per, "salary_date": due.isoformat(), "source": "monthly_salary"},
            )
            posted.append({
                "partner_id": p["_id"],
                "partner_name": p.get("name"),
                "amount": round(amount, 2),
                "period": per,
                "date": due.isoformat(),
            })
    n = len(posted)
    scheduled = next((s.get("due_date") for s in skipped if s.get("reason") == "not_due" and s.get("due_date")), None)
    if n:
        message = f"{n} maaş kaydı ortak alacağına yazıldı."
    elif scheduled:
        message = f"Kaydedildi. Hak ediş tarihinde ({scheduled}) alacağa yazılacak."
    else:
        message = f"{salary_period_label(explicit or period_of(today))} için yazılacak yeni maaş yok."
    return {
        "status": "success",
        "period": explicit or period_of(today),
        "as_of": today.isoformat(),
        "posted": posted,
        "skipped": skipped,
        "posted_count": n,
        "scheduled_date": scheduled,
        "message": message,
    }


async def accrue_due_for_all_companies(db, as_of: Optional[str] = None) -> Dict[str, Any]:
    cursor = db.partners.find({})
    partners = await cursor.to_list(5000) if hasattr(cursor, "to_list") else list(cursor)
    seen = set()
    posted = 0
    companies = 0
    for p in partners:
        try:
            if float(p.get("monthly_salary") or 0) <= 0:
                continue
        except (TypeError, ValueError):
            continue
        cid = p.get("company_id")
        if not cid or cid in seen:
            continue
        seen.add(cid)
        companies += 1
        r = await accrue_monthly_salaries(db, cid, as_of=as_of)
        posted += int(r.get("posted_count") or 0)
    return {"posted_count": posted, "companies": companies}


async def scheduler_loop(db):
    """Saatte bir: vadesi gelen ortak maaşlarını alacağa yazar."""
    await asyncio.sleep(40)
    while True:
        try:
            r = await accrue_due_for_all_companies(db)
            if r.get("posted_count"):
                logger.info("partner salary scheduler posted %s", r["posted_count"])
        except Exception as e:  # noqa: BLE001
            logger.warning("partner salary scheduler: %s", e)
        await asyncio.sleep(3600)
