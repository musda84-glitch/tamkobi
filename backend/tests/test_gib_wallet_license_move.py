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
from unittest.mock import AsyncMock, patch

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


def _write_counts(db):
    return (
        db.gib_wallets.inserts,
        db.gib_wallets.updates,
        db.gib_credit_ledger.inserts,
        db.gib_credit_ledger.updates,
        db.gib_credit_ledger.deletes,
    )


def test_same_transfer_id_is_not_applied_twice(db):
    _run(_seed_pair(db, child_balance=40))

    async def go():
        first = await gib_credits.transfer_wallet_balance(
            "comp_child", "comp_parent", company_id="comp_child", transfer_id="gib-wallet-attach:once",
        )
        frozen = _wallet_blob(db)
        counts = _write_counts(db)
        second = await gib_credits.transfer_wallet_balance(
            "comp_child", "comp_parent", company_id="comp_child", transfer_id="gib-wallet-attach:once",
        )
        return first, second, frozen, counts

    first, second, frozen, counts = _run(go())

    assert first["applied"] is True
    assert first["transferred"] == 40
    assert second["duplicate"] is True
    assert second["transferred"] == 0
    assert db.gib_wallets.docs["comp_parent"]["balance"] == 40
    assert db.gib_wallets.docs["comp_child"]["balance"] == 0
    assert len(_ledger(db)) == 2
    assert _wallet_blob(db) == frozen
    assert _write_counts(db) == counts


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


def test_retry_after_dest_credit_before_source_debit_keeps_total(db):
    """Hedefe ekleme yazıldıktan sonra, kaynak düşmeden süreç koparsa tekrar deneme çift eklemez."""
    _run(_seed_pair(db, child_balance=40))
    tid = "gib-wallet-attach:dest-first"
    real = db.gib_wallets.find_one_and_update
    state = {"armed": True}

    async def crash_on_debit(q, upd, upsert=False, return_document=True, projection=None):
        inc = int(((upd or {}).get("$inc") or {}).get("balance") or 0)
        if state["armed"] and q.get("_id") == "comp_child" and inc < 0:
            state["armed"] = False
            await real(
                {"_id": "comp_parent", gib_credits.TRANSFER_CREDIT_FIELD: {"$ne": tid}},
                {
                    "$inc": {"balance": -inc},
                    "$set": {"updated_at": "t", gib_credits.TRANSFER_CREDIT_FIELD: tid},
                },
            )
            raise RuntimeError("hedef-eklendi-kaynak-dusmedi")
        return await real(q, upd, upsert=upsert, return_document=return_document, projection=projection)

    db.gib_wallets.find_one_and_update = crash_on_debit
    with pytest.raises(RuntimeError, match="hedef-eklendi-kaynak-dusmedi"):
        _run(gib_credits.transfer_wallet_balance(
            "comp_child", "comp_parent", company_id="comp_child", transfer_id=tid,
        ))
    db.gib_wallets.find_one_and_update = real

    assert db.gib_wallets.docs["comp_child"]["balance"] == 40
    assert db.gib_wallets.docs["comp_parent"]["balance"] == 40
    assert not any(row.get("type") == "transfer_in" for row in _ledger(db))

    again = _run(gib_credits.transfer_wallet_balance(
        "comp_child", "comp_parent", company_id="comp_child", transfer_id=tid,
    ))

    assert again["applied"] is True
    assert db.gib_wallets.docs["comp_child"]["balance"] == 0
    assert db.gib_wallets.docs["comp_parent"]["balance"] == 40
    assert db.gib_wallets.docs["comp_child"]["balance"] + db.gib_wallets.docs["comp_parent"]["balance"] == 40
    rows = _ledger(db)
    assert sum(int(row.get("credits") or 0) for row in rows) == 0
    assert len([row for row in rows if row.get("type") == "transfer_in"]) == 1
    assert len([row for row in rows if row.get("type") == "transfer_out"]) == 1


def test_retry_after_source_debit_before_ledger_completes_rows(db):
    """Kaynak düştükten sonra giriş satırı yazılmadan koparsa tekrar deneme defteri bitirir, bakiyeyi oynatmaz."""
    _run(_seed_pair(db, child_balance=55))
    tid = "gib-wallet-attach:ledger"
    original = db.gib_credit_ledger.insert_one

    async def crash_before_in(doc):
        if doc.get("type") == "transfer_in":
            raise RuntimeError("ledger-oncesi")
        return await original(doc)

    db.gib_credit_ledger.insert_one = crash_before_in
    with pytest.raises(RuntimeError, match="ledger-oncesi"):
        _run(gib_credits.transfer_wallet_balance(
            "comp_child", "comp_parent", company_id="comp_child", transfer_id=tid,
        ))
    db.gib_credit_ledger.insert_one = original

    assert db.gib_wallets.docs["comp_child"]["balance"] == 0
    assert db.gib_wallets.docs["comp_parent"]["balance"] == 55
    assert any(row.get("type") == "transfer_out" for row in _ledger(db))
    assert not any(row.get("type") == "transfer_in" for row in _ledger(db))
    wallets = {key: dict(doc) for key, doc in db.gib_wallets.docs.items()}

    again = _run(gib_credits.transfer_wallet_balance(
        "comp_child", "comp_parent", company_id="comp_child", transfer_id=tid,
    ))

    assert again["applied"] is True
    assert {key: dict(doc) for key, doc in db.gib_wallets.docs.items()} == wallets
    rows = _ledger(db)
    assert {row.get("type") for row in rows} == {"transfer_out", "transfer_in"}
    assert sum(int(row.get("credits") or 0) for row in rows) == 0
    assert {row.get("amount") for row in rows} == {55}


class _RacingWallets:
    """Düşümler kapıda buluşur; bakiye koşulu yazmadan hemen önce yeniden okunur."""

    def __init__(self, docs, *, parties=2):
        self.docs = {key: dict(doc) for key, doc in docs.items()}
        self.parties = parties
        self.arrived = 0
        self.low = min(int(doc.get("balance") or 0) for doc in self.docs.values())
        self._gate = asyncio.Event()

    async def find_one(self, q=None, proj=None, sort=None):
        doc = self.docs.get((q or {}).get("_id"))
        return dict(doc) if doc else None

    async def insert_one(self, doc):
        if doc["_id"] in self.docs:
            from mysql_store import DuplicateKeyError
            raise DuplicateKeyError(doc["_id"])
        self.docs[doc["_id"]] = dict(doc)
        self.low = min(self.low, int(doc.get("balance") or 0))
        return doc

    async def _arrive(self):
        self.arrived += 1
        if self.arrived < self.parties:
            await self._gate.wait()
        else:
            self._gate.set()
            await asyncio.sleep(0)

    def _apply(self, q, upd):
        doc = self.docs.get((q or {}).get("_id"))
        if doc is None:
            return None
        balance_cond = (q or {}).get("balance")
        if isinstance(balance_cond, dict) and "$gte" in balance_cond:
            if int(doc.get("balance") or 0) < int(balance_cond["$gte"]):
                return None
        for field in (gib_credits.TRANSFER_DEBIT_FIELD, gib_credits.TRANSFER_CREDIT_FIELD):
            cond = (q or {}).get(field)
            if isinstance(cond, dict) and "$ne" in cond and doc.get(field) == cond["$ne"]:
                return None
        new = dict(doc)
        for key, value in ((upd or {}).get("$inc") or {}).items():
            new[key] = int(new.get(key) or 0) + int(value)
        new.update((upd or {}).get("$set") or {})
        self.docs[new["_id"]] = new
        self.low = min(self.low, int(new.get("balance") or 0))
        return dict(new)

    async def update_one(self, q, upd, upsert=False):
        inc = int(((upd or {}).get("$inc") or {}).get("balance") or 0)
        if inc < 0:
            await self._arrive()
        result = self._apply(q, upd)
        matched = 1 if result is not None else 0
        return type("Write", (), {"matched_count": matched, "modified_count": matched})()

    async def find_one_and_update(self, q, upd, upsert=False, return_document=True, projection=None):
        inc = int(((upd or {}).get("$inc") or {}).get("balance") or 0)
        if inc < 0:
            await self._arrive()
        return self._apply(q, upd)


def test_concurrent_consume_during_transfer_does_not_mint_credits(db):
    """Taşıma ile eski cüzdandan eşzamanlı consume kontör yoktan var etmez."""
    start = 30
    source = "comp_child"
    dest = "comp_parent"
    company = "comp_child"
    wallets = _RacingWallets({source: {"_id": source, "balance": start, "created_at": "t", "updated_at": "t"}})
    db.gib_wallets = wallets
    prev_index = gib_credits._consume_index_state
    gib_credits._consume_index_state = "pending"

    async def go():
        import event_notify
        with patch.object(saas, "license_id_of", new=AsyncMock(return_value=source)), \
             patch.object(event_notify, "maybe_gib_credits_low", new=AsyncMock(return_value={})):
            return await asyncio.wait_for(
                asyncio.gather(
                    gib_credits.transfer_wallet_balance(
                        source, dest, company_id=company, transfer_id="gib-wallet-attach:race",
                    ),
                    gib_credits.consume(company, 1, invoice_id="inv-race-transfer", note="yarış"),
                    return_exceptions=True,
                ),
                timeout=2,
            )

    try:
        transfer_result, consume_result = _run(go())
    finally:
        gib_credits._consume_index_state = prev_index

    consumed = sum(
        -int(row.get("credits") or 0)
        for row in db.gib_credit_ledger.docs.values()
        if row.get("type") == "consume"
    )
    source_bal = int(wallets.docs[source]["balance"])
    dest_bal = int(wallets.docs.get(dest, {}).get("balance") or 0)
    assert wallets.arrived == 2
    assert source_bal >= 0 and dest_bal >= 0
    assert wallets.low >= 0
    assert source_bal + dest_bal + consumed == start
    assert dest_bal <= start
    assert not (dest_bal == start and consumed)
    assert not isinstance(transfer_result, Exception)
