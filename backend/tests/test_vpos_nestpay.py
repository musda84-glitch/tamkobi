"""NestPay 3D Pay Hosting: hash vektörü, callback bütünlüğü, PCI, yetki.

Bankaya çıkılmaz. Tutar intent'ten gelir; callback tutarı yalnız karşılaştırılır.
"""
import asyncio
import copy
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import comm_service
import public_url
import rbac
import vpos.api as vpos_api
import vpos.nestpay as nestpay
from vpos.base import get_adapter

STORE_KEY = "TEST1234"
PAN = "4531440099991234"
CVV = "cvvX7421Z"
LEAKED_KEY = "STOREKEY-DO-NOT-LOG"
GOLDEN_PLAIN = (
    "1.00|100200127|949|https://app.example.com/api/vpos/callback/intent1|ver3||tr|ORD123|"
    "https://app.example.com/api/vpos/callback/intent1|abc|3d_pay_hosting|Auth|TEST1234"
)
GOLDEN_HASH = "/aOoVh7mRe2wTHC+thdVbmgxmE+iBvYAjcfYoiHl6yUXCa5/0UUAvl7NefzEg/bbJZjFXssRnr7iolwRp3xSqw=="
ESCAPE_HASH = "/kTvkXegx3+RYm6QfFANv/3xw/P1gRf27CSzTqNj75UXldk06LPYQSyHpGUeGKRInhL8PdDml73x2T1VjZDBWA=="
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
            {"_id": "pos1", "company_id": "c1", "type": "pos", "bank_name": "İş", "account_name": "Mağaza POS", "current_balance": 0},
            {"_id": "okc1", "company_id": "c1", "type": "okc_pos", "bank_name": "ÖKC", "account_name": "Yazar Kasa", "current_balance": 0},
            {"_id": "cash1", "company_id": "c1", "type": "cash_box", "bank_name": "Kasa", "account_name": "Nakit", "current_balance": 10},
            {"_id": "pos2", "company_id": "c2", "type": "pos", "bank_name": "Diğer", "account_name": "POS", "current_balance": 5},
        ])
        self.bank_transactions = FakeColl()
        self.company_audit_log = FakeColl()
        self.platform_settings = FakeColl([{"_id": "platform", "public_url": "https://tamkobi.com"}])

    def __getitem__(self, name):
        return getattr(self, name)


def _user(role="admin", company="c1", companies=None):
    return {
        "id": "u-" + role,
        "name": "Kullanıcı",
        "role": role,
        "company_ids": companies if companies is not None else [company],
        "active_company_id": company,
    }


class Req:
    def __init__(self, form=None, ip="203.0.113.8", path="/api/vpos/test-payment"):
        self._form = form or {}
        self.client = SimpleNamespace(host=ip)
        self.headers = {}
        self.method = "POST"
        self.url = SimpleNamespace(path=path)
        self.query_params = {}

    async def form(self):
        return self._form


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def db(monkeypatch):
    database = FakeDB()
    vpos_api.init(database, get_current_user=None)
    vpos_api.CALLBACK_RATE_LIMIT = 30
    vpos_api.reset_callback_rate_limit()

    async def _base(*_args, **_kwargs):
        return "https://app.example.com"

    monkeypatch.setattr(public_url, "public_base_url_for", _base)
    yield database
    vpos_api.CALLBACK_RATE_LIMIT = 30
    vpos_api.reset_callback_rate_limit()


def _bind(db, user):
    async def _current(_request):
        return user

    vpos_api.init(db, get_current_user=_current)


def _payload(**overrides):
    body = {
        "company_id": "c1",
        "family": "nestpay",
        "bank_label": "İş Bankası",
        "mode": "test",
        "client_id": "100200127",
        "store_key": STORE_KEY,
        "gateway_3d_url": "",
        "account_id": "pos1",
        "enabled": True,
        "api_user": "apiuser",
        "api_password": "api-secret",
    }
    body.update(overrides)
    return body


def _save(db, user=None, **overrides):
    _bind(db, user or _user())
    return _run(vpos_api.put_vpos_config(_payload(**overrides), Req(path="/api/vpos/configs")))


def _intent(company="c1", amount="1.00", order_id="ORD123", config_id="cfg1", status="pending", minutes=30):
    now = datetime.now(timezone.utc)
    return {
        "_id": "intent-" + company + "-" + order_id,
        "company_id": company,
        "contact_id": None,
        "purpose": "test",
        "amount": amount,
        "currency": "TRY",
        "order_id": order_id,
        "status": status,
        "vpos_config_id": config_id,
        "created_by": "u-admin",
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=minutes)).isoformat(),
        "result": None,
    }


def _config(company="c1", config_id="cfg1", store_key=STORE_KEY, mode="test"):
    return {
        "_id": config_id,
        "company_id": company,
        "family": "nestpay",
        "bank_label": "İş Bankası",
        "mode": mode,
        "client_id": "100200127",
        "store_key_enc": comm_service.encrypt(store_key),
        "api_user": "apiuser",
        "api_password_enc": comm_service.encrypt("api-secret"),
        "gateway_3d_url": nestpay.PAYTEN_TEST_3D_URL if mode == "test" else LIVE_GATEWAY,
        "account_id": "pos1" if company == "c1" else "pos2",
        "enabled": True,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }


def _signed(intent, store_key=STORE_KEY, **overrides):
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
    }
    form.update(overrides)
    form.pop("hash", None)
    form["hash"] = nestpay.hash_ver3(form, store_key)
    return form


def _callback(db, intent_id, form, ip="203.0.113.9"):
    return _run(vpos_api.vpos_callback(intent_id, Req(form=form, ip=ip, path=f"/api/vpos/callback/{intent_id}")))


# --- hash ver3 (Payten 2024) ---

GOLDEN_PARAMS = {
    "clientid": "100200127",
    "storetype": "3d_pay_hosting",
    "hashAlgorithm": "ver3",
    "TranType": "Auth",
    "amount": "1.00",
    "currency": "949",
    "oid": "ORD123",
    "okUrl": "https://app.example.com/api/vpos/callback/intent1",
    "failUrl": "https://app.example.com/api/vpos/callback/intent1",
    "lang": "tr",
    "rnd": "abc",
    "Instalment": "",
    "encoding": "utf-8",
}


def test_nestpay_hash_ver3_golden_vector_and_field_order():
    assert nestpay.hash_field_names(GOLDEN_PARAMS) == [
        "amount", "clientid", "currency", "failUrl", "hashAlgorithm", "Instalment",
        "lang", "oid", "okUrl", "rnd", "storetype", "TranType",
    ]
    assert nestpay.hash_plaintext(GOLDEN_PARAMS, STORE_KEY) == GOLDEN_PLAIN
    assert nestpay.hash_ver3(GOLDEN_PARAMS, STORE_KEY) == GOLDEN_HASH
    # encoding ve hash hesaba girmez; alan sırası sözlük sırasından bağımsızdır.
    with_noise = dict(reversed(list(GOLDEN_PARAMS.items())))
    with_noise["hash"] = "ignored"
    assert nestpay.hash_ver3(with_noise, STORE_KEY) == GOLDEN_HASH
    escaped = {"amount": "a|b\\c", "clientid": "1", "oid": "o"}
    assert nestpay.hash_plaintext(escaped, "k|y") == r"a\|b\\c|1|o|k\|y"
    assert nestpay.hash_ver3(escaped, "k|y") == ESCAPE_HASH
    assert get_adapter("nestpay").model == "3d_pay_hosting"


def test_hash_compare_digest_rejects_tamper():
    good = nestpay.hash_ver3(GOLDEN_PARAMS, STORE_KEY)
    assert nestpay.hashes_equal(good, good) is True
    flipped = ("A" if good[:1] != "A" else "B") + good[1:]
    assert nestpay.hashes_equal(good, flipped) is False
    assert nestpay.hashes_equal(good, good[:-1]) is False


# --- ayar ---

def test_put_encrypts_secrets_and_get_hides_them(db):
    saved = _save(db)
    assert saved["has_store_key"] is True
    assert saved["has_api_password"] is True
    assert "store_key" not in saved
    assert "store_key_enc" not in saved
    assert "api_password" not in saved
    assert STORE_KEY not in json.dumps(saved)
    stored = next(iter(db.vpos_configs.docs.values()))
    assert stored["store_key_enc"] != STORE_KEY
    assert comm_service.decrypt(stored["store_key_enc"]) == STORE_KEY
    assert "api-secret" not in json.dumps(saved)
    _bind(db, _user())
    again = _run(vpos_api.get_vpos_config(Req(path="/api/vpos/configs"), company_id="c1"))
    assert again["has_store_key"] is True
    assert "store_key_enc" not in again
    assert STORE_KEY not in json.dumps(again)
    audits = list(db.company_audit_log.docs.values())
    assert audits and "TEST1234" not in json.dumps(audits)
    assert "api-secret" not in json.dumps(audits)


def test_non_admin_put_and_test_payment_403(db):
    _save(db)
    _bind(db, _user(role="sales"))
    with pytest.raises(HTTPException) as put_err:
        _run(vpos_api.put_vpos_config(_payload(store_key=""), Req()))
    assert put_err.value.status_code == 403
    with pytest.raises(HTTPException) as pay_err:
        _run(vpos_api.test_payment({"amount": "1.00", "company_id": "c1"}, Req()))
    assert pay_err.value.status_code == 403


def test_live_mode_rejects_test_payment_and_test_gateway(db):
    with pytest.raises(HTTPException) as bad:
        _save(db, mode="live", gateway_3d_url=nestpay.PAYTEN_TEST_3D_URL)
    assert bad.value.status_code == 400
    _save(db, mode="live", gateway_3d_url=LIVE_GATEWAY)
    _bind(db, _user())
    with pytest.raises(HTTPException) as pay_err:
        _run(vpos_api.test_payment({"amount": "1.00", "company_id": "c1"}, Req()))
    assert pay_err.value.status_code == 400
    with pytest.raises(HTTPException) as http_err:
        _save(db, mode="live", gateway_3d_url="http://sanalpos.isbank.com.tr/fim/est3Dgate")
    assert http_err.value.status_code == 400


def test_cash_account_rejected(db):
    with pytest.raises(HTTPException) as err:
        _save(db, account_id="cash1")
    assert err.value.status_code == 400
    assert db.bank_accounts.docs["cash1"]["current_balance"] == 10


def test_other_company_config_403(db):
    _bind(db, _user())
    with pytest.raises(HTTPException) as err:
        _run(vpos_api.put_vpos_config(_payload(company_id="c2"), Req()))
    assert err.value.status_code == 403


# --- test ödemesi (bankaya çıkmaz) ---

def test_test_payment_returns_bank_form_without_calling_out(db):
    _save(db, gateway_3d_url=LIVE_GATEWAY)
    _bind(db, _user())
    with pytest.raises(HTTPException):
        _run(vpos_api.test_payment({"amount": "1.009", "company_id": "c1"}, Req()))
    body = _run(vpos_api.test_payment({"amount": "1.2", "company_id": "c1"}, Req()))
    assert body["action_url"] == nestpay.PAYTEN_TEST_3D_URL
    fields = body["fields"]
    assert fields["amount"] == "1.20"
    assert fields["currency"] == "949"
    assert fields["lang"] == "tr"
    assert fields["storetype"] == "3d_pay_hosting"
    assert fields["hashAlgorithm"] == "ver3"
    lowered = {key.lower() for key in fields}
    assert "pan" not in lowered and "cv2" not in lowered and "cvv" not in lowered
    assert STORE_KEY not in fields.values()
    assert nestpay.hashes_equal(nestpay.hash_ver3(fields, STORE_KEY), fields["hash"])
    intent = db.payment_intents.docs[body["intent_id"]]
    assert intent["amount"] == "1.20"
    assert intent["currency"] == "TRY"
    assert intent["status"] == "pending"
    assert intent["purpose"] == "test"
    assert intent["order_id"] != body["intent_id"]
    assert db.bank_transactions.docs == {}
    assert db.bank_accounts.docs["pos1"]["current_balance"] == 0
    # NestPay kartı bankaya tarayıcı formuyla gönderir; bu iki dosya giden
    # HTTP istemcisi kullanmaz. PayTR ve iyzico backend/vpos/http.py üzerinden
    # httpx açar; onların testleri sahte client enjekte eder.
    vpos_dir = Path(__file__).resolve().parents[1] / "vpos"
    for name in ("nestpay.py", "base.py"):
        text = (vpos_dir / name).read_text(encoding="utf-8")
        assert "httpx" not in text
        assert "requests." not in text


# --- callback ---

def _seed_pair(db, company="c1", **intent_kwargs):
    cfg_id = intent_kwargs.pop("config_id", None) or ("cfg1" if company == "c1" else "cfg-" + company)
    cfg = _config(company=company, config_id=cfg_id)
    db.vpos_configs.docs[cfg["_id"]] = cfg
    intent = _intent(company=company, config_id=cfg["_id"], **intent_kwargs)
    db.payment_intents.docs[intent["_id"]] = copy.deepcopy(intent)
    return intent


def test_callback_valid_hash_marks_paid_and_keeps_balance(db, caplog):
    caplog.set_level(logging.DEBUG)
    intent = _seed_pair(db)
    form = _signed(intent)
    form.update({"pan": PAN, "cv2": CVV, "store_key": LEAKED_KEY})
    form.pop("hash", None)
    form["hash"] = nestpay.hash_ver3(form, STORE_KEY)
    resp = _callback(db, intent["_id"], form)
    assert resp.status_code == 303
    assert resp.headers["location"] == f"https://app.example.com/vpos/result/{intent['_id']}"
    stored = db.payment_intents.docs[intent["_id"]]
    assert stored["status"] == "paid"
    assert stored["amount"] == "1.00"
    assert stored["result"]["auth_code"] == "123456"
    assert stored["result"]["proc_return_code"] == "00"
    assert stored["result"]["md_status"] == "1"
    assert stored["result"]["masked_pan"] == "453144******1234"
    blob = json.dumps(db.payment_intents.docs)
    assert PAN not in blob and CVV not in blob and LEAKED_KEY not in blob and STORE_KEY not in blob
    assert PAN not in caplog.text and CVV not in caplog.text and LEAKED_KEY not in caplog.text and STORE_KEY not in caplog.text
    assert db.bank_transactions.docs == {}
    assert db.bank_accounts.docs["pos1"]["current_balance"] == 0


def test_callback_amount_currency_order_mismatch_fails_without_writing_callback_values(db):
    intent = _seed_pair(db)
    before_amount = intent["amount"]
    for overrides, error in (
        ({"amount": "99.99"}, "amount_mismatch"),
        ({"currency": "840"}, "currency_mismatch"),
        ({"oid": "OTHER-ORDER"}, "order_mismatch"),
    ):
        fresh = _seed_pair(db, order_id="ORD-" + error)
        form = _signed(fresh, **overrides)
        verdict = nestpay.ADAPTER.verify_callback(
            {"company_id": "c1", "store_key": STORE_KEY}, fresh, form,
        )
        assert verdict["ok"] is False
        assert verdict["approved"] is False
        assert verdict["error"] == error
        assert verdict["amount"] == fresh["amount"]
        _callback(db, fresh["_id"], form)
        stored = db.payment_intents.docs[fresh["_id"]]
        assert stored["status"] == "failed"
        assert stored["amount"] == before_amount
        assert stored["order_id"] == fresh["order_id"]
        assert stored["result"] == {"error": error}
        assert "99.99" not in json.dumps(stored)
        assert "840" not in json.dumps(stored)
        assert "OTHER-ORDER" not in json.dumps(stored)


def test_callback_bad_hash_fails(db):
    intent = _seed_pair(db)
    form = _signed(intent)
    form["hash"] = "A" * len(form["hash"])
    _callback(db, intent["_id"], form)
    stored = db.payment_intents.docs[intent["_id"]]
    assert stored["status"] == "failed"
    assert stored["result"] == {"error": "bad_hash"}
    assert "masked_pan" not in stored["result"]


def test_callback_expired_not_paid(db):
    intent = _seed_pair(db, minutes=-1)
    form = _signed(intent)
    _callback(db, intent["_id"], form)
    stored = db.payment_intents.docs[intent["_id"]]
    assert stored["status"] == "expired"
    assert stored["result"] == {"error": "expired"}
    assert stored.get("result", {}).get("auth_code") in (None, "")


def test_second_callback_is_idempotent(db):
    intent = _seed_pair(db)
    form = _signed(intent)
    _callback(db, intent["_id"], form)
    after = db.payment_intents.update_count
    snap = copy.deepcopy(db.payment_intents.docs[intent["_id"]])
    again = _callback(db, intent["_id"], form)
    assert again.status_code == 303
    assert db.payment_intents.update_count == after
    assert db.payment_intents.docs[intent["_id"]] == snap
    assert snap["status"] == "paid"


def test_other_company_intent_does_not_mix(db):
    own = _seed_pair(db, company="c1", order_id="OWN")
    other = _seed_pair(db, company="c2", order_id="OTHER", config_id="cfg-c2")
    db.vpos_configs.docs["cfg-c2"] = _config(company="c2", config_id="cfg-c2", store_key="OTHER-KEY")
    other_before = copy.deepcopy(db.payment_intents.docs[other["_id"]])
    _callback(db, own["_id"], _signed(own))
    assert db.payment_intents.docs[own["_id"]]["status"] == "paid"
    assert db.payment_intents.docs[other["_id"]] == other_before
    # Başka şirketin anahtarı bu intent'i onaylamaz.
    swapped = copy.deepcopy(own)
    swapped["_id"] = "intent-swap"
    swapped["status"] = "pending"
    swapped["order_id"] = "SWAP"
    swapped["vpos_config_id"] = "cfg-c2"
    db.payment_intents.docs[swapped["_id"]] = swapped
    db.vpos_configs.docs["cfg-c2"]["store_key_enc"] = "gAAAA" + ("A" * 48)
    _callback(db, swapped["_id"], _signed(swapped, store_key="OTHER-KEY"))
    assert db.payment_intents.docs[swapped["_id"]]["status"] == "failed"
    assert db.payment_intents.docs[swapped["_id"]]["result"]["error"] == "company_mismatch"
    assert db.payment_intents.docs[other["_id"]] == other_before
    _bind(db, _user())
    with pytest.raises(HTTPException) as err:
        _run(vpos_api.get_payment_intent(other["_id"], Req(path=f"/api/vpos/intents/{other['_id']}")))
    assert err.value.status_code == 404
    seen = _run(vpos_api.get_payment_intent(own["_id"], Req()))
    assert seen["status"] == "paid"
    assert seen["company_id"] == "c1"


def test_callback_rate_limit_does_not_echo_card(db):
    vpos_api.CALLBACK_RATE_LIMIT = 2
    vpos_api.reset_callback_rate_limit()
    intent = _seed_pair(db)
    form = _signed(intent, pan=PAN, cv2=CVV)
    _callback(db, intent["_id"], form, ip="198.51.100.4")
    _callback(db, intent["_id"], form, ip="198.51.100.4")
    with pytest.raises(HTTPException) as err:
        _callback(db, intent["_id"], form, ip="198.51.100.4")
    assert err.value.status_code == 429
    assert PAN not in str(err.value.detail)
    assert CVV not in str(err.value.detail)


def test_callback_is_public_and_configs_are_not():
    assert rbac.is_public_api_path("/api/vpos/callback/abc", "POST") is True
    assert rbac.is_public_api_path("/api/vpos/configs", "GET") is False
    assert rbac.is_public_api_path("/api/vpos/configs", "PUT") is False
    assert rbac.is_public_api_path("/api/vpos/test-payment", "POST") is False
    assert rbac.is_public_api_path("/api/vpos/intents/abc", "GET") is False
    assert rbac.module_for_path("/api/vpos/configs") == "/settings"
    assert rbac.module_for_path("/api/pos/sale") == "/hizli-satis"
