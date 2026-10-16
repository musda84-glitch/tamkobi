"""B2B kartlı bakiye ödemesi: ayar yetkisi, quote, başlatma ve üç ailede kayıt.

TestClient + bellek içi veritabanı. Dış HTTP mock. 8021, canlı veritabanı ve
MySQL yok. Kart numarası, CVV ve son kullanma logda ve kayıtta bulunmaz.
"""
from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-vpos-b2b-payments-jwt-secret-not-default-32")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import comm_service  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import vpos.api as vpos_api  # noqa: E402
import vpos.iyzico as iyzico  # noqa: E402
import vpos.nestpay as nestpay  # noqa: E402
import vpos.paytr as paytr  # noqa: E402
from mysql_store import match_query, sort_docs  # noqa: E402

PAN = "4531440099991234"
CVV = "cvvX7421Z"
EXPIRY = "12/29"
STORE_KEY = "TEST1234"
MERCHANT_KEY = "paytr-key-do-not-log"
MERCHANT_SALT = "paytr-salt-do-not-log"
IYZICO_KEY = "sandbox-api-key-value"
IYZICO_SECRET = "sandbox-secret-do-not-log"
COMP_A = "co-a"
COMP_B = "co-b"


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    async def to_list(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self):
        self.docs = []

    def _rows(self, query):
        return [d for d in self.docs if match_query(d, query or {})]

    def find(self, query=None, projection=None):
        return MemCursor([copy.deepcopy(d) for d in self._rows(query)])

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

    def _apply(self, doc, update):
        update = update or {}
        if "$set" in update:
            doc.update(update["$set"])
        if "$unset" in update:
            for name in update["$unset"]:
                doc.pop(name, None)
        if "$inc" in update:
            for name, delta in update["$inc"].items():
                doc[name] = float(doc.get(name) or 0) + float(delta)

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if match_query(doc, query or {}):
                self._apply(doc, update)
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query, update):
        n = 0
        for doc in self.docs:
            if match_query(doc, query or {}):
                self._apply(doc, update)
                n += 1
        return SimpleNamespace(matched_count=n, modified_count=n)

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


class FakeResp:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    async def post(self, url, data=None, content=None, headers=None, follow_redirects=False):
        self.calls.append({"url": url, "data": data, "content": content, "headers": headers})
        payload = self.payload(url, data, content) if callable(self.payload) else self.payload
        return FakeResp(payload)


def _user(uid, company_ids, active, role="admin"):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }


def _contact(cid, company, token, balance=100.0, **extra):
    doc = {
        "_id": cid,
        "company_id": company,
        "type": "customer",
        "name": "Acme",
        "email": "acme@example.com",
        "phone": "555",
        "address": "Ist",
        "tax_number_or_id": "11111111111",
        "balance": balance,
        "b2b_enabled": True,
        "b2b_token": token,
        "is_active": True,
        "b2b_portal_settings": {},
    }
    doc.update(extra)
    return doc


def _company(cid, **settings):
    base = {
        "enabled": True,
        "card_payment_enabled": True,
        "card_max_installment": 6,
        "card_commission_payer": "buyer",
        "card_commission_rate": 2.5,
    }
    base.update(settings)
    return {"_id": cid, "name": cid, "b2b_settings": base}


def _nest(**overrides):
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


def _paytr(**overrides):
    doc = _nest(
        family="paytr",
        bank_label="PayTR mağaza",
        merchant_id="100001",
        merchant_key_enc=comm_service.encrypt(MERCHANT_KEY),
        merchant_salt_enc=comm_service.encrypt(MERCHANT_SALT),
    )
    doc.pop("client_id", None)
    doc.pop("store_key_enc", None)
    doc.pop("gateway_3d_url", None)
    doc.update(overrides)
    return doc


def _iyzi(**overrides):
    doc = _nest(
        family="iyzico",
        bank_label="iyzico",
        api_key=IYZICO_KEY,
        secret_key_enc=comm_service.encrypt(IYZICO_SECRET),
    )
    doc.pop("client_id", None)
    doc.pop("store_key_enc", None)
    doc.pop("gateway_3d_url", None)
    doc.update(overrides)
    return doc


def _signed_nest(intent, **overrides):
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


def _token(uid, role="admin"):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", role)


def _auth(uid, role="admin"):
    return {"Authorization": f"Bearer {_token(uid, role)}"}


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.append(_user("user-a", [COMP_A], COMP_A))
    db.users.docs.append(_user("user-b", [COMP_B], COMP_B))
    db.users.docs.append(_user("user-clerk", [COMP_A], COMP_A, role="clerk"))
    db.companies.docs.append(_company(COMP_A))
    db.companies.docs.append(_company(COMP_B, enabled=True, card_payment_enabled=False))
    db.contacts.docs.append(_contact("ct-a", COMP_A, "tok-a", balance=100))
    db.contacts.docs.append(_contact("ct-b", COMP_A, "tok-b", name="Diğer Cari", email="b@example.com", balance=80))
    db.contacts.docs.append(_contact("ct-zero", COMP_A, "tok-zero", balance=0))
    db.bank_accounts.docs.append({
        "_id": "pos1", "company_id": COMP_A, "type": "pos", "account_name": "Mağaza POS", "current_balance": 100.0,
    })
    db.vpos_configs.docs.append(_nest())
    db.platform_settings.docs.append({"_id": "platform", "public_url": "https://tamkobi.com"})
    db.roles.docs.append({
        "_id": "role-seed",
        "company_id": COMP_A,
        "code": "personel",
        "name": "Personel",
        "is_system": True,
        "permissions": {"/settings": "none"},
        "perm_levels_v2": True,
    })
    db.roles.docs.append({
        "_id": "role-clerk",
        "company_id": COMP_A,
        "code": "clerk",
        "name": "Katip",
        "is_system": False,
        "permissions": {"/settings": "edit"},
        "perm_levels_v2": True,
    })
    prev = (server.db, rbac._db, saas._db, addons._db)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    saas.invalidate()
    vpos_api.init(db, server.get_current_user)
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
        server.db, rbac._db, saas._db, addons._db = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _detail(response):
    body = response.json()
    detail = body.get("detail") if isinstance(body, dict) else body
    if isinstance(detail, list):
        return " ".join(str(x) for x in detail)
    return str(detail or "")


def _set_cfg(db, doc):
    db.vpos_configs.docs[:] = [doc]


def _intent(db, intent_id):
    return next(d for d in db.payment_intents.docs if d["_id"] == intent_id)


def _start(client, token="tok-a", amount="10.00", installment=1, **extra):
    body = {"amount": amount, "installment": installment, "description": "Bakiye"}
    body.update(extra)
    return client.post(f"/api/public/b2b/{token}/card-payments", json=body)


def _balance(db, cid):
    return next(d["balance"] for d in db.contacts.docs if d["_id"] == cid)


def _pos(db):
    return next(d["current_balance"] for d in db.bank_accounts.docs if d["_id"] == "pos1")


def _txs(db):
    return list(db.bank_transactions.docs)


def _assert_buyer_books(db, caplog):
    assert _balance(db, "ct-a") == pytest.approx(90.0)
    assert _pos(db) == pytest.approx(110.25)
    txs = _txs(db)
    assert len(txs) == 2
    main = next(t for t in txs if not str(t["_id"]).endswith(":fee"))
    fee = next(t for t in txs if str(t["_id"]).endswith(":fee"))
    assert main["amount"] == pytest.approx(10.0)
    assert main["contact_id"] == "ct-a"
    assert main["type"] == "inflow"
    assert fee["amount"] == pytest.approx(0.25)
    assert fee["category"] == "Kart komisyon farkı"
    assert "contact_id" not in fee
    assert fee["type"] == "inflow"
    assert main["_id"] == f"vpos:{main['vpos_intent_id']}"
    assert fee["_id"] == f"vpos:{main['vpos_intent_id']}:fee"
    titles = [n.get("title") for n in db.notifications.docs]
    assert "B2B kart tahsilatı" in titles
    blob = db.dump() + caplog.text
    for needle in (PAN, CVV, EXPIRY, STORE_KEY, MERCHANT_KEY, MERCHANT_SALT, IYZICO_SECRET):
        assert needle not in blob


def test_b2b_settings_auth(api):
    client, db = api
    no = client.get(f"/api/companies/{COMP_A}/b2b-settings")
    assert no.status_code == 401
    no_put = client.put(f"/api/companies/{COMP_A}/b2b-settings", json={"enabled": True})
    assert no_put.status_code == 401
    other = client.get(f"/api/companies/{COMP_B}/b2b-settings", headers=_auth("user-a"))
    assert other.status_code == 403
    other_put = client.put(
        f"/api/companies/{COMP_B}/b2b-settings",
        headers=_auth("user-a"),
        json={"enabled": True},
    )
    assert other_put.status_code == 403
    clerk = client.put(
        f"/api/companies/{COMP_A}/b2b-settings",
        headers=_auth("user-clerk", "clerk"),
        json={"card_payment_enabled": True, "card_max_installment": 3, "card_commission_payer": "seller", "card_commission_rate": 1},
    )
    assert clerk.status_code == 403
    ok = client.get(f"/api/companies/{COMP_A}/b2b-settings", headers=_auth("user-a"))
    assert ok.status_code == 200
    body = ok.json()
    assert set(body) >= {"settings", "customers", "active_count"}
    assert body["settings"]["card_payment_enabled"] is True
    assert body["settings"]["card_commission_payer"] == "buyer"
    saved = client.put(
        f"/api/companies/{COMP_A}/b2b-settings",
        headers=_auth("user-a"),
        json={
            **body["settings"],
            "card_max_installment": 3,
            "card_commission_payer": "seller",
            "card_commission_rate": 1.5,
            "card_payment_required": False,
        },
    )
    assert saved.status_code == 200
    assert saved.json()["status"] == "success"
    assert saved.json()["settings"]["card_max_installment"] == 3
    assert saved.json()["settings"]["card_commission_payer"] == "seller"
    assert saved.json()["settings"]["card_commission_rate"] == 1.5
    bad_rate = client.put(
        f"/api/companies/{COMP_A}/b2b-settings",
        headers=_auth("user-a"),
        json={**body["settings"], "card_commission_rate": 20.001},
    )
    assert bad_rate.status_code == 400
    bad_inst = client.put(
        f"/api/companies/{COMP_A}/b2b-settings",
        headers=_auth("user-a"),
        json={**body["settings"], "card_max_installment": 13},
    )
    assert bad_inst.status_code == 400
    bad_payer = client.put(
        f"/api/companies/{COMP_A}/b2b-settings",
        headers=_auth("user-a"),
        json={**body["settings"], "card_commission_payer": "bank"},
    )
    assert bad_payer.status_code == 400
    contact_bad = client.put(
        "/api/contacts/ct-a/b2b-portal",
        headers=_auth("user-a"),
        json={"settings": {"card_commission_rate": 21}},
    )
    assert contact_bad.status_code == 400
    assert db.companies.docs[0]["b2b_settings"]["card_commission_rate"] == 1.5


def test_card_payment_resolution(api):
    client, db = api
    view = client.get("/api/public/b2b/tok-a").json()["settings"]["card_payment"]
    assert view["enabled"] is True
    assert view["max_installment"] == 4
    assert view["commission_payer"] == "buyer"
    assert view["commission_rate"] == 2.5
    assert view["family"] == "nestpay"
    assert view["bank_label"] == "İş Bankası"
    assert "account_id" not in view
    assert "store_key" not in json.dumps(view)
    db.contacts.docs[0]["b2b_portal_settings"] = {"card_max_installment": 2, "card_commission_payer": "seller"}
    overridden = client.get("/api/public/b2b/tok-a").json()["settings"]["card_payment"]
    assert overridden["max_installment"] == 2
    assert overridden["commission_payer"] == "seller"
    cfg = db.vpos_configs.docs[0]
    cfg["no_installment"] = True
    assert client.get("/api/public/b2b/tok-a").json()["settings"]["card_payment"]["max_installment"] == 1
    cfg["no_installment"] = False
    cfg["account_id"] = ""
    assert client.get("/api/public/b2b/tok-a").json()["settings"]["card_payment"]["enabled"] is False
    missing = client.get("/api/public/b2b/nope")
    assert missing.status_code == 404


def test_card_quote_rounding(api):
    client, db = api
    buyer = client.get("/api/public/b2b/tok-a/card-quote", params={"amount": "10.00", "installment": 1})
    assert buyer.status_code == 200
    assert buyer.json() == {
        "base_amount": "10.00",
        "commission_amount": "0.25",
        "charge_amount": "10.25",
        "installment": 1,
    }
    db.companies.docs[0]["b2b_settings"]["card_commission_rate"] = 1.5
    odd = client.get("/api/public/b2b/tok-a/card-quote", params={"amount": "10.01", "installment": 1})
    assert odd.json()["charge_amount"] == "10.16"
    assert odd.json()["commission_amount"] == "0.15"
    db.companies.docs[0]["b2b_settings"]["card_commission_payer"] = "seller"
    db.companies.docs[0]["b2b_settings"]["card_commission_rate"] = 2.5
    seller = client.get("/api/public/b2b/tok-a/card-quote", params={"amount": "10.00"})
    assert seller.json()["charge_amount"] == "10.00"
    assert seller.json()["commission_amount"] == "0.00"
    assert seller.json()["base_amount"] == "10.00"


def test_card_payment_guards_and_start(api):
    client, db = api
    db.companies.docs[0]["b2b_settings"]["card_payment_enabled"] = False
    closed = _start(client)
    assert closed.status_code == 403
    db.companies.docs[0]["b2b_settings"]["card_payment_enabled"] = True
    assert client.post("/api/public/b2b/missing/card-payments", json={"amount": "10.00"}).status_code == 404
    assert _start(client, token="tok-zero").status_code == 400
    assert "Açık bakiye yok" in _detail(_start(client, token="tok-zero"))
    over = _start(client, amount="100.01")
    assert over.status_code == 400
    assert _start(client, installment=5).status_code == 400
    db.contacts.docs[0]["balance"] = 5000
    limited = _start(client, amount="1000.01")
    assert limited.status_code == 400
    db.contacts.docs[0]["balance"] = 100
    for _ in range(5):
        ok = _start(client, amount="10.00", installment=2)
        assert ok.status_code == 200, ok.text
        body = ok.json()
        assert body["kind"] == "form"
        assert body["action_url"]
        assert body["fields"]
        assert "pan" not in body["fields"]
    blocked = _start(client)
    assert blocked.status_code == 429
    assert len(db.payment_intents.docs) == 5
    intent = db.payment_intents.docs[0]
    assert intent["purpose"] == "b2b_collection"
    assert intent["source"] == "b2b_portal"
    assert intent["contact_id"] == "ct-a"
    assert intent["amount"] == "10.25"
    assert intent["ledger_amount"] == "10.00"
    assert intent["commission_amount"] == "0.25"
    assert intent["commission_payer"] == "buyer"
    assert intent["installment"] == 2
    assert "/api/vpos/callback/" in json.dumps(ok.json().get("fields") or {})


def test_nestpay_paid_is_idempotent_and_redirects_to_portal(api, caplog):
    client, db = api
    caplog.set_level("INFO")
    started = _start(client).json()
    intent = _intent(db, started["intent_id"])
    assert "/api/vpos/callback/" in started["fields"].get("okUrl", "") or "/api/vpos/callback/" in started["fields"].get("failUrl", "")
    first = client.post(f"/api/vpos/callback/{intent['_id']}", data=_signed_nest(intent), follow_redirects=False)
    assert first.status_code == 303
    assert f"/portal/tok-a/odeme/{intent['_id']}" in first.headers["location"]
    _assert_buyer_books(db, caplog)
    again = client.post(f"/api/vpos/callback/{intent['_id']}", data=_signed_nest(intent), follow_redirects=False)
    assert again.status_code == 303
    _assert_buyer_books(db, caplog)
    other = client.get(f"/api/public/b2b/tok-b/card-payments/{intent['_id']}")
    assert other.status_code == 404
    own = client.get(f"/api/public/b2b/tok-a/card-payments/{intent['_id']}")
    assert own.status_code == 200
    assert own.json()["status"] == "paid"
    assert own.json()["charge_amount"] == "10.25"
    assert own.json()["base_amount"] == "10.00"
    assert own.json()["balance"] == pytest.approx(90.0)


def test_paytr_paid_buyer_books_once(api, caplog):
    client, db = api
    caplog.set_level("INFO")
    _set_cfg(db, _paytr())
    http = FakeClient({"status": "success", "token": "iframeToken1"})
    vpos_api.set_outbound_client(http)
    started = _start(client)
    assert started.status_code == 200, started.text
    assert started.json()["kind"] == "iframe"
    posted = http.calls[0]["data"]
    intent = _intent(db, started.json()["intent_id"])
    assert f"/portal/tok-a/odeme/{intent['_id']}" in posted["merchant_ok_url"]
    assert f"/portal/tok-a/odeme/{intent['_id']}" in posted["merchant_fail_url"]
    assert "/api/vpos/paytr/notify/" not in posted["merchant_ok_url"]
    form = {
        "merchant_oid": intent["order_id"],
        "status": "success",
        "total_amount": paytr.payment_amount_kurus(intent["amount"]),
    }
    form["hash"] = paytr.notify_hash(MERCHANT_KEY, form["merchant_oid"], MERCHANT_SALT, form["status"], form["total_amount"])
    note = client.post(f"/api/vpos/paytr/notify/cfg-1", data=form)
    assert note.status_code == 200
    assert note.text == "OK"
    _assert_buyer_books(db, caplog)
    client.post(f"/api/vpos/paytr/notify/cfg-1", data=form)
    _assert_buyer_books(db, caplog)


def test_iyzico_paid_buyer_books_once(api, caplog):
    client, db = api
    caplog.set_level("INFO")
    _set_cfg(db, _iyzi())
    http = FakeClient({
        "status": "success",
        "token": "iyzitoken1",
        "paymentPageUrl": "https://sandbox.iyzipay.com/pay/iyzitoken1",
    })
    vpos_api.set_outbound_client(http)
    started = _start(client)
    assert started.status_code == 200, started.text
    assert started.json()["kind"] == "redirect"
    raw = http.calls[0]["content"]
    body = json.loads(raw)
    assert "/api/vpos/iyzico/callback/" in body["callbackUrl"]
    assert "/portal/" not in body["callbackUrl"]
    intent = _intent(db, started.json()["intent_id"])
    payload = {
        "status": "success",
        "paymentStatus": "SUCCESS",
        "paymentId": "99",
        "currency": "TRY",
        "basketId": intent["order_id"],
        "conversationId": intent["_id"],
        "paidPrice": intent["amount"],
        "price": intent["amount"],
        "token": "iyzitoken1",
    }
    payload["signature"] = iyzico.response_signature(IYZICO_SECRET, payload)
    vpos_api.set_outbound_client(FakeClient(payload))
    back = client.post(
        f"/api/vpos/iyzico/callback/{intent['_id']}",
        data={"token": "iyzitoken1"},
        follow_redirects=False,
    )
    assert back.status_code == 303
    assert f"/portal/tok-a/odeme/{intent['_id']}" in back.headers["location"]
    _assert_buyer_books(db, caplog)
    client.post(
        f"/api/vpos/iyzico/callback/{intent['_id']}",
        data={"token": "iyzitoken1"},
        follow_redirects=False,
    )
    _assert_buyer_books(db, caplog)


def test_seller_has_no_fee_line(api):
    client, db = api
    db.companies.docs[0]["b2b_settings"]["card_commission_payer"] = "seller"
    started = _start(client)
    intent = _intent(db, started.json()["intent_id"])
    assert intent["amount"] == "10.00"
    assert intent["ledger_amount"] == "10.00"
    assert intent["commission_amount"] == "0.00"
    client.post(f"/api/vpos/callback/{intent['_id']}", data=_signed_nest(intent), follow_redirects=False)
    assert _balance(db, "ct-a") == pytest.approx(90.0)
    assert _pos(db) == pytest.approx(110.0)
    assert len(_txs(db)) == 1
    assert _txs(db)[0]["amount"] == pytest.approx(10.0)


def test_failed_and_expired_do_not_post(api):
    client, db = api
    started = _start(client)
    intent = _intent(db, started.json()["intent_id"])
    declined = _signed_nest(intent, Response="Declined", ProcReturnCode="05", mdStatus="0", AuthCode="")
    fail = client.post(f"/api/vpos/callback/{intent['_id']}", data=declined, follow_redirects=False)
    assert fail.status_code == 303
    assert _txs(db) == []
    assert _balance(db, "ct-a") == pytest.approx(100.0)
    assert _pos(db) == pytest.approx(100.0)
    vpos_api.reset_callback_rate_limit()
    second = _start(client, token="tok-b", amount="10.00")
    assert second.status_code == 200, second.text
    expired = _intent(db, second.json()["intent_id"])
    expired_doc = next(d for d in db.payment_intents.docs if d["_id"] == expired["_id"])
    expired_doc["expires_at"] = "2000-01-01T00:00:00+00:00"
    old = client.post(f"/api/vpos/callback/{expired['_id']}", data=_signed_nest(expired), follow_redirects=False)
    assert old.status_code == 303
    assert _txs(db) == []
    assert next(d for d in db.payment_intents.docs if d["_id"] == expired["_id"])["status"] == "expired"


def test_contact_failure_rolls_back_and_retries_once(api):
    client, db = api
    started = _start(client)
    intent = _intent(db, started.json()["intent_id"])
    original = db.contacts.update_one
    state = {"n": 0}

    async def boom(query, update, upsert=False):
        if "$inc" in (update or {}) and "balance" in (update.get("$inc") or {}):
            state["n"] += 1
            if state["n"] == 1:
                raise RuntimeError("contact down")
        return await original(query, update, upsert=upsert)

    db.contacts.update_one = boom
    client.post(f"/api/vpos/callback/{intent['_id']}", data=_signed_nest(intent), follow_redirects=False)
    assert _balance(db, "ct-a") == pytest.approx(100.0)
    assert _pos(db) == pytest.approx(100.0)
    assert _txs(db) == []
    client.post(f"/api/vpos/callback/{intent['_id']}", data=_signed_nest(intent), follow_redirects=False)
    assert state["n"] == 2
    assert _balance(db, "ct-a") == pytest.approx(90.0)
    assert _pos(db) == pytest.approx(110.25)
    assert len(_txs(db)) == 2
