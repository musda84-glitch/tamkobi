"""Iteration-5 backend tests: e-commerce mapping/returns/dispatch, attendance, accountant, WhatsApp, invoice draft edit."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"


@pytest.fixture(scope="session")
def c():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- E-COMMERCE MAPPINGS ----------
class TestMappings:
    def test_list_mappings(self, c):
        r = c.get(f"{BASE}/integrations/ecommerce/mappings")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_mapping_and_upsert(self, c):
        prod = c.get(f"{BASE}/products").json()[0]
        payload = {"channel": "trendyol", "marketplace_sku": "TEST-SKU", "product_id": prod["id"]}
        r = c.post(f"{BASE}/integrations/ecommerce/mappings", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["channel"] == "trendyol"
        assert d["marketplace_sku"] == "TEST-SKU"
        assert d["product_id"] == prod["id"]
        assert d["product_name"] == prod["name"]
        mid = d["id"]
        # duplicate -> upsert same id
        r2 = c.post(f"{BASE}/integrations/ecommerce/mappings", json=payload)
        assert r2.status_code == 200
        assert r2.json()["id"] == mid
        # in list
        lst = c.get(f"{BASE}/integrations/ecommerce/mappings").json()
        assert any(m["id"] == mid for m in lst)
        # cleanup
        assert c.delete(f"{BASE}/integrations/ecommerce/mappings/{mid}").status_code == 200
        lst2 = c.get(f"{BASE}/integrations/ecommerce/mappings").json()
        assert not any(m["id"] == mid for m in lst2)

    def test_create_mapping_missing_sku_400(self, c):
        prod = c.get(f"{BASE}/products").json()[0]
        r = c.post(f"{BASE}/integrations/ecommerce/mappings",
                   json={"channel": "trendyol", "marketplace_sku": "", "product_id": prod["id"]})
        assert r.status_code == 400, r.text

    def test_create_mapping_bad_product_404(self, c):
        r = c.post(f"{BASE}/integrations/ecommerce/mappings",
                   json={"channel": "trendyol", "marketplace_sku": "TEST-SKU-2", "product_id": "nope"})
        assert r.status_code == 404

    def test_unmapped(self, c):
        r = c.get(f"{BASE}/integrations/ecommerce/unmapped")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        for row in data:
            assert "channel" in row and "product_name" in row


# ---------- ORDER APPROVE / RETURN / DISPATCH ----------
@pytest.fixture(scope="class")
def target_order(c):
    orders = c.get(f"{BASE}/orders").json()
    cand = [o for o in orders if o.get("order_status") not in ("İade Edildi", "Kısmi İade")
            and o.get("items") and not o.get("dispatch_id")]
    if not cand:
        pytest.fail("No suitable order found for return/dispatch tests")
    return cand[0]


class TestOrderFlows:
    def test_approve_order(self, c, target_order):
        r = c.post(f"{BASE}/orders/{target_order['id']}/approve", json={"cargo_carrier": "aras"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["order_status"] == "Onaylandı"
        assert d["cargo_carrier"] == "aras"
        g = c.get(f"{BASE}/orders/{target_order['id']}").json()
        assert g["order"]["order_status"] == "Onaylandı" if "order" in g else g["order_status"] == "Onaylandı"

    def test_approve_404(self, c):
        assert c.post(f"{BASE}/orders/nope/approve", json={}).status_code == 404

    def test_create_dispatch(self, c, target_order):
        r = c.post(f"{BASE}/orders/{target_order['id']}/create-dispatch")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "success"
        disp = d["dispatch"]
        assert disp["invoice_type"] == "dispatch"
        assert disp["e_type"] == "e_dispatch"
        assert disp["invoice_number"].startswith("IRS-")
        # second call -> exists
        r2 = c.post(f"{BASE}/orders/{target_order['id']}/create-dispatch")
        assert r2.status_code == 200
        assert r2.json()["status"] == "exists"
        assert r2.json()["dispatch"]["id"] == disp["id"]

    def test_return_order_restock(self, c, target_order):
        item = next((i for i in target_order["items"] if i.get("product_id")), None)
        before = None
        if item:
            before = c.get(f"{BASE}/products/{item['product_id']}").json()["stock_quantity"]
        r = c.post(f"{BASE}/orders/{target_order['id']}/return",
                   json={"reason": "TEST_iade", "restock": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "success"
        ret = d["return"]
        assert ret["reason"] == "TEST_iade"
        assert ret["restocked"] is True
        assert ret["refund_amount"] > 0
        # order status
        o = c.get(f"{BASE}/orders").json()
        row = next(x for x in o if x["id"] == target_order["id"])
        assert row["order_status"] == "İade Edildi", row["order_status"]
        # stock increased
        if item:
            after = c.get(f"{BASE}/products/{item['product_id']}").json()["stock_quantity"]
            assert after == before + float(item["quantity"]), f"{before} -> {after}"
        # listed
        rets = c.get(f"{BASE}/returns").json()
        assert any(x["id"] == ret["id"] for x in rets)
        # second return -> 400
        r2 = c.post(f"{BASE}/orders/{target_order['id']}/return", json={"reason": "x"})
        assert r2.status_code == 400


# ---------- ATTENDANCE ----------
class TestAttendance:
    def test_check_in_out_and_absent(self, c):
        emps = c.get(f"{BASE}/personnel/employees").json()
        emp_id = emps[0]["id"]
        r = c.post(f"{BASE}/personnel/attendance", json={"employee_id": emp_id, "action": "check_in"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["check_in"] and ":" in d["check_in"]
        assert d["status"] == "present"
        r = c.post(f"{BASE}/personnel/attendance", json={"employee_id": emp_id, "action": "check_out"})
        assert r.status_code == 200
        d = r.json()
        assert d["check_out"]
        assert d["hours"] >= 0
        # summary
        import datetime as dt
        month = dt.datetime.utcnow().strftime("%Y-%m")
        s = c.get(f"{BASE}/personnel/attendance", params={"month": month})
        assert s.status_code == 200
        js = s.json()
        assert js["month"] == month
        me = next(x for x in js["summary"] if x["employee_id"] == emp_id)
        assert me["days_present"] >= 1
        assert me["today"] is not None
        # absent clears times
        r = c.post(f"{BASE}/personnel/attendance", json={"employee_id": emp_id, "status": "absent"})
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "absent"
        assert d["check_in"] is None and d["check_out"] is None and d["hours"] == 0

    def test_attendance_bad_employee_404(self, c):
        assert c.post(f"{BASE}/personnel/attendance", json={"employee_id": "nope", "action": "check_in"}).status_code == 404


# ---------- ACCOUNTANT ----------
class TestAccountant:
    def test_summary(self, c):
        r = c.get(f"{BASE}/accountant/summary", params={"month": "2026-09"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["month"] == "2026-09"
        for k in ["sales", "purchases", "vat", "cash", "payroll", "e_docs", "invoices"]:
            assert k in d
        assert set(["calculated", "deductible", "payable"]).issubset(d["vat"].keys())
        assert d["vat"]["payable"] == pytest.approx(max(0.0, d["vat"]["calculated"] - d["vat"]["deductible"]), abs=0.01)
        assert isinstance(d["invoices"], list)
        assert d["sales"]["count"] + d["purchases"]["count"] <= len(d["invoices"])

    def test_export_invoices_csv(self, c):
        r = c.get(f"{BASE}/accountant/export", params={"kind": "invoices", "month": "2026-09"})
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        text = r.content.decode("utf-8")
        assert text.startswith("\ufeff")
        assert "Belge No;Tarih" in text

    def test_export_transactions_csv(self, c):
        r = c.get(f"{BASE}/accountant/export", params={"kind": "transactions", "month": "2026-09"})
        assert r.status_code == 200
        text = r.content.decode("utf-8")
        assert text.startswith("\ufeff")
        assert "Tarih;Hesap" in text


# ---------- WHATSAPP ----------
class TestWhatsApp:
    def test_settings_simulated_then_connected(self, c):
        r = c.get(f"{BASE}/comm/whatsapp/settings")
        assert r.status_code == 200
        assert r.json()["status"] == "simulated"
        assert "access_token" not in r.json()
        r = c.put(f"{BASE}/comm/whatsapp/settings",
                  json={"phone_number_id": "PN1", "access_token": "TEST_TOKEN", "verify_token": "nexus-test"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "connected"
        assert d["has_token"] is True
        assert "access_token" not in d and "access_token_enc" not in d
        assert d["phone_number_id"] == "PN1"

    def test_webhook_verify(self, c):
        bad = c.get(f"{BASE}/comm/whatsapp/webhook",
                    params={"hub.mode": "subscribe", "hub.verify_token": "WRONG", "hub.challenge": "123"})
        assert bad.status_code == 403
        ok = c.get(f"{BASE}/comm/whatsapp/webhook",
                   params={"hub.mode": "subscribe", "hub.verify_token": "nexus-test", "hub.challenge": "123"})
        assert ok.status_code == 200, ok.text
        assert ok.text == "123"

    def test_webhook_inbound_message(self, c):
        payload = {"entry": [{"changes": [{"value": {
            "metadata": {"phone_number_id": "PN1"},
            "contacts": [{"wa_id": "905323405060", "profile": {"name": "Ali"}}],
            "messages": [{"from": "905323405060", "id": "wamid.TEST1", "type": "text", "text": {"body": "Merhaba"}}]
        }}]}]}
        r = c.post(f"{BASE}/comm/whatsapp/webhook", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["saved"] == 1
        logs = c.get(f"{BASE}/comm/whatsapp/logs").json()
        log = next((x for x in logs if x.get("wa_message_id") == "wamid.TEST1"), None)
        assert log is not None
        assert log["direction"] == "inbound"
        assert log["message"] == "Merhaba"
        assert log["contact_id"] == "cnt_01", f"expected cnt_01 match, got {log.get('contact_id')}"

    def test_send_simulated(self, c):
        # reset to simulated first (no token used for send)
        r = c.post(f"{BASE}/comm/whatsapp/send", json={"phone": "0532 340 50 60", "message": "TEST_mesaj"})
        assert r.status_code in (200, 502), r.text
        d = r.json()
        assert "wa_link" in d
        assert "TEST_mesaj" in d["message"]
        assert d["direction"] == "outbound"

    def test_send_validation_400(self, c):
        assert c.post(f"{BASE}/comm/whatsapp/send", json={"phone": "", "message": ""}).status_code == 400

    def test_reset_settings_to_simulated(self, c):
        r = c.put(f"{BASE}/comm/whatsapp/settings",
                  json={"phone_number_id": "", "verify_token": ""})
        assert r.status_code == 200
        assert r.json()["status"] == "simulated"


# ---------- INVOICE DRAFT EDIT + GIB ----------
class TestInvoiceDraft:
    def _create_draft(self, c):
        payload = {"company_id": "comp_nexus_main_01", "invoice_type": "sales", "e_type": "e_archive",
                   "contact_id": "cnt_01", "contact_name": "TEST_Cari", "status": "draft",
                   "issue_date": "2026-09-15",
                   "items": [{"name": "TEST_Urun", "quantity": 2, "unit": "Adet", "unit_price": 100, "vat_rate": 20, "total": 200}]}
        r = c.post(f"{BASE}/invoices", json=payload)
        assert r.status_code == 200, r.text
        return r.json()

    def test_update_draft_recalculates(self, c):
        inv = self._create_draft(c)
        assert inv["e_type"] == "e_archive"
        assert inv["grand_total"] == pytest.approx(240)
        r = c.put(f"{BASE}/invoices/{inv['id']}", json={
            "e_type": "paper",
            "items": [{"name": "TEST_Urun", "quantity": 3, "unit": "Adet", "unit_price": 100, "vat_rate": 20, "total": 300}]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["e_type"] == "paper"
        assert d["subtotal"] == pytest.approx(300)
        assert d["vat_total"] == pytest.approx(60)
        assert d["grand_total"] == pytest.approx(360)
        # persisted
        got = next(x for x in c.get(f"{BASE}/invoices").json() if x["id"] == inv["id"])
        assert got["grand_total"] == pytest.approx(360)
        assert got["e_type"] == "paper"
        # send to gib with e_type
        g = c.post(f"{BASE}/invoices/{inv['id']}/send-to-gib", json={"e_type": "e_invoice"})
        assert g.status_code == 200, g.text
        assert g.json()["status"] == "success"
        got2 = next(x for x in c.get(f"{BASE}/invoices").json() if x["id"] == inv["id"])
        assert got2["e_type"] == "e_invoice"
        assert got2["status"] == "approved"
        # PUT on non-draft -> 400
        r2 = c.put(f"{BASE}/invoices/{inv['id']}", json={"e_type": "paper"})
        assert r2.status_code == 400
        # cleanup
        c.delete(f"{BASE}/invoices/{inv['id']}")

    def test_update_invoice_404(self, c):
        assert c.put(f"{BASE}/invoices/nope", json={"e_type": "paper"}).status_code == 404
