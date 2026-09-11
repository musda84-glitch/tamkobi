"""GİB'den gelen alış e-faturaları kesilmez; Onayla / Reddet ticari yanıtı."""
import os

import pytest
import requests
from dotenv import dotenv_values

_frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
_backend_env = dotenv_values("/app/backend/.env") or dotenv_values("/workspace/backend/.env") or {}
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or _frontend_env.get("REACT_APP_BACKEND_URL") or _backend_env.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = BASE_URL.rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _contact_balance(api, contact_id):
    rows = api.get(f"{BASE}/contacts", params={"company_id": COMPANY}).json()
    row = next(x for x in rows if x.get("id") == contact_id or x.get("_id") == contact_id)
    return float(row.get("balance") or 0)


def _get_invoice(api, invoice_id):
    rows = api.get(f"{BASE}/invoices", params={"company_id": COMPANY, "type": "purchase"}).json()
    return next(x for x in rows if x.get("id") == invoice_id)


def _mk_purchase_einvoice(api, status="draft", extra=None):
    payload = {
        "company_id": COMPANY,
        "contact_id": "cnt_03",
        "contact_name": "Mikro Çip & Komponent İthalat A.Ş.",
        "invoice_type": "purchase",
        "e_type": "e_invoice",
        "status": status,
        "items": [{"name": "TEST_GELEN_CIP", "quantity": 1, "unit_price": 100, "vat_rate": 20, "total": 100}],
    }
    if extra:
        payload.update(extra)
    r = api.post(f"{BASE}/invoices", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


class TestIncomingPurchaseGib:
    def test_create_tags_incoming(self, api):
        inv = _mk_purchase_einvoice(api)
        assert inv["invoice_type"] == "purchase"
        assert inv["e_type"] == "e_invoice"
        assert inv.get("direction") == "incoming"
        row = _get_invoice(api, inv["id"])
        assert row.get("direction") == "incoming"

    def test_send_to_gib_blocked(self, api):
        inv = _mk_purchase_einvoice(api)
        r = api.post(f"{BASE}/invoices/{inv['id']}/send-to-gib", json={"e_type": "e_invoice"})
        assert r.status_code == 400, r.text
        assert "kesilmez" in r.json()["detail"]
        row = _get_invoice(api, inv["id"])
        assert row["status"] == "draft"
        assert row.get("gib_status") in (None, "Taslak") or "Gelen" not in (row.get("gib_status") or "")

    def test_paper_purchase_still_issues(self, api):
        r = api.post(f"{BASE}/invoices", json={
            "company_id": COMPANY,
            "contact_id": "cnt_03",
            "contact_name": "Mikro Çip",
            "invoice_type": "purchase",
            "e_type": "paper",
            "status": "draft",
            "items": [{"name": "TEST_KAGIT_ALIS", "quantity": 1, "unit_price": 50, "vat_rate": 20, "total": 50}],
        })
        assert r.status_code == 200, r.text
        inv = r.json()
        g = api.post(f"{BASE}/invoices/{inv['id']}/send-to-gib", json={"e_type": "paper"})
        assert g.status_code == 200, g.text
        assert "Kağıt fatura" in g.json()["message"]

    def test_accept_draft_applies_effects(self, api):
        before = _contact_balance(api, "cnt_03")
        inv = _mk_purchase_einvoice(api, status="draft")
        r = api.post(f"{BASE}/invoices/{inv['id']}/accept-incoming")
        assert r.status_code == 200, r.text
        row = _get_invoice(api, inv["id"])
        assert row["status"] == "approved"
        assert row["gib_response"] == "accepted"
        assert row["gib_status"] == "Gelen E-Fatura Onaylandı"
        after = _contact_balance(api, "cnt_03")
        assert after == pytest.approx(before - float(inv["grand_total"]), abs=0.02)
        again = api.post(f"{BASE}/invoices/{inv['id']}/accept-incoming")
        assert again.status_code == 200
        assert "zaten" in again.json()["message"]
        blocked = api.post(f"{BASE}/invoices/{inv['id']}/reject-incoming", json={"reason": "geç"})
        assert blocked.status_code == 400

    def test_reject_reverses_balance(self, api):
        before = _contact_balance(api, "cnt_03")
        inv = _mk_purchase_einvoice(api, status="approved")
        mid = _contact_balance(api, "cnt_03")
        assert mid == pytest.approx(before - float(inv["grand_total"]), abs=0.02)
        assert _get_invoice(api, inv["id"]).get("direction") == "incoming"
        r = api.post(f"{BASE}/invoices/{inv['id']}/reject-incoming", json={"reason": "TEST ret"})
        assert r.status_code == 200, r.text
        row = _get_invoice(api, inv["id"])
        assert row["status"] == "cancelled"
        assert row["gib_response"] == "rejected"
        assert row["gib_status"] == "Gelen E-Fatura Reddedildi"
        after = _contact_balance(api, "cnt_03")
        assert after == pytest.approx(before, abs=0.02)

    def test_sales_send_to_gib_still_works(self, api):
        r = api.post(f"{BASE}/invoices", json={
            "company_id": COMPANY,
            "contact_id": "cnt_01",
            "contact_name": "TEST Cari",
            "invoice_type": "sales",
            "e_type": "e_archive",
            "status": "draft",
            "items": [{"name": "TEST_SATIS", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10}],
        })
        assert r.status_code == 200, r.text
        inv = r.json()
        g = api.post(f"{BASE}/invoices/{inv['id']}/send-to-gib", json={"e_type": "e_invoice"})
        assert g.status_code == 200, g.text
        assert g.json().get("tracking_id")

    def test_accept_on_sales_rejected(self, api):
        r = api.post(f"{BASE}/invoices", json={
            "company_id": COMPANY,
            "contact_id": "cnt_01",
            "contact_name": "TEST Cari",
            "invoice_type": "sales",
            "status": "draft",
            "items": [{"name": "TEST_SATIS2", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10}],
        })
        inv = r.json()
        a = api.post(f"{BASE}/invoices/{inv['id']}/accept-incoming")
        assert a.status_code == 400
