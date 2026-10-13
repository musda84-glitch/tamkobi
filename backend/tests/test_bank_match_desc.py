"""Eşleşme açıklaması: Eşleşti: … (kullanıcı adı yok) + migration dry-run."""
from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import bank_match_desc as bmd  # noqa: E402
import bank_tx  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def test_match_phrase_formats():
    assert bmd.match_phrase(contact_name="Mustafa Bal") == "Eşleşti: Mustafa Bal (cari)"
    assert bmd.match_phrase(
        invoice_number="SF-1", contact_name="ACME",
    ) == "Eşleşti: Fatura SF-1 – ACME"
    assert bmd.match_phrase(target_account_name="Ana Kasa") == "Eşleşti: Ana Kasa"
    assert "Ayşe" not in bmd.match_phrase(contact_name="X", invoice_number="1")


def test_append_and_strip_match_suffix():
    base = "Gelen havale MUSTAFA"
    with_match = bmd.append_match_suffix(base, "Eşleşti: Mustafa Bal (cari)")
    assert with_match == "Gelen havale MUSTAFA · Eşleşti: Mustafa Bal (cari)"
    assert "Ayşe" not in with_match
    assert bmd.strip_match_suffix(with_match) == base
    assert bmd.strip_match_suffix(
        "Metin · Ayşe Yılmaz eşleştirdi (manuel)"
    ) == "Metin"


def test_strip_trailing_actor_name():
    assert bmd.strip_trailing_actor(
        "EFT · Ayşe Yılmaz", "Ayşe Yılmaz",
    ) == "EFT"
    assert bmd.strip_trailing_actor(
        "EFT · Eşleşti: ACME (cari)", "Ayşe",
    ) == "EFT"


def test_bank_sync_stamp_leaves_created_by_empty_for_session_user():
    tok = bank_tx.set_current_actor({"id": "u1", "name": "Mehmet", "email": "m@firma.com"})
    try:
        doc = {"source": "bank_sync", "amount": 10, "description": "EFT"}
        bank_tx.stamp(doc)
        assert not doc.get("created_by_name")
        assert not doc.get("created_by_id")
    finally:
        bank_tx.reset_current_actor(tok)


def test_manual_stamp_keeps_session_user():
    tok = bank_tx.set_current_actor({"id": "u1", "name": "Mehmet"})
    try:
        doc = {"source": "manual", "amount": 5}
        bank_tx.stamp(doc)
        assert doc["created_by_name"] == "Mehmet"
    finally:
        bank_tx.reset_current_actor(tok)


def test_migrate_dry_run_does_not_write():
    class Coll:
        def __init__(self):
            self.docs = [
                {
                    "_id": "t1",
                    "company_id": "matek",
                    "source": "bank_sync",
                    "match_status": "matched",
                    "description": "Havale · Ayşe Yılmaz",
                    "matched_by_name": "Ayşe Yılmaz",
                    "contact_name": "ACME",
                },
            ]
            self.updates = []

        def find(self, q):
            class Cur:
                def __init__(self, rows):
                    self._rows = rows

                async def to_list(self, n):
                    return self._rows

            return Cur(list(self.docs))

        async def update_one(self, filt, op):
            self.updates.append((filt, op))

    coll = Coll()
    db = MagicMock()
    db.bank_transactions = coll
    out = _run(bmd.migrate_match_descriptions(db, "matek", dry_run=True))
    assert out["dry_run"] is True
    assert out["would_update"] >= 1
    assert out["updated"] == 0
    assert coll.updates == []
    assert coll.docs[0]["description"] == "Havale · Ayşe Yılmaz"


def test_migrate_apply_rewrites():
    class Coll:
        def __init__(self):
            self.docs = [
                {
                    "_id": "t1",
                    "company_id": "matek",
                    "source": "bank_sync",
                    "match_status": "matched",
                    "description": "Havale · Ayşe Yılmaz",
                    "matched_by_name": "Ayşe Yılmaz",
                    "contact_name": "ACME",
                },
            ]

        def find(self, q):
            class Cur:
                def __init__(self, rows):
                    self._rows = rows

                async def to_list(self, n):
                    return self._rows

            return Cur(list(self.docs))

        async def update_one(self, filt, op):
            for d in self.docs:
                if d["_id"] == filt["_id"]:
                    d.update(op.get("$set") or {})

    coll = Coll()
    db = MagicMock()
    db.bank_transactions = coll
    out = _run(bmd.migrate_match_descriptions(db, "matek", dry_run=False))
    assert out["updated"] == 1
    assert "Ayşe" not in coll.docs[0]["description"]
    assert "Eşleşti: ACME (cari)" in coll.docs[0]["description"]
    assert coll.docs[0]["description"].startswith("Havale")
