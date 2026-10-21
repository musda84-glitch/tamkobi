"""Personel ödemesi, ortak hareketi ve bağlı hareket kiracı dalgası 9.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Değer, filtre, şirket kimliği, tutar veya belge içeriği loglanmaz.
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

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import employee_pay  # noqa: E402
import linked_moves  # noqa: E402
import partner_pay  # noqa: E402
import personnel_payments  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import trash  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"

_REMOVED = (
    ("personnel_payments.py", "_apply_payroll_payment", "payrolls", "find_one"),
    ("personnel_payments.py", "_apply_payroll_payment", "payrolls", "update_one_atomic"),
    ("personnel_payments.py", "_apply_reimburse", "expenses", "update_one"),
    ("personnel_payments.py", "_body", "personnel_movements", "delete_one"),
    ("personnel_payments.py", "_body", "personnel_receipts", "delete_one"),
    ("personnel_payments.py", "_cash_out", "bank_transactions", "delete_one"),
    ("personnel_payments.py", "_charge_personnel_account", "bonus_payments", "delete_one"),
    ("personnel_payments.py", "_cover_allowance", "expenses", "delete_one"),
    ("personnel_payments.py", "_cover_salary", "payrolls", "delete_one"),
    ("personnel_payments.py", "_cover_salary", "payrolls", "insert_one"),
    ("personnel_payments.py", "_ensure_reimburse_template", "expenses", "update_one"),
    ("personnel_payments.py", "_insert_advance", "bonus_payments", "delete_one"),
    ("personnel_payments.py", "_insert_reimburse_expense", "expenses", "delete_one"),
    ("personnel_payments.py", "_undo", "expenses", "update_one"),
    ("personnel_payments.py", "delete_bonus_record", "bonus_payments", "find_one"),
    ("personnel_payments.py", "month_occurrence_exists", "expenses", "find_one"),
    ("personnel_payments.py", "month_occurrence_exists", "personnel_movements", "find_one"),
    ("personnel_payments.py", "movements_linked_to", "personnel_movements", "find_one"),
    ("personnel_payments.py", "reverse_payment", "bank_transactions", "update_one"),
    ("personnel_payments.py", "reverse_payment", "idempotency_keys", "delete_one"),
    ("personnel_payments.py", "reverse_payment", "personnel_movements", "find_one"),
    ("personnel_payments.py", "reverse_payment", "personnel_movements", "update_one_atomic"),
    ("personnel_payments.py", "reverse_payment", "personnel_receipts", "update_one"),
    ("partner_pay.py", "move", "partner_transactions", "insert_one"),
    ("partner_pay.py", "move", "partners", "update_one"),
    ("partner_pay.py", "reverse_one", "partner_transactions", "delete_one"),
    ("partner_pay.py", "reverse_one", "partners", "update_one"),
    ("partner_pay.py", "sync_company_partners", "partners", "update_one"),
    ("partner_pay.py", "sync_partner_from_ledger", "partner_transactions", "find"),
    ("partner_pay.py", "sync_partner_from_ledger", "partners", "update_one"),
    ("employee_pay.py", "accrue_allowances", "employees", "find"),
    ("employee_pay.py", "accrue_allowances", "expenses", "find_one"),
    ("linked_moves.py", "_recalc_touched_accounts", "bank_accounts", "find_one"),
    ("linked_moves.py", "_write_reverse_bank_entry", "bank_transactions", "update_one"),
    ("linked_moves.py", "_write_reverse_bank_entry", "contacts", "update_one"),
    ("linked_moves.py", "find_linked", "bank_transactions", "find"),
    ("linked_moves.py", "find_linked", "expenses", "find"),
    ("linked_moves.py", "find_linked", "partner_transactions", "find"),
    ("linked_moves.py", "restore_linked_from_related", "partners", "update_one"),
    ("linked_moves.py", "reverse_applied_stock_count", "products", "find_one"),
    ("linked_moves.py", "reverse_applied_stock_count", "products", "update_one"),
    ("linked_moves.py", "reverse_applied_stock_count", "stock_movements", "insert_one"),
    ("linked_moves.py", "reverse_linked", "bank_transactions", "update_one"),
    ("linked_moves.py", "reverse_linked", "expenses", "update_one"),
    ("linked_moves.py", "reverse_linked", "partner_transactions", "update_one"),
    ("linked_moves.py", "reverse_linked", "partners", "update_one"),
    ("linked_moves.py", "reverse_stock_movements_for", "products", "update_one"),
    ("linked_moves.py", "reverse_stock_movements_for", "stock_movements", "find"),
    ("linked_moves.py", "undo_effects_keep_docs", "partners", "update_one"),
)

_KEPT = (
    ("employee_pay.py", "accrue_due_for_all_companies", "employees", "find"),
    ("employee_pay.py", "scheduler_loop", "employees", "find"),
    ("linked_moves.py", "list_isnet_missing_mode", "einvoice_settings", "find"),
)

_EMPTY_LINKED = {
    "bank_transactions": [],
    "partner_transactions": [],
    "cari_lines": [],
    "expenses": [],
}


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


class _Coll(MemColl):
    async def delete_one(self, query=None):
        from tenant_scope import check

        check(self.name, "delete_one", query=query)
        query = _split_field_ops(query or {})
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def update_one_atomic(self, query, update, upsert=False):
        from tenant_scope import check

        check(self.name, "update_one_atomic", query=query, update=update, upsert=upsert)
        query = _split_field_ops(query or {})
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                self.docs[index] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1, upserted_id=None)
        return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=None)


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


class _Boom:
    def __getattr__(self, name):
        raise AssertionError("db")

    def __getitem__(self, name):
        raise AssertionError("db")


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


def _doc(db, coll, doc_id, company_id):
    for row in db[coll].docs:
        if row.get("_id") == doc_id and row.get("company_id") == company_id:
            return row
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


def _seed(db):
    for cid, balance, stock in ((CO_A, 100.0, 10.0), (CO_B, 900.0, 40.0)):
        _add(db, "partners", {
            "_id": "partner-shared",
            "company_id": cid,
            "name": "Ortak",
            "balance": balance,
            "total_withdrawn": 0.0,
            "total_capital_in": 0.0,
            "total_profit_share": 0.0,
        })
        _add(db, "partner_transactions", {
            "_id": "ptx-shared",
            "company_id": cid,
            "partner_id": "partner-shared",
            "partner_name": "Ortak",
            "type": "withdrawal",
            "amount": 10.0,
        })
        _add(db, "payrolls", {
            "_id": "payroll-shared",
            "company_id": cid,
            "employee_id": "emp-shared",
            "status": "pending",
            "paid_amount": 0.0,
            "final_payable": 1000.0,
            "net_salary": 1000.0,
            "period": "2026-10",
        })
        _add(db, "expenses", {
            "_id": "exp-shared",
            "company_id": cid,
            "employee_id": "emp-shared",
            "payment_status": "unpaid",
            "total": 50.0,
            "amount": 50.0,
            "category": "Yemek",
            "allowance_period": "2026-10",
            "source": "employee_allowance",
        })
        _add(db, "bonus_payments", {
            "_id": "bonus-shared",
            "company_id": cid,
            "employee_id": "emp-shared",
            "employee_name": "Ali",
            "type": "bonus",
            "status": "paid",
            "amount": 20.0,
        })
        _add(db, "personnel_movements", {
            "_id": "mov-shared",
            "company_id": cid,
            "status": "posted",
            "cash_mode": "bank_match",
            "bank_transaction_id": "btx-shared",
            "idempotency_key": "idem-shared",
            "receipt_id": "rcpt-shared",
            "effects": [],
            "kind": "salary",
            "amount": 10.0,
        })
        _add(db, "personnel_receipts", {
            "_id": "rcpt-shared",
            "company_id": cid,
            "status": "issued",
        })
        _add(db, "bank_transactions", {
            "_id": "btx-shared",
            "company_id": cid,
            "account_id": "acct-shared",
            "type": "outflow",
            "amount": 10.0,
            "personnel_movement_id": "mov-shared",
            "contact_id": "contact-shared",
        })
        _add(db, "bank_accounts", {
            "_id": "acct-shared",
            "company_id": cid,
            "type": "bank",
            "current_balance": balance,
            "account_name": "Banka",
        })
        _add(db, "contacts", {
            "_id": "contact-shared",
            "company_id": cid,
            "name": "Cari",
            "balance": balance,
        })
        _add(db, "products", {
            "_id": "prod-shared",
            "company_id": cid,
            "name": "Urun",
            "stock": stock,
            "stock_quantity": stock,
        })
        _add(db, "idempotency_keys", {
            "_id": "idem-shared",
            "company_id": cid,
            "key": "idem-shared",
        })
        _add(db, "employees", {
            "_id": "emp-shared",
            "company_id": cid,
            "full_name": "Ali",
            "status": "active",
            "meal_allowance": 100.0,
            "transport_allowance": 0.0,
            "pay_start_date": "2026-10-05",
            "pay_day": 5,
            "pay_recurring": True,
        })
        _add(db, "stock_movements", {
            "_id": "sm-" + cid,
            "company_id": cid,
            "product_id": "prod-shared",
            "change": 1.0,
            "order_id": "ord-shared",
        })
    _add(db, "idempotency_keys", {
        "_id": f"{CO_A}:idem-shared",
        "company_id": CO_A,
        "key": "idem-shared",
    })
    _add(db, "idempotency_keys", {
        "_id": f"{CO_A}:idem-shared",
        "company_id": CO_B,
        "key": "idem-shared",
    })


def _ready(db):
    linked_moves.init(db, reverse_tx_fn=None)
    trash.init(db)
    return db


def test_helpers_without_company_do_not_write():
    db = _ready(_DB())
    _seed(db)
    before_a = _digest(db, CO_A)
    before_b = _digest(db, CO_B)

    async def run():
        linked = await linked_moves.find_linked(_Boom(), "payroll", "src", company_id=None)
        blank = await linked_moves.find_linked(_Boom(), "payroll", "src", company_id="")
        spaces = await linked_moves.find_linked(_Boom(), "payroll", "src", company_id="  ")
        stock_n = await linked_moves.reverse_stock_movements_for(db, order_id="ord-shared")
        count_n = await linked_moves.reverse_applied_stock_count(db, {
            "_id": "sc-shared",
            "company_id": "",
            "status": "completed",
            "applied": True,
            "items": [{"product_id": "prod-shared", "expected": 1, "counted": 4}],
        })
        accrued = await employee_pay.accrue_allowances(db, "")
        accrued_none = await employee_pay.accrue_allowances(db, None)
        synced = await partner_pay.sync_company_partners(db, "")
        synced_none = await partner_pay.sync_company_partners(db, None)
        await linked_moves._recalc_touched_accounts(db, [{"account_id": "acct-shared"}])
        await linked_moves._write_reverse_bank_entry(db, {"_id": "btx-shared", "amount": 10, "type": "outflow"}, "")
        return linked, blank, spaces, stock_n, count_n, accrued, accrued_none, synced, synced_none

    linked, blank, spaces, stock_n, count_n, accrued, accrued_none, synced, synced_none = _run(run())
    assert linked == _EMPTY_LINKED
    assert blank == _EMPTY_LINKED
    assert spaces == _EMPTY_LINKED
    assert stock_n == 0
    assert count_n == 0
    assert accrued["posted_count"] == 0
    assert accrued_none["posted_count"] == 0
    assert synced == []
    assert synced_none == []
    assert _digest(db, CO_A) == before_a
    assert _digest(db, CO_B) == before_b
    assert _user(CO_A)["active_company_id"] == CO_A


def test_reverse_payment_leaves_other_company_and_stays_idempotent():
    db = _ready(_DB())
    _seed(db)
    before_b = _digest(db, CO_B)
    mov = _doc(db, "personnel_movements", "mov-shared", CO_A)

    async def run():
        first = await personnel_payments.reverse_payment(db, mov)
        second = await personnel_payments.reverse_payment(db, mov)
        return first, second

    first, second = _run(run())
    assert first["idempotent"] is False
    assert first["status"] == "success"
    assert second["idempotent"] is True
    assert second["message"] == "Ödeme zaten geri alınmış."
    assert _doc(db, "personnel_movements", "mov-shared", CO_A)["status"] == "reversed"
    assert _doc(db, "personnel_movements", "mov-shared", CO_B)["status"] == "posted"
    assert _doc(db, "personnel_receipts", "rcpt-shared", CO_A)["status"] == "cancelled"
    assert _doc(db, "personnel_receipts", "rcpt-shared", CO_B)["status"] == "issued"
    assert _doc(db, "bank_transactions", "btx-shared", CO_A).get("personnel_movement_id") is None
    assert _doc(db, "bank_transactions", "btx-shared", CO_B)["personnel_movement_id"] == "mov-shared"
    assert _doc(db, "idempotency_keys", f"{CO_A}:idem-shared", CO_A) is None
    assert _doc(db, "idempotency_keys", f"{CO_A}:idem-shared", CO_B)["key"] == "idem-shared"
    assert _doc(db, "idempotency_keys", "idem-shared", CO_B)["key"] == "idem-shared"
    assert _doc(db, "payrolls", "payroll-shared", CO_B)["paid_amount"] == 0.0
    assert _doc(db, "bank_accounts", "acct-shared", CO_B)["current_balance"] == 900.0
    assert _digest(db, CO_B) == before_b


def test_delete_bonus_record_leaves_other_company():
    db = _ready(_DB())
    _seed(db)
    before_b = _digest(db, CO_B)
    bonus = _doc(db, "bonus_payments", "bonus-shared", CO_A)

    async def run():
        return await personnel_payments.delete_bonus_record(db, bonus)

    assert _run(run()) is True
    assert _doc(db, "bonus_payments", "bonus-shared", CO_A) is None
    assert _doc(db, "bonus_payments", "bonus-shared", CO_B)["status"] == "paid"
    assert _doc(db, "bonus_payments", "bonus-shared", CO_B)["amount"] == 20.0
    assert _digest(db, CO_B) == before_b


def test_partner_money_stays_in_company():
    db = _ready(_DB())
    _seed(db)
    before_b = _digest(db, CO_B)

    async def run():
        name = await partner_pay.move(db, CO_A, "partner-shared", 5, "withdrawal", "cekis")
        undone = await partner_pay.reverse_one(db, {"_id": "ptx-shared", "company_id": CO_A})
        _doc(db, "partners", "partner-shared", CO_A)["balance"] = 1.0
        synced = await partner_pay.sync_partner_from_ledger(db, "partner-shared", company_id=CO_A)
        company = await partner_pay.sync_company_partners(db, CO_A)
        return name, undone, synced, company

    name, undone, synced, company = _run(run())
    assert name == "Ortak"
    assert undone is True
    assert _doc(db, "partner_transactions", "ptx-shared", CO_A) is None
    assert _doc(db, "partner_transactions", "ptx-shared", CO_B)["amount"] == 10.0
    assert _doc(db, "partners", "partner-shared", CO_B)["balance"] == 900.0
    assert _doc(db, "partners", "partner-shared", CO_B)["total_withdrawn"] == 0.0
    assert synced["repaired"] is True
    assert company and company[0]["partner_id"] == "partner-shared"
    assert _doc(db, "partners", "partner-shared", CO_A)["balance"] != 900.0
    assert _digest(db, CO_B) == before_b


def test_accrue_allowances_does_not_read_other_company_expense():
    db = _ready(_DB())
    _seed(db)
    db.expenses.docs[:] = [row for row in db.expenses.docs if row.get("company_id") != CO_A]
    before_b = _digest(db, CO_B)

    async def run():
        return await employee_pay.accrue_allowances(
            db, CO_A, employee_id="emp-shared", as_of="2026-10-05", force_start=True,
        )

    result = _run(run())
    assert result["posted_count"] == 1
    created = [row for row in db.expenses.docs if row.get("company_id") == CO_A]
    assert len(created) == 1
    assert created[0]["category"] == "Yemek"
    assert _doc(db, "expenses", "exp-shared", CO_B)["total"] == 50.0
    assert _doc(db, "expenses", "exp-shared", CO_B)["payment_status"] == "unpaid"
    assert _digest(db, CO_B) == before_b


def test_linked_moves_do_not_touch_other_company():
    db = _ready(_DB())
    _seed(db)
    # server importu linked_moves.init ile süreç geneli MySQL kancası kurar.
    # Bu dosya o kancayı değil, db argümanındaki company_id filtrelerini ölçer.
    prev_fx = linked_moves._reverse_tx_effects
    linked_moves._reverse_tx_effects = None
    for cid in (CO_A, CO_B):
        row = _doc(db, "bank_transactions", "btx-shared", cid)
        row.update(linked_moves.link_fields("payroll", "payroll-shared"))
        ptx = _doc(db, "partner_transactions", "ptx-shared", cid)
        ptx.update(linked_moves.link_fields("payroll", "payroll-shared"))
        exp = _doc(db, "expenses", "exp-shared", cid)
        exp["loan_id"] = "loan-shared"
    before_b = _digest(db, CO_B)

    async def run():
        found = await linked_moves.find_linked(db, "payroll", "payroll-shared", company_id=CO_A)
        missing = await linked_moves.find_linked(db, "payroll", "payroll-shared", company_id=None)
        loan = await linked_moves.find_linked(db, "loan", "loan-shared", company_id=CO_A)
        rev = await linked_moves.reverse_linked(
            db, "payroll", "payroll-shared", mode="reverse", company_id=CO_A, reason="geri",
        )
        restored = await linked_moves.restore_linked_from_related(db, [{
            "collection": "partner_transactions",
            "docs": [copy.deepcopy(_doc(db, "partner_transactions", "ptx-shared", CO_A) or {
                "_id": "ptx-shared",
                "company_id": CO_A,
                "partner_id": "partner-shared",
                "type": "withdrawal",
                "amount": 10.0,
            })],
        }])
        await linked_moves.undo_effects_keep_docs(db, [{
            "collection": "partner_transactions",
            "docs": [{
                "_id": "ptx-shared",
                "company_id": CO_A,
                "partner_id": "partner-shared",
                "type": "withdrawal",
                "amount": 4.0,
            }],
        }])
        counted = await linked_moves.reverse_applied_stock_count(db, {
            "_id": "sc-shared",
            "company_id": CO_A,
            "status": "completed",
            "applied": True,
            "name": "Sayim",
            "items": [{
                "product_id": "prod-shared",
                "product_name": "Urun",
                "expected": 8,
                "counted": 10,
            }],
        })
        return found, missing, loan, rev, restored, counted

    try:
        found, missing, loan, rev, restored, counted = _run(run())
    finally:
        linked_moves._reverse_tx_effects = prev_fx
    assert {row["_id"] for row in found["bank_transactions"]} == {"btx-shared"}
    assert found["bank_transactions"][0]["company_id"] == CO_A
    assert missing == _EMPTY_LINKED
    assert {row["_id"] for row in loan["expenses"]} == {"exp-shared"}
    assert loan["expenses"][0]["company_id"] == CO_A
    assert rev["bank"] == 1
    assert rev["partner"] == 1
    assert restored["applied"] == 1
    assert counted == 1
    assert _doc(db, "products", "prod-shared", CO_A)["stock_quantity"] == 8.0
    assert _doc(db, "products", "prod-shared", CO_B)["stock"] == 40.0
    assert _doc(db, "products", "prod-shared", CO_B)["stock_quantity"] == 40.0
    assert _doc(db, "contacts", "contact-shared", CO_B)["balance"] == 900.0
    assert _doc(db, "partners", "partner-shared", CO_B)["balance"] == 900.0
    assert _doc(db, "bank_accounts", "acct-shared", CO_B)["current_balance"] == 900.0
    assert _doc(db, "expenses", "exp-shared", CO_B)["payment_status"] == "unpaid"
    assert _doc(db, "idempotency_keys", "idem-shared", CO_B)["key"] == "idem-shared"
    moves_b = [row for row in db.stock_movements.docs if row.get("company_id") == CO_B]
    assert len(moves_b) == 1
    assert _digest(db, CO_B) == before_b


def test_wave9_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 49
    assert len(_KEPT) == 3
    for key in _KEPT:
        assert key in base
    assert not any(key[0] == "server.py" for key in _REMOVED)
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "temiz" in proc.stdout
