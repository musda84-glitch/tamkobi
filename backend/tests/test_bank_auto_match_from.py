"""Bağlantı başına otomatik eşleşme başlangıç tarihi ve güvenli toplu geri alma.

MySQL turu yalnız TAMKOBI_TEST_MYSQL_URL ile çalışır; ulaşılamazsa atlanır.
"""
from __future__ import annotations

import asyncio
import copy
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import unquote, urlparse

import pytest
from fastapi import HTTPException

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


class _Req:
    def __init__(self, path="/api/banking/connections/c1"):
        self.headers = {}
        self.cookies = {}
        self.url = SimpleNamespace(path=path)


ADMIN = {
    "id": "usr_admin",
    "name": "Ayşe Yönetici",
    "email": "ayse@firma.com",
    "role": "admin",
    "active_company_id": "co1",
    "company_ids": ["co1"],
}
MEMBER = {
    "id": "usr_mem",
    "name": "Ali Üye",
    "email": "ali@firma.com",
    "role": "user",
    "active_company_id": "co1",
    "company_ids": ["co1"],
}
OTHER = {
    "id": "usr_other",
    "name": "Başka Admin",
    "email": "baska@firma.com",
    "role": "admin",
    "active_company_id": "co2",
    "company_ids": ["co2"],
}


def _bind(db):
    import server

    server.db = db
    return server


def _audits(db):
    col = db._cols.get("company_audit_log")
    return list(col.docs.values()) if col else []


def _tx(tid, **extra):
    doc = {
        "_id": tid,
        "company_id": "co1",
        "account_id": "acc1",
        "account_name": "Vadesiz",
        "type": "inflow",
        "amount": 40.0,
        "description": "ACME TEDARIK HAVALE",
        "date": "2026-10-10",
        "currency": "TRY",
        "match_status": "unmatched",
        "source": "bank_sync",
    }
    doc.update(extra)
    return doc


def _conn(**extra):
    doc = {
        "_id": "conn1",
        "company_id": "co1",
        "provider": "enpara",
        "provider_name": "Enpara",
        "linked_account_id": "acc1",
        "linked_account_name": "Vadesiz",
        "auto_match": True,
        "auto_sync": False,
        "auto_match_from": "2026-10-10",
        "created_at": "2026-09-01T00:00:00+00:00",
        "status": "connected",
    }
    doc.update(extra)
    return doc


def _rule():
    return {
        "_id": "rule1",
        "company_id": "co1",
        "pattern": "acme tedarik",
        "category": "Tedarik",
        "source": "manual",
        "hits": 0,
    }


def _pending_db(*, auto_match_from="2026-10-10", created_at="2026-09-01T00:00:00+00:00", auto_match=True):
    db = MemoryDB()
    conn = _conn(auto_match_from=auto_match_from, created_at=created_at, auto_match=auto_match)
    if auto_match_from is None:
        conn.pop("auto_match_from", None)
    db.bank_connections.docs["conn1"] = conn
    db.bank_accounts.docs["acc1"] = {
        "_id": "acc1", "company_id": "co1", "account_name": "Vadesiz", "type": "bank", "current_balance": 500,
    }
    db.bank_match_rules.docs["rule1"] = _rule()
    db.bank_transactions.docs["tx_old"] = _tx("tx_old", date="2026-10-01")
    db.bank_transactions.docs["tx_dmy"] = _tx("tx_dmy", date="09.10.2026", amount=11)
    db.bank_transactions.docs["tx_new"] = _tx("tx_new", date="2026-10-10", amount=22)
    db.bank_transactions.docs["tx_bad"] = _tx("tx_bad", date="tarih-yok", amount=7)
    return db


def _statuses(db):
    return {tid: doc.get("match_status") for tid, doc in db.bank_transactions.docs.items()}


def _assert_only_new_matched(db):
    status = _statuses(db)
    assert status["tx_new"] == "matched"
    assert status["tx_old"] == "unmatched"
    assert status["tx_dmy"] == "unmatched"
    assert status["tx_bad"] == "unmatched"


NOTE = "2 hareket başlangıç tarihinden eski olduğu için atlandı."


def test_eligible_skips_old_unparsed_and_uses_latest_connection_day():
    import server

    db = _pending_db()
    db.bank_connections.docs["conn_late"] = _conn(
        _id="conn_late", auto_match_from="2026-10-20",
    )
    _bind(db)
    eligible, skipped = _run(server._auto_match_eligible("co1", list(db.bank_transactions.docs.values())))
    assert skipped == 3  # 10-01, 09.10 ve 10-10; en geç sınır 10-20
    assert [t["_id"] for t in eligible] == []

    db.bank_connections.docs.pop("conn_late")
    eligible, skipped = _run(server._auto_match_eligible("co1", [
        _tx("a", date="2026-10-15T20:00:00Z"),
        _tx("b", date="2026-10-15T21:30:00Z"),
        _tx("c", date="15.10.2026"),
        _tx("d", date=""),
    ]))
    # Sınır 2026-10-10. 20:00Z = İstanbul 15 Ekim 23:00; 21:30Z = 16 Ekim 00:30.
    ids = {t["_id"] for t in eligible}
    assert ids == {"a", "b", "c"}
    assert skipped == 0

    db.bank_connections.docs["conn1"]["auto_match_from"] = "2026-10-16"
    eligible, skipped = _run(server._auto_match_eligible("co1", [
        _tx("early", date="2026-10-15T20:00:00Z"),
        _tx("late", date="2026-10-15T21:30:00Z"),
        _tx("plain", date="2026-10-15"),
        _tx("day", date="2026-10-16"),
    ]))
    assert {t["_id"] for t in eligible} == {"late", "day"}
    assert skipped == 2


def test_created_at_istanbul_day_is_the_floor_when_field_missing():
    import server

    db = _pending_db(auto_match_from=None, created_at="2026-10-15T21:30:00+00:00")
    db.bank_transactions.docs.clear()
    db.bank_transactions.docs["before"] = _tx("before", date="2026-10-15")
    db.bank_transactions.docs["on_day"] = _tx("on_day", date="2026-10-16", amount=9)
    _bind(db)
    assert server._connection_auto_match_day(db.bank_connections.docs["conn1"]).isoformat() == "2026-10-16"
    n, _, skipped = _run(server._auto_match_by_rules("co1", list(db.bank_transactions.docs.values())))
    assert n == 1 and skipped == 1
    assert db.bank_transactions.docs["before"]["match_status"] == "unmatched"
    assert db.bank_transactions.docs["on_day"]["match_status"] == "matched"
    out = server._enrich_connection(db.bank_connections.docs["conn1"])
    assert out["auto_match_from_effective"] == "2026-10-16"
    assert "auto_match_from" not in db.bank_connections.docs["conn1"]


def test_four_paths_skip_before_start_and_match_after():
    import server

    async def _sync():
        db = _pending_db()
        _bind(db)

        async def _fetch(conn, since):
            return {"transactions": [], "simulated": True, "balance": None}

        with patch("bank_providers.fetch_transactions", _fetch):
            out = await server._sync_bank_connection_core("conn1", user=ADMIN, request=_Req())
        assert NOTE in out["message"]
        assert out["skipped_before_start"] == 2
        assert out["auto_matched"] == 1
        _assert_only_new_matched(db)

    async def _toggle():
        db = _pending_db(auto_match=False)
        _bind(db)
        out = await server.update_bank_connection("conn1", {"auto_match": True}, _Req(), ADMIN)
        assert NOTE in out["auto_match_message"]
        assert out["skipped_before_start"] == 2
        assert out["auto_matched_now"] == 1
        _assert_only_new_matched(db)

    async def _endpoint():
        db = _pending_db()
        _bind(db)
        out = await server.auto_match_transactions(_Req(), company_id="co1", user=ADMIN)
        assert NOTE in out["message"]
        assert out["skipped_before_start"] == 2
        assert out["matched"] == 1
        _assert_only_new_matched(db)

    async def _suggestion():
        db = _pending_db()
        db.bank_match_rules.docs.clear()
        _bind(db)
        out = await server.accept_rule_suggestion(
            {"company_id": "co1", "pattern": "acme tedarik", "category": "Tedarik", "apply_now": True},
            ADMIN,
        )
        assert NOTE in out["message"]
        assert out["skipped_before_start"] == 2
        assert out["applied"] == 1
        _assert_only_new_matched(db)

    _run(_sync())
    _run(_toggle())
    _run(_endpoint())
    _run(_suggestion())


def test_manual_match_and_rule_without_apply_ignore_start_date():
    import server

    db = _pending_db()
    db.contacts.docs["ct1"] = {"_id": "ct1", "company_id": "co1", "name": "Acme", "balance": 100}
    _bind(db)
    created = _run(server.accept_rule_suggestion(
        {"company_id": "co1", "pattern": "baska kalip", "category": "Diğer", "apply_now": False},
        ADMIN,
    ))
    assert created["applied"] == 0
    assert NOTE not in created["message"]
    assert _statuses(db)["tx_old"] == "unmatched"
    matched = _run(server.match_bank_transaction(
        _Req(), "tx_old", {"contact_id": "ct1", "learn": False}, ADMIN,
    ))
    assert matched["match_status"] == "matched"
    assert matched.get("matched_via") in (None, "manual", "")
    assert db.bank_transactions.docs["tx_old"]["match_status"] == "matched"
    assert db.contacts.docs["ct1"]["balance"] == 60


def test_put_auto_match_from_validates_and_audits_without_unmatching():
    import server

    db = MemoryDB()
    db.bank_connections.docs["conn1"] = _conn(auto_match_from=None)
    db.bank_connections.docs["conn1"].pop("auto_match_from", None)
    db.bank_transactions.docs["tx1"] = _tx(
        "tx1", date="2026-01-01", match_status="matched", matched_via="auto", contact_id="ct1",
    )
    _bind(db)
    with pytest.raises(HTTPException) as bad:
        _run(server.update_bank_connection("conn1", {"auto_match_from": "2026-13-40"}, _Req(), ADMIN))
    assert bad.value.status_code == 400
    with pytest.raises(HTTPException) as future:
        _run(server.update_bank_connection("conn1", {"auto_match_from": "2099-01-01"}, _Req(), ADMIN))
    assert future.value.status_code == 400
    assert "gelecekte" in str(future.value.detail)
    today = datetime.now(server._IST).date().isoformat()
    out = _run(server.update_bank_connection("conn1", {"auto_match_from": today}, _Req(), ADMIN))
    assert db.bank_connections.docs["conn1"]["auto_match_from"] == today
    assert out["auto_match_from_effective"] == today
    assert db.bank_transactions.docs["tx1"]["match_status"] == "matched"
    assert any("başlangıç tarihi" in (a.get("summary") or "") for a in _audits(db))
    with pytest.raises(HTTPException) as missing:
        _run(server.update_bank_connection("conn-yok", {"auto_match_from": today}, _Req(), ADMIN))
    assert missing.value.status_code == 404
    with pytest.raises(HTTPException) as other:
        _run(server.update_bank_connection("conn1", {"auto_match_from": "2026-01-02"}, _Req(), OTHER))
    assert other.value.status_code == 404


def _matched_bundle():
    """Otomatik cari+fatura, virman ve elle eşleşme. Geri alma öncesi anlık görüntü döner."""
    import server

    db = MemoryDB()
    db.bank_connections.docs["conn1"] = _conn(auto_match_from="2026-10-01")
    db.bank_accounts.docs["acc1"] = {
        "_id": "acc1", "company_id": "co1", "account_name": "Vadesiz", "type": "bank", "current_balance": 800,
    }
    db.bank_accounts.docs["acc2"] = {
        "_id": "acc2", "company_id": "co1", "account_name": "Kasa", "type": "cash", "current_balance": 1000,
    }
    db.contacts.docs["ct_auto"] = {"_id": "ct_auto", "company_id": "co1", "name": "Acme", "balance": 100}
    db.contacts.docs["ct_manual"] = {"_id": "ct_manual", "company_id": "co1", "name": "Elle Cari", "balance": 200}
    db.invoices.docs["inv1"] = {
        "_id": "inv1", "company_id": "co1", "contact_id": "ct_auto", "invoice_number": "F-1",
        "paid_amount": 0, "grand_total": 500, "payment_status": "unpaid",
    }
    db.bank_transactions.docs["tx_auto"] = _tx(
        "tx_auto", description="ACME TEDARIK FATURA", amount=40, type="inflow", date="2026-09-01",
    )
    db.bank_transactions.docs["tx_virman"] = _tx(
        "tx_virman", description="DEPO VIRMAN CIKIS", amount=25, type="outflow", date="2026-09-02",
    )
    db.bank_transactions.docs["tx_manual"] = _tx(
        "tx_manual", description="ELDEN TAHSILAT", amount=15, type="inflow", date="2026-09-03",
    )
    server_mod = _bind(db)
    before = {
        "contact": 100.0,
        "manual_contact": 200.0,
        "invoice": 0.0,
        "counter": 1000.0,
    }
    _run(server_mod._apply_match(
        copy.deepcopy(db.bank_transactions.docs["tx_auto"]), "ct_auto", "inv1", None, learn=True, via="auto", actor=ADMIN,
    ))
    _run(server_mod._apply_match(
        copy.deepcopy(db.bank_transactions.docs["tx_virman"]), None, None, "Virman",
        learn=False, target_account_id="acc2", via="suggestion", actor=ADMIN,
    ))
    _run(server_mod._apply_match(
        copy.deepcopy(db.bank_transactions.docs["tx_manual"]), "ct_manual", None, None, learn=False, via="manual", actor=ADMIN,
    ))
    return server_mod, db, before


def _effects(db):
    return {
        "contact": db.contacts.docs["ct_auto"]["balance"],
        "manual_contact": db.contacts.docs["ct_manual"]["balance"],
        "invoice": db.invoices.docs["inv1"]["paid_amount"],
        "counter": db.bank_accounts.docs["acc2"]["current_balance"],
        "auto": db.bank_transactions.docs["tx_auto"]["match_status"],
        "virman": db.bank_transactions.docs["tx_virman"]["match_status"],
        "manual": db.bank_transactions.docs["tx_manual"]["match_status"],
    }


def test_auto_unmatch_dry_run_writes_nothing_and_skips_manual():
    server, db, before = _matched_bundle()
    assert _effects(db)["contact"] == 60
    assert _effects(db)["invoice"] == 40
    assert _effects(db)["counter"] == 1025
    assert _effects(db)["manual_contact"] == 185
    snap = copy.deepcopy({name: col.docs for name, col in db._cols.items()})
    preview = _run(server.auto_unmatch_bank_connection("conn1", body={"dry_run": True}, user=ADMIN))
    assert preview["dry_run"] is True
    assert preview["count"] == 2
    assert preview["total_amount"] == pytest.approx(65.0)
    names = {row["contact_name"] for row in preview["by_contact"]}
    assert "Acme" in names
    assert "Elle Cari" not in names
    assert all(row.get("matched_via") != "manual" for row in preview["sample"])
    assert {name: col.docs for name, col in db._cols.items()} == snap
    omitted = _run(server.auto_unmatch_bank_connection("conn1", body={}, user=ADMIN))
    assert omitted["dry_run"] is True
    assert omitted["count"] == 2
    assert _effects(db)["auto"] == "matched"


def test_auto_unmatch_restores_balances_releases_rule_and_is_idempotent():
    server, db, before = _matched_bundle()
    learned = [
        rid for rid, rule in db.bank_match_rules.docs.items()
        if rule.get("source") == "learned"
    ]
    assert learned
    out = _run(server.auto_unmatch_bank_connection(
        "conn1", body={"before_date": "2026-10-01", "dry_run": False}, user=ADMIN,
    ))
    assert out["ok"] == 2
    assert out["fail"] == []
    effects = _effects(db)
    assert effects["contact"] == before["contact"]
    assert effects["invoice"] == before["invoice"]
    assert effects["counter"] == before["counter"]
    assert effects["manual_contact"] == 185
    assert effects["auto"] == "unmatched"
    assert effects["virman"] == "unmatched"
    assert effects["manual"] == "matched"
    assert all(rid not in db.bank_match_rules.docs for rid in learned)
    summaries = [a.get("summary") or "" for a in _audits(db)]
    assert any("Banka kuralı silindi" in s for s in summaries)
    assert any("geri alındı" in s for s in summaries)
    again = _run(server.auto_unmatch_bank_connection(
        "conn1", body={"before_date": "2026-10-01", "dry_run": False}, user=ADMIN,
    ))
    assert again["ok"] == 0
    assert again["fail"] == []
    assert _effects(db)["contact"] == before["contact"]
    assert _effects(db)["counter"] == before["counter"]
    assert _effects(db)["invoice"] == before["invoice"]


def test_auto_unmatch_vias_and_matched_from_and_errors_do_not_stop():
    import server

    db = MemoryDB()
    db.bank_connections.docs["conn1"] = _conn(auto_match_from="2026-11-01")
    db.contacts.docs["ct"] = {"_id": "ct", "company_id": "co1", "name": "Acme", "balance": 0}
    vias = ["auto", "prior", "cari", "suggestion", "rule", "history", "manual", ""]
    for via in vias:
        tid = f"tx_{via or 'empty'}"
        db.bank_transactions.docs[tid] = _tx(
            tid,
            date="2026-10-01",
            amount=10 if via != "prior" else 20,
            match_status="matched",
            matched_via=via,
            contact_id="ct",
            contact_name="Acme" if via in ("auto", "prior") else (via or "Boş"),
            matched_at="2026-10-02T00:00:00+00:00",
        )
    db.bank_transactions.docs["tx_early_match"] = _tx(
        "tx_early_match", date="2026-10-01", amount=5, match_status="matched",
        matched_via="auto", contact_name="Eski", matched_at="2026-01-01T00:00:00+00:00",
    )
    _bind(db)
    preview = _run(server.auto_unmatch_bank_connection("conn1", body={"dry_run": True}, user=ADMIN))
    ids = {row["tx_id"] for row in preview["sample"]}
    assert "tx_manual" not in ids
    assert "tx_empty" not in ids
    assert preview["count"] == 7  # 6 otomatik via + erken auto
    acme = next(row for row in preview["by_contact"] if row["contact_name"] == "Acme")
    assert acme["count"] == 2
    assert acme["amount"] == pytest.approx(30.0)
    filtered = _run(server.auto_unmatch_bank_connection(
        "conn1",
        body={"dry_run": True, "matched_from": "2026-06-01T00:00:00+00:00"},
        user=ADMIN,
    ))
    filtered_ids = {row["tx_id"] for row in filtered["sample"]}
    assert "tx_early_match" not in filtered_ids
    assert filtered["count"] == 6

    real = server._unmatch

    async def _flaky(tx, actor=None):
        if tx.get("_id") == "tx_auto":
            raise RuntimeError("satır hatası")
        return await real(tx, actor=actor)

    with patch.object(server, "_unmatch", _flaky):
        out = _run(server.auto_unmatch_bank_connection(
            "conn1", body={"dry_run": False, "matched_from": "2026-06-01T00:00:00+00:00"}, user=ADMIN,
        ))
    assert out["ok"] == 5
    assert out["fail"] == [{"tx_id": "tx_auto", "error": "satır hatası"}]
    assert db.bank_transactions.docs["tx_auto"]["match_status"] == "matched"
    assert db.bank_transactions.docs["tx_rule"]["match_status"] == "unmatched"
    assert db.bank_transactions.docs["tx_manual"]["match_status"] == "matched"
    assert db.bank_transactions.docs["tx_early_match"]["match_status"] == "matched"


def test_auto_unmatch_caps_at_limit_and_asks_to_rerun():
    import server

    db = MemoryDB()
    db.bank_connections.docs["conn1"] = _conn(auto_match_from="2026-12-31")
    for i in range(3):
        db.bank_transactions.docs[f"t{i}"] = _tx(
            f"t{i}", date=f"2026-01-0{i + 1}", amount=1, match_status="matched",
            matched_via="auto", contact_name="Acme",
        )
    _bind(db)
    assert server._AUTO_UNMATCH_LIMIT == 2000
    server._AUTO_UNMATCH_LIMIT = 2
    try:
        preview = _run(server.auto_unmatch_bank_connection("conn1", body={"dry_run": True}, user=ADMIN))
        assert preview["count"] == 2
        assert preview["has_more"] is True
        assert "tekrar çalıştır" in preview["message"]
        first = _run(server.auto_unmatch_bank_connection("conn1", body={"dry_run": False}, user=ADMIN))
        assert first["ok"] == 2
        assert "tekrar çalıştır" in first["message"]
        still = [t for t in db.bank_transactions.docs.values() if t.get("match_status") == "matched"]
        assert len(still) == 1
        second = _run(server.auto_unmatch_bank_connection("conn1", body={"dry_run": False}, user=ADMIN))
        assert second["ok"] == 1
        assert second["has_more"] is False
        assert not any(t.get("match_status") == "matched" for t in db.bank_transactions.docs.values())
    finally:
        server._AUTO_UNMATCH_LIMIT = 2000


def test_auto_unmatch_other_company_404_and_member_403():
    import server

    db = MemoryDB()
    db.bank_connections.docs["conn1"] = _conn()
    _bind(db)
    with pytest.raises(HTTPException) as other:
        _run(server.auto_unmatch_bank_connection("conn1", body={"dry_run": True}, user=OTHER))
    assert other.value.status_code == 404
    with pytest.raises(HTTPException) as member:
        _run(server.auto_unmatch_bank_connection("conn1", body={"dry_run": False}, user=MEMBER))
    assert member.value.status_code == 403
    with pytest.raises(HTTPException) as missing:
        _run(server.auto_unmatch_bank_connection("yok", body={"dry_run": True}, user=ADMIN))
    assert missing.value.status_code == 404


def test_confirming_start_date_rolls_back_auto_cancel_changes_nothing():
    server, db, before = _matched_bundle()
    stored_date = db.bank_connections.docs["conn1"]["auto_match_from"]
    mid = _effects(db)
    preview = _run(server.auto_unmatch_bank_connection(
        "conn1", body={"before_date": "2026-10-15", "dry_run": True}, user=ADMIN,
    ))
    assert preview["count"] == 2
    assert db.bank_connections.docs["conn1"]["auto_match_from"] == stored_date
    assert _effects(db) == mid

    _run(server.update_bank_connection("conn1", {"auto_match_from": "2026-10-15"}, _Req(), ADMIN))
    done = _run(server.auto_unmatch_bank_connection(
        "conn1", body={"before_date": "2026-10-15", "dry_run": False}, user=ADMIN,
    ))
    assert done["ok"] == 2
    effects = _effects(db)
    assert effects["contact"] == before["contact"]
    assert effects["invoice"] == before["invoice"]
    assert effects["counter"] == before["counter"]
    assert effects["manual"] == "matched"
    assert effects["auto"] == "unmatched"
    assert effects["manual_contact"] == mid["manual_contact"]
    assert db.bank_connections.docs["conn1"]["auto_match_from"] == "2026-10-15"


def test_mysql_auto_match_from_roundtrip_only_with_explicit_url():
    url = (os.environ.get("TAMKOBI_TEST_MYSQL_URL") or "").strip()
    if not url:
        pytest.skip("TAMKOBI_TEST_MYSQL_URL yok")
    if url.startswith("mysql+"):
        url = "mysql://" + url.split("://", 1)[1]
    if not url.startswith("mysql://"):
        pytest.skip("TAMKOBI_TEST_MYSQL_URL mysql değil")
    parsed = urlparse(url)
    db_name = (parsed.path or "").lstrip("/").split("?")[0]
    if "test" not in db_name.lower():
        pytest.skip("veritabanı adı test içermiyor")
    try:
        import pymysql
    except ImportError:
        pytest.skip("pymysql yok")
    try:
        conn = pymysql.connect(
            host=parsed.hostname or "127.0.0.1",
            port=parsed.port or 3306,
            user=unquote(parsed.username or ""),
            password=unquote(parsed.password or ""),
            database=db_name,
            charset="utf8mb4",
            connect_timeout=3,
            autocommit=True,
        )
    except Exception:
        pytest.skip("MySQL ulaşılamıyor")
    doc_id = "auto-match-from-" + uuid.uuid4().hex
    payload = {
        "_id": doc_id,
        "company_id": "co_auto_match_from_test",
        "auto_match_from": "2026-10-01",
        "created_at": "2026-09-01T21:30:00+00:00",
    }
    try:
        with conn.cursor() as cur:
            try:
                cur.execute("SELECT id FROM docs LIMIT 1")
            except Exception:
                pytest.skip("docs tablosu yok")
            cur.execute(
                "INSERT INTO docs (collection, id, doc) VALUES (%s, %s, %s)",
                ("bank_connections", doc_id, json.dumps(payload)),
            )
            cur.execute(
                "SELECT doc FROM docs WHERE collection=%s AND id=%s",
                ("bank_connections", doc_id),
            )
            row = cur.fetchone()
            assert row
            stored = json.loads(row[0])
            assert stored["auto_match_from"] == "2026-10-01"
    finally:
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM docs WHERE collection=%s AND id=%s", ("bank_connections", doc_id))
        except Exception:
            pass
        conn.close()
