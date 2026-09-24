"""Iteration 14 backend tests: Expenses module, Dispatches (irsaliye), partner tx edit/delete, advance/expense bonuses."""
import os
import sys

import pytest
import requests

sys.path.insert(0, os.path.dirname(__file__))
from conftest import API, TEST_COMPANY_ID  # noqa: E402

TIMEOUT = 60


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def first_account(client):
    r = client.get(f"{API}/banking/accounts", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    accts = r.json()
    assert isinstance(accts, list) and accts, "No bank accounts found"
    return accts[0]


def _balance(client, acc_id):
    r = client.get(f"{API}/banking/accounts", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
    assert r.status_code == 200
    for a in r.json():
        if a["id"] == acc_id:
            return round(float(a.get("current_balance") or 0), 2)
    raise AssertionError("account missing")


# ---------------- Module: expenses (masraflar) ----------------
class TestExpenses:
    def test_default_categories(self, client):
        r = client.get(f"{API}/expenses/categories", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        cats = r.json()
        defaults = [c for c in cats if c["is_default"]]
        assert len(defaults) == 15, f"expected 15 defaults, got {len(defaults)}"
        assert "Kira" in [c["name"] for c in defaults]

    def test_add_custom_category(self, client):
        r = client.post(f"{API}/expenses/categories", json={"company_id": TEST_COMPANY_ID, "name": "IT14 Kat"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "IT14 Kat"
        r2 = client.get(f"{API}/expenses/categories", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
        names = [c["name"] for c in r2.json()]
        assert "IT14 Kat" in names
        assert {"name": "IT14 Kat", "is_default": False} in r2.json()

    def test_expense_full_lifecycle(self, client, first_account):
        acc_id = first_account["id"]
        start = _balance(client, acc_id)

        # CREATE paid + recurring
        r = client.post(f"{API}/expenses", json={"company_id": TEST_COMPANY_ID, "description": "IT14 kira", "category": "Kira",
                                                 "amount": 10000, "vat_rate": 20, "account_id": acc_id, "is_recurring": True}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        exp = r.json()
        eid = exp["id"]
        assert exp["expense_number"].startswith("MSR-"), exp["expense_number"]
        assert exp["total"] == 12000
        assert exp["vat_amount"] == 2000
        assert exp["payment_status"] == "paid"
        assert exp.get("next_date"), "next_date missing for recurring expense"
        assert exp.get("account_name")
        assert _balance(client, acc_id) == round(start - 12000, 2)

        # LIST + filter/summary
        r = client.get(f"{API}/expenses", params={"company_id": TEST_COMPANY_ID, "category": "Kira"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert any(e["id"] == eid for e in data["expenses"])
        assert all(e["category"] == "Kira" for e in data["expenses"])
        assert data["summary"]["total"] >= 12000
        assert any(c["category"] == "Kira" for c in data["summary"]["by_category"])
        assert data["summary"]["recurring_count"] >= 1

        # UPDATE amount -> balance adjusts
        r = client.put(f"{API}/expenses/{eid}", json={"amount": 5000}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        upd = r.json()
        assert upd["total"] == 6000, upd
        assert upd["payment_status"] == "paid"
        assert _balance(client, acc_id) == round(start - 6000, 2)

        # UNPAY -> balance restored
        r = client.post(f"{API}/expenses/{eid}/unpay", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["payment_status"] == "unpaid"
        assert r.json()["account_id"] is None
        assert _balance(client, acc_id) == start

        # PAY again
        r = client.post(f"{API}/expenses/{eid}/pay", json={"account_id": acc_id}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["payment_status"] == "paid"
        assert _balance(client, acc_id) == round(start - 6000, 2)

        # double pay -> 400
        r = client.post(f"{API}/expenses/{eid}/pay", json={"account_id": acc_id}, timeout=TIMEOUT)
        assert r.status_code == 400, r.text

        # VAT included expense (unpaid)
        r = client.post(f"{API}/expenses", json={"company_id": TEST_COMPANY_ID, "description": "IT14 vat dahil", "category": "Yakıt",
                                                 "amount": 1200, "vat_rate": 20, "vat_included": True}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        e2 = r.json()
        assert e2["amount"] == 1000 and e2["vat_amount"] == 200 and e2["total"] == 1200, e2
        assert e2["payment_status"] == "unpaid"

        # recurring runner
        r = client.post(f"{API}/expenses/run-recurring", json={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["created"] == [], "next_date is future; nothing should be created"

        # profit report includes expenses
        r = client.get(f"{API}/reports/profit", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        totals = r.json()["totals"]
        assert "expenses" in totals, totals.keys()
        assert "net_profit" in totals, totals.keys()

        # validation
        assert client.post(f"{API}/expenses", json={"company_id": TEST_COMPANY_ID, "description": "  ", "amount": 10}, timeout=TIMEOUT).status_code == 400
        assert client.post(f"{API}/expenses", json={"company_id": TEST_COMPANY_ID, "description": "IT14 zero", "amount": 0}, timeout=TIMEOUT).status_code == 400

        # DELETE both -> balance back to start
        for x in (eid, e2["id"]):
            d = client.delete(f"{API}/expenses/{x}", timeout=TIMEOUT)
            assert d.status_code == 200, d.text
        assert _balance(client, acc_id) == start
        assert client.delete(f"{API}/expenses/{eid}", timeout=TIMEOUT).status_code == 404


# ---------------- Module: dispatches (irsaliye) ----------------
class TestDispatch:
    def test_dispatch_flow(self, client):
        r = client.get(f"{API}/invoices", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        invs = r.json()
        assert all(i.get("invoice_type") != "dispatch" for i in invs), "default list leaks dispatches"
        rd = client.get(f"{API}/invoices", params={"company_id": TEST_COMPANY_ID, "type": "dispatch"}, timeout=TIMEOUT)
        assert rd.status_code == 200
        assert all(i.get("invoice_type") == "dispatch" for i in rd.json())

        sales = [i for i in invs if i.get("invoice_type") == "sales" and i.get("items") and not i.get("dispatch_id")]
        assert sales, "no sales invoice available"
        src = sales[0]

        r = client.post(f"{API}/invoices/{src['id']}/create-dispatch", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "success", body
        disp = body["dispatch"]
        assert disp["invoice_number"].startswith("IRS-"), disp["invoice_number"]
        assert disp["invoice_type"] == "dispatch"
        assert round(disp["grand_total"], 2) == round(src.get("subtotal", 0), 2)
        assert disp["vat_total"] == 0

        again = client.post(f"{API}/invoices/{src['id']}/create-dispatch", timeout=TIMEOUT)
        assert again.status_code == 200 and again.json()["status"] == "exists", again.text

        c = client.post(f"{API}/invoices/{disp['id']}/convert-to-invoice", json={}, timeout=TIMEOUT)
        assert c.status_code == 200, c.text
        cb = c.json()
        assert cb["status"] == "success", cb
        new_inv = cb["invoice"]
        assert new_inv["invoice_number"].startswith("TA"), new_inv["invoice_number"]
        assert new_inv["invoice_type"] == "sales"
        assert new_inv["status"] == "draft"
        assert new_inv.get("dispatch_number") == disp["invoice_number"]

        c2 = client.post(f"{API}/invoices/{disp['id']}/convert-to-invoice", json={}, timeout=TIMEOUT)
        assert c2.status_code == 200 and c2.json()["status"] == "exists", c2.text

        # dispatch on a dispatch -> 400
        bad = client.post(f"{API}/invoices/{disp['id']}/create-dispatch", timeout=TIMEOUT)
        assert bad.status_code == 400, bad.text

        # cleanup (no DELETE /api/invoices endpoint -> direct mongo cleanup)
        import subprocess
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "cleanup_iteration14.py"),
                        "--invoice-ids", src["id"], "--delete-ids", new_inv["id"], disp["id"]], check=True)
        chk = client.get(f"{API}/invoices", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT).json()
        srcs = [i for i in chk if i["id"] == src["id"]]
        assert srcs and not srcs[0].get("dispatch_id"), "source invoice dispatch_id not cleaned"


# ---------------- Module: partner transactions edit/delete ----------------
class TestPartnerTx:
    def test_partner_tx_edit_delete(self, client, first_account):
        acc_id = first_account["id"]
        r = client.get(f"{API}/banking/partners", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        partners = r.json()
        partners = partners["partners"] if isinstance(partners, dict) else partners
        assert partners, "no partners"
        p = partners[0]
        p_start = round(float(p.get("balance") or 0), 2)
        acc_start = _balance(client, acc_id)

        r = client.post(f"{API}/banking/partners/transactions", json={"partner_id": p["id"], "type": "capital_in", "amount": 1000,
                                                                     "account_id": acc_id, "description": "IT14"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["amount"] == 1000
        assert _balance(client, acc_id) == round(acc_start + 1000, 2)

        r = client.put(f"{API}/banking/partners/transactions/{tx['id']}", json={"amount": 1500, "description": "IT14 edit"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        upd = r.json()
        assert upd["amount"] == 1500 and upd["description"] == "IT14 edit", upd
        assert _balance(client, acc_id) == round(acc_start + 1500, 2)
        pl = client.get(f"{API}/banking/partners", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT).json()
        pl = pl["partners"] if isinstance(pl, dict) else pl
        cur = [x for x in pl if x["id"] == p["id"]][0]
        assert round(float(cur["balance"]), 2) == round(p_start + 1500, 2), cur

        assert client.put(f"{API}/banking/partners/transactions/{tx['id']}", json={"amount": 0}, timeout=TIMEOUT).status_code == 400

        d = client.delete(f"{API}/banking/partners/transactions/{tx['id']}", timeout=TIMEOUT)
        assert d.status_code == 200, d.text
        assert _balance(client, acc_id) == acc_start
        pl = client.get(f"{API}/banking/partners", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT).json()
        pl = pl["partners"] if isinstance(pl, dict) else pl
        cur = [x for x in pl if x["id"] == p["id"]][0]
        assert round(float(cur["balance"]), 2) == p_start
        assert client.delete(f"{API}/banking/partners/transactions/{tx['id']}", timeout=TIMEOUT).status_code == 404

    def test_profit_share_edit_blocked(self, client):
        r = client.get(f"{API}/banking/partners/transactions", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
        if r.status_code != 200:
            pytest.skip(f"partner transactions list unavailable: {r.status_code}")
        rows = r.json()
        rows = rows.get("transactions", rows) if isinstance(rows, dict) else rows
        ps = [t for t in rows if t.get("type") == "profit_share"]
        if not ps:
            pytest.skip("no profit_share transaction to test")
        r = client.put(f"{API}/banking/partners/transactions/{ps[0]['id']}", json={"amount": 5}, timeout=TIMEOUT)
        assert r.status_code == 400, r.text


# ---------------- Module: personnel advance/expense quick pay ----------------
class TestBonusTypes:
    def test_advance_and_expense(self, client, first_account):
        acc_id = first_account["id"]
        start = _balance(client, acc_id)
        r = client.get(f"{API}/personnel/employees", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        emps = r.json()
        emps = emps.get("employees", emps) if isinstance(emps, dict) else emps
        assert emps, "no employees"
        emp_id = emps[0]["id"]

        created = []
        for t, label in (("expense", "Masraf Ödemesi"), ("advance", "Avans")):
            r = client.post(f"{API}/personnel/bonuses", json={"employee_id": emp_id, "type": t, "amount": 250,
                                                              "account_id": acc_id, "period": "2026-09", "note": "IT14"}, timeout=TIMEOUT)
            assert r.status_code == 200, r.text
            b = r.json()
            assert b["type"] == t and b["type_label"] == label, b
            assert b["status"] == "paid" and b["is_official"] is False
            created.append(b["id"])
        assert _balance(client, acc_id) == round(start - 500, 2)

        bad = client.post(f"{API}/personnel/bonuses", json={"employee_id": emp_id, "type": "xyz", "amount": 100}, timeout=TIMEOUT)
        assert bad.status_code == 400, bad.text

        for bid in created:
            assert client.delete(f"{API}/personnel/bonuses/{bid}", timeout=TIMEOUT).status_code == 200
        assert _balance(client, acc_id) == start
