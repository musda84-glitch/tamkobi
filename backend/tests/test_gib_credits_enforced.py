"""GİB kontör hesabı: yapılandırılmış entegratör iç cüzdanı düşürmez.

Ağ yok. integrator-credits çağrılmaz. resolve_company_id şirket sınırını korur.
"""
from __future__ import annotations

import asyncio
import inspect
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")
os.environ.setdefault("JWT_SECRET", "test-gib-credits-enforced-not-default")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

import e_invoice  # noqa: E402
import gib_credits  # noqa: E402
import saas  # noqa: E402

COMP_A = "comp_a"
COMP_B = "comp_b"
LEGACY_KEYS = ("company_id", "wallet_id", "balance", "sales_enabled", "packs", "ledger")


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, limit):
        return list(self.rows)[: int(limit)]


def _user(company_ids, active):
    return {
        "_id": "user-" + (active or "none"),
        "company_ids": list(company_ids),
        "active_company_id": active,
        "is_super_admin": False,
    }


def _db(settings, *, balance=0, sales=False):
    ledger = [
        {"_id": "led-a", "wallet_id": f"wallet-{COMP_A}", "company_id": COMP_A, "type": "welcome",
         "credits": 50, "note": "Hoş geldin", "created_at": "2026-10-01T00:00:00"},
        {"_id": "led-b", "wallet_id": f"wallet-{COMP_B}", "company_id": COMP_B, "type": "gift",
         "credits": 9, "note": "B-SECRET", "created_at": "2026-10-02T00:00:00"},
    ]
    wallets = {
        f"wallet-{COMP_A}": {"_id": f"wallet-{COMP_A}", "balance": balance},
        f"wallet-{COMP_B}": {"_id": f"wallet-{COMP_B}", "balance": 99},
    }
    db = MagicMock()

    async def settings_find(query=None, *args, **kwargs):
        return settings.get((query or {}).get("company_id"))

    async def wallet_find(query=None, *args, **kwargs):
        return wallets.get((query or {}).get("_id"))

    def ledger_find(query=None, *args, **kwargs):
        wid = (query or {}).get("wallet_id")
        return _Cursor([row for row in ledger if row.get("wallet_id") == wid])

    db.einvoice_settings.find_one = AsyncMock(side_effect=settings_find)
    db.gib_wallets.find_one = AsyncMock(side_effect=wallet_find)
    db.gib_wallets.insert_one = AsyncMock()
    db.gib_wallets.update_one = AsyncMock()
    db.gib_credit_ledger.find = MagicMock(side_effect=ledger_find)
    db.gib_credit_ledger.insert_one = AsyncMock()
    db.platform_settings.find_one = AsyncMock(return_value={
        "_id": "platform",
        "gib_credits_sales": sales,
        "gib_packs": [{"id": "gib_100", "name": "100 Kontör", "credits": 100, "price": 250, "tagline": "küçük"}],
    })
    db.platform_settings.update_one = AsyncMock()
    return db


def _call(db, company_id, user):
    gib_credits.init(db)
    with patch.object(saas, "license_id_of", new=AsyncMock(side_effect=lambda cid: f"wallet-{cid}")), patch.object(
        e_invoice.isnet, "get_company_balance", side_effect=AssertionError("integrator network")
    ):
        return _run(gib_credits.account_credits(company_id=company_id, user=user))


def test_helper_matches_issue_invoice_live_providers():
    assert e_invoice.REAL_INTEGRATOR_PROVIDERS == ("n11faturam", "isnet", "isnet_portal", "qnb_efinans")
    for provider in e_invoice.REAL_INTEGRATOR_PROVIDERS:
        assert e_invoice.configured_real_integrator({"provider": provider, "status": "configured"}) is True
    assert e_invoice.configured_real_integrator({"provider": "isnet", "status": "simulated"}) is False
    assert e_invoice.configured_real_integrator({"status": "simulated"}) is False
    assert e_invoice.configured_real_integrator({"provider": "custom", "status": "configured"}) is False
    assert e_invoice.configured_real_integrator(None) is False
    src = inspect.getsource(e_invoice.issue_invoice)
    assert "configured_real_integrator(settings)" in src
    assert "REAL_INTEGRATOR_PROVIDERS" in src
    assert src.index("configured_real_integrator(settings)") < src.index("if consume:")


def test_configured_isnet_is_not_enforced_and_keeps_legacy_shape():
    db = _db({COMP_A: {"provider": "isnet", "status": "configured", "password_enc": "secret"}}, balance=0)
    body = _call(db, COMP_A, _user([COMP_A], COMP_A))
    assert body["enforced"] is False
    assert body["integrator_provider"] == "isnet"
    assert body["company_id"] == COMP_A
    assert body["wallet_id"] == f"wallet-{COMP_A}"
    assert body["balance"] == 0
    assert body["sales_enabled"] is False
    assert body["packs"] == []
    assert [row["id"] for row in body["ledger"]] == ["led-a"]
    assert "password_enc" not in body
    assert "B-SECRET" not in str(body)
    for key in LEGACY_KEYS:
        assert key in body
    db.gib_wallets.insert_one.assert_not_called()
    db.gib_credit_ledger.insert_one.assert_not_called()
    db.platform_settings.update_one.assert_not_called()
    queried = [c.args[0].get("company_id") for c in db.einvoice_settings.find_one.await_args_list]
    assert queried == [COMP_A]


def test_simulated_settings_keep_wallet_enforced():
    db = _db({COMP_A: {"status": "simulated"}, COMP_B: {"provider": "isnet", "status": "configured"}})
    body = _call(db, COMP_A, _user([COMP_A], COMP_A))
    assert body["enforced"] is True
    assert body["integrator_provider"] is None
    assert body["balance"] == 0
    assert set(LEGACY_KEYS) <= set(body)
    queried = [c.args[0].get("company_id") for c in db.einvoice_settings.find_one.await_args_list]
    assert queried == [COMP_A]


def test_unconfigured_isnet_still_enforced():
    db = _db({COMP_A: {"provider": "isnet", "status": "simulated"}})
    body = _call(db, COMP_A, _user([COMP_A], COMP_A))
    assert body["enforced"] is True
    assert body["integrator_provider"] == "isnet"


def test_missing_settings_enforced_and_null_provider():
    db = _db({})
    body = _call(db, None, _user([COMP_A], COMP_A))
    assert body["company_id"] == COMP_A
    assert body["enforced"] is True
    assert body["integrator_provider"] is None


def test_other_company_blocked_by_resolve_company_id():
    src = inspect.getsource(gib_credits.account_credits)
    assert "resolve_company_id" in src
    db = _db({COMP_B: {"provider": "isnet", "status": "configured", "username": "B-SECRET"}})
    with pytest.raises(HTTPException) as exc:
        _call(db, COMP_B, _user([COMP_A], COMP_A))
    assert exc.value.status_code == 403
    assert exc.value.detail == "Bu şirket hesabına erişiminiz yok."
    db.einvoice_settings.find_one.assert_not_called()
    db.gib_wallets.find_one.assert_not_called()
    db.gib_wallets.insert_one.assert_not_called()
    db.gib_credit_ledger.insert_one.assert_not_called()
