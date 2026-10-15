"""Sahipsiz prim temizliği: dry-run listeler, --apply yalnız uygun kayıtları siler."""
import asyncio
import importlib.util
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import linked_moves  # noqa: E402

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "cleanup_orphan_prims.py"


def _load():
    spec = importlib.util.spec_from_file_location("cleanup_orphan_prims", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return [dict(x) for x in self.rows[:n]]


class _Col:
    def __init__(self):
        self.docs = []

    def _match(self, doc, query):
        if not query:
            return True
        if "$or" in query:
            rest = {k: v for k, v in query.items() if k != "$or"}
            if rest and not self._match(doc, rest):
                return False
            return any(self._match(doc, clause) for clause in query["$or"])
        for key, value in query.items():
            if isinstance(value, dict):
                return False
            if doc.get(key) != value:
                return False
        return True

    async def find_one(self, query=None, projection=None):
        found = next((row for row in self.docs if self._match(row, query)), None)
        return dict(found) if found else None

    def find(self, query=None, projection=None):
        return _Cursor([row for row in self.docs if self._match(row, query)])

    async def delete_one(self, query):
        before = len(self.docs)
        self.docs[:] = [row for row in self.docs if not self._match(row, query)]
        return before - len(self.docs)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


class _Db:
    def __init__(self):
        self.employees = _Col()
        self.bonus_payments = _Col()
        self.bank_transactions = _Col()
        self.partner_transactions = _Col()
        self.expenses = _Col()
        self.trash = _Col()

    def __getitem__(self, name):
        return getattr(self, name)


def _bonus(**extra):
    row = {
        "_id": "b1", "company_id": "c1", "employee_id": "gone",
        "employee_name": "Silinmiş", "type": "bonus", "status": "pending", "amount": 120,
    }
    row.update(extra)
    return row


def _run(coro):
    return asyncio.run(coro)


def test_cli_defaults_to_list_only():
    mod = _load()
    args = mod.build_parser().parse_args(["--company", "c1"])
    assert args.company == "c1"
    assert args.apply is False
    args_dry = mod.build_parser().parse_args(["--company", "c1", "--dry-run"])
    assert args_dry.apply is False
    args_apply = mod.build_parser().parse_args(["--company", "c1", "--apply"])
    assert args_apply.apply is True
    try:
        mod.build_parser().parse_args(["--company", "c1", "--dry-run", "--apply"])
    except SystemExit as exc:
        assert exc.code != 0
    else:
        raise AssertionError("aynı anda --dry-run ve --apply kabul edilmemeli")


def test_dry_run_lists_orphan_without_deleting():
    mod = _load()
    db = _Db()
    db.employees.docs.append({"_id": "e_live", "company_id": "c1", "full_name": "Ayşe"})
    db.bonus_payments.docs.append(_bonus())
    report = _run(mod.cleanup_orphan_prims(db, "c1", apply=False))
    assert report["dry_run"] is True
    assert report["count"] == 1
    assert report["rows"][0]["bonus_id"] == "b1"
    assert db.bonus_payments.docs[0]["_id"] == "b1"


def test_apply_deletes_only_orphan_without_moves_and_is_idempotent(caplog):
    mod = _load()
    db = _Db()
    db.employees.docs.append({"_id": "e_live", "company_id": "c1", "full_name": "Ayşe"})
    db.bonus_payments.docs.extend([
        _bonus(),
        _bonus(_id="b_live", employee_id="e_live", employee_name="Ayşe"),
        _bonus(_id="b_blank", employee_id=""),
        _bonus(_id="b_other", company_id="c2", employee_id="ghost"),
        _bonus(_id="b_bank", employee_id="ghost_bank"),
        _bonus(_id="b_partner", employee_id="ghost_partner"),
    ])
    db.bank_transactions.docs.append({
        "_id": "tx1", "company_id": "c1", "account_id": "kasa", "type": "outflow",
        "amount": 120, **linked_moves.link_fields("personnel_bonus", "b_bank"),
    })
    db.partner_transactions.docs.append({
        "_id": "pt1", "company_id": "c1", "partner_id": "p1", "type": "withdrawal",
        "amount": 120, **linked_moves.link_fields("personnel_bonus", "b_partner"),
    })
    with caplog.at_level(logging.INFO, logger="cleanup_orphan_prims"):
        report = _run(mod.cleanup_orphan_prims(db, "c1", apply=True))
    assert report["dry_run"] is False
    assert report["count"] == 1
    assert report["rows"][0]["bonus_id"] == "b1"
    left = {row["_id"] for row in db.bonus_payments.docs}
    assert left == {"b_live", "b_blank", "b_other", "b_bank", "b_partner"}
    assert db.bank_transactions.docs and db.partner_transactions.docs
    assert any("silindi" in rec.message and "b1" in rec.message for rec in caplog.records)
    again = _run(mod.cleanup_orphan_prims(db, "c1", apply=True))
    assert again["count"] == 0
    assert {row["_id"] for row in db.bonus_payments.docs} == left


def test_skips_trashed_employee_and_deletes_paid_bonus_of_purged_employee():
    mod = _load()
    db = _Db()
    db.trash.docs.extend([
        {
            "_id": "t1", "company_id": "c1", "entity_type": "employee",
            "original_id": "e_trash",
            "doc": {"_id": "e_trash", "company_id": "c1", "full_name": "Çöp"},
        },
        {
            "_id": "t2", "company_id": "c1", "entity_type": "employee",
            "doc": {"_id": "e_doc", "company_id": "c1", "full_name": "Belge"},
        },
        {
            "_id": "t3", "company_id": "c2", "entity_type": "employee",
            "original_id": "e_other_trash",
            "doc": {"_id": "e_other_trash", "company_id": "c2"},
        },
    ])
    db.bonus_payments.docs.extend([
        _bonus(_id="b_trash", employee_id="e_trash", status="paid", amount=70),
        _bonus(_id="b_doc", employee_id="e_doc", status="pending", amount=30),
        _bonus(_id="b_paid", employee_id="gone_paid", status="paid", amount=90),
        _bonus(_id="b_free", employee_id="e_other_trash", status="paid", amount=40),
    ])
    listed = _run(mod.cleanup_orphan_prims(db, "c1", apply=False))
    assert listed["dry_run"] is True
    assert {row["bonus_id"] for row in listed["rows"]} == {"b_paid", "b_free"}
    assert {row["_id"] for row in db.bonus_payments.docs} == {"b_trash", "b_doc", "b_paid", "b_free"}
    report = _run(mod.cleanup_orphan_prims(db, "c1", apply=True))
    assert report["count"] == 2
    assert {row["bonus_id"] for row in report["rows"]} == {"b_paid", "b_free"}
    assert {row["_id"] for row in db.bonus_payments.docs} == {"b_trash", "b_doc"}
    assert db.trash.docs


def test_other_company_employee_does_not_protect_this_company():
    mod = _load()
    db = _Db()
    db.employees.docs.append({"_id": "e_shared", "company_id": "c2", "full_name": "Başka"})
    db.bonus_payments.docs.append(_bonus(_id="b_here", employee_id="e_shared"))
    report = _run(mod.cleanup_orphan_prims(db, "c1", apply=True))
    assert report["count"] == 1
    assert db.bonus_payments.docs == []
    assert db.employees.docs[0]["company_id"] == "c2"
