"""Kuveyt Türk güvenli ortak ödeme.

Gerçek ağa, veritabanına ve 8021'e bağlanmaz. hashData banka örneğine
bağlanmaz; yer tutucu fonksiyonun deterministikliği ölçülür.
"""
import base64
import copy
import hashlib
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import comm_service
import public_url
import rbac
import vpos.api as vpos_api
import vpos.kuveytturk as kuveytturk
from vpos.base import get_adapter

PASSWORD = "KtPasswordSecret99"
CLIENT_SECRET = "KtClientSecretSecret99"
CLIENT_ID = "kt-client-9f3a"
ACCESS = "kt-access-SHOULD-NOT-LEAK"
PAGE = (
    "https://boatest.kuveytturk.com.tr/boa.virtualpos.services/KTPay/SecurePayment"
    "?token=page-token-78cf2402&lang=TR"
)
PAN = "5188961939192544"
CVV = "7391"
EXPIRY = "1299"
MERCHANT = "496"
CUSTOMER = "400235"
USERNAME = "apitest"
EMAIL = "ada@example.com"


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

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs.values():
            if not _match(doc, query):
                continue
            if "$set" in update:
                doc.update(update["$set"])
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
            {"_id": "pos1", "company_id": "c1", "type": "pos", "account_name": "KT POS", "current_balance": 100.0},
            {"_id": "pos2", "company_id": "c2", "type": "pos", "account_name": "Diger", "current_balance": 80.0},
        ])
        self.bank_transactions = FakeColl()
        self.contacts = FakeColl([
            {"_id": "ct1", "company_id": "c1", "name": "Acme", "balance": 50.0, "email": EMAIL},
            {"_id": "ct2", "company_id": "c2", "name": "Diger", "balance": 9.0},
        ])
        self.company_audit_log = FakeColl()
        self.platform_settings = FakeColl([{"_id": "platform", "public_url": "https://app.example.com"}])

    def __getitem__(self, name):
        return getattr(self, name)


class FakeResp:
    def __init__(self, payload, status=200):
        self.status_code = status
        self._payload = payload
        self.text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return json.loads(self.text)


class FakeClient:
    def __init__(self, routes):
        self.routes = list(routes)
        self.calls = []

    async def post(self, url, data=None, content=None, headers=None, **kwargs):
        self.calls.append({"url": url, "data": data, "content": content, "headers": dict(headers or {})})
        for key, payload in self.routes:
            if key in url:
                if isinstance(payload, Exception):
                    raise payload
                status = 200
                body = payload
                if isinstance(payload, tuple):
                    status, body = payload
                return FakeResp(body, status=status)
        raise AssertionError(url)


class Req:
    def __init__(self, form=None, ip="203.0.113.8", path="/api/vpos/kuveytturk/return/x", method="POST", query=None):
        self._form = form or {}
        self.client = SimpleNamespace(host=ip)
        self.headers = {}
        self.method = method
        self.url = SimpleNamespace(path=path)
        self.query_params = query or {}

    async def form(self):
        return self._form


def _run(coro):
    import asyncio
    return asyncio.run(coro)


def _user():
    return {
        "id": "u-admin",
        "name": "Ada Lovelace",
        "email": EMAIL,
        "role": "admin",
        "company_ids": ["c1"],
        "active_company_id": "c1",
    }


@pytest.fixture
def db(monkeypatch):
    database = FakeDB()
    kuveytturk.clear_token_cache()
    vpos_api.init(database, get_current_user=None)
    vpos_api.reset_callback_rate_limit()
    vpos_api.set_outbound_client(None)

    async def _base(*_args, **_kwargs):
        return "https://app.example.com"

    monkeypatch.setattr(public_url, "public_base_url_for", _base)
    yield database
    vpos_api.set_outbound_client(None)
    vpos_api.reset_callback_rate_limit()
    kuveytturk.clear_token_cache()


def _bind(db):
    async def _current(_request):
        return _user()

    vpos_api.init(db, get_current_user=_current)


def _body(**overrides):
    body = {
        "company_id": "c1",
        "family": "kuveytturk",
        "bank_label": "Kuveyt Türk",
        "mode": "test",
        "merchant_id": MERCHANT,
        "customer_id": CUSTOMER,
        "api_username": USERNAME,
        "kt_password": PASSWORD,
        "api_client_id": CLIENT_ID,
        "api_client_secret": CLIENT_SECRET,
        "account_id": "pos1",
        "enabled": True,
    }
    body.update(overrides)
    return body


def _save(db, **overrides):
    _bind(db)
    return _run(vpos_api.put_vpos_config(_body(**overrides), Req(path="/api/vpos/configs")))


def _token_payload():
    return {"access_token": ACCESS, "token_type": "Bearer", "expires_in": 3600}


def _page_payload(code="00", success=True, url=PAGE, message="ok"):
    return {
        "value": {"url": url, "responseCode": code, "responseMessage": message},
        "success": success,
        "results": [],
    }


def _order_row(order_id, amount="1.00", **overrides):
    row = {
        "orderId": 302708358,
        "merchantOrderId": order_id,
        "merchantId": int(MERCHANT),
        "cardHolderName": "TEST USER",
        "cardNumber": "518896******2544",
        "pan": PAN,
        "cvv2": CVV,
        "cardExpireDate": EXPIRY,
        "orderStatus": 1,
        "lastOrderStatus": 1,
        "transactionStatus": 1,
        "firstAmount": amount,
        "cancelAmount": 0,
        "drawbackAmount": 0,
        "fec": "0949",
        "responseCode": "00",
        "provNumber": "P123456",
    }
    row.update(overrides)
    return {"success": True, "results": [], "value": [row]}


def _client(*pairs):
    return FakeClient(pairs)


def _pay_client(page=_page_payload()):
    return _client(("connect/token", _token_payload()), ("secureCommonPaymentToken", page))


def _assert_clean(blob):
    assert PASSWORD not in blob
    assert CLIENT_SECRET not in blob
    assert ACCESS not in blob
    assert PAN not in blob
    assert CVV not in blob
    assert EXPIRY not in blob


def test_hash_placeholder_is_deterministic_and_isolated():
    args = (MERCHANT, "ORD1", "100", "https://app.example.com/ok", "https://app.example.com/fail", USERNAME, PASSWORD)
    first = kuveytturk.token_hash(*args)
    assert first == kuveytturk.token_hash(*args)
    assert first != kuveytturk.token_hash(MERCHANT, "ORD2", "100", args[3], args[4], USERNAME, PASSWORD)
    assert first != kuveytturk.token_hash(MERCHANT, "ORD1", "101", args[3], args[4], USERNAME, PASSWORD)
    assert first != kuveytturk.token_hash(MERCHANT, "ORD1", "100", args[3] + "/x", args[4], USERNAME, PASSWORD)
    assert PASSWORD not in first and CLIENT_SECRET not in first
    assert re.fullmatch(r"[A-Za-z0-9+/=]+", first)
    again = kuveytturk.hashed_password("Şifre")
    assert again == kuveytturk.hashed_password("Şifre")
    utf8 = base64.b64encode(hashlib.sha1("Şifre".encode("utf-8"), usedforsecurity=False).digest()).decode("ascii")
    assert again != utf8
    query = kuveytturk.query_hash(MERCHANT, "ORD1", USERNAME, PASSWORD)
    assert query == kuveytturk.query_hash(MERCHANT, "ORD1", USERNAME, PASSWORD)
    assert query != kuveytturk.query_hash(MERCHANT, "ORD2", USERNAME, PASSWORD)
    assert query != first
    assert kuveytturk.format_amount_kurus("1.00") == "100"
    assert kuveytturk.format_amount_kurus("1.2") == "120"
    with pytest.raises(ValueError):
        kuveytturk.format_amount_kurus("1.009")
    with pytest.raises(ValueError):
        kuveytturk.format_amount_kurus("0")
    assert get_adapter("kuveytturk") is kuveytturk.ADAPTER
    assert kuveytturk.ADAPTER.family == "kuveytturk"
    assert kuveytturk.ADAPTER.model == "secure_partner"


def test_put_encrypts_secrets_and_hides_them(db, caplog):
    caplog.set_level(logging.DEBUG)
    saved = _save(db)
    blob = json.dumps(saved)
    _assert_clean(blob)
    assert saved["family"] == "kuveytturk"
    assert saved["merchant_id"] == MERCHANT
    assert saved["customer_id"] == CUSTOMER
    assert saved["api_username"] == USERNAME
    assert saved["kt_password_set"] is True
    assert saved["api_client_secret_set"] is True
    assert saved["api_client_id_set"] is True
    assert "kt_password" not in saved
    assert "kt_password_enc" not in saved
    assert "api_client_secret" not in saved
    assert "api_client_id" not in saved
    assert CLIENT_ID not in blob
    stored = db.vpos_configs.docs[saved["id"]]
    assert stored["kt_password_enc"] != PASSWORD
    assert stored["api_client_secret_enc"] != CLIENT_SECRET
    assert comm_service.decrypt(stored["kt_password_enc"]) == PASSWORD
    assert comm_service.decrypt(stored["api_client_secret_enc"]) == CLIENT_SECRET
    assert stored["api_client_id"] == CLIENT_ID
    assert stored["store_key_enc"] == ""
    assert stored["merchant_key_enc"] == ""
    assert stored["secret_key_enc"] == ""
    kept = _save(db, kt_password="••••••••", api_client_secret="")
    kept_doc = db.vpos_configs.docs[kept["id"]]
    assert comm_service.decrypt(kept_doc["kt_password_enc"]) == PASSWORD
    assert comm_service.decrypt(kept_doc["api_client_secret_enc"]) == CLIENT_SECRET
    audits = json.dumps(list(db.company_audit_log.docs.values()))
    _assert_clean(audits)
    _assert_clean(caplog.text)


@pytest.mark.parametrize("field", ["kt_password", "api_client_secret", "api_client_id", "api_username", "customer_id", "merchant_id"])
def test_enabled_missing_field_is_400(db, field):
    _bind(db)
    body = _body()
    body[field] = ""
    with pytest.raises(HTTPException) as err:
        _run(vpos_api.put_vpos_config(body, Req(path="/api/vpos/configs")))
    assert err.value.status_code == 400
    assert PASSWORD not in str(err.value.detail)
    assert CLIENT_SECRET not in str(err.value.detail)


def test_family_switch_does_not_carry_secrets(db):
    saved = _save(db)
    _bind(db)
    _run(vpos_api.put_vpos_config({
        "company_id": "c1",
        "family": "paytr",
        "bank_label": "PayTR",
        "mode": "test",
        "merchant_id": "100001",
        "merchant_key": "paytr-key-do-not-log",
        "merchant_salt": "paytr-salt-do-not-log",
        "account_id": "pos1",
        "enabled": True,
    }, Req(path="/api/vpos/configs")))
    stored = db.vpos_configs.docs[saved["id"]]
    assert stored["family"] == "paytr"
    assert stored["kt_password_enc"] == ""
    assert stored["api_client_secret_enc"] == ""
    assert stored["api_client_id"] == ""
    assert stored["api_username"] == ""
    assert stored["customer_id"] == ""
    assert PASSWORD not in json.dumps(stored)
    _bind(db)
    with pytest.raises(HTTPException) as err:
        _run(vpos_api.put_vpos_config(_body(kt_password="", api_client_secret=""), Req(path="/api/vpos/configs")))
    assert err.value.status_code == 400
    _save(db)
    switched = db.vpos_configs.docs[saved["id"]]
    assert switched["family"] == "kuveytturk"
    assert switched["merchant_key_enc"] == ""
    assert switched["merchant_salt_enc"] == ""
    assert "paytr-key-do-not-log" not in json.dumps(switched)


def test_create_payment_token_posts_fixed_urls(db, caplog):
    caplog.set_level(logging.DEBUG)
    saved = _save(db)
    db.vpos_configs.docs[saved["id"]]["gateway_3d_url"] = "https://evil.example/v1/vpos/secureCommonPaymentToken"
    db.vpos_configs.docs[saved["id"]]["token_url"] = "http://169.254.169.254/token"
    client = _pay_client()
    vpos_api.set_outbound_client(client)
    _bind(db)
    body = _run(vpos_api.test_payment({"amount": "1.00", "company_id": "c1"}, Req(ip="203.0.113.8")))
    assert body["kind"] == "redirect"
    assert body["url"] == PAGE
    assert "iframe_url" not in body
    assert ACCESS not in json.dumps(body)
    assert PASSWORD not in json.dumps(body)
    urls = [call["url"] for call in client.calls]
    assert urls[0] == kuveytturk.TEST_TOKEN_URL
    assert urls[1] == kuveytturk.TEST_GATEWAY + kuveytturk.TOKEN_PATH
    assert all(call["url"].startswith("https://") and "kuveytturk.com.tr" in call["url"] for call in client.calls)
    assert "evil.example" not in json.dumps(urls)
    assert "169.254.169.254" not in json.dumps(urls)
    token_post = client.calls[0]
    assert token_post["data"]["grant_type"] == "client_credentials"
    assert token_post["data"]["scope"] == "public"
    assert token_post["data"]["client_id"] == CLIENT_ID
    assert token_post["data"]["client_secret"] == CLIENT_SECRET
    payment = json.loads(client.calls[1]["content"].decode("utf-8"))["request"]
    intent = db.payment_intents.docs[body["intent_id"]]
    assert payment["amount"] == "100"
    assert payment["currencyCode"] == "0949"
    assert payment["transactionType"] == "Sale"
    assert payment["TokenType"] == "PaymentWithLink"
    assert payment["merchantId"] == int(MERCHANT)
    assert payment["userName"] == USERNAME
    assert payment["merchantOrderId"] == intent["order_id"]
    assert payment["installmentCount"] == 0
    assert payment["clientIp"] == "203.0.113.8"
    assert payment["cardHolderIp"] == "203.0.113.8"
    assert payment["email"] == EMAIL
    assert payment["successUrl"] == f"https://app.example.com/api/vpos/kuveytturk/return/{body['intent_id']}?r=ok"
    assert payment["failUrl"] == f"https://app.example.com/api/vpos/kuveytturk/return/{body['intent_id']}?r=fail"
    assert payment["hashData"] == kuveytturk.token_hash(
        MERCHANT, intent["order_id"], "100", payment["successUrl"], payment["failUrl"], USERNAME, PASSWORD,
    )
    assert client.calls[1]["headers"]["Authorization"] == f"Bearer {ACCESS}"
    assert PASSWORD not in client.calls[1]["content"].decode("utf-8")
    assert CLIENT_SECRET not in client.calls[1]["content"].decode("utf-8")
    assert ACCESS not in client.calls[1]["content"].decode("utf-8")
    assert intent["status"] == "pending"
    assert intent["provider_ref"] in (None, "")
    assert "page-token" not in json.dumps(intent)
    second = _pay_client()
    vpos_api.set_outbound_client(second)
    _run(vpos_api.test_payment({"amount": "1.20", "company_id": "c1"}, Req(ip="203.0.113.8")))
    assert [call["url"] for call in second.calls] == [kuveytturk.TEST_GATEWAY + kuveytturk.TOKEN_PATH]
    assert second.calls[0]["headers"]["Authorization"] == f"Bearer {ACCESS}"
    _assert_clean(caplog.text)
    _assert_clean(json.dumps(vpos_api.public_intent(intent)))


@pytest.mark.parametrize("page", [
    _page_payload(code="99", message="reddet KtPasswordSecret99"),
    _page_payload(success=False, message="KtClientSecretSecret99"),
    _page_payload(url="https://evil.example/KTPay/SecurePayment?token=abc"),
    _page_payload(url="http://boatest.kuveytturk.com.tr/boa.virtualpos.services/KTPay/SecurePayment?token=abc"),
])
def test_token_rejected_without_leaking(db, caplog, page):
    caplog.set_level(logging.DEBUG)
    _save(db)
    kuveytturk.clear_token_cache()
    client = _pay_client(page)
    vpos_api.set_outbound_client(client)
    _bind(db)
    with pytest.raises(HTTPException) as err:
        _run(vpos_api.test_payment({"amount": "1.00", "company_id": "c1"}, Req()))
    assert err.value.status_code == 502
    assert PASSWORD not in str(err.value.detail)
    assert CLIENT_SECRET not in str(err.value.detail)
    assert ACCESS not in str(err.value.detail)
    assert "evil.example" not in str(err.value.detail)
    failed = next(doc for doc in db.payment_intents.docs.values() if doc["status"] == "failed")
    assert failed["result"]["error"] == "token_failed"
    _assert_clean(json.dumps(failed))
    _assert_clean(caplog.text)
    _assert_clean(json.dumps(vpos_api.public_intent(failed)))


def test_live_mode_uses_live_allowlist_only():
    kuveytturk.clear_token_cache()
    client = FakeClient([
        ("connect/token", _token_payload()),
        ("secureCommonPaymentToken", _page_payload()),
    ])
    intent = {"_id": "i-live", "order_id": "ordlive", "amount": "1.00"}
    ctx = {
        "ok_url": "https://app.example.com/api/vpos/kuveytturk/return/i-live?r=ok",
        "fail_url": "https://app.example.com/api/vpos/kuveytturk/return/i-live?r=fail",
        "user_ip": "203.0.113.9",
        "email": EMAIL,
    }
    cfg = {
        "mode": "live",
        "merchant_id": MERCHANT,
        "customer_id": CUSTOMER,
        "api_username": USERNAME,
        "kt_password": PASSWORD,
        "api_client_id": CLIENT_ID,
        "api_client_secret": CLIENT_SECRET,
        "gateway_3d_url": "https://evil.example/live",
        "token_url": "https://evil.example/token",
    }
    url = _run(kuveytturk.create_payment_token(cfg, intent, ctx, client=client))
    assert url == PAGE
    assert client.calls[0]["url"] == kuveytturk.LIVE_TOKEN_URL
    assert client.calls[1]["url"] == kuveytturk.LIVE_GATEWAY + kuveytturk.TOKEN_PATH
    posted = json.loads(client.calls[1]["content"].decode("utf-8"))["request"]
    assert posted["installmentCount"] == 0
    intent["installment"] = 3
    kuveytturk.clear_token_cache()
    _run(kuveytturk.create_payment_token(cfg, intent, ctx, client=client))
    posted = json.loads(client.calls[-1]["content"].decode("utf-8"))["request"]
    assert posted["installmentCount"] == 3
    bad = {
        "ok_url": "https://169.254.169.254/latest?r=ok",
        "fail_url": ctx["fail_url"],
    }
    with pytest.raises(kuveytturk.VposStartError):
        _run(kuveytturk.create_payment_token(cfg, intent, bad, client=client))


def _cfg(company="c1", config_id="cfg-kt"):
    return {
        "_id": config_id,
        "company_id": company,
        "family": "kuveytturk",
        "bank_label": "Kuveyt Türk",
        "mode": "test",
        "merchant_id": MERCHANT,
        "customer_id": CUSTOMER,
        "api_username": USERNAME,
        "kt_password_enc": comm_service.encrypt(PASSWORD),
        "api_client_id": CLIENT_ID,
        "api_client_secret_enc": comm_service.encrypt(CLIENT_SECRET),
        "account_id": "pos1" if company == "c1" else "pos2",
        "enabled": True,
    }


def _intent(order_id="ordkt1", company="c1", amount="1.00", config_id="cfg-kt", purpose="contact_collection"):
    now = datetime.now(timezone.utc)
    return {
        "_id": "intent-" + order_id,
        "company_id": company,
        "contact_id": "ct1" if company == "c1" else "ct2",
        "purpose": purpose,
        "amount": amount,
        "currency": "TRY",
        "order_id": order_id,
        "description": "Cari tahsilat",
        "status": "pending",
        "vpos_config_id": config_id,
        "provider_ref": None,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=30)).isoformat(),
        "result": None,
    }


def _seed(db, **kwargs):
    cfg = _cfg(company=kwargs.get("cfg_company", "c1"), config_id=kwargs.get("config_id", "cfg-kt"))
    db.vpos_configs.docs[cfg["_id"]] = cfg
    intent = _intent(
        order_id=kwargs.get("order_id", "ordkt1"),
        company=kwargs.get("company", "c1"),
        amount=kwargs.get("amount", "1.00"),
        config_id=cfg["_id"],
        purpose=kwargs.get("purpose", "contact_collection"),
    )
    if "intent_company" in kwargs:
        intent["company_id"] = kwargs["intent_company"]
    db.payment_intents.docs[intent["_id"]] = copy.deepcopy(intent)
    return intent


def _return(db, intent, detail, query=None, method="POST"):
    kuveytturk.clear_token_cache()
    client = _client(
        ("connect/token", _token_payload()),
        ("getMerchantOrderDetail", detail),
        ("orderDetailWithPaymentId", detail),
    )
    vpos_api.set_outbound_client(client)
    response = _run(vpos_api.kuveytturk_return_post(intent["_id"], Req(
        method=method,
        query=query or {},
        path=f"/api/vpos/kuveytturk/return/{intent['_id']}",
    )) if method == "POST" else vpos_api.kuveytturk_return_get(intent["_id"], Req(
        method="GET",
        query=query or {},
        path=f"/api/vpos/kuveytturk/return/{intent['_id']}",
    )))
    return response, client


def test_return_approved_collects_once_and_ignores_fail_flag(db, caplog):
    caplog.set_level(logging.DEBUG)
    intent = _seed(db)
    resp, client = _return(db, intent, _order_row(intent["order_id"]), query={"r": "ok"})
    assert resp.status_code == 303
    assert resp.headers["location"].endswith(f"/vpos/result/{intent['_id']}")
    stored = db.payment_intents.docs[intent["_id"]]
    assert stored["status"] == "paid"
    assert stored["amount"] == "1.00"
    assert stored.get("collection_tx_id") == "vpos:" + intent["_id"]
    assert len(db.bank_transactions.docs) == 1
    assert db.bank_accounts.docs["pos1"]["current_balance"] == 101.0
    assert db.contacts.docs["ct1"]["balance"] == 49.0
    order_calls = [call for call in client.calls if "getMerchantOrderDetail" in call["url"]]
    assert len(order_calls) == 1
    assert order_calls[0]["url"] == kuveytturk.TEST_GATEWAY + kuveytturk.ORDER_PATH
    assert order_calls[0]["headers"]["Authorization"] == f"Bearer {ACCESS}"
    posted = json.loads(order_calls[0]["content"].decode("utf-8"))["request"]
    assert posted["merchantOrderId"] == intent["order_id"]
    assert posted["merchantId"] == int(MERCHANT)
    assert posted["customerId"] == int(CUSTOMER)
    assert posted["userName"] == USERNAME
    assert re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", posted["startDate"])
    assert re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", posted["endDate"])
    assert posted["hashData"] == kuveytturk.query_hash(MERCHANT, intent["order_id"], USERNAME, PASSWORD)
    assert PASSWORD not in order_calls[0]["content"].decode("utf-8")
    assert not any("orderDetailWithPaymentId" in call["url"] for call in client.calls)
    digest = posted["hashData"]
    blob = caplog.text + json.dumps(stored) + json.dumps(vpos_api.public_intent(stored))
    blob += json.dumps(list(db.bank_transactions.docs.values()))
    _assert_clean(blob)
    assert digest not in blob
    assert "518896******2544" in json.dumps(stored["result"])
    snap = copy.deepcopy(stored)
    tx_count = len(db.bank_transactions.docs)
    again, second = _return(db, intent, _order_row(intent["order_id"], amount="50.00"), query={"r": "fail"})
    assert again.status_code == 303
    assert db.payment_intents.docs[intent["_id"]] == snap
    assert len(db.bank_transactions.docs) == tx_count
    assert second.calls == []
    fresh = _seed(db, order_id="ordfailok")
    paid, _called = _return(db, fresh, _order_row(fresh["order_id"]), query={"r": "fail"})
    assert paid.status_code == 303
    assert db.payment_intents.docs[fresh["_id"]]["status"] == "paid"
    assert _called.calls


def test_return_unapproved_is_not_paid(db, caplog):
    caplog.set_level(logging.DEBUG)
    ok_flag = _seed(db, order_id="ordok")
    resp, called = _return(
        db, ok_flag,
        _order_row(ok_flag["order_id"], transactionStatus=2, responseCode="05"),
        query={"r": "ok"},
        method="GET",
    )
    assert resp.status_code == 303
    assert db.payment_intents.docs[ok_flag["_id"]]["status"] == "failed"
    assert db.payment_intents.docs[ok_flag["_id"]]["result"]["error"] == "declined"
    assert called.calls
    fail_flag = _seed(db, order_id="ordfail")
    resp, _called = _return(
        db, fail_flag,
        _order_row(fail_flag["order_id"], orderStatus=6, transactionStatus=1),
        query={"r": "fail"},
    )
    assert db.payment_intents.docs[fail_flag["_id"]]["status"] == "failed"
    assert db.bank_transactions.docs == {} or "vpos:" + fail_flag["_id"] not in db.bank_transactions.docs
    assert db.payment_intents.docs[ok_flag["_id"]]["status"] == "failed"
    _assert_clean(caplog.text)


def test_return_mismatches_and_other_company(db, caplog):
    caplog.set_level(logging.DEBUG)
    amount = _seed(db, order_id="ordamt")
    _return(db, amount, _order_row(amount["order_id"], amount="9.99"))
    stored = db.payment_intents.docs[amount["_id"]]
    assert stored["status"] == "failed"
    assert stored["result"]["error"] == "amount_mismatch"
    assert stored["amount"] == "1.00"
    currency = _seed(db, order_id="ordcur")
    _return(db, currency, _order_row(currency["order_id"], fec="0840"))
    assert db.payment_intents.docs[currency["_id"]]["result"]["error"] == "currency_mismatch"
    order = _seed(db, order_id="ordother")
    _return(db, order, _order_row("SOMEONE-ELSE"))
    assert db.payment_intents.docs[order["_id"]]["result"]["error"] == "order_mismatch"
    foreign = _seed(db, order_id="ordco", cfg_company="c2", intent_company="c1")
    other = _intent(order_id="ordco-b", company="c2", config_id="cfg-kt")
    db.payment_intents.docs[other["_id"]] = other
    before = copy.deepcopy(db.payment_intents.docs[other["_id"]])
    _resp, client = _return(db, foreign, _order_row(foreign["order_id"]))
    assert db.payment_intents.docs[foreign["_id"]]["status"] == "failed"
    assert db.payment_intents.docs[foreign["_id"]]["result"]["error"] == "company_mismatch"
    assert db.payment_intents.docs[other["_id"]] == before
    assert client.calls == []
    assert db.bank_accounts.docs["pos2"]["current_balance"] == 80.0
    assert "vpos:" + amount["_id"] not in db.bank_transactions.docs
    _assert_clean(caplog.text + json.dumps(list(db.payment_intents.docs.values())))


def test_return_transport_error_stays_pending(db):
    intent = _seed(db, order_id="ordhttp", purpose="test")
    kuveytturk.clear_token_cache()
    client = _client(("connect/token", _token_payload()), ("getMerchantOrderDetail", (502, "upstream")))
    vpos_api.set_outbound_client(client)
    resp = _run(vpos_api.kuveytturk_return_post(intent["_id"], Req()))
    assert resp.status_code == 303
    assert db.payment_intents.docs[intent["_id"]]["status"] == "pending"
    assert db.payment_intents.docs[intent["_id"]]["result"] is None


def test_payment_id_fallback_when_order_row_has_no_status():
    kuveytturk.clear_token_cache()
    order_id = "ordpayid"
    sparse = {
        "success": True,
        "value": [{"merchantOrderId": order_id, "paymentId": 18387291, "merchantId": int(MERCHANT)}],
    }
    full = _order_row(order_id)
    client = _client(
        ("connect/token", _token_payload()),
        ("getMerchantOrderDetail", sparse),
        ("orderDetailWithPaymentId", full),
    )
    cfg = {
        "mode": "test",
        "merchant_id": MERCHANT,
        "customer_id": CUSTOMER,
        "api_username": USERNAME,
        "kt_password": PASSWORD,
        "api_client_id": CLIENT_ID,
        "api_client_secret": CLIENT_SECRET,
    }
    detail = _run(kuveytturk.fetch_order_detail(cfg, order_id, client=client))
    urls = [call["url"] for call in client.calls]
    assert urls[1].endswith(kuveytturk.ORDER_PATH)
    assert urls[2].endswith(kuveytturk.PAYMENT_PATH)
    posted = json.loads(client.calls[2]["content"].decode("utf-8"))["request"]
    assert posted["paymentId"] == 18387291
    assert posted["amount"] == 0
    assert PASSWORD not in client.calls[2]["content"].decode("utf-8")
    intent = {"_id": "i", "order_id": order_id, "amount": "1.00", "_merchant_id": MERCHANT}
    verdict = kuveytturk._verdict(detail, intent)
    assert verdict["approved"] is True
    assert verdict["ok"] is True
    assert PAN not in json.dumps(verdict)
    assert CVV not in json.dumps(verdict)


def test_return_is_public_and_configs_are_not():
    assert rbac.is_public_api_path("/api/vpos/kuveytturk/return/abc", "GET") is True
    assert rbac.is_public_api_path("/api/vpos/kuveytturk/return/abc", "POST") is True
    assert rbac.is_public_api_path("/api/vpos/configs", "PUT") is False
    assert rbac.is_public_api_path("/api/vpos/test-payment", "POST") is False
