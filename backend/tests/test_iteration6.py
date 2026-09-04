"""Faz 6 backend tests: send-to-gib e_type, taksit modülü, ortak ile tahsilat,
teklif ödeme planı, GİB lookup, genel iskonto, print templates layout."""
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def created():
    return {"invoices": [], "contacts": [], "quotes": []}


@pytest.fixture(scope="module", autouse=True)
def cleanup(api, created):
    yield
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import dotenv_values as dv
    be = dv("/app/backend/.env")

    async def _clean():
        cl = AsyncIOMotorClient(be["MONGO_URL"])
        db = cl[be["DB_NAME"]]
        for iid in created["invoices"]:
            await db.invoices.delete_one({"_id": iid})
            await db.installments.delete_many({"invoice_id": iid})
            await db.bank_transactions.delete_many({"related_invoice_id": iid})
        cl.close()
    asyncio.get_event_loop().run_until_complete(_clean())
    for cid in created["contacts"]:
        api.delete(f"{BASE}/contacts/{cid}")
    for qid in created["quotes"]:
        api.delete(f"{BASE}/quotes/{qid}")


def _mk_invoice(api, created, status="draft", total_items=None, **extra):
    payload = {
        "company_id": COMPANY,
        "contact_id": "cnt_01",
        "contact_name": "TEST Cari",
        "invoice_type": "sales",
        "status": status,
        "items": total_items or [{"name": "TEST_X", "quantity": 2, "unit_price": 100, "vat_rate": 20, "total": 200}],
    }
    payload.update(extra)
    r = api.post(f"{BASE}/invoices", json=payload)
    assert r.status_code == 200, r.text
    inv = r.json()
    created["invoices"].append(inv["id"] if "id" in inv else inv["_id"])
    return inv


# ---------- send-to-gib ----------
class TestSendToGib:
    def test_paper(self, api, created):
        inv = _mk_invoice(api, created)
        r = api.post(f"{BASE}/invoices/{inv['id']}/send-to-gib", json={"e_type": "paper"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "Kağıt fatura" in body["message"]
        assert body["tracking_id"] is None
        g = api.get(f"{BASE}/invoices?company_id={COMPANY}").json()
        row = next(x for x in g if x["id"] == inv["id"])
        assert row["e_type"] == "paper"
        assert row["gib_status"] == "Kağıt Fatura (Matbu)"
        assert row["status"] == "approved"

    def test_e_invoice(self, api, created):
        inv = _mk_invoice(api, created)
        r = api.post(f"{BASE}/invoices/{inv['id']}/send-to-gib", json={"e_type": "e_invoice"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["tracking_id"] and body["tracking_id"].startswith("GIB-")
        g = api.get(f"{BASE}/invoices?company_id={COMPANY}").json()
        row = next(x for x in g if x["id"] == inv["id"])
        assert row["gib_status"] == "Başarıyla İletildi (GİB Onaylı)"
        assert row["e_type"] == "e_invoice"


# ---------- installments ----------
class TestInstallmentPreview:
    def test_preview(self, api):
        r = api.post(f"{BASE}/installments/preview", json={
            "total": 2400, "count": 3, "down_payment": 400, "interval": "month", "first_due_date": "2026-10-01"})
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 4
        assert rows[0]["label"] == "Peşinat" and rows[0]["amount"] == 400
        assert [x["amount"] for x in rows[1:]] == [666.67, 666.67, 666.66]
        assert round(sum(x["amount"] for x in rows), 2) == 2400
        assert [x["due_date"] for x in rows[1:]] == ["2026-10-01", "2026-11-01", "2026-12-01"]

    def test_preview_down_exceeds_total(self, api):
        r = api.post(f"{BASE}/installments/preview", json={"total": 100, "count": 2, "down_payment": 500})
        assert r.status_code == 400


class TestInstallmentCRUD:
    def test_full_flow(self, api, created):
        inv = _mk_invoice(api, created)  # grand_total 240
        iid = inv["id"]
        cfg = {"count": 3, "down_payment": 40, "interval": "month", "first_due_date": "2026-10-01"}
        r = api.post(f"{BASE}/invoices/{iid}/installments", json=cfg)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 4
        assert round(sum(x["amount"] for x in rows), 2) == 240

        g = api.get(f"{BASE}/invoices/{iid}/installments")
        assert g.status_code == 200
        rows = g.json()
        assert all("is_overdue" in x and "days_left" in x for x in rows)

        lst = api.get(f"{BASE}/invoices?company_id={COMPANY}").json()
        row = next(x for x in lst if x["id"] == iid)
        assert row["installment_plan"]["count"] == 4
        assert row["installment_plan"]["paid_count"] == 0

        # filters
        for st in ("pending", "overdue", "paid"):
            fr = api.get(f"{BASE}/installments?company_id={COMPANY}&status={st}")
            assert fr.status_code == 200, fr.text
            assert isinstance(fr.json(), list)
        for d in ("receivable", "payable"):
            fr = api.get(f"{BASE}/installments?company_id={COMPANY}&direction={d}")
            assert fr.status_code == 200
            assert all(x["direction"] == d for x in fr.json())

        # summary
        sm = api.get(f"{BASE}/installments/summary?company_id={COMPANY}")
        assert sm.status_code == 200, sm.text
        s = sm.json()
        for k in ("overdue", "this_month", "pending_receivable", "pending_payable", "paid_total"):
            assert k in s

        # pay one installment via bank account
        accs = api.get(f"{BASE}/banking/accounts?company_id={COMPANY}").json()
        acc = next((a for a in accs if a.get("type") in ("bank", "cash_box", "pos")), None) if accs else None
        assert acc, "no bank accounts seeded"
        acc_id = acc["id"]
        contact_before = next(c for c in api.get(f"{BASE}/contacts?company_id={COMPANY}").json() if c["id"] == "cnt_01")["balance"]
        target = rows[0]
        pr = api.post(f"{BASE}/installments/{target['id']}/pay", json={"account_id": acc_id})
        assert pr.status_code == 200, pr.text
        assert pr.json()["installment_status"] == "paid"

        rows2 = api.get(f"{BASE}/invoices/{iid}/installments").json()
        assert next(x for x in rows2 if x["id"] == target["id"])["status"] == "paid"
        inv_row = next(x for x in api.get(f"{BASE}/invoices?company_id={COMPANY}").json() if x["id"] == iid)
        assert inv_row["paid_amount"] == pytest.approx(target["amount"], abs=0.02)
        assert inv_row["installment_plan"]["paid_count"] == 1

        txs = api.get(f"{BASE}/banking/transactions?company_id={COMPANY}").json()
        assert any(t.get("related_invoice_id") == iid and t["type"] == "inflow" for t in txs)

        contact_after = next(c for c in api.get(f"{BASE}/contacts?company_id={COMPANY}").json() if c["id"] == "cnt_01")["balance"]
        assert contact_after == pytest.approx(contact_before - target["amount"], abs=0.02)

        # paying again -> 400
        again = api.post(f"{BASE}/installments/{target['id']}/pay", json={"account_id": acc_id})
        assert again.status_code == 400, again.text

        # amount > remaining -> 400
        other = next(x for x in rows2 if x["status"] != "paid")
        over = api.post(f"{BASE}/installments/{other['id']}/pay", json={"account_id": acc_id, "amount": other["amount"] + 500})
        assert over.status_code == 400, over.text

        # recreate plan with a paid installment -> 400
        recreate = api.post(f"{BASE}/invoices/{iid}/installments", json=cfg)
        assert recreate.status_code == 400, recreate.text

        # delete with paid -> 400
        d1 = api.delete(f"{BASE}/invoices/{iid}/installments")
        assert d1.status_code == 400, d1.text

    def test_delete_without_paid(self, api, created):
        inv = _mk_invoice(api, created)
        iid = inv["id"]
        api.post(f"{BASE}/invoices/{iid}/installments", json={"count": 2, "interval": "month", "first_due_date": "2026-10-01"})
        d = api.delete(f"{BASE}/invoices/{iid}/installments")
        assert d.status_code == 200, d.text
        assert api.get(f"{BASE}/invoices/{iid}/installments").json() == []
        row = next(x for x in api.get(f"{BASE}/invoices?company_id={COMPANY}").json() if x["id"] == iid)
        assert not row.get("installment_plan")


# ---------- partner payment ----------
class TestPartnerPayment:
    def test_record_payment_via_partner(self, api, created):
        inv = _mk_invoice(api, created)
        iid = inv["id"]
        partners = api.get(f"{BASE}/banking/partners?company_id={COMPANY}").json()
        p = next((x for x in partners if x["id"] == "partner_01"), partners[0] if partners else None)
        assert p, "no partners seeded"
        pid = p["id"]
        bal_before, wd_before = p.get("balance", 0), p.get("total_withdrawn", 0)

        r = api.post(f"{BASE}/invoices/{iid}/record-payment", json={"amount": 100, "partner_id": pid})
        assert r.status_code == 200, r.text
        assert r.json()["via"] == "partner"

        p2 = next(x for x in api.get(f"{BASE}/banking/partners?company_id={COMPANY}").json() if x["id"] == pid)
        assert p2["balance"] == pytest.approx(bal_before - 100, abs=0.01)
        assert p2["total_withdrawn"] == pytest.approx(wd_before + 100, abs=0.01)

        ptx = api.get(f"{BASE}/banking/partners/transactions?company_id={COMPANY}&partner_id={pid}").json()
        assert any(inv["invoice_number"] in (t.get("description") or "") for t in ptx)

        row = next(x for x in api.get(f"{BASE}/invoices?company_id={COMPANY}").json() if x["id"] == iid)
        assert row["paid_amount"] == pytest.approx(100, abs=0.01)

        tx_after = api.get(f"{BASE}/banking/transactions?company_id={COMPANY}").json()
        assert not any(t.get("related_invoice_id") == iid for t in tx_after)

    def test_installment_pay_via_partner(self, api, created):
        inv = _mk_invoice(api, created)
        iid = inv["id"]
        rows = api.post(f"{BASE}/invoices/{iid}/installments", json={"count": 2, "interval": "month", "first_due_date": "2026-10-01"}).json()
        r = api.post(f"{BASE}/installments/{rows[0]['id']}/pay", json={"partner_id": "partner_01"})
        assert r.status_code == 200, r.text
        assert r.json()["invoice_payment"]["via"] == "partner"


# ---------- quote payment plan ----------
class TestQuotePaymentPlan:
    def test_plan_and_convert(self, api, created):
        qr = api.post(f"{BASE}/quotes", json={"company_id": COMPANY, "contact_id": "cnt_01", "contact_name": "TEST Cari",
                                              "title": "TEST_Teklif", "items": [{"name": "TEST_Q", "quantity": 1, "unit_price": 1000, "vat_rate": 20, "total": 1000}]})
        assert qr.status_code == 200, qr.text
        q = qr.json()
        qid = q["id"]
        created["quotes"].append(qid)
        r = api.post(f"{BASE}/quotes/{qid}/payment-plan", json={"count": 2, "down_payment": 0, "interval": "month", "first_due_date": "2026-10-15"})
        assert r.status_code == 200, r.text
        assert len(r.json()["payment_plan"]["rows"]) == 2

        q2 = next(x for x in api.get(f"{BASE}/quotes?company_id={COMPANY}").json() if x["id"] == qid)
        assert len(q2["payment_plan"]["rows"]) == 2

        conv = api.post(f"{BASE}/quotes/{qid}/convert-to-invoice", json={})
        assert conv.status_code == 200, conv.text
        new_inv = conv.json()["invoice"]
        created["invoices"].append(new_inv["id"])
        assert new_inv.get("installment_plan") or True  # returned doc may predate update
        rows = api.get(f"{BASE}/invoices/{new_inv['id']}/installments").json()
        assert len(rows) == 2, rows
        inv_row = next(x for x in api.get(f"{BASE}/invoices?company_id={COMPANY}").json() if x["id"] == new_inv["id"])
        assert inv_row["installment_plan"]["count"] == 2

    def test_plan_remove(self, api, created):
        q = api.post(f"{BASE}/quotes", json={"company_id": COMPANY, "contact_id": "cnt_01", "contact_name": "TEST Cari",
                                             "title": "TEST_Teklif2", "items": [{"name": "TEST_Q", "quantity": 1, "unit_price": 500, "vat_rate": 20, "total": 500}]}).json()
        created["quotes"].append(q["id"])
        api.post(f"{BASE}/quotes/{q['id']}/payment-plan", json={"count": 2, "interval": "month", "first_due_date": "2026-10-15"})
        r = api.post(f"{BASE}/quotes/{q['id']}/payment-plan", json={"remove": True})
        assert r.status_code == 200, r.text
        q2 = next(x for x in api.get(f"{BASE}/quotes?company_id={COMPANY}").json() if x["id"] == q["id"])
        assert not q2.get("payment_plan")


# ---------- GİB lookup ----------
class TestGibLookup:
    def test_vkn(self, api):
        r = api.get(f"{BASE}/gib/lookup", params={"tax_id": "1234567890"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["kind"] == "VKN"
        assert d["is_e_invoice_user"] is True
        assert d["suggested_e_type"] == "e_invoice"
        assert d["source"] == "simulated"
        assert d["local_contact"] is None

    def test_tckn(self, api):
        d = api.get(f"{BASE}/gib/lookup", params={"tax_id": "12345678901"}).json()
        assert d["kind"] == "TCKN"
        assert d["suggested_e_type"] == "e_archive"

    def test_invalid(self, api):
        assert api.get(f"{BASE}/gib/lookup", params={"tax_id": "123"}).status_code == 400

    def test_local_contact(self, api):
        contacts = api.get(f"{BASE}/contacts?company_id={COMPANY}").json()
        c = next((x for x in contacts if (x.get("tax_number_or_id") or "").isdigit() and len(x["tax_number_or_id"]) in (10, 11)), None)
        assert c, "no contact with valid tax id"
        d = api.get(f"{BASE}/gib/lookup", params={"tax_id": c["tax_number_or_id"]}).json()
        assert d["local_contact"] is not None
        assert d["local_contact"]["id"] == c["id"]


# ---------- general discount ----------
class TestGeneralDiscount:
    def test_rate(self, api, created):
        inv = _mk_invoice(api, created, general_discount_rate=10)
        assert inv["discount_total"] == 20
        assert inv["subtotal"] == 180
        assert inv["vat_total"] == 36
        assert inv["grand_total"] == 216

    def test_amount(self, api, created):
        inv = _mk_invoice(api, created, general_discount_amount=50)
        assert inv["subtotal"] == 150
        assert inv["vat_total"] == 30
        assert inv["grand_total"] == 180

    def test_item_discount_persisted(self, api, created):
        inv = _mk_invoice(api, created, total_items=[
            {"name": "TEST_D", "quantity": 2, "unit_price": 100, "vat_rate": 20, "discount_rate": 15, "total": 170}])
        row = next(x for x in api.get(f"{BASE}/invoices?company_id={COMPANY}").json() if x["id"] == inv["id"])
        assert row["items"][0]["discount_rate"] == 15


# ---------- print templates ----------
class TestPrintTemplates:
    def test_defaults_and_persist(self, api):
        r = api.get(f"{BASE}/companies/{COMPANY}/print-templates")
        assert r.status_code == 200, r.text
        tpl = r.json()
        for doc in ("invoice", "order", "quote", "dispatch"):
            assert "layout" in tpl[doc]
        original = tpl["invoice"]
        try:
            p = api.put(f"{BASE}/companies/{COMPANY}/print-templates/invoice", json={**original, "layout": "modern"})
            assert p.status_code == 200, p.text
            assert p.json()["layout"] == "modern"
            assert api.get(f"{BASE}/companies/{COMPANY}/print-templates").json()["invoice"]["layout"] == "modern"
        finally:
            api.put(f"{BASE}/companies/{COMPANY}/print-templates/invoice", json=original)

    def test_invalid_doc_type(self, api):
        assert api.put(f"{BASE}/companies/{COMPANY}/print-templates/bogus", json={}).status_code == 400
