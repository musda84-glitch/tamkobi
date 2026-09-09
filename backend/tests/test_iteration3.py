"""Iteration 3 backend tests: contact overview, barcode stock counts,
personnel (leaves / salary calc / unofficial bonuses), product b2b+track flags.
"""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"
TIMEOUT = 40


@pytest.fixture(scope="session")
def s():
    return requests.Session()


def get_product(s, pid="prod_01"):
    r = s.get(f"{BASE}/products", timeout=TIMEOUT)
    assert r.status_code == 200
    return next(p for p in r.json() if p["id"] == pid)


# ---------------- CONTACT OVERVIEW ----------------
class TestContactOverview:
    def test_overview_structure(self, s):
        r = s.get(f"{BASE}/contacts/cnt_01/overview", timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        for key in ("contact", "summary", "invoices", "payments", "orders", "communications", "quotes", "surveys", "projects"):
            assert key in d, f"missing {key}"
        assert isinstance(d["projects"], list)
        assert d["contact"]["id"] == "cnt_01"
        summary = d["summary"]
        for key in ("invoice_count", "draft_count", "total_invoiced", "total_paid",
                    "open_amount", "order_count", "overdue_count"):
            assert key in summary, f"summary missing {key}"
            assert isinstance(summary[key], (int, float)), key
        assert summary["open_amount"] == pytest.approx(summary["total_invoiced"] - summary["total_paid"], abs=0.01)
        assert summary["invoice_count"] == len(d["invoices"])
        for coll in ("invoices", "payments", "orders", "communications"):
            for item in d[coll]:
                assert item.get("id"), f"{coll} item without id: {item}"

    def test_overview_404(self, s):
        r = s.get(f"{BASE}/contacts/cnt_does_not_exist/overview", timeout=TIMEOUT)
        assert r.status_code == 404


# ---------------- BARCODE STOCK COUNT ----------------
class TestStockCount:
    BARCODE = "8680001234013"

    @pytest.fixture(scope="class")
    def count_id(self, s):
        r = s.post(f"{BASE}/warehouses/stock-counts",
                   json={"company_id": COMPANY, "name": "TEST_Sayim_it3", "preload_all": True}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d.get("id")
        assert d["status"] == "open"
        assert len(d["items"]) > 0, "preload_all returned no items"
        yield d["id"]
        s.delete(f"{BASE}/warehouses/stock-counts/{d['id']}", timeout=TIMEOUT)

    def test_preload_expands_variants(self, s, count_id):
        d = s.get(f"{BASE}/warehouses/stock-counts/{count_id}", timeout=TIMEOUT).json()
        variant_items = [i for i in d["items"] if i["product_id"] == "prod_01" and i.get("variant_id")]
        assert len(variant_items) >= 2, f"variants not expanded: {variant_items}"
        v2 = next(i for i in variant_items if i["variant_id"] == "v2")
        assert v2["barcode"] == self.BARCODE
        assert v2["expected"] == 60, f"expected baseline stock 60, got {v2['expected']}"

    def test_scan_increments_variant(self, s, count_id):
        r = s.post(f"{BASE}/warehouses/stock-counts/{count_id}/scan",
                   json={"barcode": self.BARCODE}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        item = r.json()["item"]
        assert item["product_id"] == "prod_01"
        assert item["variant_id"] == "v2"
        assert item["counted"] == 1
        assert item["scanned"] is True
        # persisted?
        d = s.get(f"{BASE}/warehouses/stock-counts/{count_id}", timeout=TIMEOUT).json()
        stored = next(i for i in d["items"] if i.get("variant_id") == "v2" and i["product_id"] == "prod_01")
        assert stored["counted"] == 1

    def test_scan_unknown_barcode_404(self, s, count_id):
        r = s.post(f"{BASE}/warehouses/stock-counts/{count_id}/scan",
                   json={"barcode": "0000000000000"}, timeout=TIMEOUT)
        assert r.status_code == 404, r.status_code

    def test_set_item_counted(self, s, count_id):
        r = s.put(f"{BASE}/warehouses/stock-counts/{count_id}/items",
                  json={"product_id": "prod_01", "variant_id": "v2", "counted": 57}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        stored = next(i for i in r.json()["items"] if i["product_id"] == "prod_01" and i.get("variant_id") == "v2")
        assert stored["counted"] == 57

    def test_complete_applies_stock(self, s, count_id):
        before = get_product(s)
        r = s.post(f"{BASE}/warehouses/stock-counts/{count_id}/complete",
                   json={"apply": True, "only_scanned": True}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        body = r.json()
        assert body["adjusted"] >= 1, body
        after = get_product(s)
        v2 = next(v for v in after["variants"] if v["variant_id"] == "v2")
        assert v2["stock"] == 57, f"variant stock not applied: {v2}"
        assert after["stock_quantity"] == sum(v.get("stock", 0) for v in after["variants"]), \
            f"stock_quantity != sum(variants): {after['stock_quantity']}"
        print("DEBUG before:", before["stock_quantity"], [(v["variant_id"], v["stock"]) for v in before["variants"]],
              "after:", after["stock_quantity"], [(v["variant_id"], v["stock"]) for v in after["variants"]])
        assert before["stock_quantity"] != after["stock_quantity"], "stock_quantity unchanged after applying count"
        d = s.get(f"{BASE}/warehouses/stock-counts/{count_id}", timeout=TIMEOUT).json()
        assert d["status"] == "completed"
        # RESTORE variant v2 stock to 60
        variants = after["variants"]
        for v in variants:
            if v["variant_id"] == "v2":
                v["stock"] = 60
        rr = s.put(f"{BASE}/products/prod_01/variants",
                   json={"variants": variants, "variant_options": after.get("variant_options") or []}, timeout=TIMEOUT)
        assert rr.status_code == 200, f"restore failed: {rr.text[:300]}"
        restored = get_product(s)
        assert next(v for v in restored["variants"] if v["variant_id"] == "v2")["stock"] == 60

    def test_scan_completed_count_400(self, s, count_id):
        r = s.post(f"{BASE}/warehouses/stock-counts/{count_id}/scan",
                   json={"barcode": self.BARCODE}, timeout=TIMEOUT)
        assert r.status_code == 400, r.status_code

    def test_list_contains_count(self, s, count_id):
        r = s.get(f"{BASE}/warehouses/stock-counts", timeout=TIMEOUT)
        assert r.status_code == 200
        rows = r.json()
        assert any(c["id"] == count_id for c in rows)

    def test_delete_count(self, s):
        c = s.post(f"{BASE}/warehouses/stock-counts",
                   json={"company_id": COMPANY, "name": "TEST_del_it3"}, timeout=TIMEOUT).json()
        r = s.delete(f"{BASE}/warehouses/stock-counts/{c['id']}", timeout=TIMEOUT)
        assert r.status_code == 200
        assert s.get(f"{BASE}/warehouses/stock-counts/{c['id']}", timeout=TIMEOUT).status_code == 404


# ---------------- PERSONNEL: LEAVES ----------------
class TestLeaves:
    created = []

    def emp(self, s, eid="emp_01"):
        r = s.get(f"{BASE}/personnel/employees", timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:300]
        return next(e for e in r.json() if e["id"] == eid)

    def test_create_leave_pending_with_days(self, s):
        r = s.post(f"{BASE}/personnel/leaves", json={"employee_id": "emp_01", "type": "annual",
                                                     "start_date": "2026-08-03", "end_date": "2026-08-05",
                                                     "reason": "TEST_it3"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        self.created.append(d["id"])
        assert d["status"] == "pending"
        assert d["days"] == 3, d["days"]
        assert d["employee_id"] == "emp_01"
        assert d["employee_name"]
        rows = s.get(f"{BASE}/personnel/leaves?employee_id=emp_01", timeout=TIMEOUT).json()
        assert any(x["id"] == d["id"] for x in rows)

    def test_create_leave_exceeding_balance_400(self, s):
        r = s.post(f"{BASE}/personnel/leaves", json={"employee_id": "emp_01", "type": "annual",
                                                     "start_date": "2026-09-01", "end_date": "2026-12-31"}, timeout=TIMEOUT)
        assert r.status_code == 400, r.status_code
        assert "izin" in r.json().get("detail", "").lower()

    def test_end_before_start_400(self, s):
        r = s.post(f"{BASE}/personnel/leaves", json={"employee_id": "emp_01", "type": "annual",
                                                     "start_date": "2026-09-10", "end_date": "2026-09-01"}, timeout=TIMEOUT)
        assert r.status_code == 400

    def test_unknown_employee_404(self, s):
        r = s.post(f"{BASE}/personnel/leaves", json={"employee_id": "emp_nope", "type": "annual",
                                                     "start_date": "2026-09-01", "end_date": "2026-09-02"}, timeout=TIMEOUT)
        assert r.status_code == 404

    def test_approve_increments_used_days(self, s):
        before = self.emp(s).get("used_leave_days", 0)
        d = s.post(f"{BASE}/personnel/leaves", json={"employee_id": "emp_01", "type": "annual",
                                                     "start_date": "2026-08-10", "end_date": "2026-08-11"}, timeout=TIMEOUT).json()
        self.created.append(d["id"])
        r = s.post(f"{BASE}/personnel/leaves/{d['id']}/decide", json={"status": "approved"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        assert r.json()["status"] == "approved"
        after = self.emp(s).get("used_leave_days", 0)
        assert after == before + 2, f"used_leave_days {before} -> {after}"
        # deciding twice
        r2 = s.post(f"{BASE}/personnel/leaves/{d['id']}/decide", json={"status": "approved"}, timeout=TIMEOUT)
        assert r2.status_code == 400
        # restore counter
        s.put(f"{BASE}/personnel/employees/emp_01", json={"used_leave_days": before}, timeout=TIMEOUT)

    def test_reject_does_not_increment(self, s):
        before = self.emp(s).get("used_leave_days", 0)
        d = s.post(f"{BASE}/personnel/leaves", json={"employee_id": "emp_01", "type": "annual",
                                                     "start_date": "2026-08-20", "end_date": "2026-08-21"}, timeout=TIMEOUT).json()
        self.created.append(d["id"])
        r = s.post(f"{BASE}/personnel/leaves/{d['id']}/decide", json={"status": "rejected"}, timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        assert self.emp(s).get("used_leave_days", 0) == before

    def test_invalid_decision_400(self, s):
        d = s.post(f"{BASE}/personnel/leaves", json={"employee_id": "emp_01", "type": "unpaid",
                                                     "start_date": "2026-08-25", "end_date": "2026-08-25"}, timeout=TIMEOUT).json()
        self.created.append(d["id"])
        r = s.post(f"{BASE}/personnel/leaves/{d['id']}/decide", json={"status": "maybe"}, timeout=TIMEOUT)
        assert r.status_code == 400


# ---------------- PERSONNEL: SALARY CALC ----------------
class TestSalaryCalc:
    def test_gross_mode(self, s):
        r = s.post(f"{BASE}/personnel/salary-calc", json={"mode": "gross", "amount": 50000}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["gross"] == 50000
        assert d["net"] < 50000
        assert d["sgk_employee"] == pytest.approx(7000, abs=0.5)
        assert d["unemployment_employee"] == pytest.approx(500, abs=0.5)
        assert d["total_employer_cost"] == pytest.approx(50000 * 1.175, abs=1)
        assert d["income_tax"] >= 0 and d["stamp_tax"] >= 0
        assert d["net"] == pytest.approx(d["gross"] - d["sgk_employee"] - d["unemployment_employee"]
                                         - d["income_tax"] - d["stamp_tax"], abs=0.05)

    def test_net_mode_roundtrip(self, s):
        r = s.post(f"{BASE}/personnel/salary-calc", json={"mode": "net", "amount": 40000}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["gross"] > 40000
        assert d["net"] == pytest.approx(40000, abs=1), d["net"]
        back = s.post(f"{BASE}/personnel/salary-calc", json={"mode": "gross", "amount": d["gross"]}, timeout=TIMEOUT).json()
        assert back["net"] == pytest.approx(40000, abs=1)

    def test_invalid_amount_400(self, s):
        for amt in (0, -5):
            r = s.post(f"{BASE}/personnel/salary-calc", json={"mode": "gross", "amount": amt}, timeout=TIMEOUT)
            assert r.status_code == 400, (amt, r.status_code)


# ---------------- PERSONNEL: BONUSES ----------------
class TestBonuses:
    ACC = "bank_03"

    def balance(self, s, acc_id=None):
        acc_id = acc_id or self.ACC
        r = s.get(f"{BASE}/banking/accounts", timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:300]
        return next(a for a in r.json() if a["id"] == acc_id)["current_balance"]

    def test_bonus_with_account_deducts_and_logs(self, s):
        before = self.balance(s)
        r = s.post(f"{BASE}/personnel/bonuses", json={"employee_id": "emp_01", "type": "bonus",
                                                      "amount": 2500, "account_id": self.ACC,
                                                      "note": "TEST_it3"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["status"] == "paid"
        assert d["is_official"] is False
        assert d["amount"] == 2500
        assert d["account_name"]
        assert self.balance(s) == pytest.approx(before - 2500, abs=0.01)
        txs = s.get(f"{BASE}/banking/transactions?account_id={self.ACC}", timeout=TIMEOUT).json()
        match = [t for t in txs if "Gayri Resmi" in (t.get("category") or "") and t.get("amount") == 2500]
        assert match, "bank_transaction with 'Gayri Resmi' category not created"
        assert match[0]["type"] == "outflow"
        # listed
        assert any(b["id"] == d["id"] for b in s.get(f"{BASE}/personnel/bonuses", timeout=TIMEOUT).json())
        # delete restores balance
        dr = s.delete(f"{BASE}/personnel/bonuses/{d['id']}", timeout=TIMEOUT)
        assert dr.status_code == 200
        assert self.balance(s) == pytest.approx(before, abs=0.01)
        assert not any(b["id"] == d["id"] for b in s.get(f"{BASE}/personnel/bonuses", timeout=TIMEOUT).json())

    def test_bonus_without_account_pending(self, s):
        before = self.balance(s)
        r = s.post(f"{BASE}/personnel/bonuses", json={"employee_id": "emp_01", "type": "second_salary",
                                                      "amount": 1000, "note": "TEST_it3"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["status"] == "pending"
        assert d["account_id"] in (None, "")
        assert self.balance(s) == pytest.approx(before, abs=0.01)
        s.delete(f"{BASE}/personnel/bonuses/{d['id']}", timeout=TIMEOUT)
        assert self.balance(s) == pytest.approx(before, abs=0.01), "delete of pending bonus wrongly changed balance"

    def test_bonus_invalid_amount_400(self, s):
        r = s.post(f"{BASE}/personnel/bonuses", json={"employee_id": "emp_01", "amount": 0}, timeout=TIMEOUT)
        assert r.status_code == 400

    def test_bonus_unknown_employee_404(self, s):
        r = s.post(f"{BASE}/personnel/bonuses", json={"employee_id": "emp_nope", "amount": 100}, timeout=TIMEOUT)
        assert r.status_code == 404

    def test_bonus_unknown_account_404(self, s):
        r = s.post(f"{BASE}/personnel/bonuses", json={"employee_id": "emp_01", "amount": 100,
                                                      "account_id": "bank_nope"}, timeout=TIMEOUT)
        assert r.status_code == 404


# ---------------- PRODUCT FLAGS ----------------
class TestProductFlags:
    def test_show_in_b2b_filter(self, s):
        r = s.put(f"{BASE}/products/prod_03", json={"show_in_b2b": False}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:400]
        assert r.json().get("show_in_b2b") is False
        b2b = s.get(f"{BASE}/products?b2b_only=true", timeout=TIMEOUT).json()
        assert not any(p["id"] == "prod_03" for p in b2b), "prod_03 still in b2b_only list"
        assert any(p["id"] == "prod_01" for p in b2b)
        # restore
        rr = s.put(f"{BASE}/products/prod_03", json={"show_in_b2b": True}, timeout=TIMEOUT)
        assert rr.status_code == 200
        b2b = s.get(f"{BASE}/products?b2b_only=true", timeout=TIMEOUT).json()
        assert any(p["id"] == "prod_03" for p in b2b)

    def test_track_stock_blocks_adjust(self, s):
        r = s.put(f"{BASE}/products/prod_03", json={"track_stock": False}, timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json().get("track_stock") is False
        adj = s.post(f"{BASE}/products/quick-stock-adjust",
                     json={"product_id": "prod_03", "quantity_change": 1, "reason": "TEST_it3"}, timeout=TIMEOUT)
        assert adj.status_code == 400, adj.status_code
        assert "stok takibi" in adj.json().get("detail", "").lower(), adj.text[:300]
        # restore + verify adjust works again
        rr = s.put(f"{BASE}/products/prod_03", json={"track_stock": True}, timeout=TIMEOUT)
        assert rr.status_code == 200
        ok = s.post(f"{BASE}/products/quick-stock-adjust",
                    json={"product_id": "prod_03", "quantity_change": 1, "reason": "TEST_it3"}, timeout=TIMEOUT)
        assert ok.status_code == 200, ok.text[:300]
        s.post(f"{BASE}/products/quick-stock-adjust",
               json={"product_id": "prod_03", "quantity_change": -1, "reason": "TEST_it3 revert"}, timeout=TIMEOUT)
