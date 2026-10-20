"""Çek/senet, masraf ve vergi yükümlülüğü kiracı dalgası 8. Bellek içi MemDB.

Canlı veritabanına, 8021'deki sunucuya ve ağa bağlanmaz.
LLM/OCR çıkarımı sahte. Değer, filtre, şirket kimliği veya kayıt içeriği loglanmaz.
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

import cheques  # noqa: E402
import expenses  # noqa: E402
import tax_obligations  # noqa: E402
import tenant_scope  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import trash  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
CHEQUE = "cheque-shared"
EXP = "exp-shared"
OB = "ob-shared"
TAXDOC = "taxdoc-shared"
CONTACT = "contact-shared"
ACCT = "acct-shared"
INST = "inst-shared"
ENDORSE = "contact-endorse"
EMP = "emp-shared"

_REMOVED = (
    ("cheques.py", "_append_event", "cheques", "update_one"),
    ("cheques.py", "_apply_contact", "contacts", "update_one"),
    ("cheques.py", "_cancel_cheque_core", "cheques", "find_one"),
    ("cheques.py", "_cancel_cheque_core", "cheques", "update_one"),
    ("cheques.py", "_refresh_contact_cheque", "cheques", "find"),
    ("cheques.py", "_refresh_contact_cheque", "contacts", "update_one"),
    ("cheques.py", "_unwind_bank", "bank_accounts", "update_one"),
    ("cheques.py", "_unwind_bank", "bank_transactions", "delete_one"),
    ("cheques.py", "_unwind_bank", "bank_transactions", "find"),
    ("cheques.py", "bounce_cheque", "cheques", "find_one"),
    ("cheques.py", "bounce_cheque", "cheques", "update_one"),
    ("cheques.py", "collect_cheque", "cheques", "find_one"),
    ("cheques.py", "collect_cheque", "cheques", "update_one"),
    ("cheques.py", "create_cheque", "cheques", "find_one"),
    ("cheques.py", "create_promissory_for_installments", "installments", "update_one"),
    ("cheques.py", "delete_cheque", "bank_transactions", "find"),
    ("cheques.py", "endorse_cheque", "cheques", "find_one"),
    ("cheques.py", "endorse_cheque", "cheques", "update_one"),
    ("cheques.py", "pay_issued_cheque", "cheques", "find_one"),
    ("cheques.py", "pay_issued_cheque", "cheques", "update_one"),
    ("cheques.py", "restore_cheque", "bank_transactions", "find_one"),
    ("cheques.py", "update_cheque", "cheques", "find_one"),
    ("cheques.py", "update_cheque", "cheques", "update_one"),
    ("expenses.py", "_pay_expense_core", "expenses", "find_one"),
    ("expenses.py", "_pay_expense_core", "expenses", "update_one"),
    ("expenses.py", "_post_payment", "bank_accounts", "find_one"),
    ("expenses.py", "_post_payment", "bank_accounts", "update_one"),
    ("expenses.py", "_reverse_payment", "bank_accounts", "update_one"),
    ("expenses.py", "_reverse_payment", "bank_transactions", "delete_one"),
    ("expenses.py", "_reverse_payment", "bank_transactions", "find_one"),
    ("expenses.py", "_reverse_payment", "contacts", "update_one"),
    ("expenses.py", "_unpay_expense_core", "expenses", "find_one"),
    ("expenses.py", "_unpay_expense_core", "expenses", "update_one"),
    ("expenses.py", "create_expense_for_company", "contacts", "find_one"),
    ("expenses.py", "create_expense_for_company", "employees", "find_one"),
    ("expenses.py", "create_expense_for_company", "expenses", "insert_one"),
    ("expenses.py", "create_expense_for_company", "expenses", "update_one"),
    ("expenses.py", "create_tax_payable_expense", "expenses", "insert_one"),
    ("expenses.py", "delete_expense", "partner_transactions", "find_one"),
    ("expenses.py", "record_card_spend", "contacts", "find_one"),
    ("expenses.py", "record_card_spend", "expenses", "insert_one"),
    ("expenses.py", "run_recurring_for_company", "expenses", "find_one"),
    ("expenses.py", "run_recurring_for_company", "expenses", "insert_one"),
    ("expenses.py", "run_recurring_for_company", "expenses", "update_one"),
    ("expenses.py", "update_expense", "contacts", "find_one"),
    ("expenses.py", "update_expense", "employees", "find_one"),
    ("expenses.py", "update_expense", "expenses", "find_one"),
    ("expenses.py", "update_expense", "expenses", "update_one"),
    ("tax_obligations.py", "_delete_linked_expense", "expenses", "delete_one"),
    ("tax_obligations.py", "_delete_linked_expense", "expenses", "find_one"),
    ("tax_obligations.py", "_ensure_expense", "expenses", "find_one"),
    ("tax_obligations.py", "_ensure_expense", "tax_obligations", "update_one"),
    ("tax_obligations.py", "_import_tax_doc_core", "tax_documents", "find_one"),
    ("tax_obligations.py", "_import_tax_doc_core", "tax_documents", "insert_one"),
    ("tax_obligations.py", "_import_tax_doc_core", "tax_documents", "update_one"),
    ("tax_obligations.py", "_import_tax_doc_core", "tax_obligations", "update_one"),
    ("tax_obligations.py", "_reverse_legacy_bank", "bank_accounts", "update_one"),
    ("tax_obligations.py", "_reverse_legacy_bank", "bank_transactions", "delete_one"),
    ("tax_obligations.py", "_reverse_legacy_bank", "bank_transactions", "find_one"),
    ("tax_obligations.py", "delete_tax_document", "tax_documents", "delete_one"),
    ("tax_obligations.py", "delete_tax_document", "tax_obligations", "delete_one"),
    ("tax_obligations.py", "delete_tax_document", "tax_obligations", "find"),
    ("tax_obligations.py", "delete_tax_obligation", "tax_obligations", "delete_one"),
    ("tax_obligations.py", "pay_tax_obligation", "tax_obligations", "find_one"),
    ("tax_obligations.py", "pay_tax_obligation", "tax_obligations", "update_one"),
    ("tax_obligations.py", "persist_extracted_document", "tax_documents", "find_one"),
    ("tax_obligations.py", "persist_extracted_document", "tax_documents", "insert_one"),
    ("tax_obligations.py", "persist_extracted_document", "tax_documents", "update_one"),
    ("tax_obligations.py", "unpay_tax_obligation", "tax_obligations", "find_one"),
    ("tax_obligations.py", "unpay_tax_obligation", "tax_obligations", "update_one"),
)
_KEPT = ("cheques.py", "cancel_promissory_for_installments", "cheques", "find")
_PROMISSORY_NOTE = (
    "# tenant-ok değil: id listesi server.py _cancel_promissory_for_query (company_id'li sorgu) "
    "sonucundan gelir; server.py taksit PR'ında company_id kwarg ile kapanacak."
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


class _Coll(MemColl):
    async def update_one(self, query, update, upsert=False):
        result = await super().update_one(query, update, upsert=False)
        if result.matched_count or not upsert:
            return result
        doc = new_upsert_doc(update, query)
        self.docs.append(doc)
        return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=doc.get("_id"))

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        tenant_scope.check(self.name, "find_one_and_update", query=query, update=update, upsert=upsert)
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                before = copy.deepcopy(doc)
                self.docs[i] = apply_update(doc, update, query)
                found = self.docs[i] if return_document else before
                return copy.deepcopy(found)
        if not upsert:
            return None
        doc = new_upsert_doc(update, query)
        self.docs.append(doc)
        return copy.deepcopy(doc) if return_document else None

    async def delete_one(self, query=None):
        tenant_scope.check(self.name, "delete_one", query=query)
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[i]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query=None):
        tenant_scope.check(self.name, "delete_many", query=query)
        query = _split_field_ops(query or {})
        kept = []
        removed = 0
        for doc in self.docs:
            if match_query(doc, query):
                removed += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=removed)


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


class _Upload:
    filename = "kdv.pdf"
    content_type = "application/pdf"

    async def read(self):
        return b"%PDF-1.4"


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


def _bind(db):
    prev = (cheques._db, expenses._db, tax_obligations._db, trash._db)
    cheques.init(db)
    expenses.init(db)
    tax_obligations.init(db)
    trash.init(db)
    return prev


def _unbind(prev):
    cheques._db, expenses._db, tax_obligations._db, trash._db = prev


def _contact(company_id, name, balance):
    return {
        "_id": CONTACT,
        "company_id": company_id,
        "name": name,
        "balance": balance,
        "cheque_bond_balance": balance,
    }


def _account(company_id, balance):
    return {
        "_id": ACCT,
        "company_id": company_id,
        "type": "cash_box",
        "account_name": "Kasa",
        "currency": "TRY",
        "current_balance": balance,
    }


def _cheque(company_id, *, direction="received", amount=250.0, status="open", number="CK"):
    return {
        "_id": CHEQUE,
        "company_id": company_id,
        "number": number,
        "instrument": "cheque",
        "direction": direction,
        "status": status,
        "contact_id": CONTACT,
        "contact_name": "Cari",
        "amount": amount,
        "currency": "TRY",
        "issue_date": "2026-01-01",
        "due_date": "2026-02-01",
        "skip_ledger": False,
        "events": [],
    }


def _tx(company_id, doc_id, **extra):
    doc = {
        "_id": doc_id,
        "company_id": company_id,
        "account_id": ACCT,
        "type": "inflow",
        "amount": 40.0,
        "cheque_id": CHEQUE,
        "cheque_kind": "bank",
        "date": "2026-01-02",
    }
    doc.update(extra)
    return doc


def _expense(company_id, *, status="unpaid", total=100.0, **extra):
    doc = {
        "_id": EXP,
        "company_id": company_id,
        "expense_number": "MSR-1",
        "date": "2026-01-15",
        "category": "Kira",
        "description": "Masraf",
        "amount": total,
        "vat_rate": 0,
        "vat_amount": 0,
        "total": total,
        "currency": "TRY",
        "fx_rate": 1.0,
        "payment_status": status,
        "contact_id": CONTACT,
        "employee_id": EMP,
    }
    doc.update(extra)
    return doc


def _obligation(company_id, *, status="unpaid", amount=50.0, **extra):
    doc = {
        "_id": OB,
        "company_id": company_id,
        "payment_status": status,
        "amount": amount,
        "title": "KDV",
        "kind": "kdv",
        "document_id": TAXDOC,
        "due_date": "2026-02-26",
        "period": "2026-01",
    }
    doc.update(extra)
    return doc


def _taxdoc(company_id, filename):
    return {
        "_id": TAXDOC,
        "company_id": company_id,
        "filename": filename,
        "status": "imported",
        "source_kind": "tahakkuk",
    }


def _pair_money(db):
    """İlgili satırlarda B önce: kapsamsız ilk eşleşme B'yi vurur."""
    _add(db, "contacts", _contact(CO_B, "Cari B", 500.0))
    _add(db, "contacts", _contact(CO_A, "Cari A", 100.0))
    _add(db, "contacts", {"_id": ENDORSE, "company_id": CO_B, "name": "Ciro B", "balance": 800.0, "cheque_bond_balance": 3.0})
    _add(db, "contacts", {"_id": ENDORSE, "company_id": CO_A, "name": "Ciro A", "balance": 20.0, "cheque_bond_balance": 1.0})
    _add(db, "bank_accounts", _account(CO_B, 9000.0))
    _add(db, "bank_accounts", _account(CO_A, 1000.0))
    _add(db, "employees", {"_id": EMP, "company_id": CO_B, "full_name": "Emp B"})
    _add(db, "employees", {"_id": EMP, "company_id": CO_A, "full_name": "Emp A"})


def _guard(db, before, changed):
    assert changed
    assert _digest(db, CO_B) == before
    assert _doc(db, "contacts", CONTACT, CO_B)["balance"] == 500.0
    assert _doc(db, "bank_accounts", ACCT, CO_B)["current_balance"] == 9000.0


def test_cheque_actions_leave_other_company():
    user = _user(CO_A)
    cases = (
        ("collect", lambda: cheques.collect_cheque(CHEQUE, {"account_id": ACCT}, user), "received", "collected"),
        ("pay", lambda: cheques.pay_issued_cheque(CHEQUE, {"account_id": ACCT}, user), "issued", "paid"),
        ("endorse", lambda: cheques.endorse_cheque(CHEQUE, {"contact_id": ENDORSE}, user), "received", "endorsed"),
        ("bounce", lambda: cheques.bounce_cheque(CHEQUE, {"reason": "k"}, user), "received", "bounced"),
        ("cancel", lambda: cheques.cancel_cheque(CHEQUE, {"reason": "i"}, user), "received", "cancelled"),
        ("delete", lambda: cheques.delete_cheque(CHEQUE, user), "received", None),
        ("update", lambda: cheques.update_cheque(CHEQUE, {"amount": 80, "notes": "d"}, user), "received", "open"),
    )
    for name, call, direction, expect in cases:
        db = _DB()
        _pair_money(db)
        _add(db, "bank_transactions", _tx(CO_B, "tx-b"))
        _add(db, "bank_transactions", _tx(CO_A, "tx-a"))
        _add(db, "cheques", _cheque(CO_A, direction=direction, amount=250.0, number="A"))
        _add(db, "cheques", _cheque(CO_B, direction=direction, amount=777.0, number="B"))
        prev = _bind(db)
        try:
            before = _digest(db, CO_B)
            result = _run(call())
        finally:
            _unbind(prev)
        if name == "delete":
            assert result["status"] == "success"
            assert _doc(db, "cheques", CHEQUE, CO_A) is None
            assert _doc(db, "bank_transactions", "tx-b", CO_B)["amount"] == 40.0
        elif name == "update":
            assert result["amount"] == 80
            assert result["company_id"] == CO_A
        else:
            assert result["status"] == expect
            assert result["company_id"] == CO_A
        assert _doc(db, "cheques", CHEQUE, CO_B)["amount"] == 777.0
        assert _doc(db, "cheques", CHEQUE, CO_B)["status"] == "open"
        _guard(db, before, True)


def test_cheque_other_company_rejected():
    db = _DB()
    _pair_money(db)
    _add(db, "cheques", _cheque(CO_B, amount=777.0, number="B"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        user = _user(CO_A)
        calls = (
            cheques.collect_cheque(CHEQUE, {"account_id": ACCT}, user),
            cheques.pay_issued_cheque(CHEQUE, {"account_id": ACCT}, user),
            cheques.endorse_cheque(CHEQUE, {"contact_id": ENDORSE}, user),
            cheques.bounce_cheque(CHEQUE, {}, user),
            cheques.cancel_cheque(CHEQUE, {}, user),
            cheques.delete_cheque(CHEQUE, user),
            cheques.update_cheque(CHEQUE, {"notes": "x"}, user),
        )

        async def run():
            for call in calls:
                with pytest.raises(HTTPException) as exc:
                    await call
                assert exc.value.status_code == 404
                assert exc.value.detail == "Çek/senet bulunamadı."

        _run(run())
        assert _digest(db, CO_B) == before
    finally:
        _unbind(prev)


def test_expense_actions_leave_other_company():
    user = _user(CO_A)

    db = _DB()
    _pair_money(db)
    _add(db, "expenses", _expense(CO_A, total=100.0))
    _add(db, "expenses", _expense(CO_B, total=640.0))
    _add(db, "partner_transactions", {"_id": "ptx-b", "company_id": CO_B, "expense_id": EXP, "amount": 640.0, "type": "credit", "partner_id": "p-b"})
    _add(db, "partners", {"_id": "p-b", "company_id": CO_B, "name": "Ortak B"})
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        updated = _run(expenses.update_expense(EXP, {"description": "A not", "contact_id": CONTACT, "employee_id": EMP}, user))
        paid = _run(expenses.pay_expense(EXP, {"account_id": ACCT, "date": "2026-02-01"}, user))
        assert updated["description"] == "A not"
        assert updated["contact_name"] == "Cari A"
        assert updated["employee_name"] == "Emp A"
        assert paid["payment_status"] == "paid"
        assert paid["company_id"] == CO_A
        _guard(db, before, True)
        assert _doc(db, "expenses", EXP, CO_B)["total"] == 640.0
        assert _doc(db, "expenses", EXP, CO_B)["payment_status"] == "unpaid"
        assert _doc(db, "partner_transactions", "ptx-b", CO_B)["amount"] == 640.0
    finally:
        _unbind(prev)

    db = _DB()
    _pair_money(db)
    _add(db, "bank_transactions", _tx(CO_B, "tx-exp-b", expense_id=EXP, cheque_id=None, amount=80.0, type="outflow"))
    _add(db, "bank_transactions", _tx(CO_A, "tx-exp-a", expense_id=EXP, cheque_id=None, amount=100.0, type="outflow"))
    _add(db, "expenses", _expense(CO_A, status="paid", total=100.0, account_id=ACCT))
    _add(db, "expenses", _expense(CO_B, status="paid", total=640.0, account_id=ACCT))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        unpaid = _run(expenses.unpay_expense(EXP, user))
        assert unpaid["payment_status"] == "unpaid"
        assert _doc(db, "bank_transactions", "tx-exp-a", CO_A) is None
        assert _doc(db, "bank_transactions", "tx-exp-b", CO_B)["amount"] == 80.0
        _guard(db, before, True)
        assert _doc(db, "expenses", EXP, CO_B)["payment_status"] == "paid"
    finally:
        _unbind(prev)

    db = _DB()
    _pair_money(db)
    _add(db, "expenses", _expense(CO_A, total=100.0))
    _add(db, "expenses", _expense(CO_B, total=640.0))
    _add(db, "partner_transactions", {"_id": "ptx-b", "company_id": CO_B, "expense_id": EXP, "amount": 640.0, "type": "credit", "partner_id": "p-b"})
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        deleted = _run(expenses.delete_expense(EXP, user))
        assert deleted["status"] == "success"
        assert _doc(db, "expenses", EXP, CO_A) is None
        assert _doc(db, "expenses", EXP, CO_B)["total"] == 640.0
        assert _doc(db, "partner_transactions", "ptx-b", CO_B)["amount"] == 640.0
        _guard(db, before, True)
    finally:
        _unbind(prev)


def test_expense_other_company_rejected():
    db = _DB()
    _pair_money(db)
    _add(db, "expenses", _expense(CO_B, status="paid", total=640.0, account_id=ACCT))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        user = _user(CO_A)

        async def run():
            with pytest.raises(HTTPException) as pay:
                await expenses.pay_expense(EXP, {"account_id": ACCT}, user)
            with pytest.raises(HTTPException) as unpay:
                await expenses.unpay_expense(EXP, user)
            with pytest.raises(HTTPException) as upd:
                await expenses.update_expense(EXP, {"description": "yok"}, user)
            with pytest.raises(HTTPException) as delete:
                await expenses.delete_expense(EXP, user)
            return pay.value, unpay.value, upd.value, delete.value

        errors = _run(run())
        for err in errors:
            assert err.status_code == 404
            assert err.detail == "Masraf bulunamadı."
        assert _digest(db, CO_B) == before
    finally:
        _unbind(prev)


def test_tax_actions_leave_other_company(monkeypatch):
    user = _user(CO_A)

    async def _fake_extract(*_args, **_kwargs):
        return {
            "source": "fake",
            "draft": {
                "document_id": TAXDOC,
                "source_kind": "tahakkuk",
                "period": "2026-01",
                "filename": "kdv.pdf",
                "obligations": [{"kind": "kdv", "title": "KDV", "amount": 15, "period": "2026-01"}],
            },
        }

    monkeypatch.setattr(tax_obligations, "extract_tax_file", _fake_extract)

    db = _DB()
    _pair_money(db)
    _add(db, "tax_documents", _taxdoc(CO_B, "b.pdf"))
    _add(db, "tax_obligations", _obligation(CO_B, amount=900.0))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        extracted = _run(tax_obligations.extract_tax_doc(_Upload(), company_id=CO_A, user=user))
        imported = _run(tax_obligations._import_tax_doc_core({
            "company_id": CO_A,
            "draft": {
                "document_id": TAXDOC,
                "source_kind": "tahakkuk",
                "period": "2026-01",
                "filename": "a.pdf",
                "obligations": [{"kind": "kdv", "title": "KDV A", "amount": 15, "period": "2026-01", "due_date": "2026-02-26"}],
            },
        }, user))
        assert extracted["company_id"] == CO_A
        assert extracted["document"]["filename"] == "kdv.pdf"
        assert imported["obligations"][0]["company_id"] == CO_A
        assert _doc(db, "tax_documents", TAXDOC, CO_B)["filename"] == "b.pdf"
        assert _doc(db, "tax_obligations", OB, CO_B)["amount"] == 900.0
        _guard(db, before, True)
    finally:
        _unbind(prev)

    db = _DB()
    _pair_money(db)
    _add(db, "tax_obligations", _obligation(CO_A, amount=50.0))
    _add(db, "tax_obligations", _obligation(CO_B, amount=900.0))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        paid = _run(tax_obligations.pay_tax_obligation(OB, {"account_id": ACCT, "date": "2026-02-02"}, user))
        assert paid["payment_status"] == "paid"
        assert paid["company_id"] == CO_A
        assert _doc(db, "tax_obligations", OB, CO_B)["payment_status"] == "unpaid"
        assert _doc(db, "bank_accounts", ACCT, CO_A)["current_balance"] == 950.0
        _guard(db, before, True)
    finally:
        _unbind(prev)

    db = _DB()
    _pair_money(db)
    _add(db, "bank_transactions", _tx(CO_B, "tx-tax-b", tax_obligation_id=OB, cheque_id=None, amount=30.0))
    _add(db, "bank_transactions", _tx(CO_A, "tx-tax-a", tax_obligation_id=OB, cheque_id=None, amount=20.0))
    _add(db, "tax_obligations", _obligation(CO_A, status="paid", amount=20.0))
    _add(db, "tax_obligations", _obligation(CO_B, status="paid", amount=30.0))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        unpaid = _run(tax_obligations.unpay_tax_obligation(OB, user))
        assert unpaid["payment_status"] == "unpaid"
        assert _doc(db, "bank_transactions", "tx-tax-b", CO_B)["amount"] == 30.0
        assert _doc(db, "tax_obligations", OB, CO_B)["payment_status"] == "paid"
        _guard(db, before, True)
    finally:
        _unbind(prev)

    db = _DB()
    _pair_money(db)
    _add(db, "expenses", _expense(CO_A, status="paid", total=25.0, account_id=ACCT))
    _add(db, "expenses", _expense(CO_B, status="paid", total=40.0))
    _add(db, "bank_transactions", _tx(CO_B, "tx-ob-b", expense_id=EXP, cheque_id=None, amount=40.0, type="outflow"))
    _add(db, "bank_transactions", _tx(CO_A, "tx-ob-a", expense_id=EXP, cheque_id=None, amount=25.0, type="outflow"))
    _add(db, "tax_obligations", _obligation(CO_A, status="paid", expense_id=EXP))
    _add(db, "tax_obligations", _obligation(CO_B, status="paid", expense_id=EXP))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        unpaid = _run(tax_obligations.unpay_tax_obligation(OB, user))
        assert unpaid["payment_status"] == "unpaid"
        assert _doc(db, "expenses", EXP, CO_B)["payment_status"] == "paid"
        assert _doc(db, "bank_transactions", "tx-ob-b", CO_B)["amount"] == 40.0
        _guard(db, before, True)
    finally:
        _unbind(prev)

    db = _DB()
    _pair_money(db)
    _add(db, "expenses", _expense(CO_B, total=40.0))
    _add(db, "expenses", _expense(CO_A, total=25.0))
    _add(db, "tax_obligations", _obligation(CO_A, expense_id=EXP))
    _add(db, "tax_obligations", _obligation(CO_B, expense_id=EXP))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        deleted = _run(tax_obligations.delete_tax_obligation(OB, user))
        assert deleted == {"ok": True}
        assert _doc(db, "tax_obligations", OB, CO_A) is None
        assert _doc(db, "expenses", EXP, CO_A) is None
        assert _doc(db, "tax_obligations", OB, CO_B)["amount"] == 50.0
        assert _doc(db, "expenses", EXP, CO_B)["total"] == 40.0
        _guard(db, before, True)
    finally:
        _unbind(prev)

    db = _DB()
    _pair_money(db)
    _add(db, "expenses", _expense(CO_B, total=40.0, _id="exp-b"))
    _add(db, "expenses", _expense(CO_A, total=25.0, _id="exp-a"))
    _add(db, "tax_documents", _taxdoc(CO_A, "a.pdf"))
    _add(db, "tax_documents", _taxdoc(CO_B, "b.pdf"))
    _add(db, "tax_obligations", _obligation(CO_A, expense_id="exp-a", _id="ob-a"))
    _add(db, "tax_obligations", _obligation(CO_B, expense_id="exp-b", amount=900.0))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        deleted = _run(tax_obligations.delete_tax_document(TAXDOC, user))
        assert deleted["ok"] is True
        assert deleted["deleted_obligations"] == 1
        assert _doc(db, "tax_documents", TAXDOC, CO_A) is None
        assert _doc(db, "tax_documents", TAXDOC, CO_B)["filename"] == "b.pdf"
        assert _doc(db, "tax_obligations", OB, CO_B)["amount"] == 900.0
        assert _doc(db, "expenses", "exp-b", CO_B)["total"] == 40.0
        _guard(db, before, True)
    finally:
        _unbind(prev)


def test_tax_other_company_rejected():
    db = _DB()
    _pair_money(db)
    _add(db, "tax_obligations", _obligation(CO_B, status="paid", amount=900.0))
    _add(db, "tax_documents", _taxdoc(CO_B, "b.pdf"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        user = _user(CO_A)

        async def run():
            with pytest.raises(HTTPException) as pay:
                await tax_obligations.pay_tax_obligation(OB, {"account_id": ACCT}, user)
            with pytest.raises(HTTPException) as unpay:
                await tax_obligations.unpay_tax_obligation(OB, user)
            with pytest.raises(HTTPException) as delete_ob:
                await tax_obligations.delete_tax_obligation(OB, user)
            with pytest.raises(HTTPException) as delete_doc:
                await tax_obligations.delete_tax_document(TAXDOC, user)
            return pay.value, unpay.value, delete_ob.value, delete_doc.value

        pay, unpay, delete_ob, delete_doc = _run(run())
        assert pay.status_code == 404 and pay.detail == "Yükümlülük bulunamadı."
        assert unpay.status_code == 404 and unpay.detail == "Yükümlülük bulunamadı."
        assert delete_ob.status_code == 404 and delete_ob.detail == "Yükümlülük bulunamadı."
        assert delete_doc.status_code == 404 and delete_doc.detail == "Belge bulunamadı."
        assert _digest(db, CO_B) == before
    finally:
        _unbind(prev)


def test_blank_company_helpers_do_not_write():
    boom = _Boom()
    prev = _bind(boom)
    try:
        async def run():
            await cheques._refresh_contact_cheque(CONTACT, company_id="")
            await cheques._refresh_contact_cheque(CONTACT, company_id=None)
            await cheques._apply_contact(CONTACT, 12.0, company_id="")
            await cheques._apply_contact(CONTACT, 12.0, company_id=None)
            await cheques._unwind_bank(CHEQUE, company_id="")
            await cheques._unwind_bank(CHEQUE, company_id=None)
            await cheques._append_event(CHEQUE, "created", company_id="")
            await cheques._append_event(CHEQUE, "created", company_id=None)
            await cheques.restore_cheque({"_id": CHEQUE, "status": "open", "amount": 5, "direction": "received", "contact_id": CONTACT}, [])
            await expenses._reverse_payment({"_id": EXP}, company_id="")
            await expenses._reverse_payment({"_id": EXP}, company_id=None)
            posted = await expenses._post_payment({"_id": EXP, "total": 10, "expense_number": "MSR"}, ACCT, "2026-01-01")
            card = await expenses.record_card_spend("", date="2026-01-01", category="Kira", description="x", amount=10, account_id=ACCT, contact_id=CONTACT)
            card_none = await expenses.record_card_spend(None, date="2026-01-01", category="Kira", description="x", amount=10, account_id=ACCT)
            recurring = await expenses.run_recurring_for_company("", db=boom)
            recurring_none = await expenses.run_recurring_for_company(None, db=boom)
            notes = await cheques.create_promissory_for_installments([
                {"_id": INST, "no": 1, "amount": 40, "direction": "receivable", "contact_id": CONTACT},
            ])
            with pytest.raises(HTTPException) as missing:
                await cheques._cancel_cheque_core(CHEQUE)
            with pytest.raises(HTTPException) as blank_doc:
                await cheques._cancel_cheque_core(CHEQUE, doc={"_id": CHEQUE, "company_id": "", "status": "open", "amount": 1, "direction": "received"})
            return posted, card, card_none, recurring, recurring_none, notes, missing.value, blank_doc.value

        posted, card, card_none, recurring, recurring_none, notes, missing, blank_doc = _run(run())
    finally:
        _unbind(prev)
    assert posted is None
    assert card == {}
    assert card_none == {}
    assert recurring["created"] == []
    assert recurring["message"] == "0 tekrarlayan masraf oluşturuldu."
    assert recurring_none["created"] == []
    assert notes == []
    assert missing.status_code == 404
    assert missing.detail == "Çek/senet bulunamadı."
    assert blank_doc.status_code == 404
    assert blank_doc.detail == "Çek/senet bulunamadı."


def test_promissory_skips_blank_and_other_company():
    db = _DB()
    _add(db, "contacts", _contact(CO_A, "Cari A", 100.0))
    _add(db, "installments", {
        "_id": INST, "company_id": CO_B, "no": 1, "amount": 999, "direction": "receivable",
        "contact_id": CONTACT, "due_date": "2026-04-01", "cheque_id": "keep-b",
    })
    _add(db, "installments", {
        "_id": "inst-blank", "no": 2, "amount": 50, "direction": "receivable", "contact_id": CONTACT,
    })
    _add(db, "installments", {
        "_id": INST, "company_id": CO_A, "no": 1, "amount": 100, "direction": "receivable",
        "contact_id": CONTACT, "contact_name": "Cari A", "due_date": "2026-03-01", "invoice_number": "FTR-A",
    })
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        notes = _run(cheques.create_promissory_for_installments([
            {"_id": "inst-blank", "no": 2, "amount": 50, "direction": "receivable", "contact_id": CONTACT},
            {"_id": INST, "no": 1, "amount": 100, "direction": "receivable", "company_id": CO_A, "contact_id": CONTACT, "contact_name": "Cari A", "due_date": "2026-03-01", "invoice_number": "FTR-A"},
        ]))
    finally:
        _unbind(prev)
    assert len(notes) == 1
    assert notes[0]["company_id"] == CO_A
    assert _doc(db, "installments", INST, CO_A)["cheque_id"] == notes[0]["id"]
    assert _doc(db, "installments", INST, CO_B)["cheque_id"] == "keep-b"
    blank = next(row for row in db.installments.docs if row.get("_id") == "inst-blank")
    assert "company_id" not in blank
    assert "cheque_id" not in blank
    assert _digest(db, CO_B) == before


def test_run_recurring_leaves_other_company():
    db = _DB()
    _pair_money(db)
    _add(db, "expenses", _expense(CO_B, total=77.0, is_recurring=True, next_date="2026-10-01", description="Tekrar B"))
    _add(db, "expenses", _expense(CO_A, total=10.0, is_recurring=True, next_date="2026-10-01", description="Tekrar A"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(expenses.run_recurring_for_company(CO_A, today="2026-10-20"))
    finally:
        _unbind(prev)
    assert len(out["created"]) == 1
    assert out["created"][0]["company_id"] == CO_A
    assert _doc(db, "expenses", EXP, CO_A)["next_date"] != "2026-10-01"
    assert _doc(db, "expenses", EXP, CO_B)["next_date"] == "2026-10-01"
    assert _doc(db, "expenses", EXP, CO_B)["is_recurring"] is True
    assert _doc(db, "expenses", EXP, CO_B)["total"] == 77.0
    assert _digest(db, CO_B) == before


def test_wave8_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 70
    assert len({key for key in _REMOVED}) == 70
    assert not any(key[0] == "server.py" for key in _REMOVED)
    assert _KEPT in base
    text = Path(cheques.__file__).read_text(encoding="utf-8")
    marker = "async def cancel_promissory_for_installments"
    above = text[:text.index(marker)].rstrip().splitlines()[-1]
    assert above == _PROMISSORY_NOTE
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
