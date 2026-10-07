"""Kasa/banka hareketlerinde created_by aktör damgası."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import bank_tx  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def test_actor_fields_from_user():
    assert bank_tx.actor_fields(None) == {"created_by_id": None, "created_by_name": None}
    assert bank_tx.actor_fields({"id": "u1", "name": "Ayşe"}) == {
        "created_by_id": "u1",
        "created_by_name": "Ayşe",
    }
    assert bank_tx.actor_fields({"_id": "u2", "email": "a@b.com"})["created_by_name"] == "a@b.com"
    assert bank_tx.actor_fields({})["created_by_name"] == "Kullanıcı"


def test_stamp_uses_context_actor():
    tok = bank_tx.set_current_actor({"id": "u9", "name": "Mehmet"})
    try:
        doc = {"amount": 10}
        bank_tx.stamp(doc)
        assert doc["created_by_name"] == "Mehmet"
        assert doc["created_by_id"] == "u9"
    finally:
        bank_tx.reset_current_actor(tok)


def test_stamp_keeps_existing_name():
    tok = bank_tx.set_current_actor({"name": "Other"})
    try:
        doc = {"created_by_name": "Ayşe", "amount": 1}
        bank_tx.stamp(doc)
        assert doc["created_by_name"] == "Ayşe"
    finally:
        bank_tx.reset_current_actor(tok)


def test_stamp_explicit_user_name_on_doc():
    doc = {"user_name": "Ali Veli", "amount": 5}
    bank_tx.stamp(doc)
    assert doc["created_by_name"] == "Ali Veli"
    assert "user_name" not in doc


def test_install_wraps_insert_one():
    inserted = {}

    async def fake_insert(doc, *a, **k):
        inserted["doc"] = dict(doc)
        return MagicMock()

    async def scenario():
        coll = MagicMock()
        coll.insert_one = fake_insert
        coll.insert_many = AsyncMock()
        coll._tamkobi_actor_wrapped = False
        db = MagicMock()
        db.bank_transactions = coll
        pt = MagicMock()
        pt.insert_one = AsyncMock()
        pt.insert_many = AsyncMock()
        pt._tamkobi_actor_wrapped = False
        db.partner_transactions = pt
        bank_tx.install(db)
        tok = bank_tx.set_current_actor({"id": "u1", "name": "Zeynep"})
        try:
            await coll.insert_one({"_id": "t1", "amount": 100})
        finally:
            bank_tx.reset_current_actor(tok)

    _run(scenario())
    assert inserted["doc"]["created_by_name"] == "Zeynep"
    assert inserted["doc"]["created_by_id"] == "u1"
