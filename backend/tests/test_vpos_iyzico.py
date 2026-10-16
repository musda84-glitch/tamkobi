"""iyzico Checkout Form: IYZWSv2 örneği, retrieve kararı, idempotency.

Gerçek iyzico çağrısı yok. Tarayıcı token'ı tek başına ödendi yazdırmaz.
"""
import copy
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import comm_service
import public_url
import rbac
import vpos.api as vpos_api
import vpos.iyzico as iyzico

API_KEY = "sandbox-l9Md1Gj3IYcmu4NdaWxaSUoCoX7DC5RA"
SECRET = "sandbox-qaIiLIxhjMgx3LSKIVvp6j17NunHOFtD"
RND = "123456789"
DOC_SIGNATURE = "079df4b2426fc7f4208d8f22fbc0349794019f8ce2b0711de7808b4874f4e796"
DOC_HEADER = (
    "IYZWSv2 YXBpS2V5OnNhbmRib3gtbDlNZDFHajNJWWNtdTROZGFXeGFTVW9Db1g3REM1UkEm"
    "cmFuZG9tS2V5OjEyMzQ1Njc4OSZzaWduYXR1cmU6MDc5ZGY0YjI0MjZmYzdmNDIwOGQ4ZjIy"
    "ZmJjMDM0OTc5NDAxOWY4Y2UyYjA3MTFkZTc4MDhiNDg3NGY0ZTc5Ng=="
)
DOC_BODY = '{"locale":"tr","binNumber":"535805","conversationId":"docsTest-v1"}'
AUTH_SIGNATURE = "836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173"


def _match(doc, query):
    for key, expected in (query or {}).items():
        if str(key).startswith("$"):
            continue
        if doc.get(key) != expected:
            return False
    return True


class FakeColl:
    def __init__(self):
        self.docs = {}
        self.update_count = 0

    async def find_one(self, query):
        for doc in self.docs.values():
            if _match(doc, query):
                return copy.deepcopy(doc)
        return None

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = copy.deepcopy(doc)
        return SimpleNamespace(inserted_id=doc["_id"])

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs.values():
            if not _match(doc, query):
                continue
            if "$set" in update:
                doc.update(update["$set"])
            self.update_count += 1
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class FakeDB:
    def __init__(self):
        self.vpos_configs = FakeColl()
        self.payment_intents = FakeColl()
        self.bank_accounts = FakeColl()
        self.bank_accounts.docs["pos1"] = {"_id": "pos1", "company_id": "c1", "type": "pos"}
        self.bank_transactions = FakeColl()
        self.company_audit_log = FakeColl()
        self.platform_settings = FakeColl()
        self.platform_settings.docs["platform"] = {"_id": "platform", "public_url": "https://tamkobi.com"}

    def __getitem__(self, name):
        return getattr(self, name)


class FakeResp:
    def __init__(self, payload, status=200):
        self.status_code = status
        self.text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    def json(self):
        return json.loads(self.text)


class FakeClient:
    def __init__(self, response=None, exc=None):
        self.response = response
        self.exc = exc
        self.calls = []

    async def post(self, url, data=None, content=None, headers=None, **kwargs):
        self.calls.append({"url": url, "content": content, "headers": headers or {}})
        if self.exc:
            raise self.exc
        return self.response


class Req:
    def __init__(self, form=None, ip="203.0.113.8", path="/api/vpos/iyzico/callback/x"):
        self._form = form or {}
        self.client = SimpleNamespace(host=ip)
        self.headers = {}
        self.method = "POST"
        self.url = SimpleNamespace(path=path)
        self.query_params = {}

    async def form(self):
        return self._form


def _run(coro):
    import asyncio
    return asyncio.run(coro)


def _user():
    return {
        "id": "u-admin", "name": "Ada Lovelace", "email": "ada@example.com",
        "role": "admin", "company_ids": ["c1"], "active_company_id": "c1",
    }


@pytest.fixture
def db(monkeypatch):
    database = FakeDB()
    vpos_api.init(database, get_current_user=None)
    vpos_api.reset_callback_rate_limit()
    vpos_api.set_outbound_client(None)

    async def _base(*_a, **_k):
        return "https://app.example.com"

    monkeypatch.setattr(public_url, "public_base_url_for", _base)
    yield database
    vpos_api.set_outbound_client(None)
    vpos_api.reset_callback_rate_limit()


def _bind(db):
    async def _current(_request):
        return _user()

    vpos_api.init(db, get_current_user=_current)


def test_iyzi_authorization_matches_documented_bin_check():
    assert iyzico.authorization_header(API_KEY, RND, DOC_SIGNATURE) == DOC_HEADER
    assert iyzico.request_signature(SECRET, RND, "/payment/bin/check", DOC_BODY) != ""
    signed = iyzico.request_signature(SECRET, "1722246017090123456789", "/payment/auth", "")
    assert len(signed) == 64
    message = "22416032:TRY:basketId:conversationId:10.5:10.5"
    got = hmac.new(SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()
    assert got == AUTH_SIGNATURE
    assert iyzico.strip_trailing_zeros("10.50") == "10.5"
    assert iyzico.strip_trailing_zeros("10.00") == "10"
    assert iyzico.strip_trailing_zeros("10.0") == "10"
    assert iyzico.strip_trailing_zeros("10.51050") == "10.5105"
    assert iyzico.strip_trailing_zeros(Decimal("10.50")) == "10.5"
    payload = {
        "paymentStatus": "SUCCESS",
        "paymentId": "22416032",
        "currency": "TRY",
        "basketId": "basketId",
        "conversationId": "conversationId",
        "paidPrice": "10.50",
        "price": "10.50",
        "token": "tok",
    }
    # 10.50 imzada 10.5 olur; dokümandaki /payment/auth örneği aynı HMAC yöntemidir.
    expected = hmac.new(
        SECRET.encode(),
        b"SUCCESS:22416032:TRY:basketId:conversationId:10.5:10.5:tok",
        hashlib.sha256,
    ).hexdigest()
    assert iyzico.response_signature(SECRET, payload) == expected
    assert iyzico.ADAPTER.family == "iyzico"
    assert iyzico.ADAPTER.model == "checkout_form"
    assert iyzico.base_url_for_mode("test") == "https://sandbox-api.iyzipay.com"
    assert iyzico.base_url_for_mode("live") == "https://api.iyzipay.com"


def _save(db):
    _bind(db)
    return _run(vpos_api.put_vpos_config({
        "company_id": "c1",
        "family": "iyzico",
        "display_name": "iyzico mağaza",
        "mode": "test",
        "api_key": API_KEY,
        "secret_key": SECRET,
        "account_id": "pos1",
        "enabled": True,
    }, Req(path="/api/vpos/configs")))


def _init_payload(intent_id="will-replace"):
    return {
        "status": "success",
        "token": "tok-provider-1",
        "paymentPageUrl": "https://sandbox-cpp.iyzipay.com/?token=tok-provider-1&lang=tr",
        "checkoutFormContent": "<script>SECRET_SHOULD_NOT_LEAK</script>",
        "errorMessage": "",
    }


def test_initialize_success_and_fail(db, caplog):
    import logging
    caplog.set_level(logging.DEBUG)
    saved = _save(db)
    assert saved["has_api_key"] is True
    assert saved["has_secret_key"] is True
    assert API_KEY not in json.dumps(saved)
    assert SECRET not in json.dumps(saved)
    stored_cfg = db.vpos_configs.docs[saved["id"]]
    assert stored_cfg["api_key"] == API_KEY
    assert stored_cfg["secret_key_enc"] != SECRET
    assert comm_service.decrypt(stored_cfg["secret_key_enc"]) == SECRET
    assert stored_cfg["store_key_enc"] == ""
    client = FakeClient(FakeResp(_init_payload()))
    vpos_api.set_outbound_client(client)
    _bind(db)
    body = _run(vpos_api.test_payment({"amount": "1.00", "company_id": "c1"}, Req()))
    assert body["kind"] == "redirect"
    assert body["url"].startswith("https://sandbox-cpp.iyzipay.com/")
    assert "checkoutFormContent" not in body
    assert "provider_ref" not in body
    intent = db.payment_intents.docs[body["intent_id"]]
    assert intent["status"] == "pending"
    assert intent["provider_ref"] == "tok-provider-1"
    assert "checkoutFormContent" not in json.dumps(intent)
    posted = client.calls[0]
    assert posted["url"] == "https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform/initialize/auth/ecom"
    raw = posted["content"].decode("utf-8")
    parsed = json.loads(raw)
    assert parsed["conversationId"] == body["intent_id"]
    assert parsed["basketId"] == intent["order_id"]
    assert parsed["price"] == "1.00"
    assert parsed["paidPrice"] == "1.00"
    assert parsed["currency"] == "TRY"
    assert parsed["callbackUrl"] == f"https://app.example.com/api/vpos/iyzico/callback/{body['intent_id']}"
    assert parsed["buyer"]["identityNumber"] == iyzico.DOCUMENTED_TEST_IDENTITY
    signature = iyzico.request_signature(SECRET, posted["headers"]["x-iyzi-rnd"], iyzico.INIT_PATH, raw)
    assert posted["headers"]["Authorization"] == iyzico.authorization_header(API_KEY, posted["headers"]["x-iyzi-rnd"], signature)
    assert SECRET not in caplog.text and SECRET not in json.dumps(intent)
    failed = FakeClient(FakeResp({"status": "failure", "errorMessage": f"reddet {SECRET}"}))
    vpos_api.set_outbound_client(failed)
    with pytest.raises(HTTPException) as err:
        _run(vpos_api.test_payment({"amount": "1.00", "company_id": "c1"}, Req()))
    assert err.value.status_code == 502
    assert SECRET not in str(err.value.detail)
    failed_intent = next(doc for doc in db.payment_intents.docs.values() if doc["status"] == "failed")
    assert failed_intent["result"]["error"] == "init_failed"
    assert SECRET not in json.dumps(failed_intent)
    assert len(failed_intent["result"]["errorMessage"]) <= 120
    assert SECRET not in caplog.text


def _intent(order_id="ordiyz1", token="tok-provider-1", amount="1.00", status="pending"):
    now = datetime.now(timezone.utc)
    return {
        "_id": "intent-" + order_id,
        "company_id": "c1",
        "purpose": "test",
        "amount": amount,
        "currency": "TRY",
        "order_id": order_id,
        "status": status,
        "vpos_config_id": "cfg-iyzi",
        "provider_ref": token,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=30)).isoformat(),
        "result": None,
    }


def _cfg():
    return {
        "_id": "cfg-iyzi",
        "company_id": "c1",
        "family": "iyzico",
        "bank_label": "iyzico",
        "mode": "test",
        "api_key": API_KEY,
        "secret_key_enc": comm_service.encrypt(SECRET),
        "account_id": "pos1",
        "enabled": True,
        "store_key_enc": "",
        "merchant_key_enc": "",
    }


def _retrieve(intent, **overrides):
    payload = {
        "status": "success",
        "paymentStatus": "SUCCESS",
        "paymentId": "22416032",
        "currency": "TRY",
        "basketId": intent["order_id"],
        "conversationId": intent["_id"],
        "paidPrice": intent["amount"],
        "price": intent["amount"],
        "token": intent["provider_ref"],
    }
    payload.update(overrides)
    payload["signature"] = iyzico.response_signature(SECRET, payload)
    if "signature_override" in overrides:
        payload["signature"] = overrides["signature_override"]
        payload.pop("signature_override", None)
    return payload


def _seed(db, **intent_kwargs):
    cfg = _cfg()
    db.vpos_configs.docs[cfg["_id"]] = cfg
    intent = _intent(**intent_kwargs)
    db.payment_intents.docs[intent["_id"]] = copy.deepcopy(intent)
    return intent


def _callback(db, intent, form, client):
    vpos_api.set_outbound_client(client)
    return _run(vpos_api.iyzico_callback(intent["_id"], Req(form=form, path=f"/api/vpos/iyzico/callback/{intent['_id']}")))


def test_callback_token_mismatch_does_not_write(db):
    intent = _seed(db)
    before = copy.deepcopy(db.payment_intents.docs[intent["_id"]])
    client = FakeClient(FakeResp(_retrieve(intent)))
    resp = _callback(db, intent, {"token": "baska-token-degil"}, client)
    assert resp.status_code == 303
    assert db.payment_intents.docs[intent["_id"]] == before
    assert client.calls == []


def test_retrieve_success_and_mismatches(db):
    intent = _seed(db)
    client = FakeClient(FakeResp(_retrieve(intent)))
    resp = _callback(db, intent, {"token": intent["provider_ref"]}, client)
    assert resp.status_code == 303
    assert resp.headers["location"].endswith(f"/vpos/result/{intent['_id']}")
    assert db.payment_intents.docs[intent["_id"]]["status"] == "paid"
    assert db.payment_intents.docs[intent["_id"]]["amount"] == "1.00"
    posted = client.calls[0]
    raw = posted["content"].decode()
    assert json.loads(raw) == {"locale": "tr", "conversationId": intent["_id"], "token": intent["provider_ref"]}
    assert posted["url"].endswith("/payment/iyzipos/checkoutform/auth/ecom/detail")

    cases = (
        ("paidPrice", "9.99", "amount_mismatch"),
        ("currency", "USD", "currency_mismatch"),
        ("basketId", "OTHER", "order_mismatch"),
        ("conversationId", "baska-intent", "conversation_mismatch"),
    )
    for field, value, error in cases:
        fresh = _seed(db, order_id="ord-" + error)
        payload = _retrieve(fresh, **{field: value})
        client = FakeClient(FakeResp(payload))
        _callback(db, fresh, {"token": fresh["provider_ref"]}, client)
        stored = db.payment_intents.docs[fresh["_id"]]
        assert stored["status"] == "failed"
        assert stored["result"]["error"] == error
        assert stored["amount"] == "1.00"

    fresh = _seed(db, order_id="ordfail")
    payload = _retrieve(fresh, paymentStatus="FAILURE")
    client = FakeClient(FakeResp(payload))
    _callback(db, fresh, {"token": fresh["provider_ref"]}, client)
    assert db.payment_intents.docs[fresh["_id"]]["status"] == "failed"
    assert db.payment_intents.docs[fresh["_id"]]["result"]["error"] == "declined"

    fresh = _seed(db, order_id="ordbad")
    payload = _retrieve(fresh, signature_override="ab" * 32)
    client = FakeClient(FakeResp(payload))
    _callback(db, fresh, {"token": fresh["provider_ref"]}, client)
    assert db.payment_intents.docs[fresh["_id"]]["status"] == "failed"
    assert db.payment_intents.docs[fresh["_id"]]["result"]["error"] == "bad_signature"


def test_repeat_callback_and_retrieve_http_error(db):
    intent = _seed(db)
    client = FakeClient(FakeResp(_retrieve(intent)))
    _callback(db, intent, {"token": intent["provider_ref"]}, client)
    after = db.payment_intents.update_count
    snap = copy.deepcopy(db.payment_intents.docs[intent["_id"]])
    again = _callback(db, intent, {"token": intent["provider_ref"]}, FakeClient(FakeResp(_retrieve(intent, paidPrice="50.00"))))
    assert again.status_code == 303
    assert db.payment_intents.update_count == after
    assert db.payment_intents.docs[intent["_id"]] == snap
    assert snap["status"] == "paid"

    fresh = _seed(db, order_id="ordhttp")
    before = copy.deepcopy(db.payment_intents.docs[fresh["_id"]])
    broken = FakeClient(exc=TimeoutError("timeout"))
    resp = _callback(db, fresh, {"token": fresh["provider_ref"]}, broken)
    assert resp.status_code == 303
    assert db.payment_intents.docs[fresh["_id"]]["status"] == "pending"
    assert db.payment_intents.docs[fresh["_id"]]["result"] is None
    assert db.payment_intents.docs[fresh["_id"]] == before
    http = FakeClient(FakeResp("nope", status=502))
    _callback(db, fresh, {"token": fresh["provider_ref"]}, http)
    assert db.payment_intents.docs[fresh["_id"]]["status"] == "pending"
    assert db.bank_transactions.docs == {}


def test_live_mode_does_not_send_sandbox_identity():
    intent = {"_id": "i1", "order_id": "o1", "amount": "1.00"}
    with pytest.raises(ValueError):
        iyzico.build_initialize_body({"mode": "live"}, intent, {"callback_url": "https://app.example.com/cb"})
    body = iyzico.build_initialize_body(
        {"mode": "live"}, intent,
        {"callback_url": "https://app.example.com/cb", "identity_number": "10000000146"},
    )
    assert body["buyer"]["identityNumber"] == "10000000146"
    assert iyzico.DOCUMENTED_TEST_IDENTITY not in json.dumps(body)


def test_iyzico_callback_is_public():
    assert rbac.is_public_api_path("/api/vpos/iyzico/callback/abc", "POST") is True
    assert rbac.is_public_api_path("/api/vpos/test-payment", "POST") is False
