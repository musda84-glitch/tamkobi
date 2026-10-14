"""Manuel cari tahsilat/ödeme ile ekstre veya eşleştirme çift kaydı."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Iterable, Optional

MANUAL_SOURCES = {None, "", "manual"}


def _num(v: Any) -> float:
    try:
        return abs(float(v or 0))
    except (TypeError, ValueError):
        return 0.0


def parse_tx_date(raw: Any):
    s = str(raw or "").strip()[:10]
    if len(s) != 10:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def dates_within(a: Any, b: Any, days: int = 3) -> bool:
    da, db = parse_tx_date(a), parse_tx_date(b)
    if not da or not db:
        return False
    return abs((da - db).days) <= int(days)


def is_manual_contact_movement(tx: Optional[dict]) -> bool:
    if not isinstance(tx, dict) or not tx.get("contact_id"):
        return False
    return tx.get("source") in MANUAL_SOURCES


def statement_tx_type(amount: Any, *, is_card: bool) -> str:
    """Ekstre tutarının kasa tipi: kartta pozitif harcama çıkış, bankada pozitif giriş."""
    try:
        n = float(amount or 0)
    except (TypeError, ValueError):
        n = 0.0
    if is_card:
        return "outflow" if n > 0 else "inflow"
    return "outflow" if n < 0 else "inflow"


def find_duplicate_candidate(
    rows: Iterable[dict],
    *,
    account_id: str,
    contact_id: str,
    amount: Any,
    date: Any,
    tx_type: str,
    exclude_id: Optional[str] = None,
    window_days: int = 3,
) -> Optional[Dict[str, Any]]:
    """Aynı hesap, aynı cari, aynı tutar, tarih ±pencere, aynı yön."""
    want_amt = _num(amount)
    if not account_id or not contact_id or want_amt < 0.009 or not tx_type:
        return None
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        rid = row.get("_id") or row.get("id")
        if exclude_id and str(rid) == str(exclude_id):
            continue
        if str(row.get("account_id") or "") != str(account_id):
            continue
        if str(row.get("contact_id") or "") != str(contact_id):
            continue
        if not is_manual_contact_movement(row):
            continue
        if str(row.get("type") or "") != str(tx_type):
            continue
        if abs(_num(row.get("amount")) - want_amt) >= 0.009:
            continue
        if not dates_within(row.get("date"), date, window_days):
            continue
        return row
    return None


def invoice_payment_exceeds(inv: Optional[dict], amount: Any) -> bool:
    """paid_amount + tutar grand_total'ı aşacaksa True. grand_total yoksa aşmaz."""
    if not isinstance(inv, dict):
        return False
    try:
        grand = float(inv.get("grand_total") or 0)
        paid = float(inv.get("paid_amount") or 0)
        amt = abs(float(amount or 0))
    except (TypeError, ValueError):
        return False
    if grand <= 0:
        return False
    return paid + amt > grand + 0.01
