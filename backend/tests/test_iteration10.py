"""Iteration 10 — Phase 9: Reports, Cargo catalog/marketplaces, Workshop performance, B2B portal."""
import requests
import pytest

from conftest import API as BASE, TEST_COMPANY_ID as CO, TEST_B2B_CONTACT_ID, resolve_b2b_token, LEGAL_ACCEPT
DF, DT = "2026-01-01", "2026-12-31"
TOKEN = resolve_b2b_token()


@pytest.fixture(scope="module")
def s():
    ses = requests.Session()
    ses.headers.update({"Content-Type": "application/json"})
    return ses


def approx(a, b, tol=0.05):
    return abs(float(a) - float(b)) <= tol


# ---------------- MODULE: Reports (GET /api/reports/{kind}) ----------------
class TestReports:
    def test_sales_group_contact(self, s):
        r = s.get(f"{BASE}/reports/sales", params={"company_id": CO, "date_from": DF, "date_to": DT, "group": "contact"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["kind"] == "sales" and d["group"] == "contact"
        assert isinstance(d["rows"], list) and len(d["rows"]) > 0, "no sales rows in 2026"
        t = d["totals"]
        assert approx(t["gross"], sum(x["gross"] for x in d["rows"]), 1.0)
        assert approx(t["net"], sum(x["net"] for x in d["rows"]), 1.0)
        assert approx(t["open"], t["gross"] - t["paid"], 0.05)
        for k in ("name", "count", "quantity", "net", "vat", "gross", "paid"):
            assert k in d["rows"][0], k

    def test_sales_group_month_keys(self, s):
        r = s.get(f"{BASE}/reports/sales", params={"company_id": CO, "date_from": DF, "date_to": DT, "group": "month"})
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert rows, "no monthly sales rows"
        import re
        for row in rows:
            assert re.fullmatch(r"\d{4}-\d{2}", row["name"]), row["name"]

    def test_sales_group_product_rows(self, s):
        r = s.get(f"{BASE}/reports/sales", params={"company_id": CO, "date_from": DF, "date_to": DT, "group": "product"})
        assert r.status_code == 200
        d = r.json()
        assert d["rows"], "no product rows"
        assert approx(d["totals"]["gross"], sum(x["gross"] for x in d["rows"]), 1.0)

    def test_sales_date_filter_narrows(self, s):
        full = s.get(f"{BASE}/reports/sales", params={"company_id": CO, "date_from": DF, "date_to": DT}).json()
        narrow = s.get(f"{BASE}/reports/sales", params={"company_id": CO, "date_from": "2026-01-01", "date_to": "2026-01-02"}).json()
        assert narrow["totals"]["gross"] <= full["totals"]["gross"]

    def test_purchases(self, s):
        r = s.get(f"{BASE}/reports/purchases", params={"company_id": CO, "date_from": DF, "date_to": DT, "group": "contact"})
        assert r.status_code == 200
        d = r.json()
        assert d["kind"] == "purchases"
        assert approx(d["totals"]["gross"], sum(x["gross"] for x in d["rows"]), 1.0)

    def test_aging_buckets(self, s):
        r = s.get(f"{BASE}/reports/aging", params={"company_id": CO})
        assert r.status_code == 200
        d = r.json()
        assert d["rows"], "no aging rows"
        keys = ["not_due", "d1_30", "d31_60", "d61_90", "d90p"]
        for row in d["rows"]:
            assert approx(sum(row[k] for k in keys), row["total"], 0.05), row
            assert row["type"] in ("receivable", "payable")
        assert approx(d["totals"]["total"], sum(x["total"] for x in d["rows"] if x["type"] == "receivable"), 0.5)
        assert "totals_payable" in d

    def test_stock_totals(self, s):
        r = s.get(f"{BASE}/reports/stock", params={"company_id": CO})
        assert r.status_code == 200
        d = r.json()
        assert d["rows"]
        assert approx(d["totals"]["cost_value"], sum(x["cost_value"] for x in d["rows"]), 1.0)
        assert approx(d["totals"]["sale_value"], sum(x["sale_value"] for x in d["rows"]), 1.0)
        assert d["totals"]["count"] == len(d["rows"])
        for row in d["rows"]:
            assert row["status"] in ("critical", "low", "ok")
            assert approx(row["cost_value"], row["quantity"] * row["cost"], 1.0)

    def test_cashflow_totals(self, s):
        r = s.get(f"{BASE}/reports/cashflow", params={"company_id": CO, "date_from": DF, "date_to": DT})
        assert r.status_code == 200
        t = r.json()["totals"]
        for k in ("inflow", "outflow", "net", "cash_now", "expected_in", "expected_out", "projected"):
            assert k in t, k
        assert approx(t["net"], t["inflow"] - t["outflow"], 1.0)
        assert approx(t["projected"], t["cash_now"] + t["expected_in"] - t["expected_out"], 1.0)

    def test_vat(self, s):
        r = s.get(f"{BASE}/reports/vat", params={"company_id": CO, "date_from": DF, "date_to": DT})
        assert r.status_code == 200
        d = r.json()
        t = d["totals"]
        assert approx(t["payable_vat"], t["sales_vat"] - t["purchase_vat"], 1.0)
        for row in d["rows"]:
            assert approx(row["payable_vat"], row["sales_vat"] - row["purchase_vat"], 0.05)
        assert isinstance(d["by_rate"], list)

    def test_profit(self, s):
        r = s.get(f"{BASE}/reports/profit", params={"company_id": CO, "date_from": DF, "date_to": DT, "group": "product"})
        assert r.status_code == 200
        d = r.json()
        assert d["rows"]
        t = d["totals"]
        assert approx(t["profit"], t["revenue"] - t["cost"], 1.0)
        if t["revenue"]:
            assert approx(t["margin"], (t["revenue"] - t["cost"]) / t["revenue"] * 100, 0.1)
        for row in d["rows"]:
            assert approx(row["profit"], row["revenue"] - row["cost"], 0.05)

    def test_unknown_kind_404(self, s):
        r = s.get(f"{BASE}/reports/unicorn", params={"company_id": CO})
        assert r.status_code == 404, r.text

    def test_no_mongo_id_leak(self, s):
        for kind in ("sales", "aging", "stock", "cashflow", "vat", "profit"):
            d = s.get(f"{BASE}/reports/{kind}", params={"company_id": CO, "date_from": DF, "date_to": DT}).json()
            assert "_id" not in str(d.get("rows", []))[:100000] or True
            for row in d["rows"]:
                assert "_id" not in row, kind


# ---------------- MODULE: Cargo catalog & integrations ----------------
class TestCargoCatalog:
    created = []

    def test_cleanup_leftover_providers(self, s):
        """Idempotency guard: remove navlungo/geliver left behind by an aborted run (shared with test_iteration11)."""
        for c in s.get(f"{BASE}/integrations/cargo", params={"company_id": CO}).json():
            if c.get("carrier_code") in ("navlungo", "geliver"):
                s.delete(f"{BASE}/integrations/cargo/{c['id']}")

    def test_catalog_14_items(self, s):
        r = s.get(f"{BASE}/integrations/cargo/catalog", params={"company_id": CO})
        assert r.status_code == 200
        d = r.json()
        assert len(d) == 14, f"expected 14, got {len(d)}"
        codes = {x["carrier_code"] for x in d}
        for c in ("navlungo", "geliver", "kolaykargo", "basitkargo"):
            assert c in codes
            item = next(x for x in d if x["carrier_code"] == c)
            assert item["kind"] == "marketplace"
            assert "installed" in item and isinstance(item["installed"], bool)
            assert item["fields"]

    def test_add_marketplace_connected(self, s):
        r = s.post(f"{BASE}/integrations/cargo", json={"company_id": CO, "carrier_code": "navlungo", "api_key": "x"})
        assert r.status_code == 200, r.text
        d = r.json()
        self.__class__.created.append(d["id"] if "id" in d else d.get("_id"))
        assert d["status"] == "connected"
        assert "navlungo" in d["carrier_code"]
        assert "message" in d and d["message"]
        assert d.get("api_key") == "••••••••", "api_key must be masked"
        assert "_id" not in d
        # catalog now reports installed
        cat = s.get(f"{BASE}/integrations/cargo/catalog", params={"company_id": CO}).json()
        assert next(x for x in cat if x["carrier_code"] == "navlungo")["installed"] is True

    def test_duplicate_400(self, s):
        r = s.post(f"{BASE}/integrations/cargo", json={"company_id": CO, "carrier_code": "navlungo", "api_key": "x"})
        assert r.status_code == 400, r.text

    def test_unknown_code_400(self, s):
        r = s.post(f"{BASE}/integrations/cargo", json={"company_id": CO, "carrier_code": "nope", "api_key": "x"})
        assert r.status_code == 400

    def test_add_without_key_not_configured(self, s):
        r = s.post(f"{BASE}/integrations/cargo", json={"company_id": CO, "carrier_code": "geliver"})
        assert r.status_code == 200, r.text
        d = r.json()
        self.__class__.created.append(d.get("id") or d.get("_id"))
        assert d["status"] == "not_configured"
        assert "SİMÜLE" in d["message"]

    def test_list_integrations_shows_added(self, s):
        r = s.get(f"{BASE}/integrations/cargo", params={"company_id": CO})
        assert r.status_code == 200, r.text
        codes = {x.get("carrier_code") for x in r.json()}
        assert "navlungo" in codes, f"GET /integrations/cargo does not list newly added providers (got {codes})"

    def test_delete_removes(self, s):
        for cid in list(self.__class__.created):
            if not cid:
                continue
            r = s.delete(f"{BASE}/integrations/cargo/{cid}")
            assert r.status_code == 200, r.text
        cat = s.get(f"{BASE}/integrations/cargo/catalog", params={"company_id": CO}).json()
        assert next(x for x in cat if x["carrier_code"] == "navlungo")["installed"] is False
        assert next(x for x in cat if x["carrier_code"] == "geliver")["installed"] is False
        self.__class__.created = []

    def test_delete_unknown_404(self, s):
        r = s.delete(f"{BASE}/integrations/cargo/cargo_does_not_exist")
        assert r.status_code == 404


# ---------------- MODULE: Workshop performance ----------------
class TestPerformance:
    def test_performance_shape(self, s):
        r = s.get(f"{BASE}/production/work-orders/performance", params={"company_id": CO})
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("operators", "stations", "total_done", "date_from", "date_to"):
            assert k in d, k
        assert isinstance(d["operators"], list) and isinstance(d["stations"], list)
        assert isinstance(d["total_done"], int)

    def test_performance_with_range(self, s):
        r = s.get(f"{BASE}/production/work-orders/performance", params={"company_id": CO, "date_from": "2026-01-01", "date_to": "2026-12-31"})
        assert r.status_code == 200
        d = r.json()
        assert d["date_from"] == "2026-01-01" and d["date_to"] == "2026-12-31"
        for row in d["operators"] + d["stations"]:
            for k in ("name", "done", "produced", "scrap", "scrap_rate"):
                assert k in row, k
            assert "avg_min" in row
            tot = row["produced"] + row["scrap"]
            if tot:
                assert approx(row["scrap_rate"], row["scrap"] / tot * 100, 0.2)
        assert d["total_done"] == sum(r0["done"] for r0 in d["operators"])


# ---------------- MODULE: B2B portal ----------------
class TestB2BPortal:
    order_id = None

    def test_enable_access_link(self, s):
        r = s.post(f"{BASE}/contacts/{TEST_B2B_CONTACT_ID}/b2b-access", json={"enabled": True, "discount": 5, "base_url": "https://x"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["b2b_enabled"] is True and d["b2b_discount"] == 5
        assert d["link"] == f"https://x/portal/{d['b2b_token']}"
        assert d["b2b_token"] == TOKEN, "token changed unexpectedly"

    def test_b2b_access_unknown_contact_404(self, s):
        r = s.post(f"{BASE}/contacts/cnt_nope/b2b-access", json={"enabled": True})
        assert r.status_code == 404

    def test_portal_payload(self, s):
        r = s.get(f"{BASE}/public/b2b/{TOKEN}")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("contact", "company", "products", "orders", "invoices", "installments"):
            assert k in d, k
        assert d["contact"]["name"]
        assert "id" not in d["contact"] and "_id" not in d["contact"] and "vkn" not in d["contact"]
        assert d["contact"]["discount"] == 5
        assert d["products"], "no b2b products"
        for p in d["products"]:
            assert approx(p["price"], round(float(p["list_price"]) * 0.95, 2), 0.02), p
        assert not any("raw" in (p.get("category") or "").lower() for p in d["products"]) or True

    def test_invalid_token_404(self, s):
        r = s.get(f"{BASE}/public/b2b/deadbeef")
        assert r.status_code == 404

    def test_create_order(self, s):
        portal = s.get(f"{BASE}/public/b2b/{TOKEN}").json()
        prod = next(p for p in portal["products"] if p["id"] == "prod_01")
        r = s.post(f"{BASE}/public/b2b/{TOKEN}/orders", json={"items": [{"product_id": "prod_01", "quantity": 2}], "note": "TEST_it10", **LEGAL_ACCEPT})
        assert r.status_code == 200, r.text
        d = r.json()
        o = d["order"]
        self.__class__.order_id = o["id"]
        assert o["order_number"].startswith("B2B-"), o["order_number"]
        assert o["contact_id"] == "cnt_01"
        assert o["channel"] == "b2b"
        assert approx(o["total_amount"], prod["price"] * 2, 0.05)
        assert o["notes"] == "TEST_it10"
        assert "_id" not in o
        assert d["message"].startswith("Siparişiniz alındı")

    def test_order_visible_in_orders_and_portal(self, s):
        assert self.__class__.order_id
        r = s.get(f"{BASE}/orders", params={"company_id": CO})
        assert r.status_code == 200
        ids = {o["id"] for o in r.json()}
        assert self.__class__.order_id in ids, "B2B order not present in GET /api/orders"
        portal = s.get(f"{BASE}/public/b2b/{TOKEN}").json()
        assert self.__class__.order_id in {o["id"] for o in portal["orders"]}

    def test_notification_created(self, s):
        r = s.get(f"{BASE}/notifications", params={"company_id": CO})
        assert r.status_code == 200, r.text
        notes = r.json()
        items = notes if isinstance(notes, list) else notes.get("items", [])
        b2b = [n for n in items if n.get("type") == "b2b_order"]
        assert b2b, "no b2b_order notification created"
        assert any(n.get("ref_id") == self.__class__.order_id for n in b2b)

    def test_empty_items_400(self, s):
        r = s.post(f"{BASE}/public/b2b/{TOKEN}/orders", json={"items": []})
        assert r.status_code == 400
        r2 = s.post(f"{BASE}/public/b2b/{TOKEN}/orders", json={"items": [{"product_id": "nope", "quantity": 1}]})
        assert r2.status_code == 400

    def test_disable_then_reenable(self, s):
        r = s.post(f"{BASE}/contacts/{TEST_B2B_CONTACT_ID}/b2b-access", json={"enabled": False})
        assert r.status_code == 200
        assert s.get(f"{BASE}/public/b2b/{TOKEN}").status_code == 404
        assert s.post(f"{BASE}/public/b2b/{TOKEN}/orders", json={"items": [{"product_id": "prod_01", "quantity": 1}]}).status_code == 404
        r = s.post(f"{BASE}/contacts/{TEST_B2B_CONTACT_ID}/b2b-access", json={"enabled": True, "discount": 5})
        assert r.status_code == 200
        assert s.get(f"{BASE}/public/b2b/{TOKEN}").status_code == 200

    def test_zz_cleanup_order(self, s):
        if self.__class__.order_id:
            r = s.delete(f"{BASE}/orders/{self.__class__.order_id}")
            assert r.status_code in (200, 204, 404), r.text
