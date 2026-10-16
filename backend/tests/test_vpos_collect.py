"""Cari kart tahsilatı: yetki, taksit, üç ailede idempotent kasa/cari kaydı.

Dış HTTP yok. Tutar intent'ten gelir. Kart numarası, CVV ve son kullanma
logda ve kayıtta bulunmaz.
"""
import copy
import json
import logging
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import bank_guard
import comm_service
import public_url
import rbac
import vpos.api as vpos_api
import vpos.iyzico as iyzico
import vpos.nestpay as nestpay
import vpos.paytr as paytr
from vpos.collect import tr_today

PAN = "4531440099991234"
CVV = "cvvX7421Z"
EXPIRY = "12/29"
STORE_KEY = "TEST1234"
MERCHANT_KEY = "paytr-key-do-not-log"
MERCHANT_SALT = "paytr-salt-do-not-log"
IYZICO_KEY = "sandbox-api-key-value"
IYZICO_SECRET = "sandbox-secret-do-not-log"
LIVE_GATEWAY = "https://sanalpos.isbank.com.tr/fim/est3Dgate"


def _match(doc, query):
    for key, expected in (query or {}).items():
        if str(key).startswith("$"):
            continue
        if doc.get(key) != expected:
            return False
    return True


class FakeColl:
    def __init__(self, docs=None):
        self.docs = {}
        self.update_count = 0
        for doc in docs or []:
            self.docs[doc["_id"]] = copy.deepcopy(doc)

    async def find_one(self, query):
        for doc in self.docs.values():
            if _match(doc, query):
                return copy.deepcopy(doc)
        return None

    async def insert_one(self, doc):
        if doc["_id"] in self.docs:
            raise RuntimeError("duplicate")
        self.docs[doc["_id"]] = copy.deepcopy(doc)
        return SimpleNamespace(inserted_id=doc["_id"])

    async def delete_one(self, query):
        for key, doc in list(self.docs.items()):
            if _match(doc, query):
                self.docs.pop(key)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs.values():
            if not _match(doc, query):
                continue
            if "$set" in update:
                doc.update(update["$set"])
            if "$unset" in update:
                for name in update["$unset"]:
                    doc.pop(name, None)
            if "$inc" in update:
                for name, delta in update["$inc"].items():
                    doc[name] = float(doc.get(name) or 0) + float(delta)
            self.update_count += 1
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class FakeDB:
    def __init__(self):
        self.vpos_configs = FakeColl()
        self.payment_intents = FakeColl()
        self.bank_accounts = FakeColl([
            {"_id": "pos1", "company_id": "c1", "type": "pos", "account_name": "Mağaza POS", "current_balance": 100.0},
            {"_id": "card1", "company_id": "c1", "type": "credit_card", "account_name": "Kart", "current_balance": 0},
        ])
        self.bank_transactions = FakeColl()
        self.contacts = FakeColl([
            {"_id": "ct1", "company_id": "c1", "name": "Acme", "balance": 50.0, "email": "acme@example.com", "phone": "555", "address": "Ist", "tax_number_or_id": "11111111111"},
            {"_id": "ct2", "company_id": "c2", "name": "Diğer", "balance": 9.0},
        ])
        self.company_audit_log = FakeColl()
        self.platform_settings = FakeColl([{"_id": "platform", "public_url": "https://tamkobi.com"}])

    def __getitem__(self, name):
        return getattr(self, name)


class Req:
    def __init__(self, form=None, ip="203.0.113.8", path="/api/vpos/collect"):
        self._form = form or {}
        self.client = SimpleNamespace(host=ip)
        self.headers = {}
        self.method = "POST"
        self.url = SimpleNamespace(path=path)
        self.query_params = {}

    async def form(self):
        return self._form


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
        return FakeResp(self.payload)


def _run(coro):
    import asyncio
    return asyncio.run(coro)


def _user(role="admin", company="c1", companies=None, permissions=None):
    user = {
        "id": "u-" + role,
        "name": "Kullanıcı",
        "email": "user@example.com",
        "role": role,
        "company_ids": companies if companies is not None else [company],
        "active_company_id": company,
    }
    if permissions is not None:
        user["permissions"] = permissions
    return user


def _bind(db, user):
    async def _current(_request):
        if user is None:
            raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
        return user

    vpos_api.init(db, get_current_user=_current)


@pytest.fixture
def db(monkeypatch):
    database = FakeDB()
    vpos_api.init(database, get_current_user=None)
    vpos_api.reset_callback_rate_limit()
    vpos_api.set_outbound_client(None)

    async def _base(*_args, **_kwargs):
        return "https://app.example.com"

    monkeypatch.setattr(public_url, "public_base_url_for", _base)
    yield database
    vpos_api.set_outbound_client(None)
    vpos_api.reset_callback_rate_limit()


def _nest_cfg(**overrides):
    doc = {
        "_id": "cfg-nest",
        "company_id": "c1",
        "family": "nestpay",
        "bank_label": "İş Bankası",
        "mode": "test",
        "client_id": "100200127",
        "store_key_enc": comm_service.encrypt(STORE_KEY),
        "gateway_3d_url": nestpay.PAYTEN_TEST_3D_URL,
        "account_id": "pos1",
        "enabled": True,
        "max_installment": 6,
        "no_installment": False,
    }
    doc.update(overrides)
    return doc


def _paytr_cfg(**overrides):
    doc = {
        "_id": "cfg-paytr",
        "company_id": "c1",
        "family": "paytr",
        "bank_label": "PayTR mağaza",
        "mode": "test",
        "merchant_id": "100001",
        "merchant_key_enc": comm_service.encrypt(MERCHANT_KEY),
        "merchant_salt_enc": comm_service.encrypt(MERCHANT_SALT),
        "max_installment": 6,
        "no_installment": False,
        "account_id": "pos1",
        "enabled": True,
    }
    doc.update(overrides)
    return doc


def _iyzi_cfg(**overrides):
    doc = {
        "_id": "cfg-iyzi",
        "company_id": "c1",
        "family": "iyzico",
        "bank_label": "iyzico",
        "mode": "test",
        "api_key": IYZICO_KEY,
        "secret_key_enc": comm_service.encrypt(IYZICO_SECRET),
        "max_installment": 3,
        "account_id": "pos1",
        "enabled": True,
    }
    doc.update(overrides)
    return doc


def _collect(db, user=None, **body):
    _bind(db, _user() if user is None else user)
    payload = {"company_id": "c1", "contact_id": "ct1", "amount": "10.00", "description": "Kapora"}
    payload.update(body)
    return _run(vpos_api.collect_payment(payload, Req()))


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


def _nest_callback(db, intent, form):
    return _run(vpos_api.vpos_callback(intent["_id"], Req(form=form, path=f"/api/vpos/callback/{intent['_id']}")))


def _assert_no_card(blob, caplog):
    for needle in (PAN, CVV, EXPIRY, STORE_KEY, MERCHANT_KEY, MERCHANT_SALT, IYZICO_SECRET):
        assert needle not in blob
        assert needle not in caplog.text


def test_collect_requires_session_and_same_company(db):
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg()
    _bind(db, None)
    with pytest.raises(HTTPException) as err:
        _run(vpos_api.collect_payment({"company_id": "c1", "contact_id": "ct1", "amount": "1.00"}, Req()))
    assert err.value.status_code == 401
    _bind(db, _user())
    with pytest.raises(HTTPException) as missing:
        _run(vpos_api.collect_payment({"company_id": "c1", "contact_id": "ct2", "amount": "1.00"}, Req()))
    assert missing.value.status_code == 404
    with pytest.raises(HTTPException) as other:
        _run(vpos_api.collect_payment({"company_id": "c2", "contact_id": "ct1", "amount": "1.00"}, Req()))
    assert other.value.status_code == 403


def test_collect_config_and_account_guards(db, monkeypatch):
    _bind(db, _user())
    with pytest.raises(HTTPException) as missing:
        _collect(db)
    assert missing.value.status_code == 400
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg(enabled=False)
    with pytest.raises(HTTPException) as closed:
        _collect(db)
    assert closed.value.status_code == 400
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg(account_id="")
    with pytest.raises(HTTPException) as no_acc:
        _collect(db)
    assert no_acc.value.status_code == 400
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg(account_id="card1")

    async def _blocked(_db, _account_id):
        raise HTTPException(status_code=400, detail=bank_guard.NO_COLLECT_MSG)

    monkeypatch.setattr(bank_guard, "assert_collection_allowed", _blocked)
    with pytest.raises(HTTPException) as blocked:
        _collect(db)
    assert blocked.value.status_code == 400
    assert db.bank_transactions.docs == {}
    assert db.contacts.docs["ct1"]["balance"] == 50.0


def test_sales_can_collect_view_cannot(db):
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg()
    body = _collect(db, user=_user(role="sales", permissions={"/contacts": "edit", "/settings": "none"}))
    assert body["kind"] == "form"
    assert "taksit" not in body["fields"]
    with pytest.raises(HTTPException) as err:
        _collect(db, user=_user(role="warehouse", permissions={"/contacts": "view", "/settings": "edit"}))
    assert err.value.status_code == 403


def test_installment_rules_and_nestpay_hash(db):
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg(no_installment=True, max_installment=6)
    with pytest.raises(HTTPException) as closed:
        _collect(db, installment=2)
    assert closed.value.status_code == 400
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg(max_installment=3, no_installment=False)
    with pytest.raises(HTTPException) as over:
        _collect(db, installment=4)
    assert over.value.status_code == 400
    with pytest.raises(HTTPException) as zero:
        _collect(db, installment=0)
    assert zero.value.status_code == 400
    body = _collect(db, installment=3, amount="10.50")
    fields = body["fields"]
    assert fields["taksit"] == "3"
    assert fields["Instalment"] == ""
    assert fields["amount"] == "10.50"
    plain = nestpay.hash_plaintext(fields, STORE_KEY)
    assert "|3|" in plain
    assert nestpay.hashes_equal(nestpay.hash_ver3(fields, STORE_KEY), fields["hash"])
    assert STORE_KEY not in json.dumps(body)
    single = _collect(db, installment=1)
    assert "taksit" not in single["fields"]
    intent = db.payment_intents.docs[body["intent_id"]]
    assert intent["purpose"] == "contact_collection"
    assert intent["installment"] == 3
    assert intent["contact_id"] == "ct1"
    assert intent["created_by"] == "u-admin"


def test_test_mode_cap_and_live_has_none(db):
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg()
    with pytest.raises(HTTPException) as err:
        _collect(db, amount="1000.01")
    assert err.value.status_code == 400
    with pytest.raises(HTTPException) as bad:
        _collect(db, amount="1.009")
    assert bad.value.status_code == 400
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg(mode="live", gateway_3d_url=LIVE_GATEWAY)
    body = _collect(db, amount="1500.00")
    assert body["fields"]["amount"] == "1500.00"
    assert body["action_url"] == LIVE_GATEWAY


def test_collect_options_hide_secrets(db):
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg()
    _bind(db, _user(role="sales", permissions={"/contacts": "edit", "/settings": "none"}))
    options = _run(vpos_api.collect_options(Req(path="/api/vpos/collect-options"), company_id="c1"))
    assert options == {
        "enabled": True,
        "family": "nestpay",
        "bank_label": "İş Bankası",
        "mode": "test",
        "max_installment": 6,
        "no_installment": False,
    }
    assert "store_key" not in options and "account_id" not in options
    db.vpos_configs.docs["cfg-nest"]["enabled"] = False
    closed = _run(vpos_api.collect_options(Req(path="/api/vpos/collect-options"), company_id="c1"))
    assert closed["enabled"] is False
    with pytest.raises(HTTPException) as err:
        _run(vpos_api.get_vpos_config(Req(path="/api/vpos/configs"), company_id="c1"))
    assert err.value.status_code == 403


def test_nestpay_paid_callback_is_idempotent_and_ignores_callback_amount(db, caplog):
    caplog.set_level(logging.DEBUG)
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg()
    started = _collect(db, amount="10.00", installment=2)
    intent = db.payment_intents.docs[started["intent_id"]]
    mismatch = _signed_nest(intent, amount="99.99")
    _nest_callback(db, intent, mismatch)
    assert db.payment_intents.docs[intent["_id"]]["status"] == "failed"
    assert db.bank_transactions.docs == {}
    assert db.bank_accounts.docs["pos1"]["current_balance"] == 100.0
    assert db.contacts.docs["ct1"]["balance"] == 50.0

    started = _collect(db, amount="10.00", installment=2)
    intent = db.payment_intents.docs[started["intent_id"]]
    bad = _signed_nest(intent)
    bad["hash"] = "A" * len(bad["hash"])
    _nest_callback(db, intent, bad)
    assert db.payment_intents.docs[intent["_id"]]["status"] == "failed"
    assert db.bank_transactions.docs == {}

    expired = copy.deepcopy(intent)
    expired["_id"] = "intent-expired"
    expired["order_id"] = "ord-exp"
    expired["status"] = "pending"
    expired["expires_at"] = "2000-01-01T00:00:00+00:00"
    db.payment_intents.docs[expired["_id"]] = expired
    _nest_callback(db, expired, _signed_nest(expired))
    assert db.payment_intents.docs[expired["_id"]]["status"] == "expired"
    assert db.bank_transactions.docs == {}

    started = _collect(db, amount="10.00", installment=2)
    intent = db.payment_intents.docs[started["intent_id"]]
    ok = _nest_callback(db, intent, _signed_nest(intent))
    assert ok.status_code == 303
    stored = db.payment_intents.docs[intent["_id"]]
    assert stored["status"] == "paid"
    tx_id = f"vpos:{intent['_id']}"
    assert stored["collection_tx_id"] == tx_id
    tx = db.bank_transactions.docs[tx_id]
    assert tx["type"] == "inflow"
    assert tx["category"] == "Cari Tahsilat"
    assert tx["source"] == "vpos"
    assert tx["amount"] == 10.0
    assert tx["contact_id"] == "ct1"
    assert tx["contact_name"] == "Acme"
    assert tx["account_id"] == "pos1"
    assert tx["account_name"] == "Mağaza POS"
    assert tx["date"] == tr_today()
    assert tx["auth_code"] == "123456"
    assert tx["masked_pan"] == "453144******1234"
    assert tx["installment"] == 2
    assert tx["vpos_intent_id"] == intent["_id"]
    assert db.bank_accounts.docs["pos1"]["current_balance"] == 110.0
    assert db.contacts.docs["ct1"]["balance"] == 40.0
    _nest_callback(db, intent, _signed_nest(intent))
    assert list(db.bank_transactions.docs) == [tx_id]
    assert db.bank_accounts.docs["pos1"]["current_balance"] == 110.0
    assert db.contacts.docs["ct1"]["balance"] == 40.0
    public = _run(vpos_api.get_payment_intent(intent["_id"], Req()))
    assert public["collection_tx_id"] == tx_id
    assert public["installment"] == 2
    assert public["contact_id"] == "ct1"
    assert len(db.bank_transactions.docs) == 1
    _assert_no_card(json.dumps(db.bank_transactions.docs) + json.dumps(db.payment_intents.docs), caplog)


def test_paytr_and_iyzico_paid_once_and_test_purpose_skips_ledger(db, caplog):
    caplog.set_level(logging.DEBUG)
    db.vpos_configs.docs["cfg-paytr"] = _paytr_cfg()
    client = FakeClient({"status": "success", "token": "28cc613c3d7633cfa4ed0956fdf901e0"})
    vpos_api.set_outbound_client(client)
    started = _collect(db, amount="10.00", installment=2)
    assert started["kind"] == "iframe"
    posted = client.calls[0]["data"]
    assert posted["max_installment"] == "6"
    assert posted["no_installment"] == "0"
    assert "installment" not in posted
    assert MERCHANT_KEY not in json.dumps(posted)
    intent = db.payment_intents.docs[started["intent_id"]]
    form = {
        "merchant_oid": intent["order_id"],
        "status": "success",
        "total_amount": "1000",
        "payment_type": "card",
    }
    form["hash"] = paytr.notify_hash(MERCHANT_KEY, form["merchant_oid"], MERCHANT_SALT, "success", "1000")
    bad = dict(form)
    bad["hash"] = "B" * len(form["hash"])
    with pytest.raises(HTTPException):
        _run(vpos_api.paytr_notify("cfg-paytr", Req(form=bad, path="/api/vpos/paytr/notify/cfg-paytr")))
    assert db.bank_transactions.docs == {}
    mismatch = dict(form)
    mismatch["total_amount"] = "9999"
    mismatch["hash"] = paytr.notify_hash(MERCHANT_KEY, intent["order_id"], MERCHANT_SALT, "success", "9999")
    _run(vpos_api.paytr_notify("cfg-paytr", Req(form=mismatch, path="/api/vpos/paytr/notify/cfg-paytr")))
    assert db.payment_intents.docs[intent["_id"]]["status"] == "failed"
    assert db.bank_transactions.docs == {}

    fresh = _collect(db, amount="10.00")
    intent = db.payment_intents.docs[fresh["intent_id"]]
    form["merchant_oid"] = intent["order_id"]
    form["hash"] = paytr.notify_hash(MERCHANT_KEY, intent["order_id"], MERCHANT_SALT, "success", "1000")
    _run(vpos_api.paytr_notify("cfg-paytr", Req(form=form, path="/api/vpos/paytr/notify/cfg-paytr")))
    _run(vpos_api.paytr_notify("cfg-paytr", Req(form=form, path="/api/vpos/paytr/notify/cfg-paytr")))
    assert list(db.bank_transactions.docs) == [f"vpos:{intent['_id']}"]
    assert db.bank_transactions.docs[f"vpos:{intent['_id']}"]["amount"] == 10.0
    assert db.bank_accounts.docs["pos1"]["current_balance"] == 110.0
    assert db.contacts.docs["ct1"]["balance"] == 40.0

    db.bank_transactions.docs.clear()
    db.bank_accounts.docs["pos1"]["current_balance"] = 100.0
    db.contacts.docs["ct1"]["balance"] = 50.0
    db.vpos_configs.docs.clear()
    db.vpos_configs.docs["cfg-iyzi"] = _iyzi_cfg()
    page = "https://sandbox-cpp.iyzipay.com/?token=tok-provider-1&lang=tr"
    init_client = FakeClient({"status": "success", "token": "tok-provider-1", "paymentPageUrl": page})
    vpos_api.set_outbound_client(init_client)
    started = _collect(db, amount="10.00", installment=2)
    assert started["kind"] == "redirect"
    posted_body = json.loads(init_client.calls[0]["content"].decode("utf-8"))
    assert "installment" not in posted_body
    assert IYZICO_SECRET not in json.dumps(posted_body)
    intent = db.payment_intents.docs[started["intent_id"]]
    retrieve = {
        "status": "success",
        "paymentStatus": "SUCCESS",
        "paymentId": "22416032",
        "currency": "TRY",
        "basketId": intent["order_id"],
        "conversationId": intent["_id"],
        "paidPrice": "99.99",
        "price": "99.99",
        "token": intent["provider_ref"],
    }
    retrieve["signature"] = iyzico.response_signature(IYZICO_SECRET, retrieve)
    vpos_api.set_outbound_client(FakeClient(retrieve))
    _run(vpos_api.iyzico_callback(intent["_id"], Req(form={"token": intent["provider_ref"]}, path=f"/api/vpos/iyzico/callback/{intent['_id']}")))
    assert db.payment_intents.docs[intent["_id"]]["status"] == "failed"
    assert db.bank_transactions.docs == {}

    good = dict(retrieve)
    good["paidPrice"] = "10.00"
    good["price"] = "10.00"
    good["signature"] = iyzico.response_signature(IYZICO_SECRET, good)
    vpos_api.set_outbound_client(FakeClient(good))
    _run(vpos_api.iyzico_callback(intent["_id"], Req(form={"token": intent["provider_ref"]}, path=f"/api/vpos/iyzico/callback/{intent['_id']}")))
    assert db.payment_intents.docs[intent["_id"]]["status"] == "failed"
    # amount mismatch already claimed the intent; a later success must not ledger it
    assert db.bank_transactions.docs == {}

    vpos_api.set_outbound_client(init_client)
    started = _collect(db, amount="10.00")
    intent = db.payment_intents.docs[started["intent_id"]]
    good["basketId"] = intent["order_id"]
    good["conversationId"] = intent["_id"]
    good["token"] = intent["provider_ref"]
    good["signature"] = iyzico.response_signature(IYZICO_SECRET, good)
    bad_sig = dict(good)
    bad_sig["signature"] = "a" * 64
    vpos_api.set_outbound_client(FakeClient(bad_sig))
    _run(vpos_api.iyzico_callback(intent["_id"], Req(form={"token": intent["provider_ref"]}, path=f"/api/vpos/iyzico/callback/{intent['_id']}")))
    assert db.payment_intents.docs[intent["_id"]]["status"] == "failed"
    assert db.bank_transactions.docs == {}

    vpos_api.set_outbound_client(init_client)
    started = _collect(db, amount="10.00")
    intent = db.payment_intents.docs[started["intent_id"]]
    good["basketId"] = intent["order_id"]
    good["conversationId"] = intent["_id"]
    good["token"] = intent["provider_ref"]
    good["signature"] = iyzico.response_signature(IYZICO_SECRET, good)
    vpos_api.set_outbound_client(FakeClient(good))
    _run(vpos_api.iyzico_callback(intent["_id"], Req(form={"token": intent["provider_ref"]}, path=f"/api/vpos/iyzico/callback/{intent['_id']}")))
    _run(vpos_api.iyzico_callback(intent["_id"], Req(form={"token": intent["provider_ref"]}, path=f"/api/vpos/iyzico/callback/{intent['_id']}")))
    tx_id = f"vpos:{intent['_id']}"
    assert list(db.bank_transactions.docs) == [tx_id]
    assert db.bank_transactions.docs[tx_id]["amount"] == 10.0
    assert db.bank_accounts.docs["pos1"]["current_balance"] == 110.0
    assert db.contacts.docs["ct1"]["balance"] == 40.0

    db.vpos_configs.docs.clear()
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg()
    _bind(db, _user())
    test_body = _run(vpos_api.test_payment({"amount": "1.00", "company_id": "c1"}, Req(path="/api/vpos/test-payment")))
    test_intent = db.payment_intents.docs[test_body["intent_id"]]
    assert test_intent["purpose"] == "test"
    assert "installment" not in test_intent
    before_tx = dict(db.bank_transactions.docs)
    before_acc = db.bank_accounts.docs["pos1"]["current_balance"]
    before_contact = db.contacts.docs["ct1"]["balance"]
    _nest_callback(db, test_intent, _signed_nest(test_intent, amount="1.00"))
    assert db.payment_intents.docs[test_intent["_id"]]["status"] == "paid"
    assert db.bank_transactions.docs == before_tx
    assert db.bank_accounts.docs["pos1"]["current_balance"] == before_acc
    assert db.contacts.docs["ct1"]["balance"] == before_contact
    _assert_no_card(json.dumps({"tx": db.bank_transactions.docs, "intents": db.payment_intents.docs}), caplog)


def test_get_intent_does_not_post_and_callback_retries_failure(db, monkeypatch):
    db.vpos_configs.docs["cfg-nest"] = _nest_cfg()
    started = _collect(db, amount="10.00")
    intent = db.payment_intents.docs[started["intent_id"]]
    real_update = db.bank_accounts.update_one

    async def _boom(query, update, upsert=False):
        db.bank_accounts.update_one = real_update
        raise RuntimeError("db down")

    db.bank_accounts.update_one = _boom
    _nest_callback(db, intent, _signed_nest(intent))
    stored = db.payment_intents.docs[intent["_id"]]
    assert stored["status"] == "paid"
    assert stored.get("collection_error") == "post_failed"
    assert stored.get("collection_tx_id") in (None, "")
    assert db.bank_transactions.docs == {}
    assert db.bank_accounts.docs["pos1"]["current_balance"] == 100.0
    _bind(db, _user())
    seen = _run(vpos_api.get_payment_intent(intent["_id"], Req()))
    assert seen["status"] == "paid"
    assert seen["collection_tx_id"] is None
    assert db.bank_transactions.docs == {}
    _nest_callback(db, intent, _signed_nest(intent))
    tx_id = f"vpos:{intent['_id']}"
    assert db.bank_transactions.docs[tx_id]["amount"] == 10.0
    assert db.payment_intents.docs[intent["_id"]]["collection_tx_id"] == tx_id
    assert db.payment_intents.docs[intent["_id"]]["collection_error"] is None
    assert db.bank_accounts.docs["pos1"]["current_balance"] == 110.0
    assert db.contacts.docs["ct1"]["balance"] == 40.0


def test_collect_route_is_not_public_and_uses_contact_permission():
    sales = {"/contacts": "edit", "/settings": "none"}
    assert rbac.mutation_allowed("/settings", "/api/vpos/collect", sales, "POST") is True
    assert rbac.mutation_allowed("/settings", "/api/vpos/test-payment", sales, "POST") is False
    assert rbac.mutation_allowed("/settings", "/api/vpos/configs", sales, "PUT") is False
    view = {"/contacts": "view", "/settings": "none"}
    assert rbac.mutation_allowed("/settings", "/api/vpos/collect", view, "POST") is False
    assert rbac.is_public_api_path("/api/vpos/collect", "POST") is False
    assert rbac.is_public_api_path("/api/vpos/collect-options", "GET") is False
    assert rbac.module_for_path("/api/vpos/collect") == "/settings"


def test_put_config_checks_collection_allowed(db, monkeypatch):
    async def _blocked(_db, _account_id):
        raise HTTPException(status_code=400, detail=bank_guard.NO_COLLECT_MSG)

    monkeypatch.setattr(bank_guard, "assert_collection_allowed", _blocked)
    _bind(db, _user())
    with pytest.raises(HTTPException) as err:
        _run(vpos_api.put_vpos_config({
            "company_id": "c1",
            "family": "nestpay",
            "bank_label": "İş Bankası",
            "mode": "test",
            "client_id": "100200127",
            "store_key": STORE_KEY,
            "account_id": "pos1",
            "enabled": True,
        }, Req(path="/api/vpos/configs")))
    assert err.value.status_code == 400
