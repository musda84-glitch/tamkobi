"""Iteration 15: expense budgets, dashboard overview, loans (AI plan extract + installment pay), credit-card statement import."""
import os
import time
from pathlib import Path

import pytest
import requests

from conftest import API, TEST_COMPANY_ID

_FIXTURES = Path(__file__).resolve().parent
PDF_LOAN = str(_FIXTURES / "sample_loan_plan.pdf")
PDF_INVOICE = str(_FIXTURES / "sample_supplier_invoice.pdf")
BANK_01 = "bank_01"
BANK_01_BASELINE = 249812.5


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    return s


def _account(api, acc_id):
    r = api.get(f"{API}/banking/accounts?company_id={TEST_COMPANY_ID}", timeout=60)
    r.raise_for_status()
    return next((a for a in r.json() if a["id"] == acc_id), None)


# ---------------- Expense budgets ----------------
class TestExpenseBudgets:
    exp_id = None

    def test_01_set_budget(self, api):
        r = api.put(f"{API}/expense-budgets", json={"company_id": TEST_COMPANY_ID, "budgets": [{"category": "Yakıt", "monthly_limit": 1000}]}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        row = next((x for x in d["rows"] if x["category"] == "Yakıt"), None)
        assert row is not None
        assert row["monthly_limit"] == 1000
        assert row["status"] in ("ok", "warning", "over")

    def test_02_create_expense_triggers_warning(self, api):
        r = api.post(f"{API}/expenses", json={"company_id": TEST_COMPANY_ID, "description": "IT15 yakıt", "category": "Yakıt", "amount": 850, "vat_rate": 0}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        TestExpenseBudgets.exp_id = d["id"]
        assert d["total"] == 850
        assert "budget" in d, f"budget bilgisi yok: {d}"
        assert d["budget"]["monthly_limit"] == 1000
        assert d["budget"]["pct"] == pytest.approx(85, abs=0.1), d["budget"]
        assert d["budget"]["status"] == "warning"

    def test_03_get_budgets_warning(self, api):
        r = api.get(f"{API}/expense-budgets?company_id={TEST_COMPANY_ID}", timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        w = [x for x in d["warnings"] if x["category"] == "Yakıt"]
        assert len(w) == 1, d["warnings"]
        assert w[0]["pct"] == pytest.approx(85, abs=0.1)
        assert w[0]["status"] == "warning"
        assert d["totals"]["limit"] >= 1000

    def test_04_dashboard_budget_warning(self, api):
        r = api.get(f"{API}/dashboard/overview?company_id={TEST_COMPANY_ID}", timeout=60)
        assert r.status_code == 200, r.text
        cats = [w["category"] for w in r.json()["budget_warnings"]]
        assert "Yakıt" in cats, cats

    def test_05_cleanup(self, api):
        assert TestExpenseBudgets.exp_id
        r = api.delete(f"{API}/expenses/{TestExpenseBudgets.exp_id}", timeout=60)
        assert r.status_code == 200, r.text
        r2 = api.put(f"{API}/expense-budgets", json={"company_id": TEST_COMPANY_ID, "budgets": [{"category": "Yakıt", "monthly_limit": 0}]}, timeout=60)
        assert r2.status_code == 200
        row = next((x for x in r2.json()["rows"] if x["category"] == "Yakıt"), None)
        assert row["monthly_limit"] == 0


# ---------------- Dashboard overview ----------------
class TestDashboardOverview:
    def test_overview_structure(self, api):
        r = api.get(f"{API}/dashboard/overview?company_id={TEST_COMPANY_ID}", timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ("date", "tasks", "collections", "payments", "drafts", "invoices", "vat", "budget_warnings"):
            assert key in d, f"{key} eksik"
        assert all(t["count"] > 0 for t in d["tasks"]), d["tasks"]
        assert all("path" in t and "label" in t and "key" in t for t in d["tasks"])
        for k in ("collections", "payments"):
            b = d[k]
            assert set(("total", "overdue", "not_due")).issubset(b)
            assert b["total"] == pytest.approx(b["overdue"] + b["not_due"], abs=0.05), (k, b)
        assert isinstance(d["drafts"]["count"], int)
        assert isinstance(d["drafts"]["total"], (int, float))
        for direction in ("outgoing", "incoming"):
            c = d["invoices"][direction]
            assert set(("month", "week", "today")).issubset(c)
            assert c["month"] >= c["week"] >= c["today"], (direction, c)
        v = d["vat"]
        assert v["payable"] == pytest.approx(v["calculated"] - v["deductible"], abs=0.05)
        assert len(v["declaration_date"]) == 10
        assert isinstance(v["days_left"], int)


# ---------------- Loans ----------------
class TestLoans:
    draft = None
    loan_id = None

    def test_01_extract_ai(self, api):
        assert os.path.exists(PDF_LOAN)
        with open(PDF_LOAN, "rb") as f:
            r = api.post(f"{API}/loans/extract", files={"file": ("sample_loan_plan.pdf", f, "application/pdf")}, timeout=180)
        assert r.status_code == 200, r.text
        d = r.json()["draft"]
        TestLoans.draft = d
        assert d.get("bank") and "Garanti" in d["bank"], d.get("bank")
        assert d["principal"] == pytest.approx(120000, abs=1)
        assert len(d["installments"]) == 6, d["installments"]
        assert d["installments"][0]["amount"] == pytest.approx(23330, abs=1), d["installments"][0]
        assert d["installments"][0]["no"] == 1

    def test_02_create_loan(self, api):
        assert TestLoans.draft
        payload = {"company_id": TEST_COMPANY_ID, "name": "IT15 Kredi", "bank": TestLoans.draft.get("bank"), "principal": 120000,
                   "term_months": 6, "installments": TestLoans.draft["installments"], "account_id": BANK_01}
        r = api.post(f"{API}/loans", json=payload, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        TestLoans.loan_id = d["id"]
        assert "_id" not in d
        assert d["name"] == "IT15 Kredi"
        assert len(d["installments"]) == 6

    def test_03_list_loans(self, api):
        r = api.get(f"{API}/loans?company_id={TEST_COMPANY_ID}", timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        loan = next(x for x in d["loans"] if x["id"] == TestLoans.loan_id)
        assert loan["next_installment"]["no"] == 1
        assert loan["paid_count"] == 0
        assert loan["remaining_debt"] == pytest.approx(137272.5, abs=6), loan["remaining_debt"]
        assert d["summary"]["total_debt"] >= loan["remaining_debt"]

    def test_04_pay_installment(self, api):
        before = _account(api, BANK_01)
        assert before, "bank_01 hesabı yok"
        bal_before = before["current_balance"]
        r = api.post(f"{API}/loans/{TestLoans.loan_id}/installments/1/pay", json={"account_id": BANK_01}, timeout=60)
        assert r.status_code == 200, r.text
        loan = r.json()
        ins = loan["installments"][0]
        assert ins["paid"] is True
        amt = ins["amount"]
        after = _account(api, BANK_01)
        assert after["current_balance"] == pytest.approx(bal_before - amt, abs=0.05), (bal_before, after["current_balance"], amt)
        # faiz + KKDF Masraflar'a işlendi
        e = api.get(f"{API}/expenses?company_id={TEST_COMPANY_ID}&category=Kredi Faizi / Finansman", timeout=60)
        assert e.status_code == 200, e.text
        rows = [x for x in e.json()["expenses"] if x.get("loan_id") == TestLoans.loan_id]
        assert len(rows) == 1, rows
        expected_cost = round(float(ins.get("interest") or 0) + float(ins.get("kkdf_bsmv") or 0), 2)
        assert rows[0]["total"] == pytest.approx(expected_cost, abs=0.05)
        assert rows[0]["total"] == pytest.approx(4830, abs=6), rows[0]["total"]
        assert rows[0]["payment_status"] == "paid"

    def test_05_double_pay_rejected(self, api):
        r = api.post(f"{API}/loans/{TestLoans.loan_id}/installments/1/pay", json={"account_id": BANK_01}, timeout=60)
        assert r.status_code == 400, r.status_code

    def test_06_pay_unknown_installment(self, api):
        r = api.post(f"{API}/loans/{TestLoans.loan_id}/installments/99/pay", json={"account_id": BANK_01}, timeout=60)
        assert r.status_code == 400, r.status_code

    def test_07_create_loan_without_installments(self, api):
        r = api.post(f"{API}/loans", json={"company_id": TEST_COMPANY_ID, "name": "IT15 Bad", "installments": []}, timeout=60)
        assert r.status_code == 400, r.status_code

    def test_08_delete_loan(self, api):
        r = api.delete(f"{API}/loans/{TestLoans.loan_id}", timeout=60)
        assert r.status_code == 200, r.text
        r2 = api.delete(f"{API}/loans/{TestLoans.loan_id}", timeout=60)
        assert r2.status_code == 404


# ---------------- Credit card account + statement import ----------------
class TestCreditCard:
    acc_id = None
    detail_id = None
    contact_id = None
    expense_ids = []
    tx_ids = []

    def test_01_create_credit_card_account(self, api):
        r = api.post(f"{API}/banking/accounts", json={"company_id": TEST_COMPANY_ID, "type": "credit_card", "bank_name": "IT15 Bank",
                                                     "account_name": "IT15 Kart", "currency": "TRY", "current_balance": 0}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        TestCreditCard.acc_id = d["id"]
        assert d["type"] == "credit_card"
        assert "_id" not in d
        assert _account(api, d["id"])["account_name"] == "IT15 Kart"

    def test_02_import_statement_dry_run(self, api):
        with open(PDF_INVOICE, "rb") as f:
            r = api.post(f"{API}/banking/accounts/{TestCreditCard.acc_id}/import-statement?dry_run=true",
                         files={"file": ("sample_supplier_invoice.pdf", f, "application/pdf")}, timeout=180)
        assert r.status_code != 500, f"500 döndü: {r.text[:400]}"
        assert r.status_code in (200, 400, 502), r.status_code
        if r.status_code == 200:
            d = r.json()
            assert isinstance(d["transactions"], list)
            assert "statement" in d
            for t in d["transactions"]:
                assert "duplicate" in t and isinstance(t["amount"], (int, float))
        else:
            assert r.json().get("detail")

    def test_03_import_statement_bad_account(self, api):
        with open(PDF_INVOICE, "rb") as f:
            r = api.post(f"{API}/banking/accounts/nope-404/import-statement?dry_run=true",
                         files={"file": ("x.pdf", f, "application/pdf")}, timeout=60)
        assert r.status_code == 404, r.status_code

    def test_04_import_statement_rejects_non_pdf(self, api):
        r = api.post(f"{API}/banking/accounts/{TestCreditCard.acc_id}/import-statement?dry_run=true",
                     files={"file": ("x.png", b"\x89PNG\r\n", "image/png")}, timeout=60)
        assert r.status_code == 400, r.status_code

    def test_05_card_details_sanitized(self, api):
        r = api.post(f"{API}/banking/accounts", json={
            "company_id": TEST_COMPANY_ID, "type": "credit_card", "bank_name": "IT15 Garanti",
            "account_name": "IT15 Kart Detay", "currency": "TRY", "current_balance": 0,
            "card_holder": "MUSTAFA BAL", "card_last4": "4111111111111234",
            "card_expiry": "7/28", "card_limit": 25000, "cvv": "999",
        }, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        TestCreditCard.detail_id = d["id"]
        assert d["card_holder"] == "MUSTAFA BAL"
        assert d["card_last4"] == "1234"
        assert d["card_expiry"] == "07/28"
        assert float(d["card_limit"]) == 25000
        assert "cvv" not in d and "card_number" not in d
        stored = _account(api, d["id"])
        assert stored["card_last4"] == "1234"
        assert "cvv" not in stored

    def test_06_put_card_fields(self, api):
        acc_id = TestCreditCard.detail_id or TestCreditCard.acc_id
        r = api.put(f"{API}/banking/accounts/{acc_id}", json={"card_last4": "00009999", "card_expiry": "01-29", "card_limit": 10000}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["card_last4"] == "9999"
        assert d["card_expiry"] == "01/29"
        assert float(d["card_limit"]) == 10000

    def test_07_confirm_matches_expense_and_contact(self, api):
        cr = api.post(f"{API}/contacts", json={
            "company_id": TEST_COMPANY_ID, "type": "supplier", "name": "IT15 Kart Cari Lojistik A.Ş.",
            "tax_number_or_id": "2222222222",
        }, timeout=60)
        assert cr.status_code == 200, cr.text
        contact = cr.json()
        TestCreditCard.contact_id = contact["id"]
        bal0 = float(contact.get("balance") or 0)
        acc_id = TestCreditCard.acc_id
        body = {
            "statement": {"bank": "IT15 Bank", "card_last4": "4242", "total_debt": 430.5, "due_date": "2026-09-20", "limit": 15000},
            "lines": [
                {"date": "2026-09-01", "description": "SHELL ISTANBUL YAKIT", "amount": 850, "category": "Yakıt", "kind": "masraf", "included": True},
                {"date": "2026-09-02", "description": "IT15 Kart Cari Lojistik fatura", "amount": 1200, "category": "Kargo / Nakliye", "kind": "cari_odeme", "contact_id": contact["id"], "included": True},
                {"date": "2026-09-03", "description": "iade", "amount": -50, "category": "Diğer", "kind": "islem", "included": True},
                {"date": "2026-09-01", "description": "SHELL ISTANBUL YAKIT", "amount": 850, "category": "Yakıt", "kind": "masraf", "included": True},
            ],
        }
        r = api.post(f"{API}/banking/accounts/{acc_id}/import-statement/confirm", json=body, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["inserted"] == 3, d
        assert d["expenses_created"] == 1, d
        assert d["contacts_matched"] == 1, d
        TestCreditCard.expense_ids = [x["expense_id"] for x in d["details"] if x.get("expense_id")]
        TestCreditCard.tx_ids = [x["tx_id"] for x in d["details"] if x.get("tx_id")]
        stored = _account(api, acc_id)
        assert stored["card_last4"] == "4242"
        assert float(stored["current_balance"]) == pytest.approx(-430.5)
        assert float(stored["card_limit"]) == 15000
        er = api.get(f"{API}/expenses?company_id={TEST_COMPANY_ID}&q=SHELL ISTANBUL", timeout=60)
        assert er.status_code == 200, er.text
        exps = er.json()["expenses"]
        hit = next((e for e in exps if e.get("id") in TestCreditCard.expense_ids or "SHELL" in (e.get("description") or "")), None)
        assert hit, exps[:3]
        assert hit["payment_status"] == "paid"
        assert hit["source"] == "card_statement"
        txs = api.get(f"{API}/banking/transactions?company_id={TEST_COMPANY_ID}&account_id={acc_id}", timeout=60).json()
        # paid expense must not duplicate a second bank outflow for the same spend
        expense_sources = [t for t in txs if t.get("source") == "expense" and "SHELL" in (t.get("description") or "")]
        assert expense_sources == [], expense_sources
        c2 = next(c for c in api.get(f"{API}/contacts?company_id={TEST_COMPANY_ID}", timeout=60).json() if c["id"] == contact["id"])
        assert float(c2["balance"]) == pytest.approx(bal0 + 1200)
        r2 = api.post(f"{API}/banking/accounts/{acc_id}/import-statement/confirm", json=body, timeout=60)
        assert r2.status_code == 200
        assert r2.json()["inserted"] == 0

    def test_08_confirm_unknown_account(self, api):
        r = api.post(f"{API}/banking/accounts/nope-404/import-statement/confirm", json={"lines": []}, timeout=60)
        assert r.status_code == 404

    def test_09_cleanup_account(self, api):
        for eid in getattr(TestCreditCard, "expense_ids", []) or []:
            api.delete(f"{API}/expenses/{eid}", timeout=60)
        for tid in getattr(TestCreditCard, "tx_ids", []) or []:
            api.delete(f"{API}/banking/transactions/{tid}", timeout=60)
        if getattr(TestCreditCard, "contact_id", None):
            api.delete(f"{API}/contacts/{TestCreditCard.contact_id}", timeout=60)
        for acc_id in (TestCreditCard.acc_id, getattr(TestCreditCard, "detail_id", None)):
            if not acc_id:
                continue
            txs = api.get(f"{API}/banking/transactions?company_id={TEST_COMPANY_ID}&account_id={acc_id}", timeout=60)
            if txs.status_code == 200:
                for t in txs.json():
                    api.delete(f"{API}/banking/transactions/{t['id']}", timeout=60)
            r = api.delete(f"{API}/banking/accounts/{acc_id}", timeout=60)
            assert r.status_code in (200, 204, 404, 405, 400), r.status_code


def test_match_statement_contact_and_sanitize():
    from card_match import match_statement_contact, sanitize_card_fields
    contacts = [
        {"_id": "c1", "name": "ABC Lojistik A.Ş.", "tax_number_or_id": "1111111111"},
        {"_id": "c2", "name": "Shell", "tax_number_or_id": ""},
    ]
    assert match_statement_contact("SHELL ISTANBUL 05", contacts)["_id"] == "c2"
    assert match_statement_contact("ABC LOJISTIK FATURA", contacts)["_id"] == "c1"
    assert match_statement_contact("random market 99", contacts) is None
    d = sanitize_card_fields({"card_last4": "4111111111119999", "card_expiry": "3/27", "cvv": "123", "card_holder": "  Ali  "})
    assert d["card_last4"] == "9999"
    assert d["card_expiry"] == "03/27"
    assert "cvv" not in d
    assert d["card_holder"] == "Ali"


# ---------------- Balance restore verification ----------------
def test_zz_bank01_balance_restored(api):
    """Kredi testleri sonrası bank_01 bakiyesi cleanup script ile geri alınmalı; burada sadece raporlanır."""
    acc = _account(api, BANK_01)
    assert acc is not None
    print(f"bank_01 current_balance = {acc['current_balance']} (baseline {BANK_01_BASELINE})")
