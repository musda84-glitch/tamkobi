"""Satış faturası numarası: TA + yıl + 8 hane.

Satış, alış, ihracat ve ithalat sırası `db.counters` içinde atomik tutulur.
Anahtar şirkete, öneke ve yıla aittir; sayım kullanılmaz.
"""

import re
from datetime import datetime, timezone

SALES_INVOICE_PREFIX = "TA"


def format_sales_invoice_number(seq, year=None) -> str:
    y = str(year or datetime.now(timezone.utc).year)
    try:
        n = int(str(seq).strip() or "1")
    except (TypeError, ValueError):
        n = 1
    return f"{SALES_INVOICE_PREFIX}{y}{str(max(n, 1)).zfill(8)}"


def _format_invoice_number(prefix: str, seq, year) -> str:
    if prefix == SALES_INVOICE_PREFIX:
        return format_sales_invoice_number(seq, year)
    y = str(year or datetime.now(timezone.utc).year)
    try:
        n = int(str(seq).strip() or "1")
    except (TypeError, ValueError):
        n = 1
    return f"{prefix}{y}{str(max(n, 1)).zfill(8)}"


def _invoice_seq(number, prefix: str, year: str):
    """^{önek}{yıl} ve tam 8 hane. Başka uzunluk veya önek yok sayılır."""
    match = re.fullmatch(rf"{re.escape(prefix)}{re.escape(year)}(\d{{8}})", str(number or ""))
    if not match:
        return None
    return int(match.group(1))


async def _max_invoice_seq(db, company_id: str, prefix: str, year: str) -> int:
    pattern = rf"^{re.escape(prefix)}{re.escape(year)}\d{{8}}$"
    best = 0
    cursor = db.invoices.find(
        {"company_id": company_id, "invoice_number": {"$regex": pattern}},
        {"invoice_number": 1},
    )
    rows = await cursor.to_list(None) if hasattr(cursor, "to_list") else list(cursor)
    for row in rows or []:
        seq = _invoice_seq((row or {}).get("invoice_number"), prefix, year)
        if seq is not None and seq > best:
            best = seq
    return best


async def next_invoice_number(db, company_id, prefix, year) -> str:
    """Atomik fatura sayacı. Silinen kayıt ve eşzamanlı istek aynı numarayı vermez.

    Anahtar INV-{önek}-{yıl}-{company_id}. İlk çağrı o şirket ve yılda
    ^{önek}{yıl}\\d{8}$ desenine uyan numaraların sayısal en büyüğünden
    tohumlanır; sonraki çağrılar $inc ile ilerler.
    """
    prefix_s = str(prefix)
    year_s = str(year)
    company_s = str(company_id)
    key = f"INV-{prefix_s}-{year_s}-{company_s}"
    if not await db.counters.find_one({"_id": key}):
        seed = await _max_invoice_seq(db, company_s, prefix_s, year_s)
        await db.counters.update_one({"_id": key}, {"$setOnInsert": {"seq": seed}}, upsert=True)
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = int((doc or {}).get("seq") or 1)
    return _format_invoice_number(prefix_s, seq, year_s)
