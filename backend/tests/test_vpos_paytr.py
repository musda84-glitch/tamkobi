"""PayTR iFrame: token vektörü, bildirim hash'i, tutar ve idempotency.

Gerçek PayTR çağrısı yok. Kasa / cari / fatura yazılmaz.
"""
import copy
import json
import logging
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import comm_service
import public_url
import rbac
import vpos.api as vpos_api
import vpos.paytr as paytr

MERCHANT_ID = "XXXXXX"
STORE_ID = "100001"
MERCHANT_KEY = "YYYYYYYYYYYYYY"
MERCHANT_SALT = "ZZZZZZZZZZZZZZ"
USER_IP = "176.240.43.22"
ORDER_ID = "ABC123"
EMAIL = "test@example.com"
BASKET = "W1siT3JuZWsgdXJ1biIsIjEuMDAiLDFdXQ=="
TOKEN = "3CU6/Rfrhe/+8o3iuBQYTnAIk7RbIjj9sFSwzuzOVh8="
NOTIFY_HASH = "eNla7qNIxadTpyIRVuMecHsAfaHS25WSZMFMQaKm/gs="


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
        self.bank_accounts = FakeColl([
            {"_id": "pos1", "company_id": "c1", "type": "pos", "bank_name": "İş", "account_name": "POS"},
            {"_id": "pos2", "company_id": "c2", "type": "pos", "bank_name": "Diğer", "account_name": "POS"},
        ])
        self.bank_transactions = FakeColl()
        self.company_audit_log = FakeColl()
        self.platform_settings = FakeColl([{"_id": "platform", "public_url": "https://tamkobi.com"}])

    def __getitem__(self, name):
        return getattr(self, name)


class FakeResp:
    def __init__(self, payload=None, status=200, text=None):
        self.status_code = status
        self._payload = payload if payload is not None else {}
        self.text = text if text is not None else json.dumps(self._payload, ensure_ascii=False)

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeClient:
    def __init__(self, response=None, exc=None):
        self.response = response or FakeResp({"status": "success", "token": "abc123token"})
        self.exc = exc
        self.calls = []

    async def post(self, url, data=None, content=None, headers=None, **kwargs):
        self.calls.append({"url": url, "data": dict(data or {}), "content": content, "headers": headers})
        if self.exc:
            raise self.exc
        return self.response


class Req:
    def __init__(self, form=None, ip="203.0.113.8", path="/api/vpos/paytr/notify/cfg1"):
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
    vpos_api.init(database, get_current_user=None)
    vpos_api.reset_callback_rate_limit()
    vpos_api.set_outbound_client(None)

    async def _base(*_args, **_kwargs):
        return "https://app.example.com"

    monkeypatch.setattr(public_url, "public_base_url_for", _base)
    yield database
    vpos_api.set_outbound_client(None)
    vpos_api.reset_callback_rate_limit()


def _bind(db):
    async def _current(_request):
        return _user()

    vpos_api.init(db, get_current_user=_current)


def _config(company="c1", config_id="cfg1", key=MERCHANT_KEY, salt=MERCHANT_SALT):
    return {
        "_id": config_id,
        "company_id": company,
        "family": "paytr",
        "bank_label": "PayTR mağaza",
        "mode": "test",
        "merchant_id": MERCHANT_ID,
        "merchant_key_enc": comm_service.encrypt(key),
        "merchant_salt_enc": comm_service.encrypt(salt),
        "max_installment": 0,
        "no_installment": False,
        "store_key_enc": "",
        "api_password_enc": "",
        "secret_key_enc": "",
        "api_key": "",
        "account_id": "pos1" if company == "c1" else "pos2",
        "enabled": True,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }


def _intent(company="c1", amount="1.00", order_id="ordpaytr001", config_id="cfg1", status="pending"):
    now = datetime.now(timezone.utc)
    return {
        "_id": "intent-" + order_id,
        "company_id": company,
        "contact_id": None,
        "purpose": "test",
        "amount": amount,
        "currency": "TRY",
        "order_id": order_id,
        "status": status,
        "vpos_config_id": config_id,
        "provider_ref": None,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=30)).isoformat(),
        "result": None,
    }


def _save(db, **overrides):
    _bind(db)
    body = {
        "company_id": "c1",
        "family": "paytr",
        "bank_label": "PayTR mağaza",
        "mode": "test",
        "merchant_id": STORE_ID,
        "merchant_key": MERCHANT_KEY,
        "merchant_salt": MERCHANT_SALT,
        "max_installment": 0,
        "no_installment": False,
        "account_id": "pos1",
        "enabled": True,
    }
    body.update(overrides)
    return _run(vpos_api.put_vpos_config(body, Req(path="/api/vpos/configs")))


def test_paytr_token_matches_documented_vector():
    assert paytr.user_basket("Ornek urun", "1.00") == BASKET
    assert paytr.payment_amount_kurus("1.00") == "100"
    assert paytr.payment_amount_kurus("1.20") == "120"
    assert paytr.payment_amount_kurus("1.2") == "120"
    with pytest.raises(ValueError):
        paytr.payment_amount_kurus("1.009")
    with pytest.raises(ValueError):
        paytr.payment_amount_kurus("1.005")
    token = paytr.paytr_token(
        MERCHANT_KEY, MERCHANT_ID, USER_IP, ORDER_ID, EMAIL, "100", BASKET,
        "0", "0", "TL", "1", MERCHANT_SALT,
    )
    assert token == TOKEN
    assert paytr.notify_hash(MERCHANT_KEY, ORDER_ID, MERCHANT_SALT, "success", "100") == NOTIFY_HASH
    assert paytr.hashes_equal(NOTIFY_HASH, NOTIFY_HASH) is True
    assert paytr.hashes_equal(NOTIFY_HASH, "A" * len(NOTIFY_HASH)) is False
    assert paytr.ADAPTER.family == "paytr"
    assert paytr.ADAPTER.model == "iframe"


def test_put_encrypts_paytr_secrets_and_exposes_notify_url(db):
    _save(db, family="nestpay", bank_label="Banka", client_id="100200127", store_key="TEST1234", gateway_3d_url="")
    saved = _save(db)
    assert saved["family"] == "paytr"
    assert saved["has_merchant_key"] is True
    assert saved["has_merchant_salt"] is True
    assert saved["notify_url"] == f"https://app.example.com/api/vpos/paytr/notify/{saved['id']}"
    blob = json.dumps(saved)
    assert MERCHANT_KEY not in blob and MERCHANT_SALT not in blob
    assert "merchant_key_enc" not in saved and "merchant_salt_enc" not in saved
    stored = db.vpos_configs.docs[saved["id"]]
    assert comm_service.decrypt(stored["merchant_key_enc"]) == MERCHANT_KEY
    assert stored["store_key_enc"] == ""
    assert stored["secret_key_enc"] == ""
    again = _save(db, merchant_key="••••••••", merchant_salt="")
    kept = db.vpos_configs.docs[again["id"]]
    assert comm_service.decrypt(kept["merchant_key_enc"]) == MERCHANT_KEY
    assert comm_service.decrypt(kept["merchant_salt_enc"]) == MERCHANT_SALT
    audits = json.dumps(list(db.company_audit_log.docs.values()))
    assert MERCHANT_KEY not in audits and MERCHANT_SALT not in audits


def test_get_token_success_and_failure(db, caplog):
    caplog.set_level(logging.DEBUG)
    saved = _save(db)
    client = FakeClient(FakeResp({"status": "success", "token": "28cc613c3d7633cfa4ed0956fdf901e0"}))
    vpos_api.set_outbound_client(client)
    _bind(db)
    body = _run(vpos_api.test_payment({"amount": "1.00", "company_id": "c1"}, Req(ip=USER_IP)))
    assert body["kind"] == "iframe"
    assert body["iframe_url"] == "https://www.paytr.com/odeme/guvenli/28cc613c3d7633cfa4ed0956fdf901e0"
    posted = client.calls[0]["data"]
    assert posted["merchant_id"] == STORE_ID
    assert posted["test_mode"] == "1"
    assert posted["currency"] == "TL"
    assert posted["payment_amount"] == "100"
    assert "merchant_key" not in posted and "merchant_salt" not in posted
    assert MERCHANT_KEY not in json.dumps(posted) and MERCHANT_SALT not in json.dumps(posted)
    assert posted["merchant_ok_url"] == f"https://app.example.com/vpos/result/{body['intent_id']}"
    assert posted["merchant_fail_url"] == posted["merchant_ok_url"]
    assert "/api/vpos/" not in posted["merchant_ok_url"]
    expected = paytr.paytr_token(
        MERCHANT_KEY, STORE_ID, USER_IP, posted["merchant_oid"], EMAIL, "100",
        posted["user_basket"], "0", "0", "TL", "1", MERCHANT_SALT,
    )
    assert posted["paytr_token"] == expected
    intent = db.payment_intents.docs[body["intent_id"]]
    assert intent["status"] == "pending"
    assert intent["amount"] == "1.00"
    assert db.bank_transactions.docs == {}
    failed = FakeClient(FakeResp({"status": "failed", "reason": f"gecersiz {MERCHANT_KEY} {MERCHANT_SALT}"}))
    vpos_api.set_outbound_client(failed)
    with pytest.raises(HTTPException) as err:
        _run(vpos_api.test_payment({"amount": "1.00", "company_id": "c1"}, Req(ip=USER_IP)))
    assert err.value.status_code == 502
    assert MERCHANT_KEY not in str(err.value.detail)
    failed_intent = next(doc for doc in db.payment_intents.docs.values() if doc["status"] == "failed")
    assert failed_intent["result"]["error"] == "token_failed"
    assert len(failed_intent["result"]["reason"]) <= 120
    stored_blob = json.dumps(failed_intent)
    assert MERCHANT_KEY not in stored_blob and MERCHANT_SALT not in stored_blob
    assert MERCHANT_KEY not in caplog.text and MERCHANT_SALT not in caplog.text


def _notify(db, config_id, form, ip="198.51.100.9"):
    return _run(vpos_api.paytr_notify(config_id, Req(form=form, ip=ip, path=f"/api/vpos/paytr/notify/{config_id}")))


def _seed(db, **kwargs):
    cfg = _config(**{k: kwargs[k] for k in ("company", "config_id") if k in kwargs})
    if "key" in kwargs:
        cfg = _config(company=kwargs.get("company", "c1"), config_id=kwargs.get("config_id", "cfg1"), key=kwargs["key"], salt=kwargs.get("salt", MERCHANT_SALT))
    db.vpos_configs.docs[cfg["_id"]] = cfg
    intent = _intent(
        company=kwargs.get("company", "c1"),
        amount=kwargs.get("amount", "1.00"),
        order_id=kwargs.get("order_id", "ordpaytr001"),
        config_id=cfg["_id"],
        status=kwargs.get("status", "pending"),
    )
    if "config_id_on_intent" in kwargs:
        intent["vpos_config_id"] = kwargs["config_id_on_intent"]
    if "intent_company" in kwargs:
        intent["company_id"] = kwargs["intent_company"]
    db.payment_intents.docs[intent["_id"]] = copy.deepcopy(intent)
    return cfg, intent


def _form(intent, status="success", total="100", key=MERCHANT_KEY, salt=MERCHANT_SALT, **extra):
    form = {
        "merchant_oid": intent["order_id"],
        "status": status,
        "total_amount": total,
        "payment_type": "card",
        "failed_reason_code": extra.get("failed_reason_code", ""),
        "failed_reason_msg": extra.get("failed_reason_msg", ""),
    }
    form["hash"] = paytr.notify_hash(key, form["merchant_oid"], salt, status, total)
    form.update(extra)
    return form


def test_notify_hash_amount_company_and_idempotent(db, caplog):
    caplog.set_level(logging.DEBUG)
    cfg, intent = _seed(db)
    bad = _form(intent)
    bad["hash"] = "A" * len(bad["hash"])
    before = copy.deepcopy(db.payment_intents.docs[intent["_id"]])
    with pytest.raises(HTTPException) as err:
        _notify(db, cfg["_id"], bad)
    assert err.value.status_code == 400
    assert db.payment_intents.docs[intent["_id"]] == before
    assert db.payment_intents.update_count == 0

    mismatch = _form(intent, total="9999")
    resp = _notify(db, cfg["_id"], mismatch)
    assert resp.body == b"OK"
    stored = db.payment_intents.docs[intent["_id"]]
    assert stored["status"] == "failed"
    assert stored["amount"] == "1.00"
    assert stored["result"] == {"error": "amount_mismatch"}
    assert "9999" not in json.dumps(stored)

    cfg, intent = _seed(db, order_id="ordok")
    ok = _form(intent)
    resp = _notify(db, cfg["_id"], ok)
    assert resp.body == b"OK"
    assert db.payment_intents.docs[intent["_id"]]["status"] == "paid"
    assert db.payment_intents.docs[intent["_id"]]["amount"] == "1.00"
    after = db.payment_intents.update_count
    snap = copy.deepcopy(db.payment_intents.docs[intent["_id"]])
    again = _notify(db, cfg["_id"], ok)
    assert again.body == b"OK"
    assert db.payment_intents.update_count == after
    assert db.payment_intents.docs[intent["_id"]] == snap

    other_cfg = _config(company="c1", config_id="cfg-other")
    db.vpos_configs.docs[other_cfg["_id"]] = other_cfg
    cfg, intent = _seed(db, order_id="ordcfg", config_id="cfg-real")
    untouched = copy.deepcopy(db.payment_intents.docs[intent["_id"]])
    crossed = _notify(db, other_cfg["_id"], _form(intent))
    assert crossed.body == b"OK"
    assert db.payment_intents.docs[intent["_id"]] == untouched

    cfg, intent = _seed(db, order_id="ordco", config_id="cfg-c2", company="c2", intent_company="c1")
    untouched = copy.deepcopy(db.payment_intents.docs[intent["_id"]])
    mixed = _notify(db, "cfg-c2", _form(intent))
    assert mixed.body == b"OK"
    assert db.payment_intents.docs[intent["_id"]] == untouched
    assert MERCHANT_KEY not in caplog.text and MERCHANT_SALT not in caplog.text
    assert db.bank_transactions.docs == {}


def test_ok_url_does_not_write_intent(db):
    _save(db)
    client = FakeClient(FakeResp({"status": "success", "token": "aabbccddeeff00112233"}))
    vpos_api.set_outbound_client(client)
    _bind(db)
    body = _run(vpos_api.test_payment({"amount": "1.00", "company_id": "c1"}, Req(ip=USER_IP)))
    posted = client.calls[0]["data"]
    assert posted["merchant_ok_url"].endswith(f"/vpos/result/{body['intent_id']}")
    assert posted["merchant_fail_url"] == posted["merchant_ok_url"]
    before = copy.deepcopy(db.payment_intents.docs[body["intent_id"]])
    assert before["status"] == "pending"
    redirected = _run(vpos_api.vpos_callback(body["intent_id"], Req(form={"status": "success", "merchant_oid": before["order_id"], "total_amount": "100"}, path=f"/api/vpos/callback/{body['intent_id']}")))
    assert redirected.status_code == 303
    assert db.payment_intents.docs[body["intent_id"]]["status"] == "pending"
    assert db.payment_intents.docs[body["intent_id"]]["result"] is None


def test_paytr_notify_is_public():
    assert rbac.is_public_api_path("/api/vpos/paytr/notify/cfg1", "POST") is True
    assert rbac.is_public_api_path("/api/vpos/configs", "PUT") is False


def test_real_async_client_is_rejected():
    import httpx
    import vpos.http as vpos_http

    with pytest.raises(AssertionError, match="sahte client"):
        httpx.AsyncClient(timeout=1)
    with pytest.raises(AssertionError, match="sahte client"):
        vpos_http.open_async_client()
