"""Cari özetindeki tahsilat / ödeme satırlarını tamamlar (masraf ve hesapsız fatura)."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def linked_invoice_paid(payments: Optional[Iterable[dict]]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for pay in payments or []:
        if not isinstance(pay, dict):
            continue
        iid = pay.get("related_invoice_id")
        if not iid:
            continue
        out[str(iid)] = out.get(str(iid), 0.0) + _num(pay.get("amount"))
    return out


def expense_as_payment(
    exp: dict,
    contact_id: str,
    contact_name: Optional[str] = None,
    bank_tx: Optional[dict] = None,
) -> Optional[dict]:
    """Tedarikçiye işlenen masraf ödemesini cari Ödeme listesine çevirir."""
    if not isinstance(exp, dict):
        return None
    name = contact_name or exp.get("contact_name")
    if bank_tx:
        return {
            **bank_tx,
            "contact_id": contact_id,
            "contact_name": name or bank_tx.get("contact_name"),
            "source": bank_tx.get("source") or "expense",
            "expense_id": bank_tx.get("expense_id") or exp.get("_id"),
        }
    if (exp.get("payment_status") or "") != "paid":
        return None
    amount = _num(exp.get("total") if exp.get("total") is not None else exp.get("amount"))
    if amount <= 0:
        return None
    number = str(exp.get("expense_number") or "").strip()
    desc = str(exp.get("description") or "").strip()
    return {
        "_id": f"expense-virt-{exp.get('_id')}",
        "company_id": exp.get("company_id"),
        "account_id": exp.get("account_id"),
        "account_name": exp.get("account_name") or "Masraf",
        "type": "outflow",
        "category": f"Masraf: {exp.get('category') or 'Diğer'}",
        "amount": amount,
        "currency": exp.get("currency") or "TRY",
        "description": " ".join(part for part in (number, desc) if part).strip() or "Masraf ödemesi",
        "contact_id": contact_id,
        "contact_name": name,
        "source": "expense",
        "expense_id": exp.get("_id"),
        "date": exp.get("paid_date") or exp.get("date") or "",
        "created_at": exp.get("created_at"),
        "virtual": True,
    }


def purchase_invoice_leftover_payment(inv: dict, leftover: float) -> Optional[dict]:
    """Hesapsız (cariye işlenen) alış faturası ödemesini sanal satır olarak gösterir."""
    if not isinstance(inv, dict):
        return None
    if inv.get("invoice_type") == "sales":
        return None
    if inv.get("status") in ("draft", "cancelled"):
        return None
    amount = round(_num(leftover), 2)
    if amount <= 0.01:
        return None
    number = inv.get("invoice_number") or "Fatura"
    return {
        "_id": f"invoice-pay-virt-{inv.get('_id')}",
        "company_id": inv.get("company_id"),
        "account_id": None,
        "account_name": "Cari",
        "type": "outflow",
        "category": "Fatura Ödemesi",
        "amount": amount,
        "currency": inv.get("currency") or "TRY",
        "description": f"{number} nolu fatura ödemesi / {inv.get('contact_name') or ''}".strip(" /"),
        "contact_id": inv.get("contact_id"),
        "contact_name": inv.get("contact_name"),
        "source": "invoice",
        "related_invoice_id": inv.get("_id"),
        "date": inv.get("issue_date") or inv.get("paid_date") or "",
        "created_at": inv.get("created_at"),
        "virtual": True,
    }


def append_contact_outflows(
    payments: List[dict],
    *,
    contact_id: str,
    contact_name: Optional[str],
    expenses: Optional[Iterable[dict]] = None,
    expense_bank_txs: Optional[Dict[str, dict]] = None,
    invoices: Optional[Iterable[dict]] = None,
) -> List[dict]:
    """Masraf ve hesapsız alış ödemelerini mevcut cari hareket listesine ekler."""
    rows = list(payments or [])
    seen = {p.get("_id") for p in rows if isinstance(p, dict) and p.get("_id")}
    seen_expense = {p.get("expense_id") for p in rows if isinstance(p, dict) and p.get("expense_id")}
    txs = expense_bank_txs or {}

    for exp in expenses or []:
        if not isinstance(exp, dict):
            continue
        eid = exp.get("_id")
        if eid and eid in seen_expense:
            continue
        bt = txs.get(str(eid)) if eid else None
        if bt and bt.get("_id") in seen:
            continue
        row = expense_as_payment(exp, contact_id, contact_name, bt)
        if not row or row.get("_id") in seen:
            continue
        rows.append(row)
        seen.add(row.get("_id"))
        if eid:
            seen_expense.add(eid)

    linked = linked_invoice_paid(rows)
    for inv in invoices or []:
        if not isinstance(inv, dict):
            continue
        leftover = _num(inv.get("paid_amount")) - linked.get(str(inv.get("_id")), 0.0)
        row = purchase_invoice_leftover_payment(inv, leftover)
        if not row or row.get("_id") in seen:
            continue
        rows.append(row)
        seen.add(row.get("_id"))
    return rows
