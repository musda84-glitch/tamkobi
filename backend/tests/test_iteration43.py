"""Partner current-account as a payment source for avans, masraf, maaş, cari."""
import os
import uuid

import pytest
import requests

from conftest import API, TEST_COMPANY_ID

TIMEOUT = 40
COMPANY = TEST_COMPANY_ID


@pytest.fixture(scope="module")
def api():
    return requests.Session()


def _partners(api):
    r = api.get(f"{API}/banking/partners", params={"company_id": COMPANY}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert rows, "no partners seeded"
    return rows


def _partner(api, pid="partner_01"):
    rows = _partners(api)
    return next((p for p in rows if p["id"] == pid), rows[0])


class TestPartnerPaymentSource:
    def test_bonus_advance_via_partner_and_delete_restores(self, api):
        p = _partner(api)
        before = float(p.get("balance") or 0)
        withdrawn = float(p.get("total_withdrawn") or 0)
        r = api.post(f"{API}/personnel/bonuses", json={
            "employee_id": "emp_01", "type": "advance", "amount": 37.5,
            "partner_id": p["id"], "period": "2097-03", "note": "IT43 partner avans",
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "paid"
        assert d["partner_id"] == p["id"]
        assert "Ortak" in (d.get("account_name") or "")
        p2 = _partner(api, p["id"])
        assert p2["balance"] == pytest.approx(before - 37.5, abs=0.01)
        assert p2["total_withdrawn"] == pytest.approx(withdrawn + 37.5, abs=0.01)
        ptx = api.get(f"{API}/banking/partners/transactions", params={"company_id": COMPANY, "partner_id": p["id"]}, timeout=TIMEOUT).json()
        assert any(t.get("bonus_id") == d["id"] or "IT43" in (t.get("description") or "") or "Avans" in (t.get("description") or "") for t in ptx)
        dr = api.delete(f"{API}/personnel/bonuses/{d['id']}", timeout=TIMEOUT)
        assert dr.status_code == 200, dr.text
        p3 = _partner(api, p["id"])
        assert p3["balance"] == pytest.approx(before, abs=0.01)
        assert p3["total_withdrawn"] == pytest.approx(withdrawn, abs=0.01)

    def test_expense_pay_via_partner_unpay_restores(self, api):
        p = _partner(api)
        before = float(p.get("balance") or 0)
        created = api.post(f"{API}/expenses", json={
            "company_id": COMPANY, "description": "IT43 partner masraf", "category": "Personel Masrafı",
            "amount": 80, "vat_rate": 0,
        }, timeout=TIMEOUT)
        assert created.status_code == 200, created.text
        exp = created.json()
        assert exp["payment_status"] == "unpaid"
        pay = api.post(f"{API}/expenses/{exp['id']}/pay", json={"partner_id": p["id"]}, timeout=TIMEOUT)
        assert pay.status_code == 200, pay.text
        paid = pay.json()
        assert paid["payment_status"] == "paid"
        assert paid["partner_id"] == p["id"]
        assert paid.get("account_id") in (None, "")
        p2 = _partner(api, p["id"])
        assert p2["balance"] == pytest.approx(before - 80, abs=0.01)
        unpay = api.post(f"{API}/expenses/{exp['id']}/unpay", timeout=TIMEOUT)
        assert unpay.status_code == 200, unpay.text
        p3 = _partner(api, p["id"])
        assert p3["balance"] == pytest.approx(before, abs=0.01)
        api.delete(f"{API}/expenses/{exp['id']}", timeout=TIMEOUT)

    def test_expense_create_paid_from_partner(self, api):
        p = _partner(api)
        before = float(p.get("balance") or 0)
        r = api.post(f"{API}/expenses", json={
            "company_id": COMPANY, "description": "IT43 partner kira", "category": "Kira",
            "amount": 12, "vat_rate": 0, "partner_id": p["id"],
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        exp = r.json()
        assert exp["payment_status"] == "paid"
        assert exp["partner_id"] == p["id"]
        p2 = _partner(api, p["id"])
        assert p2["balance"] == pytest.approx(before - 12, abs=0.01)
        api.delete(f"{API}/expenses/{exp['id']}", timeout=TIMEOUT)
        p3 = _partner(api, p["id"])
        assert p3["balance"] == pytest.approx(before, abs=0.01)

    def test_contact_collect_via_partner(self, api):
        p = _partner(api)
        before = float(p.get("balance") or 0)
        name = f"IT43 Cari {uuid.uuid4().hex[:6]}"
        cr = api.post(f"{API}/contacts", json={"company_id": COMPANY, "name": name, "type": "customer", "tax_number_or_id": f"VKN{uuid.uuid4().hex[:8]}"}, timeout=TIMEOUT)
        assert cr.status_code == 200, cr.text
        cid = cr.json()["id"]
        ov = api.get(f"{API}/contacts/{cid}/overview", timeout=TIMEOUT).json()
        c_before = float(ov["contact"].get("balance") or 0)
        r = api.post(f"{API}/contacts/{cid}/record-payment", json={
            "partner_id": p["id"], "type": "inflow", "amount": 15, "description": "IT43 tahsilat",
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["via"] == "partner"
        p2 = _partner(api, p["id"])
        assert p2["balance"] == pytest.approx(before - 15, abs=0.01)
        ov2 = api.get(f"{API}/contacts/{cid}/overview", timeout=TIMEOUT).json()
        assert ov2["contact"]["balance"] == pytest.approx(c_before - 15, abs=0.01)
        assert any(x.get("source") == "partner" and x.get("amount") == 15 for x in ov2["payments"])
        ptxs = api.get(f"{API}/banking/partners/transactions", params={"company_id": COMPANY, "partner_id": p["id"]}, timeout=TIMEOUT).json()
        tx = next(t for t in ptxs if t.get("contact_id") == cid or "IT43 tahsilat" in (t.get("description") or ""))
        api.delete(f"{API}/banking/partners/transactions/{tx['id']}", timeout=TIMEOUT)
        api.delete(f"{API}/contacts/{cid}", timeout=TIMEOUT)
        p3 = _partner(api, p["id"])
        assert p3["balance"] == pytest.approx(before, abs=0.01)

    def test_pay_expense_requires_target(self, api):
        created = api.post(f"{API}/expenses", json={
            "company_id": COMPANY, "description": "IT43 no target", "category": "Diğer", "amount": 9, "vat_rate": 0,
        }, timeout=TIMEOUT)
        assert created.status_code == 200
        eid = created.json()["id"]
        r = api.post(f"{API}/expenses/{eid}/pay", json={}, timeout=TIMEOUT)
        assert r.status_code == 400
        api.delete(f"{API}/expenses/{eid}", timeout=TIMEOUT)
