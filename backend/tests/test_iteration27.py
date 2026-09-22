"""Iteration 27 tests: Trash module, order auto-contacts, marketplace settlement flow."""
import os
import time
import pytest
import requests
from mysql_store import SyncMySQLClient as MongoClient

_url = os.environ.get("REACT_APP_BACKEND_URL")
if not _url:
    with open("/app/frontend/.env") as _f:
        for _ln in _f:
            if _ln.startswith("REACT_APP_BACKEND_URL="):
                _url = _ln.split("=", 1)[1].strip()
BASE = _url.rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"

# ---- Mongo direct (for cleanup only) ----
_mongo_url = None
_db_name = None
with open("/app/backend/.env") as f:
    for ln in f:
        if ln.startswith("MONGO_URL="):
            _mongo_url = ln.split("=", 1)[1].strip().strip('"')
        elif ln.startswith("DB_NAME="):
            _db_name = ln.split("=", 1)[1].strip().strip('"')
mongo = MongoClient(_mongo_url)[_db_name]


# =============================================================
# Trash: quote lifecycle
# =============================================================
class TestTrashQuote:
    def test_quote_trash_lifecycle(self):
        # Create quote
        r = requests.post(f"{BASE}/quotes", json={
            "company_id": COMPANY, "title": "TEST_it27 quote",
            "contact_name": "TEST_it27 contact",
            "items": [{"product_name": "TEST item", "quantity": 1, "unit_price": 100, "vat_rate": 20, "total": 120}]
        })
        assert r.status_code == 200, r.text
        quote = r.json()
        qid = quote["id"]

        # Delete quote -> trash
        r = requests.delete(f"{BASE}/quotes/{qid}")
        assert r.status_code == 200
        assert "çöp" in r.json().get("message", "").lower() or "trash" in r.json().get("message", "").lower() or r.json().get("status") == "success"

        # List trash
        r = requests.get(f"{BASE}/trash", params={"company_id": COMPANY})
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "types" in body and body.get("retention_days") == 30
        matching = [i for i in body["items"] if i.get("original_id") == qid]
        assert matching, f"Quote not found in trash: {body}"
        item = matching[0]
        assert item["entity_type"] == "quote"
        assert 28 <= item["days_left"] <= 30

        tid = item["id"]

        # GET single
        r = requests.get(f"{BASE}/trash/{tid}")
        assert r.status_code == 200
        assert r.json()["doc"]["id"] == qid

        # Restore
        r = requests.post(f"{BASE}/trash/{tid}/restore")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "success"

        # Quote should exist again
        r = requests.get(f"{BASE}/quotes/{qid}")
        assert r.status_code == 200

        # Restore again should 404 (already removed from trash)
        r = requests.post(f"{BASE}/trash/{tid}/restore")
        assert r.status_code == 404

        # Delete again then permanent delete
        r = requests.delete(f"{BASE}/quotes/{qid}")
        assert r.status_code == 200
        r = requests.get(f"{BASE}/trash", params={"company_id": COMPANY, "entity_type": "quote"})
        tid2 = [i["id"] for i in r.json()["items"] if i.get("original_id") == qid][0]
        r = requests.delete(f"{BASE}/trash/{tid2}")
        assert r.status_code == 200

        # Empty trash (no-op for this entity now)
        r = requests.post(f"{BASE}/trash/empty", json={"company_id": COMPANY, "entity_type": "quote"})
        assert r.status_code == 200
        assert r.json()["status"] == "success"


# =============================================================
# Trash balance hooks: bank transaction + expense
# =============================================================
class TestTrashBalanceHooks:
    def _pick_non_integrated_account(self):
        r = requests.get(f"{BASE}/banking/accounts", params={"company_id": COMPANY})
        assert r.status_code == 200
        for a in r.json():
            if not a.get("is_integrated"):
                return a
        pytest.skip("no non-integrated account")

    def test_bank_transaction_trash_restore_balance(self):
        acc = self._pick_non_integrated_account()
        aid = acc["id"]
        b0 = float(acc.get("current_balance") or 0)

        # Create inflow tx
        r = requests.post(f"{BASE}/banking/transactions", json={
            "company_id": COMPANY, "account_id": aid, "account_name": acc.get("account_name"),
            "type": "inflow", "amount": 123.45, "category": "TEST_it27",
            "description": "TEST_it27 inflow", "date": "2026-01-15"
        })
        assert r.status_code == 200, r.text
        tx = r.json()
        tx_id = tx["id"]

        b1 = self._bal(aid)
        assert round(b1 - b0, 2) == 123.45

        # Delete tx -> trash, balance goes back
        r = requests.delete(f"{BASE}/banking/transactions/{tx_id}")
        assert r.status_code == 200
        b2 = self._bal(aid)
        assert round(b2 - b0, 2) == 0.0

        # Find trash id
        tid = self._trash_id_by_original(tx_id, "bank_transaction")
        # Restore -> balance re-applied
        r = requests.post(f"{BASE}/trash/{tid}/restore")
        assert r.status_code == 200, r.text
        b3 = self._bal(aid)
        assert round(b3 - b0, 2) == 123.45

        # Cleanup: delete + purge
        r = requests.delete(f"{BASE}/banking/transactions/{tx_id}")
        assert r.status_code == 200
        tid2 = self._trash_id_by_original(tx_id, "bank_transaction")
        r = requests.delete(f"{BASE}/trash/{tid2}")
        assert r.status_code == 200
        b_final = self._bal(aid)
        assert round(b_final - b0, 2) == 0.0

    def test_expense_paid_trash_restore(self):
        acc = self._pick_non_integrated_account()
        aid = acc["id"]
        b0 = self._bal(aid)

        r = requests.post(f"{BASE}/expenses", json={
            "company_id": COMPANY, "category": "TEST_it27_exp",
            "description": "TEST_it27 expense", "amount": 50.0, "vat_rate": 0, "vat_amount": 0,
            "total": 50.0, "payment_status": "paid", "account_id": aid, "date": "2026-01-15", "paid_date": "2026-01-15"
        })
        assert r.status_code == 200, r.text
        exp = r.json()
        eid = exp.get("id") or exp.get("_id")
        b1 = self._bal(aid)
        assert round(b0 - b1, 2) == 50.0

        r = requests.delete(f"{BASE}/expenses/{eid}")
        assert r.status_code == 200
        b2 = self._bal(aid)
        assert round(b2 - b0, 2) == 0.0

        tid = self._trash_id_by_original(eid, "expense")
        r = requests.post(f"{BASE}/trash/{tid}/restore")
        assert r.status_code == 200, r.text
        b3 = self._bal(aid)
        assert round(b0 - b3, 2) == 50.0

        # cleanup
        r = requests.delete(f"{BASE}/expenses/{eid}")
        assert r.status_code == 200
        tid2 = self._trash_id_by_original(eid, "expense")
        requests.delete(f"{BASE}/trash/{tid2}")
        b_final = self._bal(aid)
        assert round(b_final - b0, 2) == 0.0

    def _bal(self, aid):
        r = requests.get(f"{BASE}/banking/accounts", params={"company_id": COMPANY})
        for a in r.json():
            if a["id"] == aid:
                return float(a.get("current_balance") or 0)
        pytest.fail(f"account {aid} missing")

    def _trash_id_by_original(self, oid, etype):
        r = requests.get(f"{BASE}/trash", params={"company_id": COMPANY, "entity_type": etype})
        for it in r.json()["items"]:
            if it.get("original_id") == oid:
                return it["id"]
        pytest.fail(f"no trash row for {oid} etype={etype}")


# =============================================================
# Trash: product/contact/order
# =============================================================
class TestTrashProductContactOrder:
    def test_multi_entity_trash(self):
        # Product
        r = requests.post(f"{BASE}/products", json={
            "company_id": COMPANY, "name": "TEST_it27 product", "sku": "TEST_IT27_SKU",
            "category": "TEST", "unit": "Adet", "sale_price": 100, "cost_price": 50,
            "vat_rate": 20, "stock_quantity": 10
        })
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        # Contact
        r = requests.post(f"{BASE}/contacts", json={
            "company_id": COMPANY, "type": "customer", "name": "TEST_it27 cari",
            "tax_number_or_id": "11111111111"
        })
        assert r.status_code == 200, r.text
        cid = r.json()["id"]

        # Order (channel manual)
        r = requests.post(f"{BASE}/orders", json={
            "company_id": COMPANY, "channel": "manual",
            "customer_name": "TEST_it27 order cust", "shipping_address": "test", "city": "İstanbul",
            "items": [{"product_id": "", "sku": "TEST_IT27_SKU", "product_name": "TEST_it27 product", "quantity": 1, "unit_price": 100, "total": 100}],
            "total_amount": 100.0
        })
        assert r.status_code == 200, r.text
        oid = r.json()["id"]

        # Delete each
        assert requests.delete(f"{BASE}/products/{pid}").status_code == 200
        assert requests.delete(f"{BASE}/contacts/{cid}").status_code == 200
        assert requests.delete(f"{BASE}/orders/{oid}").status_code == 200

        # Verify types
        r = requests.get(f"{BASE}/trash", params={"company_id": COMPANY})
        items = r.json()["items"]
        by_orig = {i["original_id"]: i for i in items}
        assert by_orig[pid]["type_label"] == "Ürün / Stok Kartı"
        assert by_orig[cid]["type_label"] == "Cari Hesap"
        assert by_orig[oid]["type_label"] == "Sipariş"

        # Restore all
        for oid_ in (pid, cid, oid):
            tid = by_orig[oid_]["id"]
            r = requests.post(f"{BASE}/trash/{tid}/restore")
            assert r.status_code == 200, f"restore {oid_}: {r.text}"

        # Delete + purge
        requests.delete(f"{BASE}/products/{pid}")
        requests.delete(f"{BASE}/contacts/{cid}")
        requests.delete(f"{BASE}/orders/{oid}")
        r = requests.get(f"{BASE}/trash", params={"company_id": COMPANY})
        for it in r.json()["items"]:
            if it.get("original_id") in (pid, cid, oid):
                requests.delete(f"{BASE}/trash/{it['id']}")

    def test_invoiced_order_delete_returns_400(self):
        # Existing invoiced order should not be deletable
        r = requests.get(f"{BASE}/orders", params={"company_id": COMPANY})
        assert r.status_code == 200
        orders = r.json() if isinstance(r.json(), list) else r.json().get("orders", [])
        invoiced = [o for o in orders if o.get("is_invoiced") or o.get("invoice_id")]
        if not invoiced:
            pytest.skip("no invoiced order to test")
        oid = invoiced[0]["id"]
        r = requests.delete(f"{BASE}/orders/{oid}")
        assert r.status_code == 400


# =============================================================
# Auto-contact
# =============================================================
class TestAutoContact:
    def test_auto_contact_on_order_and_reuse(self):
        # Order 1
        r = requests.post(f"{BASE}/orders", json={
            "company_id": COMPANY, "channel": "trendyol",
            "order_number": "TEST_IT27_TY1",
            "customer_name": "QA Otomatik Cari", "customer_phone": "05001234567",
            "shipping_address": "test", "city": "İstanbul",
            "items": [{"product_id": "p_test", "sku": "SKU_X", "product_name": "x", "quantity": 1, "unit_price": 50, "total": 50}],
            "total_amount": 50.0
        })
        assert r.status_code == 200, r.text
        o1 = r.json()
        assert o1.get("contact_id"), f"contact_id missing: {o1}"
        cid1 = o1["contact_id"]

        # Contact category
        r = requests.get(f"{BASE}/contacts", params={"company_id": COMPANY})
        contacts = r.json() if isinstance(r.json(), list) else r.json().get("contacts", [])
        c = next((x for x in contacts if x["id"] == cid1), None)
        assert c is not None
        assert c.get("category") == "Trendyol Müşterisi"
        assert c.get("auto_created") is True

        # Order 2 - slight name diff, same phone -> should reuse
        r = requests.post(f"{BASE}/orders", json={
            "company_id": COMPANY, "channel": "trendyol",
            "order_number": "TEST_IT27_TY2",
            "customer_name": "QA Otomatik", "customer_phone": "05001234567",
            "shipping_address": "test", "city": "İstanbul",
            "items": [{"product_id": "p_test", "sku": "SKU_Y", "product_name": "y", "quantity": 1, "unit_price": 30, "total": 30}],
            "total_amount": 30.0
        })
        assert r.status_code == 200
        o2 = r.json()
        assert o2.get("contact_id") == cid1, "Second order should reuse contact"

        # Backfill
        r = requests.post(f"{BASE}/orders/auto-contacts", json={"company_id": COMPANY})
        assert r.status_code == 200
        assert r.json().get("status") == "success"

        # Cleanup: delete orders + purge, delete contact + purge
        for oid in (o1["id"], o2["id"]):
            requests.delete(f"{BASE}/orders/{oid}")
        requests.delete(f"{BASE}/contacts/{cid1}")
        r = requests.get(f"{BASE}/trash", params={"company_id": COMPANY})
        for it in r.json()["items"]:
            if it.get("original_id") in (o1["id"], o2["id"], cid1):
                requests.delete(f"{BASE}/trash/{it['id']}")


# =============================================================
# Settlement
# =============================================================
class TestSettlement:
    def _get_trendyol_channel(self):
        r = requests.get(f"{BASE}/integrations/ecommerce", params={"company_id": COMPANY})
        assert r.status_code == 200
        body = r.json() if isinstance(r.json(), list) else r.json().get("channels", [])
        for ch in body:
            if ch.get("channel") == "trendyol" or ch.get("id") == "ecom_trendyol":
                return ch
        pytest.fail(f"trendyol channel missing: {body}")

    def _pick_non_integrated_account(self):
        r = requests.get(f"{BASE}/banking/accounts", params={"company_id": COMPANY})
        for a in r.json():
            if not a.get("is_integrated"):
                return a
        pytest.skip("no non-integrated account")

    def _bal(self, aid):
        r = requests.get(f"{BASE}/banking/accounts", params={"company_id": COMPANY})
        for a in r.json():
            if a["id"] == aid:
                return float(a.get("current_balance") or 0)
        return 0

    def test_settlement_full_flow(self):
        ch = self._get_trendyol_channel()
        cid = ch["id"]
        acc = self._pick_non_integrated_account()
        aid = acc["id"]

        # PUT settlement account
        r = requests.put(f"{BASE}/integrations/ecommerce/{cid}/settlement-account", json={"account_id": aid})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("settlement_account_name") == acc.get("account_name")

        # PUT bogus id -> 404
        r = requests.put(f"{BASE}/integrations/ecommerce/{cid}/settlement-account", json={"account_id": "bogus_xxx"})
        assert r.status_code == 404

        # PUT integrated account -> 400 (if exists)
        r = requests.get(f"{BASE}/banking/accounts", params={"company_id": COMPANY})
        integrated = [a for a in r.json() if a.get("is_integrated")]
        if integrated:
            r = requests.put(f"{BASE}/integrations/ecommerce/{cid}/settlement-account", json={"account_id": integrated[0]["id"]})
            assert r.status_code == 400, r.text

        # Reset back
        requests.put(f"{BASE}/integrations/ecommerce/{cid}/settlement-account", json={"account_id": aid})

        b0 = self._bal(aid)

        # Create order 1000
        r = requests.post(f"{BASE}/orders", json={
            "company_id": COMPANY, "channel": "trendyol",
            "order_number": "TEST_IT27_SETTLE",
            "customer_name": "TEST_IT27 Settle Cust", "customer_phone": "05559998877",
            "shipping_address": "test", "city": "İstanbul",
            "items": [
                {"product_id": "p_test", "sku": "SKU_I1", "product_name": "i1", "quantity": 2, "unit_price": 500, "total": 1000},
            ],
            "total_amount": 1000.0
        })
        assert r.status_code == 200, r.text
        order = r.json()
        oid = order["id"]
        contact_id = order.get("contact_id")

        # Convert to invoice
        r = requests.post(f"{BASE}/orders/{oid}/convert-to-invoice", json={})
        assert r.status_code == 200, r.text
        conv = r.json()
        settlement = conv.get("settlement")
        assert settlement, f"no settlement: {conv}"
        assert settlement["gross"] == 1000
        assert abs(settlement["deductions"] - 270.99) < 1.0, f"deductions={settlement['deductions']}"
        assert abs(settlement["net"] - 729.01) < 1.0, f"net={settlement['net']}"

        # Balance
        b1 = self._bal(aid)
        assert abs((b1 - b0) - settlement["net"]) < 0.05

        # Bank tx source
        r = requests.get(f"{BASE}/banking/transactions", params={"company_id": COMPANY, "account_id": aid})
        txs = r.json() if isinstance(r.json(), list) else r.json().get("transactions", [])
        matching_tx = [t for t in txs if t.get("order_id") == oid]
        assert matching_tx and matching_tx[0].get("source") == "marketplace_settlement"
        tx_id = matching_tx[0]["id"]

        # Expense
        r = requests.get(f"{BASE}/expenses", params={"company_id": COMPANY})
        exps = r.json().get("expenses", [])
        pk = [e for e in exps if e.get("order_id") == oid and e.get("category") == "Pazaryeri Komisyonu"]
        assert pk, f"no Pazaryeri Komisyonu expense for order"
        exp = pk[0]
        assert exp.get("payment_status") == "paid"
        assert exp.get("netted_in_settlement") is True
        assert abs(exp.get("total", 0) - 270.99) < 1.0
        assert exp.get("contact_name") == "Trendyol"
        assert exp.get("contact_id")
        # Kesinti kasa satırında değil, pazaryeri carisinde (ledger).
        all_tx = requests.get(f"{BASE}/banking/transactions", params={"company_id": COMPANY}).json()
        if isinstance(all_tx, dict):
            all_tx = all_tx.get("transactions", [])
        mp_txs = [t for t in all_tx if t.get("order_id") == oid and t.get("category") == "Pazaryeri Kesintisi"]
        assert mp_txs and mp_txs[0].get("contact_id") == exp.get("contact_id")
        assert abs(float(mp_txs[0].get("amount") or 0) - 270.99) < 1.0
        # NO bank tx with expense_id for it
        assert not any(t for t in txs if t.get("expense_id") == exp["id"])

        # Profitability
        r = requests.get(f"{BASE}/marketplace/profitability", params={"company_id": COMPANY})
        assert r.status_code == 200
        prof = r.json()
        assert prof.get("settlement", {}).get("count", 0) >= 1
        chs = prof.get("channels", [])
        tr = next((c for c in chs if (c.get("channel") == "trendyol" or "rendyol" in (c.get("name") or ""))), None)
        assert tr and tr.get("settlement_account_name") == acc.get("account_name")

        # Reset settlement account
        r = requests.put(f"{BASE}/integrations/ecommerce/{cid}/settlement-account", json={"account_id": None})
        assert r.status_code == 200

        # CLEANUP: delete invoice, tx, expense, order, auto contact directly via Mongo
        inv_id = conv.get("invoice_id")
        mongo.invoices.delete_one({"_id": inv_id})
        mongo.bank_transactions.delete_one({"_id": tx_id})
        mongo.expenses.delete_one({"_id": exp["id"]})
        mongo.orders.delete_one({"_id": oid})
        if contact_id:
            mongo.contacts.delete_one({"_id": contact_id})
        # Revert balance
        mongo.bank_accounts.update_one({"_id": aid}, {"$inc": {"current_balance": -settlement["net"]}})

        # Verify balance restored
        b_final = self._bal(aid)
        assert abs(b_final - b0) < 0.05, f"balance not restored: {b_final} vs {b0}"

        # Ensure settlement=None when account unset
        # Create another order & convert -> settlement null
        r = requests.post(f"{BASE}/orders", json={
            "company_id": COMPANY, "channel": "trendyol",
            "order_number": "TEST_IT27_NOSETTLE",
            "customer_name": "TEST_IT27 NoSettle", "customer_phone": "05559998866",
            "shipping_address": "test", "city": "İstanbul",
            "items": [{"product_id": "p_test", "sku": "SKU_X2", "product_name": "x", "quantity": 1, "unit_price": 100, "total": 100}],
            "total_amount": 100.0
        })
        assert r.status_code == 200
        o2 = r.json()
        r = requests.post(f"{BASE}/orders/{o2['id']}/convert-to-invoice", json={})
        assert r.status_code == 200
        assert r.json().get("settlement") in (None, {}), f"expected null settlement: {r.json()}"

        # Cleanup this order too
        inv2 = r.json().get("invoice_id")
        mongo.invoices.delete_one({"_id": inv2})
        mongo.orders.delete_one({"_id": o2["id"]})
        if o2.get("contact_id"):
            mongo.contacts.delete_one({"_id": o2["contact_id"]})
