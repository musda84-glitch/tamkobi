"""Çöp geri alma: sync tombstone temizliği + updated_at damgası."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import trash  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def test_clear_sync_tombstones_deletes_matching():
    db = MagicMock()
    db.sync_tombstones.delete_many = AsyncMock()
    trash.init(db)
    _run(trash._clear_sync_tombstones("bank_transactions", ["tx1", "tx2"]))
    db.sync_tombstones.delete_many.assert_awaited_once_with(
        {"collection": "bank_transactions", "doc_id": {"$in": ["tx1", "tx2"]}}
    )


def test_restore_clears_tombstone_and_stamps_updated_at():
    doc = {
        "_id": "tx_restore_1",
        "company_id": "co1",
        "account_id": "cash1",
        "type": "inflow",
        "amount": 260,
        "description": "Test",
        "created_by_name": "tamkobi.com",
    }
    trash_rec = {
        "_id": "trash1",
        "collection": "bank_transactions",
        "entity_type": "bank_transaction",
        "label": "Test · 260,00 ₺",
        "doc": doc,
        "related": [],
    }

    bank_coll = MagicMock()
    bank_coll.find_one = AsyncMock(return_value=None)
    bank_coll.insert_one = AsyncMock()
    bank_coll.delete_one = AsyncMock()

    trash_coll = MagicMock()
    trash_coll.find_one = AsyncMock(return_value=trash_rec)
    trash_coll.delete_one = AsyncMock()

    tombs = MagicMock()
    tombs.delete_many = AsyncMock()

    class _DB:
        def __getitem__(self, name):
            if name == "bank_transactions":
                return bank_coll
            if name == "trash":
                return trash_coll
            raise KeyError(name)

        trash = trash_coll
        sync_tombstones = tombs

    db = _DB()
    trash.init(db)
    trash._hooks.clear()

    out = _run(trash.restore_trash_item("trash1"))
    assert out["status"] == "success"
    assert out["id"] == "tx_restore_1"
    inserted = bank_coll.insert_one.await_args.args[0]
    assert inserted["_id"] == "tx_restore_1"
    assert inserted.get("restored_at")
    assert inserted.get("updated_at")
    tombs.delete_many.assert_awaited()
    trash_coll.delete_one.assert_awaited_once_with({"_id": "trash1"})
