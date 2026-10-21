"""Banka hesabı, hareket, ters kayıt ve bağlantı kiracı dalgası 14.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar, bakiye, IBAN, hesap adı/numarası ve şirket kimliği loglanmaz.
"""
from __future__ import annotations

import ast
import asyncio
import copy
import hashlib
import json
import logging
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import rbac  # noqa: E402
import server  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import trash  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from models import BankAccount, BankConnection, BankTransaction  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
ACC = "acc-shared"
ACC_B = "acc-b-only"
TARGET = "acc-target"
BT = "bt-shared"
BT_A = "bt-a"
PAIR = "bt-pair"
CONTACT = "contact-shared"
OWNER = "owner-shared"
INV = "inv-shared"
CONN = "conn-shared"
SECRET_NAME = "HesapB-Gizli"
SECRET_BANK = "BankaGizli"
SECRET_NO = "9988776655"
SECRET_IBAN = "TR99GIZLI000000000000000"

_REMOVED = (
    ("server.py", "_reverse_tx_effects", "contacts", "update_one"),
    ("server.py", "_reverse_tx_effects", "invoices", "find_one"),
    ("server.py", "_reverse_tx_effects", "invoices", "update_one"),
    ("server.py", "_touch_account", "bank_accounts", "find_one"),
    ("server.py", "_touch_account", "bank_accounts", "update_one"),
    ("server.py", "create_bank_account", "bank_accounts", "insert_one"),
    ("server.py", "create_bank_connection", "bank_accounts", "find_one"),
    ("server.py", "create_bank_connection", "bank_connections", "insert_one"),
    ("server.py", "create_bank_transaction", "bank_accounts", "find_one"),
    ("server.py", "create_bank_transaction", "bank_accounts", "update_one"),
    ("server.py", "create_bank_transaction", "contacts", "update_one"),
    ("server.py", "delete_bank_account", "bank_connections", "find_one"),
    ("server.py", "delete_bank_account", "bank_transactions", "count_documents"),
    ("server.py", "delete_bank_transaction", "bank_accounts", "find_one"),
    ("server.py", "delete_bank_transaction", "bank_transactions", "find_one"),
    ("server.py", "update_bank_account", "bank_accounts", "find_one"),
    ("server.py", "update_bank_account", "bank_accounts", "update_one"),
    ("server.py", "update_bank_account", "bank_transactions", "count_documents"),
    ("server.py", "update_bank_account", "bank_transactions", "delete_many"),
    ("server.py", "update_bank_connection", "bank_accounts", "find_one"),
    ("server.py", "update_bank_connection", "bank_connections", "find_one"),
    ("server.py", "update_bank_connection", "bank_connections", "update_one"),
    ("server.py", "update_bank_transaction", "bank_accounts", "find_one"),
    ("server.py", "update_bank_transaction", "bank_transactions", "find_one"),
    ("server.py", "update_bank_transaction", "bank_transactions", "update_one"),
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
    async def delete_one(self, query=None):
        query = _split_field_ops(query or {})
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[index]
                return type("R", (), {"deleted_count": 1})()
        return type("R", (), {"deleted_count": 0})()

    async def delete_many(self, query=None):
        query = _split_field_ops(query or {})
        kept = []
        removed = 0
        for doc in self.docs:
            if match_query(doc, query):
                removed += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return type("R", (), {"deleted_count": removed})()


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
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


def _bind(db):
    prev = {"server": server.db, "rbac": rbac._db, "trash": trash._db}
    server.db = db
    rbac._db = db
    trash._db = db
    return prev


def _restore(prev):
    server.db = prev["server"]
    rbac._db = prev["rbac"]
    trash._db = prev["trash"]


async def _own(db_arg, collection, doc_id, actor, **kwargs):
    """Aynı _id iki şirkette de varken çağıranın satırını yükle."""
    allowed = {str(item) for item in (actor.get("company_ids") or [])}
    for row in db_arg[collection].docs:
        if str(row.get("_id")) == str(doc_id) and str(row.get("company_id") or "") in allowed:
            return copy.deepcopy(row)
    raise HTTPException(status_code=404, detail=kwargs.get("not_found") or "Kayıt bulunamadı.")


def _account(company_id, **extra):
    row = {
        "_id": ACC,
        "company_id": company_id,
        "type": "bank",
        "bank_name": "BankaA" if company_id == CO_A else SECRET_BANK,
        "account_name": "HesapA" if company_id == CO_A else SECRET_NAME,
        "account_number": "11112222" if company_id == CO_A else SECRET_NO,
        "currency": "TRY",
        "current_balance": 1000.0 if company_id == CO_A else 4242.0,
    }
    row.update(extra)
    return row


def _contact(company_id, doc_id=CONTACT, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "name": "CariA" if company_id == CO_A else "CariB",
        "balance": 90.0 if company_id == CO_A else 777.0,
    }
    row.update(extra)
    return row


def _invoice(company_id, **extra):
    row = {
        "_id": INV,
        "company_id": company_id,
        "paid_amount": 40.0 if company_id == CO_A else 80.0,
        "grand_total": 100.0 if company_id == CO_A else 80.0,
        "payment_status": "unpaid" if company_id == CO_A else "paid",
    }
    row.update(extra)
    return row


def _tx(company_id, **extra):
    row = {
        "_id": BT,
        "company_id": company_id,
        "account_id": ACC,
        "account_name": "HesapA" if company_id == CO_A else SECRET_NAME,
        "type": "inflow",
        "category": "Tahsilat",
        "amount": 10.0 if company_id == CO_A else 9999.0,
        "description": "tahsil-a" if company_id == CO_A else "tahsil-b-gizli",
        "source": "manual",
        "date": "2026-03-01",
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
        "linked_account_name": "HesapA" if company_id == CO_A else SECRET_NAME,
        "mode": "sandbox",
        "status": "simulated",
        "auto_sync": False,
        "auto_match": False,
    }
    row.update(extra)
    return row


def _row(db, coll, company_id, doc_id):
    for doc in db[coll].docs:
        if doc.get("_id") == doc_id and doc.get("company_id") == company_id:
            return doc
    return None


def _seed_pair(db, *builders, b_first=True):
    order = (CO_B, CO_A) if b_first else (CO_A, CO_B)
    for company_id in order:
        for build in builders:
            _add(db, build[0], build[1](company_id))


def test_account_and_transaction_writes_stay_in_company(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _seed_pair(
        db,
        ("bank_accounts", _account),
        ("contacts", _contact),
        ("bank_transactions", _tx),
    )
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as foreign:
            _run(server.create_bank_account(BankAccount(
                company_id=CO_B, type="bank", bank_name="BankaA", account_name="YeniA",
                currency="TRY", current_balance=0,
            ), user))
        assert foreign.value.status_code == 403
        assert _digest(db, CO_B) == before

        created = _run(server.create_bank_account(BankAccount(
            company_id="", type="bank", bank_name="BankaA", account_name="YeniA",
            currency="TRY", current_balance=0,
        ), user))
        assert created["company_id"] == CO_A
        stored = next(row for row in db.bank_accounts.docs if row.get("account_name") == "YeniA")
        assert stored["company_id"] == CO_A

        renamed = _run(server.update_bank_account(ACC, {"account_name": "HesapA2"}, user))
        assert renamed["account_name"] == "HesapA2"
        assert renamed["company_id"] == CO_A
        assert _row(db, "bank_accounts", CO_B, ACC)["account_name"] == SECRET_NAME
        assert _row(db, "bank_accounts", CO_B, ACC)["current_balance"] == 4242.0

        posted = _run(server.create_bank_transaction(BankTransaction(
            company_id=CO_A, account_id=ACC, account_name="YabanciAd", type="inflow",
            category="Tahsilat", amount=12, description="tahsil-yeni", contact_id=CONTACT,
        ), user))
        assert posted["company_id"] == CO_A
        assert _row(db, "bank_accounts", CO_A, ACC)["current_balance"] == pytest.approx(1012)
        assert _row(db, "contacts", CO_A, CONTACT)["balance"] == pytest.approx(78)
        assert _row(db, "bank_accounts", CO_B, ACC)["current_balance"] == 4242.0
        assert _row(db, "contacts", CO_B, CONTACT)["balance"] == 777.0
        assert _row(db, "bank_transactions", CO_B, BT)["amount"] == 9999.0

        edited = _run(server.update_bank_transaction(BT, {"amount": 15, "description": "tahsil-a2"}, user))
        assert edited["amount"] == 15
        assert edited["company_id"] == CO_A
        assert edited["description"] == "tahsil-a2"
        assert _row(db, "bank_transactions", CO_B, BT)["amount"] == 9999.0
        assert _row(db, "bank_transactions", CO_B, BT)["description"] == "tahsil-b-gizli"
        assert _row(db, "bank_accounts", CO_B, ACC)["current_balance"] == 4242.0
        assert _row(db, "contacts", CO_B, CONTACT)["balance"] == 777.0
        assert SECRET_NAME not in json.dumps(edited)
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_update_transaction_rejects_foreign_account(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "bank_accounts", _account(CO_B, _id=ACC_B, current_balance=4242.0))
    _add(db, "bank_accounts", _account(CO_A))
    _add(db, "bank_transactions", _tx(CO_B))
    _add(db, "bank_transactions", _tx(CO_A))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as exc:
            _run(server.update_bank_transaction(BT, {"account_id": ACC_B}, user))
        assert exc.value.status_code == 404
        assert exc.value.detail == "Hesap bulunamadı."
        assert SECRET_NAME not in str(exc.value.detail)
        assert SECRET_NO not in str(exc.value.detail)
        assert SECRET_BANK not in str(exc.value.detail)
        assert _row(db, "bank_transactions", CO_A, BT)["account_id"] == ACC
        assert _row(db, "bank_transactions", CO_A, BT)["account_name"] == "HesapA"
        assert _row(db, "bank_transactions", CO_A, BT)["amount"] == 10.0
        assert _row(db, "bank_accounts", CO_A, ACC)["current_balance"] == 1000.0
        assert _row(db, "bank_accounts", CO_B, ACC_B)["current_balance"] == 4242.0
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_connection_rejects_foreign_account(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "bank_accounts", _account(CO_B, _id=ACC_B))
    _add(db, "bank_connections", _conn(CO_A, linked_account_id=ACC))
    _add(db, "bank_accounts", _account(CO_A, _id="acc-a-home"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as created:
            _run(server.create_bank_connection(BankConnection(
                company_id=CO_A, provider="other", linked_account_id=ACC_B,
            ), user))
        assert created.value.status_code == 404
        assert created.value.detail == "Bağlanacak banka hesabı bulunamadı."
        assert SECRET_NAME not in str(created.value.detail)
        assert SECRET_NO not in str(created.value.detail)
        assert all(row.get("company_id") != CO_A or row.get("_id") == CONN for row in db.bank_connections.docs)
        assert len(db.bank_connections.docs) == 1

        with pytest.raises(HTTPException) as updated:
            _run(server.update_bank_connection(CONN, {"linked_account_id": ACC_B}, _Req(), user))
        assert updated.value.status_code == 404
        assert updated.value.detail == "Banka hesabı bulunamadı."
        assert SECRET_NAME not in str(updated.value.detail)
        assert SECRET_NO not in str(updated.value.detail)
        assert SECRET_IBAN not in str(updated.value.detail)
        assert _row(db, "bank_connections", CO_A, CONN)["linked_account_id"] == ACC
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_connection_update_stays_in_company(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "bank_accounts", _account(CO_B))
    _add(db, "bank_accounts", _account(CO_A))
    _add(db, "bank_connections", _conn(CO_B))
    _add(db, "bank_connections", _conn(CO_A))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.update_bank_connection(CONN, {"linked_account_id": ACC, "mode": "live"}, _Req(), user))
        assert out["company_id"] == CO_A
        assert out["mode"] == "live"
        assert SECRET_NAME not in json.dumps(out)
        assert SECRET_BANK not in json.dumps(out)
        assert SECRET_NO not in json.dumps(out)
        stored = _row(db, "bank_connections", CO_A, CONN)
        assert stored["mode"] == "live"
        assert stored["company_id"] == CO_A
        assert "HesapA" in (stored.get("linked_account_name") or "")
        assert SECRET_NAME not in (stored.get("linked_account_name") or "")
        assert _row(db, "bank_connections", CO_B, CONN)["mode"] == "sandbox"
        assert _row(db, "bank_connections", CO_B, CONN)["linked_account_name"] == SECRET_NAME
        assert _row(db, "bank_accounts", CO_B, ACC)["current_balance"] == 4242.0
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_reverse_ignores_other_company_and_empty_company(caplog):
    db = _DB()
    _add(db, "bank_accounts", _account(CO_B, current_balance=4242.0))
    _add(db, "bank_accounts", _account(CO_A, current_balance=1000.0))
    _add(db, "bank_accounts", _account(CO_B, _id=TARGET, current_balance=8000.0, account_name=SECRET_NAME))
    _add(db, "bank_accounts", _account(CO_A, _id=TARGET, current_balance=50.0, account_name="HedefA"))
    _add(db, "bank_accounts", _account(CO_B, _id=ACC_B, type="bank", current_balance=4242.0))
    _add(db, "contacts", _contact(CO_B))
    _add(db, "contacts", _contact(CO_A))
    _add(db, "contacts", _contact(CO_B, OWNER, balance=500.0, name="SahipB"))
    _add(db, "contacts", _contact(CO_A, OWNER, balance=10.0, name="SahipA"))
    _add(db, "invoices", _invoice(CO_B))
    _add(db, "invoices", _invoice(CO_A))
    bare = {
        "_id": "bt-bare",
        "type": "transfer",
        "amount": 4242.55,
        "account_id": ACC,
        "target_account_id": TARGET,
        "owner_contact_id": OWNER,
        "contact_id": CONTACT,
        "related_invoice_id": INV,
        "description": "GizliAciklama",
        "account_name": SECRET_NAME,
        "iban": SECRET_IBAN,
    }
    prev = _bind(db)
    try:
        before_a = _digest(db, CO_A)
        before_b = _digest(db, CO_B)
        caplog.clear()
        with caplog.at_level(logging.WARNING, logger="TamKobiERP"):
            for empty in (None, "", "   "):
                _run(server._reverse_tx_effects({**bare, "company_id": empty}, -1))
        assert _digest(db, CO_A) == before_a
        assert _digest(db, CO_B) == before_b
        warnings = [rec.getMessage() for rec in caplog.records if rec.name == "TamKobiERP"]
        assert warnings
        assert set(warnings) == {"Banka hareketi geri alınamadı."}
        for text in warnings:
            assert "4242" not in text
            assert SECRET_NAME not in text
            assert SECRET_IBAN not in text
            assert "GizliAciklama" not in text
            assert CO_A not in text
            assert CO_B not in text
            assert "bt-bare" not in text

        _run(server._reverse_tx_effects({
            "_id": "bt-tr",
            "company_id": CO_A,
            "type": "transfer",
            "amount": 10,
            "account_id": ACC,
            "target_account_id": ACC_B,
            "owner_contact_id": OWNER,
            "source": "manual",
        }, -1))
        assert _row(db, "bank_accounts", CO_A, ACC)["current_balance"] == pytest.approx(1010)
        assert _row(db, "bank_accounts", CO_B, ACC)["current_balance"] == 4242.0
        assert _row(db, "bank_accounts", CO_B, ACC_B)["current_balance"] == 4242.0
        assert _row(db, "contacts", CO_A, OWNER)["balance"] == pytest.approx(20)
        assert _row(db, "contacts", CO_B, OWNER)["balance"] == 500.0

        _run(server._reverse_tx_effects({
            "_id": "bt-in",
            "company_id": CO_A,
            "type": "inflow",
            "amount": 25,
            "account_id": ACC,
            "contact_id": CONTACT,
            "owner_contact_id": OWNER,
            "related_invoice_id": INV,
            "source": "manual",
        }, -1))
        assert _row(db, "bank_accounts", CO_A, ACC)["current_balance"] == pytest.approx(985)
        assert _row(db, "contacts", CO_A, CONTACT)["balance"] == pytest.approx(115)
        assert _row(db, "contacts", CO_A, OWNER)["balance"] == pytest.approx(45)
        inv = _row(db, "invoices", CO_A, INV)
        assert inv["paid_amount"] == pytest.approx(15)
        assert inv["payment_status"] == "partially_paid"
        assert _row(db, "bank_accounts", CO_B, ACC)["current_balance"] == 4242.0
        assert _row(db, "bank_accounts", CO_B, TARGET)["current_balance"] == 8000.0
        assert _row(db, "contacts", CO_B, CONTACT)["balance"] == 777.0
        assert _row(db, "contacts", CO_B, OWNER)["balance"] == 500.0
        assert _row(db, "invoices", CO_B, INV)["paid_amount"] == 80.0
        assert _row(db, "invoices", CO_B, INV)["payment_status"] == "paid"
        assert _digest(db, CO_B) == before_b
    finally:
        _restore(prev)


def test_reverse_pool_pin_does_not_touch_other_company():
    db = _DB()
    _add(db, "bank_accounts", _account(
        CO_B, type="bank", is_customer_card_pool=False, current_balance=4242.0,
    ))
    _add(db, "bank_accounts", _account(
        CO_A, type="credit_card", is_customer_card_pool=True, card_owner="customer",
        current_balance=5.0, account_name="HavuzA", bank_name="Havuz",
    ))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        _run(server._reverse_tx_effects({
            "_id": "bt-pool",
            "company_id": CO_A,
            "type": "inflow",
            "amount": 20,
            "account_id": ACC,
            "source": "manual",
        }, +1))
        assert _row(db, "bank_accounts", CO_A, ACC)["current_balance"] == pytest.approx(0)
        assert _row(db, "bank_accounts", CO_B, ACC)["current_balance"] == 4242.0
        assert _row(db, "bank_accounts", CO_B, ACC)["type"] == "bank"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_delete_transaction_does_not_take_foreign_pair(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "bank_accounts", _account(CO_B, type="cash_box", current_balance=4242.0))
    _add(db, "bank_accounts", _account(CO_A, type="cash_box", current_balance=1000.0))
    _add(db, "contacts", _contact(CO_B))
    _add(db, "contacts", _contact(CO_A))
    _add(db, "bank_transactions", _tx(
        CO_B, _id=PAIR, amount=7777.0, account_id=ACC, description="es-b",
    ))
    _add(db, "bank_transactions", _tx(
        CO_A, _id=BT_A, amount=10.0, account_id=ACC, pair_tx_id=PAIR, contact_id=CONTACT,
    ))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.delete_bank_transaction(BT_A, user))
        assert out["status"] == "success"
        assert _row(db, "bank_transactions", CO_B, PAIR)["amount"] == 7777.0
        assert _row(db, "bank_transactions", CO_B, PAIR)["description"] == "es-b"
        assert _row(db, "bank_accounts", CO_B, ACC)["current_balance"] == 4242.0
        assert _row(db, "contacts", CO_B, CONTACT)["balance"] == 777.0
        assert all(
            (row.get("doc") or {}).get("_id") != PAIR
            for row in db.trash.docs
        )
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_balance_edit_ignores_other_company_activity(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "bank_accounts", _account(
        CO_B, type="credit_card", is_customer_card_pool=True, card_owner="customer",
        current_balance=4242.0, account_name=SECRET_NAME,
    ))
    _add(db, "bank_accounts", _account(
        CO_A, type="credit_card", is_customer_card_pool=True, card_owner="customer",
        current_balance=10.0, account_name="HavuzA",
    ))
    _add(db, "bank_transactions", _tx(CO_B, _id="man-b", source="manual", amount=5))
    _add(db, "bank_transactions", _tx(CO_B, _id="open-b", source="opening", amount=4242))
    _add(db, "bank_transactions", _tx(CO_A, _id="open-a", source="opening", amount=10))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        updated = _run(server.update_bank_account(ACC, {"current_balance": 55}, user))
        assert updated["current_balance"] == pytest.approx(55)
        assert updated["company_id"] == CO_A
        assert _row(db, "bank_accounts", CO_B, ACC)["current_balance"] == 4242.0
        assert _row(db, "bank_accounts", CO_B, ACC)["account_name"] == SECRET_NAME
        assert _row(db, "bank_transactions", CO_B, "open-b")["source"] == "opening"
        assert _row(db, "bank_transactions", CO_B, "man-b")["amount"] == 5
        assert _row(db, "bank_transactions", CO_A, "open-a") is None
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_delete_account_ignores_other_company_links(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    # Çöp kutusu hâlâ yalnız _id ile siler; A önde olursa B'nin kartı kalır.
    _add(db, "bank_accounts", _account(CO_A, current_balance=10.0))
    _add(db, "bank_accounts", _account(CO_B, current_balance=4242.0))
    _add(db, "bank_connections", _conn(CO_B, linked_account_id=ACC))
    _add(db, "bank_transactions", _tx(CO_B, account_id=ACC, amount=9))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.delete_bank_account(ACC, user))
        assert out["status"] == "success"
        assert out["message"] == "Hesap çöp kutusuna taşındı."
        assert _row(db, "bank_accounts", CO_A, ACC) is None
        assert _row(db, "bank_accounts", CO_B, ACC)["current_balance"] == 4242.0
        assert _row(db, "bank_accounts", CO_B, ACC)["account_name"] == SECRET_NAME
        assert _row(db, "bank_connections", CO_B, CONN)["linked_account_id"] == ACC
        assert _row(db, "bank_transactions", CO_B, BT)["amount"] == 9
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_insert_company_stays_after_stamp():
    user = _user(CO_A)
    db = _DB()
    prev = _bind(db)
    traced = sys.gettrace()

    def _stamp(frame, event, arg):
        if event == "line" and frame.f_code.co_name in ("create_bank_account", "create_bank_connection"):
            blob = frame.f_locals.get("doc")
            if isinstance(blob, dict):
                blob["company_id"] = CO_B
        return _stamp

    sys.settrace(_stamp)
    try:
        _run(server.create_bank_account(BankAccount(
            company_id=CO_A, type="bank", bank_name="BankaA", account_name="Damgali",
            currency="TRY", current_balance=0,
        ), user))
        stored = next(row for row in db.bank_accounts.docs if row.get("account_name") == "Damgali")
        assert stored["company_id"] == CO_A

        _add(db, "bank_accounts", _account(CO_A, _id="acc-link", account_name="HesapA"))
        _run(server.create_bank_connection(BankConnection(
            company_id=CO_A, provider="other", linked_account_id="acc-link",
        ), user))
        conn = next(row for row in db.bank_connections.docs if row.get("linked_account_id") == "acc-link")
        assert conn["company_id"] == CO_A
        assert all(row.get("company_id") != CO_B for row in db.bank_connections.docs)
    finally:
        sys.settrace(traced)
        _restore(prev)


def test_insert_company_id_is_after_spread():
    tree = ast.parse(Path(server.__file__).read_text(encoding="utf-8"))
    wanted = {"create_bank_account", "create_bank_connection"}
    found = set()
    for fn in ast.walk(tree):
        if not isinstance(fn, ast.AsyncFunctionDef) or fn.name not in wanted:
            continue
        inserts = [
            node for node in ast.walk(fn)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "insert_one"
        ]
        assert len(inserts) == 1
        arg = inserts[0].args[0]
        assert isinstance(arg, ast.Dict)
        last_spread = max((i for i, key in enumerate(arg.keys) if key is None), default=-1)
        company_at = next(
            i for i, key in enumerate(arg.keys)
            if isinstance(key, ast.Constant) and key.value == "company_id"
        )
        assert company_at > last_spread
        found.add(fn.name)
    assert found == wanted


def test_wave14_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 25
    assert len(set(_REMOVED)) == 25
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
