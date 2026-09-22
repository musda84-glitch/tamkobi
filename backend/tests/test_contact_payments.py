import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from contact_payments import append_contact_outflows, expense_as_payment, purchase_invoice_leftover_payment


def test_expense_bank_tx_keeps_id_and_stamps_contact():
    exp = {"_id": "e1", "contact_name": "Tedarikçi", "payment_status": "paid", "total": 40}
    bt = {"_id": "tx1", "amount": 40, "type": "outflow", "source": "expense", "expense_id": "e1"}
    row = expense_as_payment(exp, "c1", "Tedarikçi A.Ş.", bt)
    assert row["_id"] == "tx1"
    assert row["contact_id"] == "c1"
    assert row["contact_name"] == "Tedarikçi A.Ş."
    assert row["expense_id"] == "e1"


def test_paid_expense_without_bank_tx_becomes_virtual_outflow():
    exp = {
        "_id": "e2",
        "company_id": "co",
        "expense_number": "MSR-2026-0001",
        "description": "Kira",
        "category": "Kira",
        "payment_status": "paid",
        "total": 12.5,
        "account_name": "Kasa",
        "paid_date": "2026-09-22",
    }
    row = expense_as_payment(exp, "c9", "Acme")
    assert row["type"] == "outflow"
    assert row["virtual"] is True
    assert row["amount"] == 12.5
    assert row["description"] == "MSR-2026-0001 Kira"
    assert row["_id"] == "expense-virt-e2"


def test_unpaid_expense_is_skipped():
    assert expense_as_payment({"_id": "e3", "payment_status": "unpaid", "total": 9}, "c1") is None


def test_purchase_invoice_leftover_is_outflow():
    inv = {
        "_id": "i1",
        "invoice_type": "purchase",
        "status": "approved",
        "invoice_number": "AF-9",
        "contact_id": "c1",
        "contact_name": "Tedarikçi",
        "paid_amount": 80,
        "issue_date": "2026-09-20",
    }
    row = purchase_invoice_leftover_payment(inv, 80)
    assert row["type"] == "outflow"
    assert row["category"] == "Fatura Ödemesi"
    assert row["amount"] == 80
    assert row["account_name"] == "Cari"
    assert "AF-9" in row["description"]


def test_sales_invoice_leftover_is_not_treated_as_cari_odeme():
    assert purchase_invoice_leftover_payment({"_id": "s1", "invoice_type": "sales", "paid_amount": 10}, 10) is None


def test_append_skips_duplicates_and_adds_purchase_leftover():
    existing = [{"_id": "tx1", "expense_id": "e1", "amount": 5, "related_invoice_id": None}]
    expenses = [
        {"_id": "e1", "payment_status": "paid", "total": 5},
        {"_id": "e2", "payment_status": "paid", "total": 20, "description": "Hırdavat"},
    ]
    invoices = [
        {"_id": "i1", "invoice_type": "purchase", "status": "approved", "invoice_number": "AF-1", "paid_amount": 30},
        {"_id": "i2", "invoice_type": "purchase", "status": "approved", "invoice_number": "AF-2", "paid_amount": 10, "related": True},
    ]
    already = [{"_id": "tx-inv", "related_invoice_id": "i2", "amount": 10, "type": "outflow"}]
    rows = append_contact_outflows(
        existing + already,
        contact_id="c1",
        contact_name="Acme",
        expenses=expenses,
        invoices=invoices,
    )
    ids = [r["_id"] for r in rows]
    assert ids.count("tx1") == 1
    assert "expense-virt-e2" in ids
    assert "invoice-pay-virt-i1" in ids
    assert "invoice-pay-virt-i2" not in ids
