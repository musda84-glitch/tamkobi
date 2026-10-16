"""B2B portal siparişinde zorunlu kart ödemesi.

TestClient + bellek içi veritabanı. Sağlayıcı dış çağrıları mock. 8021, canlı
veritabanı ve MySQL yok. Kart numarası, CVV ve son kullanma saklanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-vpos-b2b-order-payment-jwt-secret-32b")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import comm_service  # noqa: E402
import event_notify  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import vpos.api as vpos_api  # noqa: E402
import vpos.nestpay as nestpay  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc, sort_docs  # noqa: E402

PAN = "4531440099991234"
CVV = "cvvX7421Z"
EXPIRY = "12/29"
STORE_KEY = "TEST1234"
COMP_A = "co-a"
TOKEN = "tok-a"


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None
        self._limit = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def limit(self, n):
        self._limit = int(n)
        return self

    async def to_list(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        cap = self._limit
        if length is not None:
            cap = int(length) if cap is None else min(cap, int(length))
        if cap is not None:
            rows = rows[:cap]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self):
        self.docs = []

    def _rows(self, query):
        return [d for d in self.docs if match_query(d, query or {})]

    def find(self, query=None, projection=None):
        return MemCursor(self._rows(query))

    async def find_one(self, query=None, projection=None):
        rows = self._rows(query or {})
        return copy.deepcopy(rows[0]) if rows else None

    async def insert_one(self, doc):
        if any(d.get("_id") == doc.get("_id") for d in self.docs):
            raise RuntimeError("duplicate")
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        for doc in docs:
            await self.insert_one(doc)

    async def count_documents(self, query=None, **kwargs):
        return len(self._rows(query or {}))

    def _replace(self, doc, updated):
        doc.clear()
        doc.update(updated)

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if match_query(doc, query or {}):
                self._replace(doc, apply_update(doc, update or {}, query, is_insert=False))
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        created = new_upsert_doc(update or {}, query)
        self.docs.append(copy.deepcopy(created))
        return SimpleNamespace(matched_count=0, modified_count=1, upserted_id=created.get("_id"))

    async def update_many(self, query, update):
        n = 0
        for doc in self.docs:
            if match_query(doc, query or {}):
                self._replace(doc, apply_update(doc, update or {}, query, is_insert=False))
                n += 1
        return SimpleNamespace(matched_count=n, modified_count=n)

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        rows = self._rows(query or {})
        if not rows:
            if not upsert:
                return None
            created = new_upsert_doc(update or {}, query)
            self.docs.append(copy.deepcopy(created))
            return copy.deepcopy(created) if return_document else None
        old = copy.deepcopy(rows[0])
        self._replace(rows[0], apply_update(rows[0], update or {}, query, is_insert=False))
        return copy.deepcopy(rows[0] if return_document else old)

    async def delete_one(self, query):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        kept = [d for d in self.docs if not match_query(d, query or {})]
        deleted = len(self.docs) - len(kept)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=deleted)

    async def create_index(self, *args, **kwargs):
        return None


class MemDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl()
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)

    def dump(self):
        return json.dumps({name: coll.docs for name, coll in self._cols.items()}, default=str)


def _user(uid="user-a"):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [COMP_A],
        "active_company_id": COMP_A,
    }


def _company(**settings):
    base = {
        "enabled": True,
        "allow_orders": True,
        "min_order_amount": 0.0,
        "card_payment_enabled": True,
        "card_payment_required": False,
        "card_max_installment": 6,
        "card_commission_payer": "buyer",
        "card_commission_rate": 2.5,
    }
    base.update(settings)
    return {"_id": COMP_A, "name": "Acme AŞ", "b2b_settings": base}


def _contact(balance=500.0, **extra):
    doc = {
        "_id": "ct-a",
        "company_id": COMP_A,
        "type": "customer",
        "name": "Acme",
        "email": "acme@example.com",
        "phone": "555",
        "address": "Ist",
        "city": "İstanbul",
        "tax_number_or_id": "11111111111",
        "balance": balance,
        "b2b_enabled": True,
        "b2b_token": TOKEN,
        "is_active": True,
        "b2b_portal_settings": {},
    }
    doc.update(extra)
    return doc


def _other_contact():
    return _contact(_id="ct-b", name="Diğer", email="b@example.com", b2b_token="tok-b", balance=80.0)


def _product(**extra):
    doc = {
        "_id": "p1",
        "company_id": COMP_A,
        "name": "Vida",
        "sku": "VIDA",
        "unit": "Adet",
        "sale_price": 100.0,
        "vat_rate": 20,
        "price_includes_vat": False,
        "stock_quantity": 10,
        "track_stock": True,
        "show_in_b2b": True,
        "type": "goods",
    }
    doc.update(extra)
    return doc


def _cfg(**overrides):
    doc = {
        "_id": "cfg-1",
        "company_id": COMP_A,
        "family": "nestpay",
        "bank_label": "İş Bankası",
        "mode": "test",
        "client_id": "100200127",
        "store_key_enc": comm_service.encrypt(STORE_KEY),
        "gateway_3d_url": nestpay.PAYTEN_TEST_3D_URL,
        "account_id": "pos1",
        "enabled": True,
        "max_installment": 4,
        "no_installment": False,
    }
    doc.update(overrides)
    return doc


def _active_cart():
    return {
        "_id": "cart-1",
        "company_id": COMP_A,
        "contact_id": "ct-a",
        "order_number": "BA-2026-0001",
        "order_status": "active_cart",
        "source": "b2b_active_cart",
        "is_active_cart": True,
        "customer_name": "Acme",
        "items": [{"product_id": "p1", "quantity": 1}],
    }


def _signed(intent, **overrides):
    form = {
        "clientid": "100200127",
        "oid": intent["order_id"],
        "amount": intent["amount"],
        "currency": "949",
        "Response": "Approved",
        "ProcReturnCode": "00",
        "mdStatus": "1",
        "AuthCode": "123456",
        "hashAlgorithm": "ver3",
        "MaskedPan": "453144******1234",
        "pan": PAN,
        "cv2": CVV,
        "Ecom_Payment_Card_ExpDate_Month": "12",
        "Ecom_Payment_Card_ExpDate_Year": "29",
        "expiry": EXPIRY,
    }
    form.update(overrides)
    form.pop("hash", None)
    form["hash"] = nestpay.hash_ver3(form, STORE_KEY)
    return form


def _auth():
    token = auth_utils.create_access_token("user-a", "user-a@example.com", "admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.append(_user())
    db.companies.docs.append(_company())
    db.contacts.docs.append(_contact())
    db.contacts.docs.append(_other_contact())
    db.products.docs.append(_product())
    db.bank_accounts.docs.append({
        "_id": "pos1", "company_id": COMP_A, "type": "pos", "account_name": "Mağaza POS", "current_balance": 100.0,
    })
    db.vpos_configs.docs.append(_cfg())
    db.orders.docs.append(_active_cart())
    db.platform_settings.docs.append({"_id": "platform", "public_url": "https://tamkobi.com"})
    prev = (server.db, rbac._db, saas._db, addons._db, event_notify._db, vpos_api._finalize_b2b_order)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    event_notify._db = db
    saas.invalidate()
    vpos_api.init(db, server.get_current_user, server.finalize_b2b_order_payment)
    vpos_api.reset_callback_rate_limit()
    vpos_api.set_outbound_client(None)
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    try:
        client.__enter__()
        entered = True
        yield client, db
    finally:
        if entered:
            client.__exit__(None, None, None)
        vpos_api.set_outbound_client(None)
        vpos_api.reset_callback_rate_limit()
        server.db, rbac._db, saas._db, addons._db, event_notify._db, vpos_api._finalize_b2b_order = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _settings(db):
    return db.companies.docs[0]["b2b_settings"]


def _require_card(db, on=True):
    _settings(db)["card_payment_enabled"] = True
    _settings(db)["card_payment_required"] = on


def _order_body(**extra):
    body = {
        "items": [{"product_id": "p1", "quantity": 1, "unit_price": 1, "total": 1}],
        "note": "kapıya bırak",
        "customer_order_number": "PO-9",
        "pan": PAN,
        "cvv": CVV,
        "cv2": CVV,
        "expiry": EXPIRY,
    }
    body.update(extra)
    return body


def _sales(db):
    return [d for d in db.orders.docs if d.get("source") == "b2b_portal"]


def _carts(db):
    return [d for d in db.orders.docs if d.get("source") == "b2b_active_cart" or d.get("is_active_cart")]


def _stock(db):
    return next(d["stock_quantity"] for d in db.products.docs if d["_id"] == "p1")


def _balance(db):
    return next(d["balance"] for d in db.contacts.docs if d["_id"] == "ct-a")


def _pos(db):
    return next(d["current_balance"] for d in db.bank_accounts.docs if d["_id"] == "pos1")


def _titles(db):
    return [n.get("title") or "" for n in db.notifications.docs]


def _assert_clean(db, caplog):
    blob = db.dump() + caplog.text
    for needle in (PAN, CVV, EXPIRY):
        assert needle not in blob


def _pay(client, db):
    started = client.post(f"/api/public/b2b/{TOKEN}/order-payments", json=_order_body())
    assert started.status_code == 200, started.text
    intent = next(d for d in db.payment_intents.docs if d["_id"] == started.json()["intent_id"])
    return started, intent


def _callback(client, intent, **overrides):
    return client.post(
        f"/api/vpos/callback/{intent['_id']}",
        data=_signed(intent, **overrides),
        follow_redirects=False,
    )


def test_setting_off_order_keeps_old_behavior(api, caplog):
    client, db = api
    caplog.set_level("INFO")
    assert _settings(db)["card_payment_required"] is False
    portal = client.get(f"/api/public/b2b/{TOKEN}")
    assert portal.status_code == 200, portal.text
    assert portal.json()["card_order_required"] is False
    res = client.post(f"/api/public/b2b/{TOKEN}/orders", json=_order_body())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["order"]["order_number"].startswith("B2B-")
    assert body["order"]["grand_total"] == pytest.approx(120.0)
    assert body["order"]["items"][0]["unit_price"] == pytest.approx(100.0)
    assert "payment_intent_id" not in body["order"]
    assert _carts(db) == []
    assert len(_sales(db)) == 1
    assert any(t.startswith("Yeni B2B siparişi") for t in _titles(db))
    drafts = [i for i in db.invoices.docs if i.get("status") == "draft"]
    assert len(drafts) == 1
    assert drafts[0]["order_id"] == _sales(db)[0]["_id"]
    assert _stock(db) == 10
    assert db.payment_intents.docs == []
    assert db.bank_transactions.docs == []
    _assert_clean(db, caplog)


def test_required_without_card_enabled_is_422(api):
    client, db = api
    saved = client.put(
        f"/api/companies/{COMP_A}/b2b-settings",
        headers=_auth(),
        json={"card_payment_required": True, "card_payment_enabled": False},
    )
    assert saved.status_code == 422
    assert saved.json()["detail"] == "Önce kartla ödemeyi açın."
    assert _settings(db)["card_payment_required"] is False
    opened = client.put(
        f"/api/companies/{COMP_A}/b2b-settings",
        headers=_auth(),
        json={"card_payment_required": True, "card_payment_enabled": True, "card_commission_payer": "buyer", "card_commission_rate": 2.5},
    )
    assert opened.status_code == 200, opened.text
    assert opened.json()["settings"]["card_payment_required"] is True


def test_setting_on_plain_order_is_402_and_writes_nothing(api):
    client, db = api
    _require_card(db, True)
    before_orders = copy.deepcopy(db.orders.docs)
    before_notes = copy.deepcopy(db.notifications.docs)
    res = client.post(f"/api/public/b2b/{TOKEN}/orders", json=_order_body())
    assert res.status_code == 402
    body = res.json()
    assert body["card_required"] is True
    assert body["detail"] == "Bu portalda sipariş için kartla ödeme zorunlu."
    assert body["pay_url"] == f"/portal/{TOKEN}"
    assert db.orders.docs == before_orders
    assert db.notifications.docs == before_notes
    assert db.invoices.docs == []
    assert db.payment_intents.docs == []
    assert _stock(db) == 10
    portal = client.get(f"/api/public/b2b/{TOKEN}")
    assert portal.json()["card_order_required"] is True


def test_contact_card_off_does_not_force_company_required(api):
    client, db = api
    _require_card(db, True)
    db.contacts.docs[0]["b2b_portal_settings"] = {"card_payment_enabled": False}
    assert client.get(f"/api/public/b2b/{TOKEN}").json()["card_order_required"] is False
    res = client.post(f"/api/public/b2b/{TOKEN}/orders", json=_order_body())
    assert res.status_code == 200, res.text
    assert len(_sales(db)) == 1


def test_order_payment_uses_server_total_and_opens_nothing(api, caplog):
    client, db = api
    caplog.set_level("INFO")
    _require_card(db, True)
    started, intent = _pay(client, db)
    body = started.json()
    assert body["kind"] == "form"
    assert "pan" not in (body.get("fields") or {})
    assert intent["purpose"] == "b2b_order"
    assert intent["source"] == "b2b_portal"
    assert intent["amount"] == "123.00"
    assert intent["ledger_amount"] == "120.00"
    assert intent["commission_amount"] == "3.00"
    assert intent["commission_payer"] == "buyer"
    assert intent["order_draft"]["grand_total"] == pytest.approx(120.0)
    assert intent["order_draft"]["items"][0]["unit_price"] == pytest.approx(100.0)
    assert intent["order_draft"]["customer_order_number"] == "PO-9"
    assert intent["order_draft_hash"] == server._b2b_order_draft_hash(intent["order_draft"])
    assert _sales(db) == []
    assert len(_carts(db)) == 1
    assert db.invoices.docs == []
    assert db.bank_transactions.docs == []
    assert db.notifications.docs == []
    assert _stock(db) == 10
    assert _balance(db) == pytest.approx(500.0)
    _assert_clean(db, caplog)


def _assert_paid_books(db):
    assert _balance(db) == pytest.approx(380.0)
    assert _pos(db) == pytest.approx(223.0)
    txs = list(db.bank_transactions.docs)
    assert len(txs) == 2
    main = next(t for t in txs if not str(t["_id"]).endswith(":fee"))
    fee = next(t for t in txs if str(t["_id"]).endswith(":fee"))
    assert main["amount"] == pytest.approx(120.0)
    assert main["contact_id"] == "ct-a"
    assert main["category"] == "Cari Tahsilat"
    assert main["description"] == "Kartlı sipariş ödemesi"
    assert fee["amount"] == pytest.approx(3.0)
    assert fee["category"] == "Kart komisyon farkı"
    assert "contact_id" not in fee
    assert main["_id"] == f"vpos:{main['vpos_intent_id']}"
    assert fee["_id"] == f"vpos:{main['vpos_intent_id']}:fee"
    sales = _sales(db)
    assert len(sales) == 1
    order = sales[0]
    assert order["_id"] == f"b2bord_{main['vpos_intent_id']}"
    assert order["payment_status"] == "paid"
    assert order["payment_method"] == "card"
    assert order["payment_intent_id"] == main["vpos_intent_id"]
    assert order["paid_amount"] == pytest.approx(120.0)
    assert order["grand_total"] == pytest.approx(120.0)
    assert order["items"][0]["unit_price"] == pytest.approx(100.0)
    assert order["order_number"].startswith("B2B-")
    assert _carts(db) == []
    assert any(t.startswith("Yeni B2B siparişi") for t in _titles(db))
    assert "Kartlı sipariş ödemesi" in _titles(db)
    drafts = [i for i in db.invoices.docs if i.get("status") == "draft"]
    assert len(drafts) == 1
    assert _stock(db) == 10
    intent = next(d for d in db.payment_intents.docs if d["_id"] == main["vpos_intent_id"])
    assert intent["b2b_order_id"] == order["_id"]
    assert intent["order_number"] == order["order_number"]
    assert intent["order_id"] != order["_id"]
    return intent, order


def test_paid_callback_opens_one_order_and_is_idempotent(api, caplog):
    client, db = api
    caplog.set_level("INFO")
    _require_card(db, True)
    _started, intent = _pay(client, db)
    first = _callback(client, intent)
    assert first.status_code == 303
    assert f"/portal/{TOKEN}/odeme/{intent['_id']}" in first.headers["location"]
    intent_doc, order = _assert_paid_books(db)
    _callback(client, intent)
    _assert_paid_books(db)
    asyncio.run(server.finalize_b2b_order_payment(intent["_id"]))
    _assert_paid_books(db)
    own = client.get(f"/api/public/b2b/{TOKEN}/card-payments/{intent['_id']}")
    assert own.status_code == 200
    assert own.json()["status"] == "paid"
    assert own.json()["order_id"] == order["_id"]
    assert own.json()["order_number"] == order["order_number"]
    assert own.json()["order_error"] is None
    assert own.json()["charge_amount"] == "123.00"
    assert own.json()["base_amount"] == "120.00"
    other = client.get(f"/api/public/b2b/tok-b/card-payments/{intent['_id']}")
    assert other.status_code == 404
    _assert_clean(db, caplog)
    assert intent_doc["order_error"] in (None, "")


def test_retry_and_concurrent_finalize_stay_single(api):
    client, db = api
    _require_card(db, True)
    _started, intent = _pay(client, db)
    vpos_api._finalize_b2b_order = None
    _callback(client, intent)
    assert _sales(db) == []
    assert len(db.bank_transactions.docs) == 2
    assert len(_carts(db)) == 1
    vpos_api._finalize_b2b_order = server.finalize_b2b_order_payment
    _callback(client, intent)
    assert len(_sales(db)) == 1
    assert len(db.bank_transactions.docs) == 2
    live = next(d for d in db.payment_intents.docs if d["_id"] == intent["_id"])
    live.pop("b2b_order_id", None)
    live.pop("order_number", None)
    live.pop("order_claim", None)

    async def _both():
        await asyncio.gather(
            server.finalize_b2b_order_payment(intent["_id"]),
            server.finalize_b2b_order_payment(intent["_id"]),
        )

    asyncio.run(_both())
    assert len(_sales(db)) == 1
    assert len(db.bank_transactions.docs) == 2
    assert _carts(db) == []


def test_failed_payment_writes_nothing(api):
    client, db = api
    _require_card(db, True)
    _started, intent = _pay(client, db)
    fail = _callback(client, intent, Response="Declined", ProcReturnCode="05", mdStatus="0", AuthCode="")
    assert fail.status_code == 303
    assert _sales(db) == []
    assert db.bank_transactions.docs == []
    assert db.invoices.docs == []
    assert len(_carts(db)) == 1
    assert _balance(db) == pytest.approx(500.0)
    assert _stock(db) == 10
    fresh = next(d for d in db.payment_intents.docs if d["_id"] == intent["_id"])
    assert fresh["status"] == "failed"
    assert "b2b_order_id" not in fresh


def test_hash_mismatch_keeps_collection_and_flags_review(api):
    client, db = api
    _require_card(db, True)
    _started, intent = _pay(client, db)
    live = next(d for d in db.payment_intents.docs if d["_id"] == intent["_id"])
    live["order_draft"] = {**live["order_draft"], "grand_total": 1}
    _callback(client, intent)
    assert _sales(db) == []
    assert len(db.bank_transactions.docs) == 2
    assert _balance(db) == pytest.approx(380.0)
    assert len(_carts(db)) == 1
    fresh = next(d for d in db.payment_intents.docs if d["_id"] == intent["_id"])
    assert fresh["order_error"] == "review"
    assert "b2b_order_id" not in fresh
    assert any("firma onayında" in (n.get("message") or "") for n in db.notifications.docs)
    own = client.get(f"/api/public/b2b/{TOKEN}/card-payments/{intent['_id']}")
    assert own.json()["order_error"] == "review"
    assert own.json()["order_number"] is None
    asyncio.run(server.finalize_b2b_order_payment(intent["_id"]))
    assert sum(1 for n in db.notifications.docs if "firma onayında" in (n.get("message") or "")) == 1


def test_deleted_product_flags_review_and_keeps_collection(api):
    client, db = api
    _require_card(db, True)
    _started, intent = _pay(client, db)
    db.products.docs[:] = [d for d in db.products.docs if d["_id"] != "p1"]
    _callback(client, intent)
    assert _sales(db) == []
    assert len(db.bank_transactions.docs) == 2
    fresh = next(d for d in db.payment_intents.docs if d["_id"] == intent["_id"])
    assert fresh["order_error"] == "review"
    assert any(n.get("type") == "b2b_order_payment_review" for n in db.notifications.docs)


def test_paid_order_cannot_be_edited_or_deleted_but_cancel_request_works(api):
    client, db = api
    _require_card(db, True)
    _started, intent = _pay(client, db)
    _callback(client, intent)
    order = _sales(db)[0]
    oid = order["_id"]
    edit = client.put(f"/api/public/b2b/{TOKEN}/orders/{oid}", json=_order_body())
    delete = client.delete(f"/api/public/b2b/{TOKEN}/orders/{oid}")
    assert edit.status_code == 409
    assert delete.status_code == 409
    msg = "Kartla ödenmiş sipariş portaldan değiştirilemez; iptal talebi gönderin."
    assert edit.json()["detail"] == msg
    assert delete.json()["detail"] == msg
    assert len(_sales(db)) == 1
    order["order_status"] = "approved"
    cancel = client.post(f"/api/public/b2b/{TOKEN}/orders/{oid}/cancel-request", json={"reason": "yanlış"})
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["order"]["cancel_request"]["status"] == "pending"
