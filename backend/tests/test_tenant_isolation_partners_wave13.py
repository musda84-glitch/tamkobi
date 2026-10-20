"""Ortak kartı, hareket, ters kayıt ve kâr dağıtımı kiracı dalgası 13.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar, bakiye, ortak adı, IBAN, hesap adı ve şirket kimliği loglanmaz.
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
from models import Partner  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
PARTNER = "partner-shared"
PTX = "ptx-shared"
ACC = "acc-shared"
CONTACT = "contact-shared"
BT = "bt-shared"
DAY = "2026-03-01"

_REMOVED = (
    ("server.py", "_execute_distribute_profit", "bank_accounts", "find_one"),
    ("server.py", "_execute_distribute_profit", "partner_transactions", "insert_one"),
    ("server.py", "_execute_distribute_profit", "partners", "update_one"),
    ("server.py", "_execute_partner_tx", "partner_transactions", "insert_one"),
    ("server.py", "_execute_partner_tx", "partners", "find_one"),
    ("server.py", "_execute_partner_tx", "partners", "update_one"),
    ("server.py", "_reverse_partner_tx", "bank_accounts", "update_one"),
    ("server.py", "_reverse_partner_tx", "bank_transactions", "delete_one"),
    ("server.py", "_reverse_partner_tx", "bank_transactions", "find_one"),
    ("server.py", "_reverse_partner_tx", "contacts", "update_one"),
    ("server.py", "_reverse_partner_tx", "partners", "update_one"),
    ("server.py", "create_partner", "partners", "find_one"),
    ("server.py", "create_partner", "partners", "insert_one"),
    ("server.py", "delete_partner", "partner_transactions", "find"),
    ("server.py", "partner_ledger_check", "partner_transactions", "find"),
    ("server.py", "partner_ledger_check", "partners", "find_one"),
    ("server.py", "update_partner", "partners", "find_one"),
    ("server.py", "update_partner", "partners", "update_one"),
    ("server.py", "update_partner_transaction", "contacts", "update_one"),
    ("server.py", "update_partner_transaction", "partner_transactions", "find_one"),
    ("server.py", "update_partner_transaction", "partner_transactions", "update_one"),
    ("server.py", "update_partner_transaction", "partners", "update_one"),
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id, *, uid=None):
    uid = uid or ("user-" + company_id)
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


def _partner(company_id, **extra):
    row = {
        "_id": PARTNER,
        "company_id": company_id,
        "name": "OrtakA" if company_id == CO_A else "OrtakB",
        "share_percent": 100,
        "balance": 0.0,
        "total_capital_in": 0.0,
        "total_withdrawn": 0.0,
        "total_profit_share": 0.0,
        "is_active": True,
    }
    row.update(extra)
    return row


def _account(company_id, **extra):
    row = {
        "_id": ACC,
        "company_id": company_id,
        "type": "cash_box",
        "account_name": "KasaA" if company_id == CO_A else "KasaB",
        "currency": "TRY",
        "current_balance": 1000.0 if company_id == CO_A else 4242.0,
    }
    row.update(extra)
    return row


def _contact(company_id, **extra):
    row = {
        "_id": CONTACT,
        "company_id": company_id,
        "name": "CariA" if company_id == CO_A else "CariB",
        "balance": 90.0 if company_id == CO_A else 777.0,
    }
    row.update(extra)
    return row


def _ptx(company_id, **extra):
    row = {
        "_id": PTX,
        "company_id": company_id,
        "partner_id": PARTNER,
        "partner_name": "OrtakA" if company_id == CO_A else "OrtakB",
        "type": "withdrawal",
        "amount": 10.0 if company_id == CO_A else 9999.0,
        "account_id": ACC,
        "account_name": "KasaA" if company_id == CO_A else "KasaB",
        "contact_id": CONTACT,
        "contact_name": "CariA" if company_id == CO_A else "CariB",
        "description": "cek-a" if company_id == CO_A else "cek-b",
        "date": DAY,
        "is_paid": True,
    }
    row.update(extra)
    return row


def _bank_tx(company_id, **extra):
    name = "OrtakA" if company_id == CO_A else "OrtakB"
    row = {
        "_id": BT,
        "company_id": company_id,
        "account_id": ACC,
        "partner_tx_id": PTX,
        "source": "partner",
        "type": "outflow",
        "amount": 10.0 if company_id == CO_A else 9999.0,
        "date": DAY,
        "description": f"{name}: cek-{'a' if company_id == CO_A else 'b'}",
    }
    row.update(extra)
    return row


def _seed_shared(db, *, b_first=True, with_tx=True, with_bank=True):
    """B önce yazılır; şirketsiz ilk eşleşme B'yi vurur."""
    order = (CO_B, CO_A) if b_first else (CO_A, CO_B)
    for company_id in order:
        _add(db, "partners", _partner(company_id))
        _add(db, "bank_accounts", _account(company_id))
        _add(db, "contacts", _contact(company_id))
        if with_tx:
            _add(db, "partner_transactions", _ptx(company_id))
        if with_bank:
            _add(db, "bank_transactions", _bank_tx(company_id))


_IDS = {
    "partners": PARTNER,
    "partner_transactions": PTX,
    "bank_accounts": ACC,
    "contacts": CONTACT,
    "bank_transactions": BT,
}


def _row(db, coll, company_id, doc_id=None):
    wanted = _IDS.get(coll, PARTNER) if doc_id is None else doc_id
    for doc in db[coll].docs:
        if doc.get("_id") == wanted and doc.get("company_id") == company_id:
            return doc
    return None


def test_shared_reads_and_writes_leave_other_company(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _seed_shared(db)
    # Cari tahsilat (withdrawal+contact) bakiyeyi artırır. Kayıtlı toplam sapmasın.
    _row(db, "partners", CO_B)["balance"] = 9999.0
    _row(db, "partners", CO_B)["total_withdrawn"] = 9999.0
    _row(db, "partners", CO_A)["balance"] = 10.0
    _row(db, "partners", CO_A)["total_withdrawn"] = 10.0
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        ledger = _run(server.partner_ledger_check(PARTNER, user))
        assert ledger["partner_name"] == "OrtakA"
        assert [row["amount"] for row in ledger["transactions"]] == [10.0]
        assert [row["description"] for row in ledger["transactions"]] == ["cek-a"]

        updated = _run(server.update_partner(PARTNER, {"name": "OrtakA2"}, user))
        assert updated["name"] == "OrtakA2"
        assert _row(db, "partners", CO_B)["name"] == "OrtakB"

        edited = _run(server.update_partner_transaction(PTX, {"amount": 15, "description": "cek-a2"}, user))
        assert edited["amount"] == 15
        assert edited["company_id"] == CO_A
        assert _row(db, "partners", CO_B)["balance"] == 9999.0
        assert _row(db, "contacts", CO_B)["balance"] == 777.0
        assert _row(db, "bank_accounts", CO_B)["current_balance"] == 4242.0
        assert _row(db, "bank_transactions", CO_B, BT)["amount"] == 9999.0

        created = _run(server.create_partner_transaction({
            "partner_id": PARTNER,
            "type": "capital_in",
            "amount": 8,
            "account_id": ACC,
            "company_id": CO_B,
            "description": "koy-a",
            "date": DAY,
        }, user))
        assert created["company_id"] == CO_A
        assert _row(db, "bank_accounts", CO_B)["current_balance"] == 4242.0
        assert _row(db, "partners", CO_B)["total_capital_in"] == 0.0
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_delete_partner_transaction_keeps_other_company(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "partners", _partner(CO_B, balance=9999.0, total_withdrawn=9999.0))
    _add(db, "partners", _partner(CO_A, balance=10.0, total_withdrawn=10.0))
    _add(db, "bank_accounts", _account(CO_B))
    _add(db, "bank_accounts", _account(CO_A))
    _add(db, "contacts", _contact(CO_B))
    _add(db, "contacts", _contact(CO_A))
    _add(db, "bank_transactions", _bank_tx(CO_B))
    _add(db, "partner_transactions", _ptx(CO_A))
    _add(db, "partner_transactions", _ptx(CO_B))
    _add(db, "bank_transactions", _bank_tx(CO_A))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.delete_partner_transaction(PTX, user))
        assert out["status"] == "success"
        assert _row(db, "partner_transactions", CO_B, PTX)["amount"] == 9999.0
        assert _row(db, "bank_transactions", CO_B, BT)["description"].startswith("OrtakB")
        assert _row(db, "partners", CO_B)["balance"] == 9999.0
        assert _row(db, "contacts", CO_B)["balance"] == 777.0
        assert _row(db, "bank_accounts", CO_B)["current_balance"] == 4242.0
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_delete_partner_does_not_take_other_company_transactions(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "partners", _partner(CO_A, balance=0.0, share_percent=0))
    _add(db, "partners", _partner(CO_B, balance=50.0, share_percent=0))
    _add(db, "partner_transactions", _ptx(CO_A, _id="ptx-a-only", amount=4))
    _add(db, "partner_transactions", _ptx(CO_B))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.delete_partner(PARTNER, user))
        assert out["status"] == "success"
        assert _row(db, "partners", CO_B)["balance"] == 50.0
        assert _row(db, "partner_transactions", CO_B, PTX)["amount"] == 9999.0
        assert _row(db, "partner_transactions", CO_A, "ptx-a-only") is None
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_virman_unknown_partner_and_shared_partner_stay_in_company():
    db = _DB()
    _add(db, "partners", _partner(CO_B, balance=80.0, total_withdrawn=3.0))
    _add(db, "bank_accounts", _account(CO_B, current_balance=4242.0))
    _add(db, "bank_accounts", _account(CO_A, current_balance=500.0))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        for source, target in (
            (ACC, f"partner:{PARTNER}"),
            (f"partner:{PARTNER}", ACC),
        ):
            with pytest.raises(HTTPException) as exc:
                _run(server._execute_virman({
                    "company_id": CO_A,
                    "source_account_id": source,
                    "target_account_id": target,
                    "amount": 12,
                    "description": "yabanci",
                }))
            assert exc.value.status_code == 404
            assert exc.value.detail == "Ortak bulunamadı."
        assert _row(db, "partners", CO_B)["balance"] == 80.0
        assert _row(db, "bank_accounts", CO_B)["current_balance"] == 4242.0
        assert _digest(db, CO_B) == before

        _add(db, "partners", _partner(CO_A, balance=0.0))
        before = _digest(db, CO_B)
        out = _run(server._execute_virman({
            "company_id": CO_A,
            "source_account_id": ACC,
            "target_account_id": f"partner:{PARTNER}",
            "amount": 5,
            "description": "hesap-ortak",
        }))
        assert out["status"] == "success"
        back = _run(server._execute_virman({
            "company_id": CO_A,
            "source_account_id": f"partner:{PARTNER}",
            "target_account_id": ACC,
            "amount": 4,
            "description": "ortak-hesap",
        }))
        assert back["status"] == "success"
        assert _row(db, "partners", CO_A)["company_id"] == CO_A
        assert _row(db, "partners", CO_B)["balance"] == 80.0
        assert _row(db, "bank_accounts", CO_B)["current_balance"] == 4242.0
        assert all(row.get("company_id") != CO_B for row in db.partner_transactions.docs)
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_execute_partner_tx_without_company_writes_nothing():
    db = _DB()
    _seed_shared(db, with_tx=False, with_bank=False)
    prev = _bind(db)
    try:
        before_a = _digest(db, CO_A)
        before_b = _digest(db, CO_B)
        for payload in (
            {"partner_id": PARTNER, "type": "withdrawal", "amount": 12, "account_id": ACC},
            {"partner_id": PARTNER, "type": "capital_in", "amount": 12, "account_id": ACC, "company_id": ""},
            {"partner_id": PARTNER, "type": "capital_in", "amount": 12, "account_id": ACC, "company_id": "   "},
        ):
            with pytest.raises(HTTPException) as exc:
                _run(server._execute_partner_tx(payload))
            assert exc.value.status_code == 404
            assert exc.value.detail == "Ortak bulunamadı."
        assert db.partner_transactions.docs == []
        assert _digest(db, CO_A) == before_a
        assert _digest(db, CO_B) == before_b
    finally:
        _restore(prev)


def test_approve_cash_request_uses_queue_company():
    db = _DB()
    _seed_shared(db, with_tx=False, with_bank=False)
    _row(db, "partners", CO_A)["balance"] = 0.0
    _row(db, "bank_accounts", CO_A)["current_balance"] = 1000.0
    requester = _user(CO_A, uid="user-req")
    approver = _user(CO_A, uid="user-ap")
    _add(db, "cash_approval_requests", {
        "_id": "apr-bare",
        "company_id": CO_A,
        "kind": "partner_tx",
        "status": "pending",
        "requested_by": requester["_id"],
        "requested_by_name": "Talep",
        "summary": "eski kuyruk",
        "payload": {
            "partner_id": PARTNER,
            "type": "capital_in",
            "amount": 20,
            "account_id": ACC,
            "description": "eski",
            "date": DAY,
        },
    })
    _add(db, "cash_approval_requests", {
        "_id": "apr-other",
        "company_id": CO_A,
        "kind": "partner_tx",
        "status": "pending",
        "requested_by": requester["_id"],
        "requested_by_name": "Talep",
        "summary": "yanlis sirket",
        "payload": {
            "company_id": CO_B,
            "partner_id": PARTNER,
            "type": "capital_in",
            "amount": 7,
            "account_id": ACC,
            "description": "ezilen",
            "date": DAY,
        },
    })
    prev = _bind(db)
    previous_user = server.get_current_user

    async def _as_approver(_request):
        return approver

    server.get_current_user = _as_approver
    try:
        before = _digest(db, CO_B)
        first = _run(server.approve_cash_request("apr-bare", type("R", (), {})()))
        second = _run(server.approve_cash_request("apr-other", type("R", (), {})()))
        assert first["status"] == "success"
        assert second["status"] == "success"
        assert _row(db, "partners", CO_A)["balance"] == pytest.approx(27)
        assert _row(db, "partners", CO_A)["total_capital_in"] == pytest.approx(27)
        assert _row(db, "bank_accounts", CO_A)["current_balance"] == pytest.approx(1027)
        assert _row(db, "partners", CO_B)["balance"] == 0.0
        assert _row(db, "bank_accounts", CO_B)["current_balance"] == 4242.0
        assert all(row.get("company_id") == CO_A for row in db.partner_transactions.docs)
        assert _digest(db, CO_B) == before
    finally:
        server.get_current_user = previous_user
        _restore(prev)


def test_distribute_profit_foreign_account_is_not_found(monkeypatch):
    calls = []

    async def _guard(_db, account_id):
        calls.append(account_id)

    monkeypatch.setattr(server.bank_guard, "assert_manual_allowed", _guard)
    db = _DB()
    _add(db, "partners", _partner(CO_B, balance=10.0, total_profit_share=4.0))
    _add(db, "partners", _partner(CO_A, balance=1.0, total_profit_share=2.0))
    _add(db, "bank_accounts", _account(CO_B, current_balance=5.0))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as exc:
            _run(server._execute_distribute_profit({
                "company_id": CO_A,
                "total_profit": 100,
                "pay_now": True,
                "account_id": ACC,
            }))
        assert exc.value.status_code == 404
        assert exc.value.detail == "Kaynak hesap bulunamadı."
        assert "yetersiz" not in exc.value.detail
        assert calls == []
        assert db.partner_transactions.docs == []
        assert _row(db, "bank_accounts", CO_B)["current_balance"] == 5.0
        assert _digest(db, CO_B) == before

        _add(db, "bank_accounts", _account(CO_A, current_balance=1000.0))
        before = _digest(db, CO_B)
        accrued = _run(server._execute_distribute_profit({
            "company_id": CO_A,
            "total_profit": 100,
            "pay_now": False,
        }))
        assert accrued["status"] == "success"
        assert _row(db, "partners", CO_A)["balance"] == pytest.approx(101)
        assert _row(db, "partners", CO_A)["total_profit_share"] == pytest.approx(102)
        assert _row(db, "partners", CO_B)["balance"] == 10.0
        assert _row(db, "partners", CO_B)["total_profit_share"] == 4.0
        assert all(row.get("company_id") == CO_A for row in db.partner_transactions.docs)
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_reverse_without_company_and_regex_backup_ignore_other_company(caplog):
    db = _DB()
    _seed_shared(db, with_tx=False, with_bank=False)
    _add(db, "bank_transactions", _bank_tx(
        CO_B,
        partner_tx_id="ptx-bare",
        amount=15.0,
        description="OrtakA: yedek",
        account_id=ACC,
        date=DAY,
    ))
    _row(db, "partners", CO_B)["balance"] = 80.0
    _row(db, "contacts", CO_B)["balance"] = 777.0
    _row(db, "bank_accounts", CO_B)["current_balance"] = 4242.0
    bare = {
        "_id": "ptx-bare",
        "partner_id": PARTNER,
        "partner_name": "OrtakA",
        "type": "withdrawal",
        "amount": 15.0,
        "account_id": ACC,
        "contact_id": CONTACT,
        "date": DAY,
        "description": "yedek",
    }
    prev = _bind(db)
    try:
        before_a = _digest(db, CO_A)
        before_b = _digest(db, CO_B)
        caplog.clear()
        with caplog.at_level(logging.WARNING, logger="TamKobiERP"):
            for empty in (None, "", "   "):
                _run(server._reverse_partner_tx({**bare, "company_id": empty}))
        assert _digest(db, CO_A) == before_a
        assert _digest(db, CO_B) == before_b
        warnings = [rec.getMessage() for rec in caplog.records if rec.name == "TamKobiERP"]
        assert warnings
        for text in warnings:
            assert "ptx-bare" not in text
            assert CO_A not in text
            assert CO_B not in text
            assert "15" not in text
            assert "OrtakA" not in text
            assert "4242" not in text
            assert "KasaB" not in text

        owned = {**bare, "_id": "ptx-a", "company_id": CO_A}
        _run(server._reverse_partner_tx(owned))
        assert _row(db, "bank_transactions", CO_B, BT)["description"] == "OrtakA: yedek"
        assert _row(db, "bank_transactions", CO_B, BT)["amount"] == 15.0
        assert _row(db, "partners", CO_B)["balance"] == 80.0
        assert _row(db, "contacts", CO_B)["balance"] == 777.0
        assert _row(db, "bank_accounts", CO_B)["current_balance"] == 4242.0
    finally:
        _restore(prev)


def test_create_partner_keeps_caller_company():
    user = _user(CO_A)
    db = _DB()
    _add(db, "partners", _partner(CO_A, share_percent=10, name="OrtakA"))
    _add(db, "partners", _partner(CO_B, share_percent=10, name="OrtakB"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as exc:
            _run(server.create_partner(Partner(company_id=CO_B, name="Sizma", share_percent=5), user))
        assert exc.value.status_code == 403
        assert all(row.get("name") != "Sizma" for row in db.partners.docs)
        assert _digest(db, CO_B) == before

        created = _run(server.create_partner(Partner(company_id="", name="YeniA", share_percent=5), user))
        assert created["company_id"] == CO_A
        stored = next(row for row in db.partners.docs if row.get("name") == "YeniA")
        assert stored["company_id"] == CO_A
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)

    db = _DB()
    prev = _bind(db)
    traced = sys.gettrace()

    def _stamp(frame, event, arg):
        if event == "line" and frame.f_code.co_name == "create_partner":
            blob = frame.f_locals.get("doc")
            if isinstance(blob, dict):
                blob["company_id"] = CO_B
        return _stamp

    sys.settrace(_stamp)
    try:
        before = _digest(db, CO_B)
        _run(server.create_partner(Partner(company_id=CO_A, name="Damgali", share_percent=5), user))
        stored = next(row for row in db.partners.docs if row.get("name") == "Damgali")
        assert stored["company_id"] == CO_A
        assert _digest(db, CO_B) == before
    finally:
        sys.settrace(traced)
        _restore(prev)


def test_wave13_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 22
    assert len(set(_REMOVED)) == 22
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
