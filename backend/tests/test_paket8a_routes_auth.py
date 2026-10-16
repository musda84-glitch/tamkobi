"""Paket 8a: banka hareketi, WhatsApp ayar/gönderim/webhook ve BizimHesap ayarı.

Bellek içi veritabanı ve TestClient. 8021'e, canlı veritabanına, graph.facebook.com
ve BizimHesap'a bağlanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import hmac
import inspect
import json
import logging
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-paket8a-routes-auth-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import company_audit  # noqa: E402
import comm_service  # noqa: E402
import migration  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import match_query, new_upsert_doc  # noqa: E402

COMP_A = "comp-a"
COMP_B = "comp-b"
NEXUS = "comp_nexus_main_01"
WA_TOKEN = "wa-access-token-plain-9f3a"
APP_SECRET = "wa-app-secret-plain-77c1"
APP_SECRET_B = "wa-app-secret-plain-b-22"
BH_TOKEN = "bh-plain-token-9f3a-long"
DENY = "Bu şirket hesabına erişiminiz yok."


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, key, direction=1):
        return self

    def limit(self, n):
        return self

    async def to_list(self, length=None):
        rows = copy.deepcopy(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return rows

    def __aiter__(self):
        rows = copy.deepcopy(self._docs)

        async def _gen():
            for row in rows:
                yield row

        return _gen()


class MemColl:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.docs = []

    def find(self, query=None, projection=None):
        return MemCursor([d for d in self.docs if match_query(d, query or {})])

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        self.docs.extend(copy.deepcopy(list(docs)))
        return SimpleNamespace(inserted_ids=[d.get("_id") for d in docs])

    async def update_one(self, query, update, upsert=False):
        from mysql_store import apply_update

        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))


class MemDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl(name, self)
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)


def _user(uid, company_ids, active, *, role="admin", superadmin=False):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }


def _token(uid, *, role="admin", superadmin=False):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", role, is_super_admin=superadmin)


def _auth(uid, *, role="admin", superadmin=False):
    return {"Authorization": f"Bearer {_token(uid, role=role, superadmin=superadmin)}"}


def _tx(**over):
    body = {
        "company_id": COMP_A,
        "account_id": "accA",
        "account_name": "Kasa A",
        "type": "inflow",
        "category": "Cari Tahsilat",
        "amount": 40,
        "currency": "TRY",
        "description": "tahsilat",
        "contact_id": "ctA",
        "contact_name": "Cari A",
        "source": "manual",
    }
    body.update(over)
    return body


def _money(db):
    return {
        "accounts": copy.deepcopy(db.bank_accounts.docs),
        "contacts": copy.deepcopy(db.contacts.docs),
        "txs": copy.deepcopy(db.bank_transactions.docs),
    }


def _wa_payload(phone_number_id, message_id, body, *, sender="905321112233"):
    return {"entry": [{"changes": [{"value": {
        "metadata": {"phone_number_id": phone_number_id},
        "contacts": [{"wa_id": sender, "profile": {"name": "Ali"}}],
        "messages": [{"from": sender, "id": message_id, "type": "text", "text": {"body": body}}],
    }}]}]}


def _sign(raw: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()


def _post_webhook(client, payload, *, secret=None, header=None, sign=True):
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if sign and secret is not None and header is None:
        header = _sign(raw, secret)
    if header is not None:
        headers["X-Hub-Signature-256"] = header
    return client.post("/api/comm/whatsapp/webhook", content=raw, headers=headers)


class _GraphResponse:
    def __init__(self, status_code=200, text="ok"):
        self.status_code = status_code
        self.text = text


class _GraphClient:
    calls = []

    def __init__(self, *args, **kwargs):
        type(self).calls.append({"event": "init", "timeout": kwargs.get("timeout")})

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        type(self).calls.append({"event": "post", "url": url})
        return _GraphResponse()


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.extend([
        _user("user-a", [COMP_A], COMP_A, role="admin"),
        _user("user-b", [COMP_B], COMP_B, role="admin"),
        _user("user-ab", [COMP_A, COMP_B], COMP_A, role="admin"),
        _user("user-sales", [COMP_A], COMP_A, role="sales"),
        _user("user-sa", [], "", role="admin", superadmin=True),
    ])
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A"},
        {"_id": COMP_B, "name": "Firma B"},
        {"_id": NEXUS, "name": "Nexus"},
    ])
    db.bank_accounts.docs.extend([
        {"_id": "accA", "company_id": COMP_A, "type": "cash_box", "account_name": "Kasa A", "current_balance": 1000.0},
        {"_id": "accB", "company_id": COMP_B, "type": "bank", "account_name": "Banka B", "current_balance": 500.0},
        {"_id": "cardA", "company_id": COMP_A, "type": "credit_card", "card_owner": "company", "account_name": "Kart A", "current_balance": 80.0},
        {
            "_id": "custCard", "company_id": COMP_A, "type": "credit_card", "card_owner": "customer",
            "account_name": "Müşteri Kartı", "current_balance": 300.0,
            "linked_contact_id": "ownerA", "linked_contact_name": "Kart Sahibi",
        },
    ])
    db.contacts.docs.extend([
        {"_id": "ctA", "company_id": COMP_A, "name": "Cari A", "balance": 200.0, "phone": "05321112233"},
        {"_id": "ctB", "company_id": COMP_B, "name": "Cari B", "balance": 80.0, "phone": "05321112233"},
        {"_id": "ownerA", "company_id": COMP_A, "name": "Kart Sahibi", "balance": 50.0, "phone": "05329998877"},
        {"_id": "payeeA", "company_id": COMP_A, "name": "Tedarikçi", "balance": 10.0},
    ])
    db.whatsapp_settings.docs.extend([
        {
            "_id": "setA", "company_id": COMP_A, "phone_number_id": "pnA", "verify_token": "verify-a",
            "access_token_enc": comm_service.encrypt(WA_TOKEN),
            "app_secret_enc": comm_service.encrypt(APP_SECRET),
        },
        {
            "_id": "setB", "company_id": COMP_B, "phone_number_id": "pnB", "verify_token": "verify-b",
            "access_token_enc": comm_service.encrypt("b-token"),
            "app_secret_enc": comm_service.encrypt(APP_SECRET_B),
        },
        {
            "_id": "setOpen", "company_id": COMP_A, "phone_number_id": "pnOpen", "verify_token": "verify-open",
        },
    ])
    db.migration_api_configs.docs.append({
        "_id": "bhB", "company_id": COMP_B, "provider": "bizimhesap", "firm_id": "FIRM-B",
        "token_enc": comm_service.encrypt("b-secret-token"), "token_tail": "oken",
    })

    prev = (server.db, migration._db, migration._current_user, rbac._db, saas._db, addons._db, company_audit._db)
    server.db = db
    migration._db = db
    migration._current_user = server.get_current_user
    rbac._db = db
    saas._db = db
    addons._db = db
    company_audit._db = db
    saas.invalidate()
    _GraphClient.calls = []
    bh_calls = []

    async def _fake_bh_get(path, token, firm_id="", timeout=40.0):
        bh_calls.append({"path": path, "firm_id": firm_id})
        return {"warehouses": []}

    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    try:
        with patch("server.httpx.AsyncClient", _GraphClient), patch("migration._bh_get", _fake_bh_get):
            client.__enter__()
            entered = True
            yield client, db, _GraphClient.calls, bh_calls
    finally:
        if entered:
            client.__exit__(None, None, None)
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        server.db, migration._db, migration._current_user, rbac._db, saas._db, addons._db, company_audit._db = prev
        saas.invalidate()


def test_internal_signatures_keep_wa_send_and_drop_nexus_default():
    assert list(inspect.signature(server.wa_send).parameters) == ["req"]
    assert "comp_nexus_main_01" in inspect.getsource(server.wa_send)
    route = inspect.getsource(server.wa_send_route)
    assert "resolve_company_id" in route
    assert "comp_nexus_main_01" not in route
    assert "from server import wa_send" in Path(rbac.__file__).read_text(encoding="utf-8")
    for fn in (server.create_bank_transaction, server.save_wa_settings, server.wa_webhook, server._process_wa_webhook, migration.bh_put_config):
        assert "comp_nexus_main_01" not in inspect.getsource(fn)
    bank = inspect.getsource(server.create_bank_transaction)
    assert bank.index("get_tenant_doc") < bank.index("assert_manual_allowed")
    assert bank.index("assert_manual_allowed") < bank.index("assert_collection_allowed")
    assert bank.index("assert_collection_allowed") < bank.index("apply_customer_card_owner_effect")
    assert bank.index("apply_customer_card_owner_effect") < bank.index('"$inc"')
    assert "/api/comm/whatsapp/webhook" in rbac.PUBLIC_API_ALLOWLIST


def test_bank_transaction_requires_session_and_same_company(api):
    client, db, graph_calls, bh_calls = api
    before = _money(db)

    anon = client.post("/api/banking/transactions", json=_tx())
    assert anon.status_code == 401, anon.text
    assert _money(db) == before

    foreign_account = client.post("/api/banking/transactions", json=_tx(account_id="accB", account_name="Banka B"), headers=_auth("user-a"))
    assert foreign_account.status_code == 404, foreign_account.text
    assert foreign_account.json()["detail"] == "Hesap bulunamadı."
    assert _money(db) == before
    assert db.bank_transactions.docs == []

    foreign_contact = client.post(
        "/api/banking/transactions",
        json=_tx(contact_id="ctB", contact_name="Cari B"),
        headers=_auth("user-a"),
    )
    assert foreign_contact.status_code == 404, foreign_contact.text
    assert _money(db) == before

    shared_user_foreign_contact = client.post(
        "/api/banking/transactions",
        json=_tx(contact_id="ctB", contact_name="Cari B"),
        headers=_auth("user-ab"),
    )
    assert shared_user_foreign_contact.status_code == 404, shared_user_foreign_contact.text
    assert _money(db) == before

    other_company = client.post("/api/banking/transactions", json=_tx(company_id=COMP_B), headers=_auth("user-a"))
    assert other_company.status_code == 403, other_company.text
    assert other_company.json()["detail"] == DENY
    assert _money(db) == before

    both = client.post("/api/banking/transactions", json=_tx(company_id=COMP_B), headers=_auth("user-ab"))
    assert both.status_code == 403, both.text
    assert _money(db) == before
    assert graph_calls == []
    assert bh_calls == []


def test_bank_transaction_uses_account_company_and_increments(api):
    client, db, _graph_calls, _bh_calls = api
    response = client.post(
        "/api/banking/transactions",
        json=_tx(company_id=f"  {COMP_A}  "),
        headers=_auth("user-a"),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["company_id"] == COMP_A
    assert body["company_id"] != f"  {COMP_A}  "
    assert body["type"] == "inflow"
    assert body["amount"] == 40
    stored = db.bank_transactions.docs
    assert len(stored) == 1
    assert stored[0]["company_id"] == COMP_A
    assert stored[0]["account_id"] == "accA"
    assert stored[0]["contact_id"] == "ctA"
    acc = next(d for d in db.bank_accounts.docs if d["_id"] == "accA")
    contact = next(d for d in db.contacts.docs if d["_id"] == "ctA")
    assert acc["current_balance"] == 1040.0
    assert contact["balance"] == 160.0
    untouched = next(d for d in db.bank_accounts.docs if d["_id"] == "accB")
    other_contact = next(d for d in db.contacts.docs if d["_id"] == "ctB")
    assert untouched["current_balance"] == 500.0
    assert other_contact["balance"] == 80.0

    card = client.post(
        "/api/banking/transactions",
        json=_tx(account_id="cardA", account_name="Kart A", contact_id=None),
        headers=_auth("user-a"),
    )
    assert card.status_code == 400, card.text
    assert next(d for d in db.bank_accounts.docs if d["_id"] == "cardA")["current_balance"] == 80.0
    assert len(db.bank_transactions.docs) == 1

    owner = client.post(
        "/api/banking/transactions",
        json=_tx(
            account_id="custCard",
            account_name="Müşteri Kartı",
            type="outflow",
            category="Cari Ödeme",
            amount=25,
            contact_id="payeeA",
            contact_name="Tedarikçi",
            description="kartla ödeme",
        ),
        headers=_auth("user-a"),
    )
    assert owner.status_code == 200, owner.text
    assert owner.json()["owner_contact_id"] == "ownerA"
    assert next(d for d in db.bank_accounts.docs if d["_id"] == "custCard")["current_balance"] == 275.0
    assert next(d for d in db.contacts.docs if d["_id"] == "payeeA")["balance"] == 35.0
    assert next(d for d in db.contacts.docs if d["_id"] == "ownerA")["balance"] == 25.0


def test_whatsapp_and_bizimhesap_settings_require_admin(api):
    client, db, graph_calls, bh_calls = api
    wa_before = copy.deepcopy(db.whatsapp_settings.docs)
    bh_before = copy.deepcopy(db.migration_api_configs.docs)

    for path, payload in (
        ("/api/comm/whatsapp/settings", {"company_id": COMP_A, "phone_number_id": "pnX", "verify_token": "vt-new", "access_token": WA_TOKEN, "app_secret": APP_SECRET}),
        ("/api/migration/bizimhesap/config", {"company_id": COMP_A, "firm_id": "FIRM-X", "token": BH_TOKEN}),
    ):
        anon = client.put(path, json=payload)
        assert anon.status_code == 401, (path, anon.text)
        foreign = client.put(path, json={**payload, "company_id": COMP_B}, headers=_auth("user-a"))
        assert foreign.status_code == 403, (path, foreign.text)
        assert foreign.json()["detail"] == DENY
        member = client.put(path, json=payload, headers=_auth("user-sales", role="sales"))
        assert member.status_code == 403, (path, member.text)

    assert db.whatsapp_settings.docs == wa_before
    assert db.migration_api_configs.docs == bh_before
    with pytest.raises(HTTPException) as exc:
        _run(migration.bh_put_config({"company_id": COMP_A, "firm_id": "FIRM-X", "token": BH_TOKEN}, user=_user("user-sales", [COMP_A], COMP_A, role="sales")))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as wa_exc:
        _run(server.save_wa_settings({"company_id": COMP_A, "phone_number_id": "pnX", "verify_token": "vt-new"}, user=_user("user-sales", [COMP_A], COMP_A, role="sales")))
    assert wa_exc.value.status_code == 403
    assert db.whatsapp_settings.docs == wa_before
    assert db.migration_api_configs.docs == bh_before
    assert graph_calls == []
    assert bh_calls == []


def test_admin_saves_masked_secrets_and_keeps_blank_app_secret(api):
    client, db, _graph_calls, bh_calls = api
    headers = _auth("user-a")
    saved = client.put("/api/comm/whatsapp/settings", json={
        "company_id": COMP_A,
        "phone_number_id": "pnA2",
        "verify_token": "verify-a",
        "access_token": WA_TOKEN,
        "app_secret": APP_SECRET,
    }, headers=headers)
    assert saved.status_code == 200, saved.text
    view = saved.json()
    assert view["company_id"] == COMP_A
    assert view["phone_number_id"] == "pnA2"
    assert view["has_token"] is True
    assert view["has_app_secret"] is True
    assert view["status"] == "connected"
    assert view["webhook_url"] == "/api/comm/whatsapp/webhook"
    assert WA_TOKEN not in saved.text
    assert APP_SECRET not in saved.text
    for key in ("access_token", "app_secret", "access_token_enc", "app_secret_enc"):
        assert key not in view
    stored = next(d for d in db.whatsapp_settings.docs if d["company_id"] == COMP_A and d.get("phone_number_id") == "pnA2")
    assert stored["access_token_enc"] != WA_TOKEN
    assert stored["app_secret_enc"] != APP_SECRET
    assert comm_service.decrypt(stored["app_secret_enc"]) == APP_SECRET
    kept_enc = stored["app_secret_enc"]

    blank = client.put("/api/comm/whatsapp/settings", json={
        "company_id": COMP_A,
        "phone_number_id": "pnA2",
        "verify_token": "verify-a",
        "access_token": "",
        "app_secret": "",
    }, headers=headers)
    assert blank.status_code == 200, blank.text
    assert blank.json()["has_app_secret"] is True
    assert APP_SECRET not in blank.text
    again = next(d for d in db.whatsapp_settings.docs if d["company_id"] == COMP_A and d.get("phone_number_id") == "pnA2")
    assert again["app_secret_enc"] == kept_enc

    cleared = client.put("/api/comm/whatsapp/settings", json={
        "company_id": COMP_A,
        "phone_number_id": "pnA2",
        "verify_token": "verify-a",
        "clear_app_secret": True,
    }, headers=headers)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["has_app_secret"] is False
    assert next(d for d in db.whatsapp_settings.docs if d["company_id"] == COMP_A and d.get("phone_number_id") == "pnA2")["app_secret_enc"] == ""

    clash = client.put("/api/comm/whatsapp/settings", json={
        "company_id": COMP_A,
        "phone_number_id": "pnA2",
        "verify_token": "verify-b",
    }, headers=headers)
    assert clash.status_code == 409, clash.text
    assert next(d for d in db.whatsapp_settings.docs if d["_id"] == "setA")["verify_token"] == "verify-a"
    assert next(d for d in db.whatsapp_settings.docs if d["company_id"] == COMP_B)["verify_token"] == "verify-b"

    bh = client.put("/api/migration/bizimhesap/config", json={"company_id": COMP_A, "firm_id": "FIRM-A", "token": BH_TOKEN}, headers=headers)
    assert bh.status_code == 200, bh.text
    payload = bh.json()
    assert payload == _run(migration._bh_config_payload(COMP_A))
    assert payload["configured"] is True
    assert payload["firm_id"] == "FIRM-A"
    assert payload["token_mask"] == "••••" + BH_TOKEN[-4:]
    assert "token" not in payload
    assert BH_TOKEN not in bh.text
    stored_bh = next(d for d in db.migration_api_configs.docs if d.get("company_id") == COMP_A and d.get("provider") == "bizimhesap")
    assert stored_bh["token_enc"] != BH_TOKEN
    assert comm_service.decrypt(stored_bh["token_enc"]) == BH_TOKEN
    assert next(d for d in db.migration_api_configs.docs if d["_id"] == "bhB")["firm_id"] == "FIRM-B"
    assert bh_calls == []


def test_whatsapp_send_route_is_authed_and_internal_call_is_not(api):
    client, db, graph_calls, _bh_calls = api
    anon = client.post("/api/comm/whatsapp/send", json={"company_id": COMP_A, "phone": "05321112233", "message": "gizli"})
    assert anon.status_code == 401, anon.text
    assert graph_calls == []

    foreign = client.post(
        "/api/comm/whatsapp/send",
        json={"company_id": COMP_B, "phone": "05321112233", "message": "baska"},
        headers=_auth("user-a"),
    )
    assert foreign.status_code == 403, foreign.text
    assert foreign.json()["detail"] == DENY
    assert graph_calls == []
    assert db.whatsapp_logs.docs == []

    own = client.post(
        "/api/comm/whatsapp/send",
        json={"phone": "0532 111 22 33", "message": "kendi"},
        headers=_auth("user-a"),
    )
    assert own.status_code == 200, own.text
    body = own.json()
    assert body["company_id"] == COMP_A
    assert body["status"] == "sent"
    assert body["direction"] == "outbound"
    assert "wa_link" in body
    assert body["message_info"] == "Gönderildi."
    assert len(graph_calls) == 2
    assert graph_calls[-1]["url"] == "https://graph.facebook.com/v21.0/pnA/messages"
    assert WA_TOKEN not in own.text
    assert db.whatsapp_logs.docs[-1]["company_id"] == COMP_A

    calls_before = len(graph_calls)
    direct = _run(server.wa_send({"company_id": COMP_A, "phone": "05321112233", "message": "ic-cagri"}))
    assert direct["status"] == "sent"
    assert direct["company_id"] == COMP_A
    assert len(graph_calls) == calls_before + 2
    legacy = _run(server.wa_send({"phone": "05321112233", "message": "varsayilan"}))
    assert legacy["company_id"] == NEXUS
    assert legacy["status"] == "simulated"
    assert len(graph_calls) == calls_before + 2
    assert any(d["company_id"] == NEXUS and d["message"] == "varsayilan" for d in db.whatsapp_logs.docs)


def test_webhook_signature_and_unknown_phone(api, caplog):
    client, db, _graph_calls, _bh_calls = api
    caplog.set_level(logging.INFO)

    bad = client.get("/api/comm/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "WRONG", "hub.challenge": "123"})
    assert bad.status_code == 403
    ok = client.get("/api/comm/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "verify-a", "hub.challenge": "123"})
    assert ok.status_code == 200, ok.text
    assert ok.text == "123"

    signed = _post_webhook(client, _wa_payload("pnA", "wamid.ok", "Merhaba"), secret=APP_SECRET)
    assert signed.status_code == 200, signed.text
    assert signed.json()["status"] == "ok"
    assert signed.json()["saved"] == 1
    row = next(d for d in db.whatsapp_logs.docs if d.get("wa_message_id") == "wamid.ok")
    assert row["company_id"] == COMP_A
    assert row["signature_verified"] is True
    assert row["direction"] == "inbound"
    assert row["message"] == "Merhaba"
    assert row["contact_id"] == "ctA"
    assert '"signature_verified": True' in caplog.text
    assert APP_SECRET not in caplog.text

    wrong = _post_webhook(client, _wa_payload("pnA", "wamid.bad", "olmaz"), secret=APP_SECRET, header="sha256=" + ("0" * 64))
    assert wrong.status_code == 401, wrong.text
    assert not any(d.get("wa_message_id") == "wamid.bad" for d in db.whatsapp_logs.docs)

    missing = _post_webhook(client, _wa_payload("pnA", "wamid.miss", "eksik"), sign=False)
    assert missing.status_code == 401, missing.text
    assert not any(d.get("wa_message_id") == "wamid.miss" for d in db.whatsapp_logs.docs)

    caplog.clear()
    unsigned = _post_webhook(client, _wa_payload("pnOpen", "wamid.open", "IMZA-YOK-METIN"), sign=False)
    assert unsigned.status_code == 200, unsigned.text
    assert unsigned.json()["saved"] == 1
    open_row = next(d for d in db.whatsapp_logs.docs if d.get("wa_message_id") == "wamid.open")
    assert open_row["company_id"] == COMP_A
    assert open_row["signature_verified"] is False
    assert '"signature_verified": False' in caplog.text
    assert "IMZA-YOK-METIN" not in caplog.text
    assert APP_SECRET not in caplog.text

    unknown = _post_webhook(client, _wa_payload("pn-yok", "wamid.unknown", "kaybol"), sign=False)
    assert unknown.status_code == 200, unknown.text
    assert unknown.json()["saved"] == 0
    assert unknown.json()["ignored"] >= 1
    assert not any(d.get("wa_message_id") == "wamid.unknown" for d in db.whatsapp_logs.docs)
    assert not any(d.get("company_id") == NEXUS and d.get("direction") == "inbound" for d in db.whatsapp_logs.docs)

    mixed_payload = {"entry": [{"changes": [
        {"value": {"metadata": {"phone_number_id": "pnA"}, "messages": [{"from": "905321112233", "id": "wamid.mixA", "type": "text", "text": {"body": "A"}}]}},
        {"value": {"metadata": {"phone_number_id": "pnB"}, "messages": [{"from": "905321112233", "id": "wamid.mixB", "type": "text", "text": {"body": "B"}}]}},
    ]}]}
    mixed = _post_webhook(client, mixed_payload, secret=APP_SECRET)
    assert mixed.status_code == 200, mixed.text
    assert mixed.json()["saved"] == 1
    assert any(d.get("wa_message_id") == "wamid.mixA" and d["signature_verified"] is True for d in db.whatsapp_logs.docs)
    assert not any(d.get("wa_message_id") == "wamid.mixB" for d in db.whatsapp_logs.docs)
