"""Banka eşleştirme ve virman kiracı sınırı.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar, bakiye ve şirket kimliği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import server  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402
from models import BankTransaction  # noqa: E402
from mysql_store import new_upsert_doc  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
ACC_A = "acc-a"
ACC_A2 = "acc-a2"
ACC_B = "acc-b"
ACC_INT = "acc-int"
CONTACT_A = "contact-a"
CONTACT_B = "contact-b"
CONTACT_SHARED = "contact-shared"
INV_A = "inv-a"
INV_B = "inv-b"
TX_A = "tx-a"
EMP_A = "emp-a"
PAY_A = "pay-a"
PAY_B = "pay-b"
RULE_B = "rule-b"
REPORTED = 9045.42

_REMOVED = (
    ("bank_match_target.py", "repair_legacy_bank_match_directions", "bank_transactions", "find"),
    ("bank_match_target.py", "repair_legacy_bank_match_directions", "partner_transactions", "find"),
    ("bank_match_target.py", "repair_legacy_bank_match_directions", "partner_transactions", "update_one"),
    ("bank_tx.py", "scrub_platform_actors", "bank_transactions", "find"),
    ("bank_tx.py", "scrub_platform_actors", "bank_transactions", "update_one"),
    ("server.py", "_apply_match", "bank_accounts", "find_one"),
    ("server.py", "_apply_match", "bank_transactions", "find"),
    ("server.py", "_apply_match", "bank_transactions", "find_one"),
    ("server.py", "_apply_match", "bank_transactions", "update_one"),
    ("server.py", "_apply_match", "contacts", "find_one"),
    ("server.py", "_apply_match", "contacts", "update_one"),
    ("server.py", "_apply_match", "invoices", "find_one"),
    ("server.py", "_apply_match", "invoices", "update_one"),
    ("server.py", "_apply_personnel_bank_match", "payrolls", "find"),
    ("server.py", "_apply_personnel_bank_match", "payrolls", "update_one"),
    ("server.py", "_apply_personnel_reimburse_match", "bonus_payments", "find"),
    ("server.py", "_apply_personnel_reimburse_match", "payrolls", "find"),
    ("server.py", "_create_match_rule_core", "bank_accounts", "find_one"),
    ("server.py", "_create_match_rule_core", "contacts", "find_one"),
    ("server.py", "_create_match_rule_core", "partners", "find_one"),
    ("server.py", "_execute_virman", "bank_accounts", "find_one"),
    ("server.py", "_execute_virman", "bank_accounts", "update_one"),
    ("server.py", "_execute_virman_contact", "bank_accounts", "find_one"),
    ("server.py", "_execute_virman_contact", "bank_accounts", "update_one"),
    ("server.py", "_execute_virman_contact", "bank_transactions", "insert_one"),
    ("server.py", "_execute_virman_contact", "contacts", "update_one"),
    ("server.py", "_unmatch", "bank_transactions", "find_one"),
    ("server.py", "_unmatch", "bonus_payments", "delete_one"),
    ("server.py", "_unmatch", "bonus_payments", "find_one"),
    ("server.py", "_unmatch", "contacts", "update_one"),
    ("server.py", "_unmatch", "expenses", "delete_one"),
    ("server.py", "_unmatch", "expenses", "find_one"),
    ("server.py", "_unmatch", "invoices", "find_one"),
    ("server.py", "_unmatch", "invoices", "update_one"),
    ("server.py", "_unmatch", "payrolls", "find_one"),
    ("server.py", "_unmatch", "payrolls", "update_one"),
    ("server.py", "_unmatch", "personnel_movements", "find_one"),
    ("server.py", "delete_match_rule", "bank_match_rules", "delete_one"),
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


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


def _row(db, coll, company_id, doc_id):
    for doc in db[coll].docs:
        if doc.get("_id") == doc_id and doc.get("company_id") == company_id:
            return doc
    return None


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
    prev = server.db
    server.db = db
    return prev


def _restore(prev):
    server.db = prev


def _account(company_id, doc_id, balance, name):
    return {
        "_id": doc_id,
        "company_id": company_id,
        "type": "bank",
        "account_name": name,
        "currency": "TRY",
        "current_balance": balance,
    }


def _contact(company_id, doc_id, balance, name):
    return {"_id": doc_id, "company_id": company_id, "name": name, "balance": balance}


def _tx(company_id, doc_id, *, account_id, amount=40.0, tx_type="outflow", **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "account_id": account_id,
        "account_name": "Hesap",
        "type": tx_type,
        "amount": amount,
        "currency": "TRY",
        "description": "HAVALE",
        "date": "2026-10-09",
        "match_status": "unmatched",
        "source": "bank_sync",
    }
    row.update(extra)
    return row


def _invoice(company_id, doc_id, *, paid, total, contact_id=None):
    return {
        "_id": doc_id,
        "company_id": company_id,
        "contact_id": contact_id,
        "invoice_number": "FTR-" + doc_id,
        "paid_amount": paid,
        "grand_total": total,
        "payment_status": "unpaid" if paid <= 0 else "partially_paid",
    }


def test_h3_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == len(set(_REMOVED))
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


def test_apply_match_rejects_foreign_contact_invoice_and_account():
    user_unused = _user(CO_A)
    assert user_unused["active_company_id"] == CO_A
    db = MemDB()
    _add(db, "bank_accounts", _account(CO_A, ACC_A, 1000.0, "HesapA"))
    _add(db, "bank_accounts", _account(CO_B, ACC_B, 4242.0, "HesapB"))
    _add(db, "contacts", _contact(CO_A, CONTACT_A, 90.0, "CariA"))
    _add(db, "contacts", _contact(CO_B, CONTACT_B, 777.0, "CariB"))
    _add(db, "invoices", _invoice(CO_B, INV_B, paid=80.0, total=80.0, contact_id=CONTACT_B))
    _add(db, "bank_transactions", _tx(CO_A, TX_A, account_id=ACC_A))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        tx = _row(db, "bank_transactions", CO_A, TX_A)
        with pytest.raises(HTTPException) as foreign_contact:
            _run(server._apply_match(copy.deepcopy(tx), CONTACT_B, None, None, learn=False))
        assert foreign_contact.value.status_code == 404
        assert foreign_contact.value.detail == "Cari bulunamadı."
        with pytest.raises(HTTPException) as foreign_invoice:
            _run(server._apply_match(copy.deepcopy(tx), None, INV_B, None, learn=False))
        assert foreign_invoice.value.status_code == 404
        assert foreign_invoice.value.detail == "Fatura bulunamadı."
        with pytest.raises(HTTPException) as foreign_account:
            _run(server._apply_match(copy.deepcopy(tx), None, None, None, learn=False, target_account_id=ACC_B))
        assert foreign_account.value.status_code == 404
        assert foreign_account.value.detail == "Hedef kasa/hesap bulunamadı."
        stored = _row(db, "bank_transactions", CO_A, TX_A)
        assert stored["match_status"] == "unmatched"
        assert "contact_id" not in stored
        assert _row(db, "contacts", CO_A, CONTACT_A)["balance"] == 90.0
        assert _row(db, "contacts", CO_B, CONTACT_B)["balance"] == 777.0
        assert _row(db, "invoices", CO_B, INV_B)["paid_amount"] == 80.0
        assert _row(db, "invoices", CO_B, INV_B)["payment_status"] == "partially_paid"
        assert _row(db, "bank_accounts", CO_A, ACC_A)["current_balance"] == 1000.0
        assert _row(db, "bank_accounts", CO_B, ACC_B)["current_balance"] == 4242.0
        assert len(db.bank_transactions.docs) == 1
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_apply_match_and_unmatch_stay_in_company():
    db = MemDB()
    _add(db, "bank_accounts", _account(CO_A, ACC_A, 1000.0, "HesapA"))
    _add(db, "contacts", _contact(CO_B, CONTACT_SHARED, 777.0, "CariB"))
    _add(db, "contacts", _contact(CO_A, CONTACT_SHARED, 90.0, "CariA"))
    _add(db, "invoices", _invoice(CO_B, INV_A, paid=80.0, total=80.0))
    _add(db, "invoices", _invoice(CO_A, INV_A, paid=0.0, total=100.0, contact_id=CONTACT_SHARED))
    _add(db, "bank_transactions", _tx(CO_A, TX_A, account_id=ACC_A, amount=25.0, tx_type="outflow"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        matched = _run(server._apply_match(
            copy.deepcopy(_row(db, "bank_transactions", CO_A, TX_A)),
            CONTACT_SHARED, INV_A, "Cari Ödeme", learn=False,
        ))
        assert matched["match_status"] == "matched"
        assert matched["company_id"] == CO_A
        assert matched["contact_id"] == CONTACT_SHARED
        assert matched["related_invoice_id"] == INV_A
        assert _row(db, "contacts", CO_A, CONTACT_SHARED)["balance"] == pytest.approx(115.0)
        assert _row(db, "invoices", CO_A, INV_A)["paid_amount"] == pytest.approx(25.0)
        assert _row(db, "invoices", CO_A, INV_A)["payment_status"] == "partially_paid"
        assert _row(db, "contacts", CO_B, CONTACT_SHARED)["balance"] == 777.0
        assert _row(db, "invoices", CO_B, INV_A)["paid_amount"] == 80.0
        fresh = copy.deepcopy(_row(db, "bank_transactions", CO_A, TX_A))
        out = _run(server._unmatch(fresh))
        assert out["match_status"] == "unmatched"
        assert out["company_id"] == CO_A
        assert _row(db, "contacts", CO_A, CONTACT_SHARED)["balance"] == pytest.approx(90.0)
        assert _row(db, "invoices", CO_A, INV_A)["paid_amount"] == pytest.approx(0.0)
        assert _row(db, "invoices", CO_A, INV_A)["payment_status"] == "unpaid"
        assert _row(db, "contacts", CO_B, CONTACT_SHARED)["balance"] == 777.0
        assert _row(db, "invoices", CO_B, INV_A)["paid_amount"] == 80.0
        assert _row(db, "bank_accounts", CO_A, ACC_A)["current_balance"] == 1000.0
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_salary_match_ignores_other_company_payroll():
    db = MemDB()
    _add(db, "employees", {
        "_id": EMP_A, "company_id": CO_A, "full_name": "Ayse",
    })
    _add(db, "payrolls", {
        "_id": PAY_B, "company_id": CO_B, "employee_id": EMP_A,
        "status": "unpaid", "final_payable": 20000.0, "net_salary": 20000.0,
    })
    _add(db, "payrolls", {
        "_id": PAY_A, "company_id": CO_A, "employee_id": EMP_A,
        "status": "unpaid", "final_payable": 20000.0, "net_salary": 20000.0,
    })
    _add(db, "bank_accounts", _account(CO_A, ACC_A, 50000.0, "HesapA"))
    _add(db, "bank_transactions", _tx(CO_A, TX_A, account_id=ACC_A, amount=20000.0))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server._apply_match(
            copy.deepcopy(_row(db, "bank_transactions", CO_A, TX_A)),
            None, None, "Personel", learn=False, as_expense=True,
            employee_id=EMP_A, personnel_pay_kind="salary",
        ))
        assert out["payroll_id"] == PAY_A
        assert _row(db, "payrolls", CO_A, PAY_A)["status"] == "paid"
        assert _row(db, "payrolls", CO_B, PAY_B)["status"] == "unpaid"
        assert "paid_date" not in _row(db, "payrolls", CO_B, PAY_B)
        fresh = copy.deepcopy(_row(db, "bank_transactions", CO_A, TX_A))
        _run(server._unmatch(fresh))
        assert _row(db, "payrolls", CO_A, PAY_A)["status"] == "unpaid"
        assert _row(db, "payrolls", CO_B, PAY_B)["status"] == "unpaid"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_virman_rejects_foreign_account_and_keeps_own_path():
    db = MemDB()
    _add(db, "bank_accounts", _account(CO_B, ACC_B, 4242.0, "HesapB"))
    _add(db, "bank_accounts", _account(CO_A, ACC_A, 1000.0, "HesapA"))
    _add(db, "bank_accounts", _account(CO_A, ACC_A2, 200.0, "KasaA"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        for source, target in ((ACC_B, ACC_A2), (ACC_A, ACC_B)):
            with pytest.raises(HTTPException) as exc:
                _run(server._execute_virman({
                    "company_id": CO_A,
                    "source_account_id": source,
                    "target_account_id": target,
                    "amount": 15,
                    "description": "yabanci",
                }))
            assert exc.value.status_code == 404
            assert exc.value.detail == "Kaynak veya hedef hesap bulunamadı."
        assert _row(db, "bank_accounts", CO_A, ACC_A)["current_balance"] == 1000.0
        assert _row(db, "bank_accounts", CO_A, ACC_A2)["current_balance"] == 200.0
        assert _row(db, "bank_accounts", CO_B, ACC_B)["current_balance"] == 4242.0
        assert db.bank_transactions.docs == []
        out = _run(server._execute_virman({
            "company_id": CO_A,
            "source_account_id": ACC_A,
            "target_account_id": ACC_A2,
            "amount": 15,
            "description": "kendi",
        }))
        assert out["status"] == "success"
        assert _row(db, "bank_accounts", CO_A, ACC_A)["current_balance"] == pytest.approx(985.0)
        assert _row(db, "bank_accounts", CO_A, ACC_A2)["current_balance"] == pytest.approx(215.0)
        assert _row(db, "bank_accounts", CO_B, ACC_B)["current_balance"] == 4242.0
        assert len(db.bank_transactions.docs) == 1
        assert db.bank_transactions.docs[0]["company_id"] == CO_A
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_virman_contact_rejects_foreign_ids():
    db = MemDB()
    _add(db, "bank_accounts", _account(CO_A, ACC_A, 1000.0, "HesapA"))
    _add(db, "bank_accounts", _account(CO_B, ACC_B, 4242.0, "HesapB"))
    _add(db, "contacts", _contact(CO_B, CONTACT_B, 777.0, "CariB"))
    _add(db, "contacts", _contact(CO_A, CONTACT_A, 90.0, "CariA"))
    prev = _bind(db)
    try:
        before_a = _digest(db, CO_A)
        before_b = _digest(db, CO_B)
        with pytest.raises(HTTPException) as foreign_contact:
            _run(server._execute_virman({
                "company_id": CO_A,
                "source_account_id": ACC_A,
                "target_account_id": "contact:" + CONTACT_B,
                "amount": 8,
                "description": "yabanci-cari",
            }))
        assert foreign_contact.value.status_code == 404
        assert foreign_contact.value.detail == "Cari hesap bulunamadı."
        with pytest.raises(HTTPException) as foreign_account:
            _run(server._execute_virman({
                "company_id": CO_A,
                "source_account_id": "contact:" + CONTACT_A,
                "target_account_id": ACC_B,
                "amount": 8,
                "description": "yabanci-hesap",
            }))
        assert foreign_account.value.status_code == 404
        assert foreign_account.value.detail == "Hedef hesap bulunamadı."
        assert _digest(db, CO_A) == before_a
        assert _digest(db, CO_B) == before_b
        out = _run(server._execute_virman({
            "company_id": CO_A,
            "source_account_id": ACC_A,
            "target_account_id": "contact:" + CONTACT_A,
            "amount": 8,
            "description": "kendi-cari",
        }))
        assert out["status"] == "success"
        assert _row(db, "bank_accounts", CO_A, ACC_A)["current_balance"] == pytest.approx(992.0)
        assert _row(db, "contacts", CO_A, CONTACT_A)["balance"] == pytest.approx(98.0)
        assert _row(db, "contacts", CO_B, CONTACT_B)["balance"] == 777.0
        assert _row(db, "bank_accounts", CO_B, ACC_B)["current_balance"] == 4242.0
        assert _digest(db, CO_B) == before_b
    finally:
        _restore(prev)


def test_integrated_balance_is_not_moved_by_manual_pay_or_match():
    db = MemDB()
    _add(db, "bank_accounts", _account(CO_A, ACC_INT, REPORTED, "Entegre"))
    _add(db, "bank_accounts", _account(CO_A, ACC_A2, 200.0, "KasaA"))
    _add(db, "bank_connections", {
        "_id": "conn-a",
        "company_id": CO_A,
        "linked_account_id": ACC_INT,
        "provider": "kuveytturk",
        "provider_name": "Banka",
    })
    _add(db, "contacts", _contact(CO_A, CONTACT_A, 10.0, "CariA"))
    _add(db, "bank_transactions", _tx(CO_A, TX_A, account_id=ACC_INT, amount=80.0))
    user = _user(CO_A)
    prev = _bind(db)
    try:
        with pytest.raises(HTTPException) as manual:
            _run(server.create_bank_transaction(BankTransaction(
                company_id=CO_A, account_id=ACC_INT, account_name="Entegre",
                type="outflow", category="Odeme", amount=50, description="manuel",
                contact_id=CONTACT_A,
            ), user))
        assert manual.value.status_code == 400
        assert _row(db, "bank_accounts", CO_A, ACC_INT)["current_balance"] == REPORTED
        assert _row(db, "contacts", CO_A, CONTACT_A)["balance"] == 10.0
        assert len(db.bank_transactions.docs) == 1

        with pytest.raises(HTTPException) as virman:
            _run(server._execute_virman({
                "company_id": CO_A,
                "source_account_id": ACC_INT,
                "target_account_id": ACC_A2,
                "amount": 20,
                "description": "entegre-virman",
            }))
        assert virman.value.status_code == 400
        assert _row(db, "bank_accounts", CO_A, ACC_INT)["current_balance"] == REPORTED
        assert _row(db, "bank_accounts", CO_A, ACC_A2)["current_balance"] == 200.0

        matched = _run(server._apply_match(
            copy.deepcopy(_row(db, "bank_transactions", CO_A, TX_A)),
            CONTACT_A, None, "Cari Ödeme", learn=False,
        ))
        assert matched["match_status"] == "matched"
        assert _row(db, "bank_accounts", CO_A, ACC_INT)["current_balance"] == REPORTED
        assert _row(db, "contacts", CO_A, CONTACT_A)["balance"] == pytest.approx(90.0)
        assert _row(db, "bank_accounts", CO_A, ACC_A2)["current_balance"] == 200.0
    finally:
        _restore(prev)


def test_match_rule_rejects_foreign_target_and_delete_stays():
    db = MemDB()
    _add(db, "contacts", _contact(CO_B, CONTACT_B, 777.0, "CariB"))
    _add(db, "contacts", _contact(CO_A, CONTACT_A, 90.0, "CariA"))
    _add(db, "bank_accounts", _account(CO_B, ACC_B, 4242.0, "HesapB"))
    _add(db, "bank_match_rules", {
        "_id": RULE_B, "company_id": CO_B, "pattern": "gizli", "hits": 3, "source": "manual",
    })
    user = _user(CO_A)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as foreign_contact:
            _run(server._create_match_rule_core(
                {"company_id": CO_A, "pattern": "havale", "contact_id": CONTACT_B},
                user,
            ))
        assert foreign_contact.value.status_code == 404
        assert foreign_contact.value.detail == "Cari bulunamadı."
        with pytest.raises(HTTPException) as foreign_account:
            _run(server._create_match_rule_core(
                {"company_id": CO_A, "pattern": "virman", "target_account_id": ACC_B},
                user,
            ))
        assert foreign_account.value.status_code == 404
        assert foreign_account.value.detail == "Hedef kasa/hesap bulunamadı."
        assert [doc["_id"] for doc in db.bank_match_rules.docs] == [RULE_B]
        with pytest.raises(HTTPException) as deleted:
            _run(server.delete_match_rule(RULE_B, user))
        assert deleted.value.status_code == 404
        assert deleted.value.detail == "Kural bulunamadı."
        assert _row(db, "bank_match_rules", CO_B, RULE_B)["hits"] == 3
        rules = db.bank_match_rules
        original_update = rules.update_one

        async def _update_one(query, update, upsert=False):
            result = await original_update(query, update, upsert=upsert)
            if upsert and not getattr(result, "matched_count", 0):
                created = new_upsert_doc(update, query)
                rules.docs.append(created)
                return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=created.get("_id"))
            return result

        rules.update_one = _update_one
        saved = _run(server._create_match_rule_core(
            {"company_id": CO_A, "pattern": "havale", "contact_id": CONTACT_A, "category": "Cari"},
            user,
        ))
        assert saved["contact_id"] == CONTACT_A
        assert saved["contact_name"] == "CariA"
        assert saved["company_id"] == CO_A
        assert _row(db, "contacts", CO_B, CONTACT_B)["balance"] == 777.0
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)
