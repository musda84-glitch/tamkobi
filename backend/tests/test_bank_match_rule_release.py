"""Banka eşleşmesi kaldırılınca öğrenilen/manuel kural güncellenir veya silinir."""
from __future__ import annotations

import asyncio
import copy
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mysql_store import apply_update, document_from_upsert, match_query


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, length=None):
        rows = self._docs if length is None else self._docs[:length]
        return copy.deepcopy(rows)


class MemoryCollection:
    def __init__(self):
        self.docs = {}

    async def insert_one(self, doc):
        stored = copy.deepcopy(doc)
        self.docs[stored["_id"]] = stored
        return stored

    async def find_one(self, query=None, projection=None):
        for doc in self.docs.values():
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        matched = [copy.deepcopy(d) for d in self.docs.values() if match_query(d, query or {})]
        return _Cursor(matched)

    async def update_one(self, query, update, upsert=False):
        found = None
        for doc in self.docs.values():
            if match_query(doc, query or {}):
                found = doc
                break
        if not found:
            if not upsert:
                return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=None)
            new_doc = document_from_upsert(update, query)
            self.docs[new_doc["_id"]] = new_doc
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=new_doc["_id"])
        updated = apply_update(found, update, query)
        old_id = found.get("_id")
        new_id = updated.get("_id") or old_id
        if old_id and old_id != new_id:
            self.docs.pop(old_id, None)
        self.docs[new_id] = updated
        return SimpleNamespace(modified_count=1, matched_count=1, upserted_id=None)

    async def delete_one(self, query):
        for doc_id, doc in list(self.docs.items()):
            if match_query(doc, query or {}):
                del self.docs[doc_id]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class MemoryDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name):
        self._cols.setdefault(name, MemoryCollection())
        return self._cols[name]


USER = {
    "id": "usr_ayse",
    "name": "Ayşe Yılmaz",
    "email": "ayse@firma.com",
    "active_company_id": "co1",
    "company_ids": ["co1"],
}


def _tx(tid, *, company_id="co1", description="TURKCELL FATURA ODEME", **extra):
    doc = {
        "_id": tid,
        "company_id": company_id,
        "account_id": "acc1",
        "account_name": "Vadesiz",
        "type": "outflow",
        "amount": 80.0,
        "description": description,
        "date": "2026-10-01",
        "currency": "TRY",
        "match_status": "unmatched",
        "source": "bank_sync",
    }
    doc.update(extra)
    return doc


def _bind(db):
    import server

    server.db = db
    return server


def _audits(db):
    return list(db["company_audit_log"].docs.values())


def test_learn_rule_returns_id_and_marks_learned():
    import server

    db = MemoryDB()
    _bind(db)
    rid = _run(server._learn_rule("co1", "TURKCELL FATURA ODEME", None, None, "Abonelik"))
    assert rid
    rule = db.bank_match_rules.docs[rid]
    assert rule["source"] == "learned"
    assert rule["company_id"] == "co1"
    assert rule["hits"] == 1
    assert rule["category"] == "Abonelik"
    assert rule["pattern"] == "turkcell"


def test_manual_create_writes_source_manual():
    import server

    db = MemoryDB()
    _bind(db)
    saved = _run(server._create_match_rule_core(
        {"company_id": "co1", "pattern": "turkcell", "category": "Abonelik"},
        USER,
    ))
    assert saved["source"] == "manual"
    assert saved["hits"] == 0
    stored = db.bank_match_rules.docs[saved["id"]]
    assert stored["source"] == "manual"


def test_learn_does_not_overwrite_manual_source():
    import server

    db = MemoryDB()
    _bind(db)
    created = _run(server._create_match_rule_core(
        {"company_id": "co1", "pattern": "turkcell", "category": "Abonelik"},
        USER,
    ))
    rid = _run(server._learn_rule("co1", "TURKCELL FATURA ODEME", None, None, "Abonelik"))
    assert rid == created["id"]
    assert db.bank_match_rules.docs[rid]["source"] == "manual"
    assert db.bank_match_rules.docs[rid]["hits"] == 1


def test_match_then_unmatch_deletes_learned_rule_and_clears_id():
    import server

    db = MemoryDB()
    _bind(db)
    db.bank_transactions.docs["tx1"] = _tx("tx1")
    db.contacts.docs["ct1"] = {"_id": "ct1", "company_id": "co1", "name": "Turkcell", "balance": 10}

    matched = _run(server._apply_match(db.bank_transactions.docs["tx1"], "ct1", None, None, learn=True))
    assert matched["match_status"] == "matched"
    assert matched.get("learned_rule_id")
    rid = matched["learned_rule_id"]
    assert rid in db.bank_match_rules.docs
    assert db.bank_match_rules.docs[rid]["source"] == "learned"
    assert db.contacts.docs["ct1"]["balance"] == 90  # outflow +80

    fresh = copy.deepcopy(db.bank_transactions.docs["tx1"])
    out = _run(server._unmatch(fresh, actor=USER))
    assert out["match_status"] == "unmatched"
    assert out["rule_action"] == "deleted"
    assert "learned_rule_id" not in db.bank_transactions.docs["tx1"]
    assert "matched_rule_id" not in db.bank_transactions.docs["tx1"]
    assert rid not in db.bank_match_rules.docs
    assert db.contacts.docs["ct1"]["balance"] == 10
    summaries = [a.get("summary") or "" for a in _audits(db)]
    assert any("Banka kuralı silindi" in s and "turkcell" in s and "tx1" in s and "Ayşe" in s for s in summaries)


def test_two_hits_first_unmatch_keeps_rule_second_deletes():
    import server

    db = MemoryDB()
    _bind(db)
    db.bank_transactions.docs["tx1"] = _tx("tx1", description="TURKCELL FATURA 1", amount=80.0)
    db.bank_transactions.docs["tx2"] = _tx("tx2", description="TURKCELL FATURA 2", amount=95.0, date="2026-10-08")
    db.contacts.docs["ct1"] = {"_id": "ct1", "company_id": "co1", "name": "Turkcell", "balance": 0}

    a = _run(server._apply_match(db.bank_transactions.docs["tx1"], "ct1", None, None, learn=True))
    b = _run(server._apply_match(db.bank_transactions.docs["tx2"], "ct1", None, None, learn=True))
    assert a["learned_rule_id"] == b["learned_rule_id"]
    rid = a["learned_rule_id"]
    assert db.bank_match_rules.docs[rid]["hits"] == 2

    first = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx1"]), actor=USER))
    assert first["rule_action"] == "decremented"
    assert rid in db.bank_match_rules.docs
    assert db.bank_match_rules.docs[rid]["hits"] == 1
    assert db.bank_transactions.docs["tx2"]["learned_rule_id"] == rid

    second = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx2"]), actor=USER))
    assert second["rule_action"] == "deleted"
    assert rid not in db.bank_match_rules.docs
    keep_summaries = [a.get("summary") or "" for a in _audits(db)]
    assert any("Banka kuralı güncellendi" in s for s in keep_summaries)
    assert any("Banka kuralı silindi" in s for s in keep_summaries)


def test_manual_rule_unmatch_decrements_but_keeps():
    import server

    db = MemoryDB()
    _bind(db)
    db.bank_match_rules.docs["rule_m"] = {
        "_id": "rule_m",
        "company_id": "co1",
        "pattern": "turkcell",
        "category": "Abonelik",
        "source": "manual",
        "hits": 3,
    }
    db.bank_transactions.docs["tx1"] = _tx(
        "tx1",
        match_status="matched",
        category="Abonelik",
        matched_rule_id="rule_m",
    )
    out = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx1"]), actor=USER))
    assert out["match_status"] == "unmatched"
    assert out["rule_action"] == "decremented"
    assert "rule_m" in db.bank_match_rules.docs
    assert db.bank_match_rules.docs["rule_m"]["hits"] == 2
    assert db.bank_match_rules.docs["rule_m"]["source"] == "manual"
    assert "matched_rule_id" not in db.bank_transactions.docs["tx1"]
    assert any("Banka kuralı güncellendi" in (a.get("summary") or "") for a in _audits(db))


def test_legacy_tx_same_logic_other_target_untouched():
    import server

    db = MemoryDB()
    _bind(db)
    db.bank_match_rules.docs["rule_same"] = {
        "_id": "rule_same",
        "company_id": "co1",
        "pattern": "turkcell",
        "category": "Abonelik",
        "source": "learned",
        "hits": 1,
    }
    db.bank_match_rules.docs["rule_other"] = {
        "_id": "rule_other",
        "company_id": "co1",
        "pattern": "turkcell",
        "category": "Diğer",
        "contact_id": "ct-other",
        "source": "learned",
        "hits": 9,
    }
    db.bank_transactions.docs["tx1"] = _tx(
        "tx1",
        match_status="matched",
        category="Abonelik",
        description="TURKCELL FATURA · Eşleşti: Abonelik",
    )
    out = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx1"]), actor=USER))
    assert out["rule_action"] == "deleted"
    assert "rule_same" not in db.bank_match_rules.docs
    assert db.bank_match_rules.docs["rule_other"]["hits"] == 9
    assert db.bank_match_rules.docs["rule_other"]["category"] == "Diğer"


def test_legacy_two_txs_decrements_then_deletes():
    import server

    db = MemoryDB()
    _bind(db)
    db.bank_match_rules.docs["rule_l"] = {
        "_id": "rule_l",
        "company_id": "co1",
        "pattern": "turkcell",
        "contact_id": "ct1",
        "source": "learned",
        "hits": 2,
    }
    db.bank_transactions.docs["tx1"] = _tx(
        "tx1",
        match_status="matched",
        contact_id="ct1",
        contact_name="Turkcell",
        description="TURKCELL FATURA 1 · Eşleşti: Turkcell (cari)",
    )
    db.bank_transactions.docs["tx2"] = _tx(
        "tx2",
        match_status="matched",
        contact_id="ct1",
        contact_name="Turkcell",
        description="TURKCELL FATURA 2 · Eşleşti: Turkcell (cari)",
    )
    db.contacts.docs["ct1"] = {"_id": "ct1", "company_id": "co1", "name": "Turkcell", "balance": 160}

    first = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx1"]), actor=USER))
    assert first["rule_action"] == "decremented"
    assert db.bank_match_rules.docs["rule_l"]["hits"] == 1

    second = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx2"]), actor=USER))
    assert second["rule_action"] == "deleted"
    assert "rule_l" not in db.bank_match_rules.docs


def test_other_company_rule_untouched():
    import server

    db = MemoryDB()
    _bind(db)
    db.bank_match_rules.docs["rule_a"] = {
        "_id": "rule_a",
        "company_id": "co1",
        "pattern": "turkcell",
        "category": "Abonelik",
        "source": "learned",
        "hits": 1,
    }
    db.bank_match_rules.docs["rule_b"] = {
        "_id": "rule_b",
        "company_id": "co2",
        "pattern": "turkcell",
        "category": "Abonelik",
        "source": "learned",
        "hits": 4,
    }
    db.bank_transactions.docs["tx1"] = _tx(
        "tx1",
        match_status="matched",
        category="Abonelik",
        learned_rule_id="rule_a",
    )
    db.bank_transactions.docs["tx_other"] = _tx(
        "tx_other",
        company_id="co2",
        match_status="matched",
        category="Abonelik",
        learned_rule_id="rule_b",
    )
    out = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx1"]), actor=USER))
    assert out["rule_action"] == "deleted"
    assert "rule_a" not in db.bank_match_rules.docs
    assert db.bank_match_rules.docs["rule_b"]["hits"] == 4
    assert db.bank_transactions.docs["tx_other"]["learned_rule_id"] == "rule_b"


def test_missing_source_treated_as_learned():
    import server

    db = MemoryDB()
    _bind(db)
    db.bank_match_rules.docs["rule_old"] = {
        "_id": "rule_old",
        "company_id": "co1",
        "pattern": "turkcell",
        "category": "Abonelik",
        "hits": 1,
    }
    db.bank_transactions.docs["tx1"] = _tx(
        "tx1",
        match_status="matched",
        category="Abonelik",
        learned_rule_id="rule_old",
    )
    out = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx1"]), actor=USER))
    assert out["rule_action"] == "deleted"
    assert "rule_old" not in db.bank_match_rules.docs


def test_auto_match_by_rules_writes_matched_rule_id():
    import server

    db = MemoryDB()
    _bind(db)
    db.bank_match_rules.docs["rule_auto"] = {
        "_id": "rule_auto",
        "company_id": "co1",
        "pattern": "turkcell",
        "category": "Abonelik",
        "source": "manual",
        "hits": 0,
    }
    db.bank_transactions.docs["tx1"] = _tx("tx1")
    n, details, skipped_old = _run(server._auto_match_by_rules("co1", [copy.deepcopy(db.bank_transactions.docs["tx1"])]))
    assert skipped_old == 0
    assert n == 1
    stored = db.bank_transactions.docs["tx1"]
    assert stored["match_status"] == "matched"
    assert stored["matched_rule_id"] == "rule_auto"
    assert stored.get("learned_rule_id") in (None, "")
    assert db.bank_match_rules.docs["rule_auto"]["hits"] == 1
    assert details[0]["via"] in ("rule", "auto")


def test_unmatch_keeps_existing_rollback_and_survives_release_error():
    import server

    db = MemoryDB()
    _bind(db)
    db.contacts.docs["ct1"] = {"_id": "ct1", "company_id": "co1", "name": "Turkcell", "balance": 50}
    db.invoices.docs["inv1"] = {
        "_id": "inv1",
        "company_id": "co1",
        "grand_total": 80,
        "paid_amount": 80,
        "payment_status": "paid",
        "contact_id": "ct1",
    }
    db.bank_transactions.docs["tx1"] = _tx(
        "tx1",
        type="inflow",
        amount=80.0,
        match_status="matched",
        contact_id="ct1",
        related_invoice_id="inv1",
        learned_rule_id="rule_x",
        category="Cari Tahsilat",
    )
    with patch.object(server, "_release_rule_for_tx", AsyncMock(side_effect=RuntimeError("boom"))):
        out = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx1"]), actor=USER))
    assert out["match_status"] == "unmatched"
    assert out["rule_action"] == "none"
    assert db.contacts.docs["ct1"]["balance"] == 130  # inflow unmatch +80
    assert db.invoices.docs["inv1"]["paid_amount"] == 0
    assert db.invoices.docs["inv1"]["payment_status"] == "unpaid"
    assert "contact_id" not in db.bank_transactions.docs["tx1"]
    assert "learned_rule_id" not in db.bank_transactions.docs["tx1"]


def test_hits_never_go_negative_on_manual():
    import server

    db = MemoryDB()
    _bind(db)
    db.bank_match_rules.docs["rule_m"] = {
        "_id": "rule_m",
        "company_id": "co1",
        "pattern": "turkcell",
        "category": "Abonelik",
        "source": "manual",
        "hits": 0,
    }
    db.bank_transactions.docs["tx1"] = _tx(
        "tx1",
        match_status="matched",
        category="Abonelik",
        matched_rule_id="rule_m",
    )
    out = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx1"]), actor=USER))
    assert out["rule_action"] == "decremented"
    assert db.bank_match_rules.docs["rule_m"]["hits"] == 0


def test_release_error_is_logged(caplog):
    import logging
    import server

    db = MemoryDB()
    _bind(db)
    db.bank_transactions.docs["tx1"] = _tx("tx1", match_status="matched", category="Abonelik")
    with patch.object(server, "_release_rule_for_tx", AsyncMock(side_effect=RuntimeError("boom"))):
        with caplog.at_level(logging.ERROR):
            out = _run(server._unmatch(copy.deepcopy(db.bank_transactions.docs["tx1"]), actor=USER))
    assert out["match_status"] == "unmatched"
    assert any("_release_rule_for_tx" in rec.message for rec in caplog.records)
