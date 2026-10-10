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


def test_actor_fields_rejects_site_brand_name():
    assert bank_tx.actor_fields({"id": "u1", "name": "tamkobi.com", "email": "ali@firma.com"})[
        "created_by_name"
    ] == "ali@firma.com"
    assert bank_tx.actor_fields({"id": "u1", "name": "TamKobi"})["created_by_name"] == "Kullanıcı"
    assert bank_tx._looks_like_site_brand("example.org") is True
    assert bank_tx._looks_like_site_brand("Ayşe Yılmaz") is False


def test_actor_fields_rejects_platform_crm_email():
    """tamkobi.crm@gmail.com şirket kullanıcısı değil — hareket aktörü olamaz."""
    assert bank_tx._is_platform_actor_email("tamkobi.crm@gmail.com") is True
    assert bank_tx._is_platform_actor_email("destek@tamkobi.com") is True
    assert bank_tx._is_platform_actor_email("mustafa@matek.com") is False
    fields = bank_tx.actor_fields({
        "id": "plat1",
        "name": "TamKobi",
        "email": "tamkobi.crm@gmail.com",
        "is_super_admin": True,
    })
    assert fields == {"created_by_id": None, "created_by_name": None}
    # Süper admin olmasa bile platform e-posta yazılmaz
    fields2 = bank_tx.actor_fields({
        "id": "plat2",
        "name": "tamkobi.com",
        "email": "tamkobi.crm@gmail.com",
    })
    assert fields2["created_by_name"] == "Kullanıcı"
    assert fields2["created_by_name"] != "tamkobi.crm@gmail.com"


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


def test_stamp_replaces_brand_created_by():
    tok = bank_tx.set_current_actor({"id": "u3", "name": "Mehmet", "email": "m@x.com"})
    try:
        doc = {"created_by_name": "tamkobi.com", "amount": 1}
        bank_tx.stamp(doc)
        assert doc["created_by_name"] == "Mehmet"
        assert doc["created_by_id"] == "u3"
    finally:
        bank_tx.reset_current_actor(tok)


def test_stamp_bank_sync_clears_platform_crm_actor():
    tok = bank_tx.set_current_actor({
        "id": "plat1",
        "name": "TamKobi",
        "email": "tamkobi.crm@gmail.com",
        "is_super_admin": True,
    })
    try:
        doc = {
            "source": "bank_sync",
            "created_by_name": "tamkobi.crm@gmail.com",
            "amount": 100,
        }
        bank_tx.stamp(doc)
        assert not doc.get("created_by_name")
        assert not doc.get("created_by_id")
    finally:
        bank_tx.reset_current_actor(tok)


def test_stamp_explicit_user_name_on_doc():
    doc = {"user_name": "Ali Veli", "amount": 5}
    bank_tx.stamp(doc)
    assert doc["created_by_name"] == "Ali Veli"
    assert "user_name" not in doc


def test_scrub_platform_actors_clears_crm_email():
    class Coll:
        def __init__(self):
            self.docs = [
                {"_id": "t1", "company_id": "matek", "created_by_name": "tamkobi.crm@gmail.com", "created_by_id": "p1"},
                {"_id": "t2", "company_id": "matek", "created_by_name": "Mustafa BAL"},
                {"_id": "t3", "company_id": "matek", "matched_by_name": "destek@tamkobi.com", "matched_by_id": "p2"},
            ]
            self.updates = []

        def find(self, q):
            class Cur:
                def __init__(self, rows):
                    self._rows = rows

                async def to_list(self, n):
                    return self._rows

            # Basit filtre: company_id (motor tarzı sync find → async to_list)
            return Cur([d for d in self.docs if d.get("company_id") == "matek"])

        async def update_one(self, filt, op):
            self.updates.append((filt, op))
            tid = filt["_id"]
            for d in self.docs:
                if d["_id"] == tid:
                    for k in (op.get("$unset") or {}):
                        d.pop(k, None)

    coll = Coll()
    db = MagicMock()
    db.bank_transactions = coll
    n = _run(bank_tx.scrub_platform_actors(db, "matek"))
    assert n == 2
    assert not coll.docs[0].get("created_by_name")
    assert coll.docs[1].get("created_by_name") == "Mustafa BAL"
    assert not coll.docs[2].get("matched_by_name")


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
