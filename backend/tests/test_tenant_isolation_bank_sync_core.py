"""Banka senkron çekirdeği kiracı kapsamı.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar, bakiye, IBAN, hesap numarası, token ve şirket kimliği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import server  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemColl, MemDB  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
ACC = "acc-shared"
CONN = "conn-shared"
TX = "tx-shared"
EXT = "ext-shared"
SECRET_IBAN = "TR99GIZLI000000000000000"
SECRET_NO = "9988776655"
SECRET_TOKEN = "tok-b-gizli"
SECRET_NAME = "HesapB-Gizli"
REPORTED = 250.75
BALANCE_B = 4242.42

_BANK = {"bank_accounts", "bank_transactions", "bank_connections"}
_REMOVED = (
    ("server.py", "_sync_bank_connection_core", "bank_accounts", "find_one"),
    ("server.py", "_sync_bank_connection_core", "bank_connections", "find_one"),
    ("server.py", "_sync_bank_connection_core", "bank_connections", "update_one"),
    ("server.py", "_sync_bank_connection_core", "bank_transactions", "find_one"),
    ("server.py", "_sync_bank_connection_core", "bank_transactions", "insert_one"),
    ("server.py", "_sync_bank_connection_core", "bank_transactions", "update_one"),
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id):
    uid = "user-" + company_id
    return {
        "_id": uid,
        "id": uid,
        "name": "Yonetici",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
    }


class _Req:
    def __init__(self):
        self.headers = {}
        self.cookies = {}
        self.url = SimpleNamespace(path="/api/banking/connections/c1")


class _Coll(MemColl):
    def __init__(self, name, db, seen):
        super().__init__(name, db)
        self._seen = seen

    def find(self, query=None, projection=None):
        cursor = super().find(query, projection)
        if self.name in _BANK:
            for row in cursor._docs:
                self._seen.append((self.name, row.get("company_id")))
        return cursor

    async def find_one(self, query=None, projection=None, sort=None):
        doc = await super().find_one(query, projection, sort)
        if doc is not None and self.name in _BANK:
            self._seen.append((self.name, doc.get("company_id")))
        return doc


class _DB(MemDB):
    def __init__(self, seen):
        super().__init__()
        self._seen = seen

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self, self._seen)
            self._cols[name] = coll
        return coll


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


def _digest(db, company_id):
    payload = []
    for name in sorted(db._cols):
        rows = [copy.deepcopy(d) for d in db._cols[name].docs if d.get("company_id") == company_id]
        if not rows:
            continue
        rows.sort(key=lambda d: json.dumps(d, sort_keys=True, default=str))
        payload.append([name, rows])
    raw = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def _row(db, coll, company_id, doc_id):
    for doc in db[coll].docs:
        if doc.get("_id") == doc_id and doc.get("company_id") == company_id:
            return doc
    return None


def _account(company_id, **extra):
    row = {
        "_id": ACC,
        "company_id": company_id,
        "type": "bank",
        "bank_name": "BankaA" if company_id == CO_A else "BankaB",
        "account_name": "HesapA" if company_id == CO_A else SECRET_NAME,
        "account_number": SECRET_NO,
        "iban": SECRET_IBAN,
        "currency": "TRY",
        "current_balance": 100.0 if company_id == CO_A else BALANCE_B,
    }
    row.update(extra)
    return row


def _conn(company_id, **extra):
    row = {
        "_id": CONN,
        "company_id": company_id,
        "provider": "other",
        "provider_name": "Diger",
        "linked_account_id": ACC,
        "bank_account_number": SECRET_IBAN,
        "account_number": SECRET_NO,
        "access_token": "tok-a" if company_id == CO_A else SECRET_TOKEN,
        "status": "idle" if company_id == CO_A else "error",
        "last_error": "eski-a" if company_id == CO_A else "onceki-b",
        "auto_sync": True,
        "auto_match": False,
        "synced_count": 1 if company_id == CO_A else 7,
        "auto_matched_count": 0,
    }
    row.update(extra)
    return row


def _tx(company_id, **extra):
    row = {
        "_id": TX,
        "company_id": company_id,
        "account_id": ACC,
        "account_name": "HesapA" if company_id == CO_A else SECRET_NAME,
        "type": "inflow",
        "amount": 10.0 if company_id == CO_A else 9999.0,
        "currency": "TRY",
        "description": "Banka Hareketi",
        "counterparty": "",
        "external_id": EXT,
        "source": "bank_sync",
        "match_status": "unmatched",
        "date": "2026-10-01",
    }
    row.update(extra)
    return row


def _tx_payload():
    return {
        "external_id": EXT,
        "direction": "credit",
        "amount": 40.0,
        "currency": "TRY",
        "description": "ACME TICARET odeme",
        "counterparty": "ACME TICARET",
        "date": "2026-10-12",
        "is_simulated": False,
    }


def _bind(db):
    prev = server.db
    server.db = db
    return prev


def _seed_pair(db, *, with_a_tx=True):
    _add(db, "bank_accounts", _account(CO_B))
    _add(db, "bank_accounts", _account(CO_A))
    _add(db, "bank_connections", _conn(CO_B))
    _add(db, "bank_connections", _conn(CO_A))
    _add(db, "bank_transactions", _tx(CO_B))
    if with_a_tx:
        _add(db, "bank_transactions", _tx(CO_A))


def _assert_b_untouched(db, before):
    assert _digest(db, CO_B) == before
    account = _row(db, "bank_accounts", CO_B, ACC)
    conn = _row(db, "bank_connections", CO_B, CONN)
    tx = _row(db, "bank_transactions", CO_B, TX)
    assert account["current_balance"] == BALANCE_B
    assert account.get("bank_reported_balance") is None
    assert conn["status"] == "error"
    assert conn["last_error"] == "onceki-b"
    assert conn["synced_count"] == 7
    assert conn["access_token"] == SECRET_TOKEN
    assert tx["description"] == "Banka Hareketi"
    assert tx["amount"] == 9999.0


def _assert_b_not_read(seen):
    assert CO_B not in {company for _name, company in seen}


def test_sync_updates_only_caller_company_when_keys_collide():
    seen = []
    db = _DB(seen)
    _seed_pair(db, with_a_tx=True)
    loaded = {}

    async def fetch(conn, _since):
        loaded["company_id"] = conn.get("company_id")
        loaded["token"] = conn.get("access_token")
        return {
            "simulated": False,
            "balance": REPORTED,
            "transactions": [_tx_payload()],
            "access_token": "tok-yeni-a",
        }

    prev = _bind(db)
    before = _digest(db, CO_B)
    try:
        with patch.object(server.bank_providers, "fetch_transactions", AsyncMock(side_effect=fetch)):
            out = _run(server._sync_bank_connection_core(CONN, days=7, company_id=CO_A))
    finally:
        server.db = prev
    assert out["status"] == "success"
    assert out["inserted"] == 0
    assert out["skipped"] == 1
    assert out["balance"] == REPORTED
    assert loaded["company_id"] == CO_A
    assert loaded["token"] != SECRET_TOKEN
    account = _row(db, "bank_accounts", CO_A, ACC)
    conn = _row(db, "bank_connections", CO_A, CONN)
    tx = _row(db, "bank_transactions", CO_A, TX)
    assert account["current_balance"] == REPORTED
    assert account["bank_reported_balance"] == REPORTED
    assert conn["status"] == "connected"
    assert conn["last_error"] is None
    assert conn["synced_count"] == 1
    assert conn["access_token"] == "tok-yeni-a"
    assert tx["description"] == "ACME TICARET odeme"
    assert tx["counterparty"] == "ACME TICARET"
    _assert_b_untouched(db, before)
    _assert_b_not_read(seen)


def test_same_external_id_inserts_for_caller_without_reading_other_company():
    seen = []
    db = _DB(seen)
    _seed_pair(db, with_a_tx=False)
    prev = _bind(db)
    before = _digest(db, CO_B)

    async def fetch(_conn, _since):
        return {"simulated": False, "balance": REPORTED, "transactions": [_tx_payload()]}

    try:
        with patch.object(server.bank_providers, "fetch_transactions", AsyncMock(side_effect=fetch)):
            out = _run(server._sync_bank_connection_core(CONN, company_id=CO_A))
    finally:
        server.db = prev
    assert out["inserted"] == 1
    assert out["skipped"] == 0
    inserted = [
        doc for doc in db.bank_transactions.docs
        if doc.get("company_id") == CO_A and doc.get("external_id") == EXT
    ]
    assert len(inserted) == 1
    assert inserted[0]["description"] == "ACME TICARET odeme"
    assert inserted[0]["_id"] != TX
    assert _row(db, "bank_accounts", CO_A, ACC)["current_balance"] == REPORTED
    _assert_b_untouched(db, before)
    _assert_b_not_read(seen)


def test_other_company_linked_account_is_not_found():
    seen = []
    db = _DB(seen)
    _add(db, "bank_accounts", _account(CO_B, _id="acc-only-b"))
    _add(db, "bank_connections", _conn(CO_A, linked_account_id="acc-only-b", _id="conn-a"))
    _add(db, "bank_connections", _conn(CO_B, linked_account_id="acc-only-b", _id="conn-b"))
    prev = _bind(db)
    before = _digest(db, CO_B)
    called = {"n": 0}

    async def fetch(_conn, _since):
        called["n"] += 1
        return {"simulated": False, "balance": REPORTED, "transactions": []}

    try:
        with patch.object(server.bank_providers, "fetch_transactions", AsyncMock(side_effect=fetch)):
            with pytest.raises(HTTPException) as exc:
                _run(server._sync_bank_connection_core("conn-a", company_id=CO_A))
    finally:
        server.db = prev
    assert exc.value.status_code == 404
    assert called["n"] == 0
    assert _row(db, "bank_accounts", CO_B, "acc-only-b")["current_balance"] == BALANCE_B
    assert _row(db, "bank_connections", CO_B, "conn-b")["status"] == "error"
    assert _row(db, "bank_connections", CO_B, "conn-b")["last_error"] == "onceki-b"
    assert _row(db, "bank_connections", CO_A, "conn-a")["status"] == "idle"
    assert _row(db, "bank_connections", CO_A, "conn-a")["last_error"] == "eski-a"
    assert _digest(db, CO_B) == before
    _assert_b_not_read(seen)


def test_blank_company_on_connection_skips_without_logging_secrets(caplog):
    seen = []
    db = _DB(seen)
    _add(db, "bank_accounts", _account(CO_B, _id="acc-only-b"))
    _add(db, "bank_connections", {
        "_id": "conn-blank",
        "provider": "other",
        "linked_account_id": "acc-only-b",
        "bank_account_number": SECRET_IBAN,
        "account_number": SECRET_NO,
        "access_token": SECRET_TOKEN,
        "status": "idle",
        "auto_match": False,
    })
    prev = _bind(db)
    before = _digest(db, CO_B)
    try:
        with caplog.at_level(logging.WARNING, logger="TamKobiERP"):
            with pytest.raises(HTTPException) as exc:
                _run(server._sync_bank_connection_core("conn-blank"))
    finally:
        server.db = prev
    assert exc.value.status_code == 404
    assert _digest(db, CO_B) == before
    assert _row(db, "bank_accounts", CO_B, "acc-only-b")["current_balance"] == BALANCE_B
    _assert_b_not_read(seen)
    text = caplog.text
    assert SECRET_IBAN not in text
    assert SECRET_NO not in text
    assert SECRET_TOKEN not in text


def test_fetch_error_updates_only_caller_connection():
    seen = []
    db = _DB(seen)
    _seed_pair(db, with_a_tx=True)
    prev = _bind(db)
    before = _digest(db, CO_B)

    async def fetch(_conn, _since):
        raise RuntimeError("kopuk")

    try:
        with patch.object(server.bank_providers, "fetch_transactions", AsyncMock(side_effect=fetch)):
            with pytest.raises(HTTPException) as exc:
                _run(server._sync_bank_connection_core(CONN, company_id=CO_A))
    finally:
        server.db = prev
    assert exc.value.status_code == 502
    conn = _row(db, "bank_connections", CO_A, CONN)
    assert conn["status"] == "error"
    assert "kopuk" in (conn["last_error"] or "")
    assert SECRET_IBAN not in (conn["last_error"] or "")
    assert SECRET_TOKEN not in (conn["last_error"] or "")
    assert _row(db, "bank_accounts", CO_A, ACC)["current_balance"] == 100.0
    _assert_b_untouched(db, before)
    _assert_b_not_read(seen)


def test_scheduler_passes_each_company_and_skips_blank(caplog, monkeypatch):
    calls = []
    db = _DB([])
    _add(db, "bank_connections", _conn(CO_B, _id="bc-b"))
    _add(db, "bank_connections", _conn(CO_A, _id="bc-a"))
    _add(db, "bank_connections", {
        "_id": "bc-blank",
        "auto_sync": True,
        "bank_account_number": SECRET_IBAN,
        "account_number": SECRET_NO,
        "access_token": SECRET_TOKEN,
    })

    async def _core(conn_id, days=7, *, user=None, request=None, company_id=None):
        calls.append((conn_id, company_id))
        return None

    monkeypatch.setattr(server, "_sync_bank_connection_core", _core)
    monkeypatch.setattr("bank_auto_sync.should_background_sync", lambda conn: True)
    prev = _bind(db)
    before_b = _digest(db, CO_B)
    before_a = _digest(db, CO_A)
    try:
        with caplog.at_level(logging.WARNING, logger="TamKobiERP"):
            _run(server._run_bank_auto_sync_tick())
    finally:
        server.db = prev
    assert calls == [("bc-b", CO_B), ("bc-a", CO_A)]
    assert _digest(db, CO_B) == before_b
    assert _digest(db, CO_A) == before_a
    assert "firma bilgisi olmayan bağlantı sayısı 1" in caplog.text
    assert SECRET_IBAN not in caplog.text
    assert SECRET_NO not in caplog.text
    assert SECRET_TOKEN not in caplog.text


def test_route_and_sync_all_pass_verified_company(monkeypatch):
    calls = []
    db = _DB([])
    _add(db, "bank_connections", _conn(CO_B, _id="conn-b", auto_sync=True))
    _add(db, "bank_connections", _conn(CO_A, _id="conn-a", auto_sync=True))

    async def _core(conn_id, days=7, *, user=None, request=None, company_id=None):
        calls.append((conn_id, company_id))
        return {"status": "success", "inserted": 0, "message": "ok"}

    monkeypatch.setattr(server, "_sync_bank_connection_core", _core)
    prev = _bind(db)
    try:
        out = _run(server.sync_bank_connection("conn-a", _Req(), 7, _user(CO_A)))
        bulk = _run(server.sync_all_connections(CO_A, _user(CO_A)))
    finally:
        server.db = prev
    assert out["status"] == "success"
    assert calls == [("conn-a", CO_A), ("conn-a", CO_A)]
    assert bulk["results"][0]["connection_id"] == "conn-a"
    assert all(company == CO_A for _conn_id, company in calls)


def test_sync_core_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 6
    assert len(set(_REMOVED)) == 6
    assert all(key[0] == "server.py" for key in _REMOVED)
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "temiz" in proc.stdout
