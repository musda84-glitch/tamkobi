"""Doğrudan çağrıda Depends çözülmez; yenileme token'ındaki firma geçerli kalır.

Bellek içi TestClient. Canlı veritabanına ve 8021 portuna bağlanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

os.environ.setdefault("JWT_SECRET", "test-no-default-company-fallback-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import auth_utils  # noqa: E402
import company_audit  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import saas_billing  # noqa: E402
import saas_docs  # noqa: E402
import saas_extras  # noqa: E402
import server  # noqa: E402
from mysql_store import match_query  # noqa: E402

COMP_A = "comp-renew-a"
COMP_B = "comp-renew-b"
PLAN = "plan_pro"
DENY = "Bu şirket hesabına erişiminiz yok."
NO_COMPANY = "Şirket seçilmedi."


class _StripeSession:
    url = "https://checkout.stripe.test/cs_test_renew"
    session_id = "cs_test_renew"


class _StripeCheckout:
    def __init__(self, api_key=None, webhook_url=None, **_kwargs):
        self.api_key = api_key
        self.webhook_url = webhook_url

    async def create_checkout_session(self, _req):
        return _StripeSession()


class _PaytrResponse:
    def json(self):
        return {"status": "success", "token": "paytr-token-renew"}


class _PaytrClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, data=None):
        return _PaytrResponse()


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


class MemColl:
    def __init__(self):
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

    async def update_one(self, query, update, upsert=False):
        from mysql_store import apply_update

        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        return SimpleNamespace(modified_count=0, matched_count=0)


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


def _user(uid, company_ids, active):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }


def _auth(uid):
    return {"Authorization": f"Bearer {auth_utils.create_access_token(uid, f'{uid}@example.com', 'admin')}"}


def _bare_request() -> Request:
    return Request({
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/payments/checkout",
        "raw_path": b"/api/payments/checkout",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 9),
        "server": ("testserver", 80),
    })


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def api(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_checkout_direct_caller")
    monkeypatch.setattr(saas_billing, "StripeCheckout", _StripeCheckout)
    monkeypatch.setattr(saas_extras.httpx, "AsyncClient", _PaytrClient)

    async def _paytr_on():
        return {
            "merchant_id": "mid",
            "merchant_key": "key",
            "merchant_salt": "salt",
            "test_mode": "1",
            "enabled": True,
            "max_installment": "0",
        }

    monkeypatch.setattr(saas_extras, "paytr_conf", _paytr_on)

    db = MemDB()
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Token A.Ş.", "email": "a@example.com"},
        {"_id": COMP_B, "name": "Ziyaretçi Ltd.", "email": "b@example.com"},
    ])
    db.users.docs.extend([
        _user("user-a", [COMP_A], COMP_A),
        _user("user-b", [COMP_B], COMP_B),
    ])
    db.saas_plans.docs.append({
        "_id": PLAN,
        "name": "Pro",
        "price_monthly": 250.0,
        "price_yearly": 2500.0,
        "is_public": True,
    })

    prev = (
        server.db,
        rbac._db,
        saas._db,
        saas._current_user,
        saas_billing._db,
        saas_extras._db,
        saas_docs._db,
        company_audit._db,
    )
    server.db = db
    rbac._db = saas._db = saas_billing._db = saas_extras._db = saas_docs._db = company_audit._db = db
    saas._current_user = server.get_current_user
    saas.invalidate()

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
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        (
            server.db,
            rbac._db,
            saas._db,
            saas._current_user,
            saas_billing._db,
            saas_extras._db,
            saas_docs._db,
            company_audit._db,
        ) = prev
        saas.invalidate()


def test_create_checkout_direct_without_company_is_400():
    with pytest.raises(HTTPException) as exc:
        _run(saas_billing.create_checkout({}, _bare_request()))
    assert exc.value.status_code == 400
    assert exc.value.detail == NO_COMPANY


def test_public_renew_stripe_checkout_without_login(api):
    client, db = api
    token = saas_docs.make_renew_token(COMP_A, PLAN)
    res = client.post(
        f"/api/public/renew/{token}/checkout",
        json={"period": "monthly", "origin_url": "https://example.com"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["checkout_url"] == _StripeSession.url
    assert body["session_id"] == _StripeSession.session_id
    assert db.payment_transactions.docs[-1]["company_id"] == COMP_A
    assert db.payment_transactions.docs[-1]["session_id"] == _StripeSession.session_id


def test_public_renew_paytr_uses_token_company_for_other_visitor(api):
    client, db = api
    token = saas_docs.make_renew_token(COMP_A, PLAN)
    blocked = client.post(
        "/api/payments/paytr/session",
        json={"company_id": COMP_A, "plan_id": PLAN, "period": "monthly", "origin_url": "https://example.com"},
        headers=_auth("user-b"),
    )
    assert blocked.status_code == 403, blocked.text
    assert blocked.json()["detail"] == DENY
    assert db.payment_transactions.docs == []

    res = client.post(
        f"/api/public/renew/{token}/checkout",
        json={"provider": "paytr", "period": "monthly", "origin_url": "https://example.com"},
        headers=_auth("user-b"),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["iframe_token"] == "paytr-token-renew"
    assert "iframe_url" in body
    assert len(db.payment_transactions.docs) == 1
    tx = db.payment_transactions.docs[0]
    assert tx["company_id"] == COMP_A
    assert tx["provider"] == "paytr"
    assert tx["company_id"] != COMP_B


def test_paytr_disabled_is_reported_before_company_resolution(monkeypatch):
    async def _disabled():
        return {
            "merchant_id": "",
            "merchant_key": "",
            "merchant_salt": "",
            "test_mode": "1",
            "enabled": False,
            "max_installment": "0",
        }

    async def _user_must_not_run(_request):
        raise AssertionError("PayTR kapalıyken firma çözümü çalıştı")

    monkeypatch.setattr(saas_extras, "paytr_conf", _disabled)
    monkeypatch.setattr(saas, "_user_dep", _user_must_not_run)
    with pytest.raises(HTTPException) as exc:
        _run(saas_extras.paytr_session(
            {"company_id": COMP_A, "plan_id": PLAN},
            _bare_request(),
        ))
    assert exc.value.status_code == 400
    assert "aktif değil" in exc.value.detail
