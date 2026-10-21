"""Üst firmaya bağlanınca GİB kontörü taşınır. Sahipsiz cüzdan dry-run yazmaz.

Canlı veritabanı yok. Sahipsiz cüzdan betiği burada çalıştırılmaz; yalnız
bellekteki sahte koleksiyonlara bakılır.
"""
from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import addons  # noqa: E402
import gib_credits  # noqa: E402
import saas  # noqa: E402
from test_platform_admin_v1 import FakeDB  # noqa: E402

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "gib_wallet_orphans.py"


def _run(coro):
    return asyncio.run(coro)


def _load_script():
    spec = importlib.util.spec_from_file_location("gib_wallet_orphans", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _wallet_blob(db):
    return {
        "wallets": {key: dict(doc) for key, doc in db.gib_wallets.docs.items()},
        "ledger": {key: dict(doc) for key, doc in db.gib_credit_ledger.docs.items()},
    }


@pytest.fixture
def db():
    fake = FakeDB()
    prev = (saas._db, saas._current_user, addons._db, gib_credits._db, gib_credits._current_user)
    saas.init(fake, None)
    saas.invalidate()
    addons.init(fake)
    gib_credits.init(fake, None)
    yield fake
    saas.init(prev[0], prev[1])
    addons.init(prev[2])
    gib_credits.init(prev[3], prev[4])
    saas.invalidate()


async def _seed_pair(db, *, child_balance=None):
    await db.companies.insert_one({"_id": "comp_parent", "name": "Ust", "license_id": "comp_parent"})
    await db.companies.insert_one({"_id": "comp_child", "name": "Alt", "license_id": "comp_child"})
    await db.company_licenses.insert_one({"_id": "comp_parent", "status": "active"})
    await db.company_licenses.insert_one({"_id": "comp_child", "status": "active"})
    if child_balance is not None:
        await db.gib_wallets.insert_one({
            "_id": "comp_child",
            "balance": child_balance,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        })


def _ledger(db):
    return list(db.gib_credit_ledger.docs.values())


def test_attach_moves_balance_without_welcome(db):
    _run(_seed_pair(db, child_balance=120))

    row = _run(saas.apply_set_company_parent("comp_child", "comp_parent"))

    assert row["license_id"] == "comp_parent"
    assert row["parent_company_id"] == "comp_parent"
    assert "comp_child" not in db.company_licenses.docs
    assert db.gib_wallets.docs["comp_child"]["balance"] == 0
    assert db.gib_wallets.docs["comp_parent"]["balance"] == 120
    rows = _ledger(db)
    assert len(rows) == 2
    assert {item["type"] for item in rows} == {"transfer_out", "transfer_in"}
    assert {item["amount"] for item in rows} == {120}
    assert {item["transfer_id"] for item in rows} == {rows[0]["transfer_id"]}
    assert {item["company_id"] for item in rows} == {"comp_child"}
    assert all(item["type"] != "welcome" for item in rows)
    assert rows[0]["transfer_id"]
    out = next(item for item in rows if item["type"] == "transfer_out")
    inn = next(item for item in rows if item["type"] == "transfer_in")
    assert out["wallet_id"] == "comp_child"
    assert inn["wallet_id"] == "comp_parent"
    assert out["credits"] == -120
    assert inn["credits"] == 120


def test_attach_twice_does_not_double_transfer(db):
    _run(_seed_pair(db, child_balance=80))

    _run(saas.apply_set_company_parent("comp_child", "comp_parent"))
    _run(saas.apply_set_company_parent("comp_child", "comp_parent"))

    assert db.gib_wallets.docs["comp_parent"]["balance"] == 80
    assert db.gib_wallets.docs["comp_child"]["balance"] == 0
    assert len(_ledger(db)) == 2
    assert not any(item["type"] == "welcome" for item in _ledger(db))


def test_same_transfer_id_is_not_applied_twice(db):
    _run(_seed_pair(db, child_balance=40))

    async def go():
        first = await gib_credits.transfer_wallet_balance(
            "comp_child", "comp_parent", company_id="comp_child", transfer_id="gib-wallet-attach:once",
        )
        second = await gib_credits.transfer_wallet_balance(
            "comp_child", "comp_parent", company_id="comp_child", transfer_id="gib-wallet-attach:once",
        )
        return first, second

    first, second = _run(go())

    assert first["applied"] is True
    assert first["transferred"] == 40
    assert second["duplicate"] is True
    assert second["transferred"] == 0
    assert db.gib_wallets.docs["comp_parent"]["balance"] == 40
    assert db.gib_wallets.docs["comp_child"]["balance"] == 0
    assert len(_ledger(db)) == 2


def test_missing_old_wallet_does_not_raise(db):
    _run(_seed_pair(db, child_balance=None))

    row = _run(saas.apply_set_company_parent("comp_child", "comp_parent"))

    assert row["license_id"] == "comp_parent"
    assert db.gib_wallets.docs == {}
    assert db.gib_credit_ledger.docs == {}


def test_detach_opens_zero_wallet_without_splitting_or_welcome(db):
    _run(_seed_pair(db, child_balance=90))
    _run(saas.apply_set_company_parent("comp_child", "comp_parent"))

    row = _run(saas.apply_detach_subsidiary("comp_child"))

    assert row["license_id"] == "comp_child"
    assert not row.get("parent_company_id")
    assert db.gib_wallets.docs["comp_parent"]["balance"] == 90
    assert db.gib_wallets.docs["comp_child"]["balance"] == 0
    assert not any(item["type"] == "welcome" for item in _ledger(db))
    assert {item["type"] for item in _ledger(db)} == {"transfer_out", "transfer_in"}


def test_detach_without_prior_wallet_stays_at_zero(db):
    async def seed():
        await db.companies.insert_one({
            "_id": "comp_parent", "name": "Ust", "license_id": "comp_parent",
        })
        await db.companies.insert_one({
            "_id": "comp_child", "name": "Alt", "license_id": "comp_parent", "parent_company_id": "comp_parent",
        })
        await db.company_licenses.insert_one({"_id": "comp_parent", "status": "active", "notes": "paket"})
        await db.gib_wallets.insert_one({"_id": "comp_parent", "balance": 15, "created_at": "t", "updated_at": "t"})

    _run(seed())

    _run(saas.apply_detach_subsidiary("comp_child"))

    assert db.gib_wallets.docs["comp_parent"]["balance"] == 15
    assert db.gib_wallets.docs["comp_child"]["balance"] == 0
    assert db.gib_credit_ledger.docs == {}


def test_orphan_script_dry_run_does_not_write(db):
    mod = _load_script()

    async def seed():
        await db.companies.insert_one({"_id": "comp_parent", "name": "Ust", "license_id": "comp_parent"})
        await db.companies.insert_one({
            "_id": "comp_child", "name": "Alt", "license_id": "comp_parent", "parent_company_id": "comp_parent",
        })
        await db.company_licenses.insert_one({"_id": "comp_parent", "status": "active"})
        await db.gib_wallets.insert_one({"_id": "comp_child", "balance": 70, "created_at": "t", "updated_at": "t"})
        await db.gib_wallets.insert_one({"_id": "ghost-wallet", "balance": 25, "created_at": "t", "updated_at": "t"})
        await db.gib_wallets.insert_one({"_id": "comp_parent", "balance": 5, "created_at": "t", "updated_at": "t"})
        await db.gib_credit_ledger.insert_one({
            "_id": "led-ghost",
            "wallet_id": "ghost-wallet",
            "company_id": "comp_child",
            "type": "gift",
            "credits": 25,
            "created_at": "t",
        })

    _run(seed())
    before = _wallet_blob(db)
    writes = (db.gib_wallets.inserts, db.gib_wallets.updates, db.gib_credit_ledger.inserts, db.gib_credit_ledger.updates)

    report = _run(mod.gib_wallet_orphan_report(db, apply=False))

    assert report["dry_run"] is True
    assert report["applied"] == []
    assert report["orphan_count"] == 1
    assert report["orphan_balance"] == 25
    assert report["certain_count"] == 2
    assert report["certain_balance"] == 95
    assert _wallet_blob(db) == before
    assert (db.gib_wallets.inserts, db.gib_wallets.updates, db.gib_credit_ledger.inserts, db.gib_credit_ledger.updates) == writes
    args = mod.build_parser().parse_args([])
    assert args.apply is False
    assert mod.build_parser().parse_args(["--dry-run"]).apply is False


def test_orphan_script_apply_moves_only_certain_matches(db):
    mod = _load_script()

    async def seed():
        await db.companies.insert_one({"_id": "comp_parent", "name": "Ust", "license_id": "comp_parent"})
        await db.companies.insert_one({
            "_id": "comp_child", "name": "Alt", "license_id": "comp_parent", "parent_company_id": "comp_parent",
        })
        await db.company_licenses.insert_one({"_id": "comp_parent", "status": "active"})
        await db.gib_wallets.insert_one({"_id": "comp_child", "balance": 70, "created_at": "t", "updated_at": "t"})
        await db.gib_wallets.insert_one({"_id": "ghost-wallet", "balance": 25, "created_at": "t", "updated_at": "t"})
        await db.gib_wallets.insert_one({"_id": "unknown-wallet", "balance": 9, "created_at": "t", "updated_at": "t"})
        await db.gib_credit_ledger.insert_one({
            "_id": "led-ghost",
            "wallet_id": "ghost-wallet",
            "company_id": "comp_child",
            "type": "gift",
            "credits": 25,
            "created_at": "t",
        })

    _run(seed())

    report = _run(mod.gib_wallet_orphan_report(db, apply=True))
    again = _run(mod.gib_wallet_orphan_report(db, apply=True))

    assert report["dry_run"] is False
    assert db.gib_wallets.docs["comp_child"]["balance"] == 0
    assert db.gib_wallets.docs["ghost-wallet"]["balance"] == 0
    assert db.gib_wallets.docs["unknown-wallet"]["balance"] == 9
    assert db.gib_wallets.docs["comp_parent"]["balance"] == 95
    kinds = {item["type"] for item in _ledger(db)}
    assert "welcome" not in kinds
    assert "transfer_in" in kinds and "transfer_out" in kinds
    assert again["applied"] == []
    assert db.gib_wallets.docs["comp_parent"]["balance"] == 95
