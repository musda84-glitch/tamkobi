"""Sahipsiz prim temizliği: dry-run listeler, --apply yalnız uygun kayıtları siler."""
import asyncio
import importlib.util
import logging
import os
import sys
from pathlib import Path

import pytest

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


def _skip_if_mysql_unreachable():
    """Bağlantı yoksa testi düşürme. Şifre uydurulmaz; yalnız ortam MYSQL_* kullanılır."""
    import pymysql

    try:
        conn = pymysql.connect(
            host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
            port=int(os.environ.get("MYSQL_PORT", "3306")),
            user=os.environ.get("MYSQL_USER", ""),
            password=os.environ.get("MYSQL_PASSWORD", ""),
            charset="utf8mb4",
            connect_timeout=3,
        )
    except (pymysql.err.OperationalError, ConnectionRefusedError):
        pytest.skip("MySQL yok")
    else:
        conn.close()


def test_cli_dry_run_real_mysql_lists_name_amount_and_prim_id(monkeypatch, tmp_path):
    """Script gerçek MySQLClient[db] ile çalışır; dry-run ad, tutar ve prim id yazar.

    Veritabanı nesnesi MySQLDatabase'dir (sahte koleksiyon yok). Olmayan firma
    id'si sıfırdan farklı çıkar. Dry-run kayıt silmez. MySQL yoksa atlanır.
    """
    import json
    import subprocess
    import uuid

    _skip_if_mysql_unreachable()

    from mysql_store import MySQLClient, MySQLDatabase, mysql_settings_from_env

    db_name = "tamkobi_orphan_prim_test"
    monkeypatch.setenv("TAMKOBI_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MYSQL_DATABASE", db_name)
    monkeypatch.setenv("DB_NAME", db_name)
    monkeypatch.setenv("MYSQL_URL", "")
    monkeypatch.setenv("DATABASE_URL", "")

    company = f"co_prim_{uuid.uuid4().hex[:8]}"
    missing = f"co_yok_{uuid.uuid4().hex[:8]}"
    live_id = f"emp_live_{uuid.uuid4().hex[:8]}"
    bonus_id = f"prim_{uuid.uuid4().hex[:10]}"
    live_bonus_id = f"prim_live_{uuid.uuid4().hex[:10]}"
    employee_name = "Silinmiş Kerem"
    amount = 1375

    async def seed():
        import pymysql

        cfg = mysql_settings_from_env()
        assert cfg["db"] == db_name
        conn = pymysql.connect(
            host=cfg["host"],
            port=int(cfg["port"]),
            user=cfg["user"],
            password=cfg["password"],
            charset="utf8mb4",
            autocommit=True,
        )
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
        finally:
            conn.close()

        client = MySQLClient()
        assert type(client).__name__ == "MySQLClient"
        try:
            client.employees
        except AttributeError:
            pass
        else:
            raise AssertionError("MySQLClient.employees AttributeError vermeli")
        db = client[db_name]
        assert isinstance(db, MySQLDatabase)
        assert type(db).__name__ == "MySQLDatabase"
        await db._ensure()
        await db.companies.delete_many({"_id": company})
        await db.employees.delete_many({"company_id": company})
        await db.bonus_payments.delete_many({"company_id": company})
        await db.companies.insert_one({"_id": company, "name": "Prim Test Firma"})
        await db.employees.insert_one({
            "_id": live_id, "company_id": company, "full_name": "Ayşe Canlı",
        })
        await db.bonus_payments.insert_one({
            "_id": bonus_id,
            "company_id": company,
            "employee_id": f"gone_{uuid.uuid4().hex[:6]}",
            "employee_name": employee_name,
            "type": "bonus",
            "status": "pending",
            "amount": amount,
        })
        await db.bonus_payments.insert_one({
            "_id": live_bonus_id,
            "company_id": company,
            "employee_id": live_id,
            "employee_name": "Ayşe Canlı",
            "type": "bonus",
            "status": "pending",
            "amount": 40,
        })
        await client.close_async()

    _run(seed())

    script = Path(__file__).resolve().parents[1] / "scripts" / "cleanup_orphan_prims.py"
    env = os.environ.copy()
    proc = subprocess.run(
        [sys.executable, str(script), "--company", company, "--dry-run"],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert "dry-run" in proc.stdout
    assert "has no attribute" not in proc.stderr
    payload = json.loads(proc.stdout[proc.stdout.index("{"):])
    assert payload["dry_run"] is True
    assert payload["count"] == 1
    row = payload["rows"][0]
    assert row["bonus_id"] == bonus_id
    assert row["employee_name"] == employee_name
    assert row["amount"] == amount
    assert employee_name in proc.stdout
    assert str(amount) in proc.stdout
    assert bonus_id in proc.stdout
    assert live_bonus_id not in proc.stdout

    missing_proc = subprocess.run(
        [sys.executable, str(script), "--company", missing],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )
    assert missing_proc.returncode != 0
    assert missing in missing_proc.stderr
    assert "firma bulunamadı" in missing_proc.stderr
    assert "has no attribute" not in missing_proc.stderr

    async def check():
        client = MySQLClient()
        db = client[db_name]
        left = await db.bonus_payments.find({"company_id": company}).to_list(20)
        await db.bonus_payments.delete_many({"company_id": company})
        await db.employees.delete_many({"company_id": company})
        await db.companies.delete_many({"_id": company})
        await client.close_async()
        return {row["_id"] for row in left}

    assert _run(check()) == {bonus_id, live_bonus_id}


def test_main_fake_client_uses_db_name_and_lists_dry_run(monkeypatch, tmp_path, capsys):
    """MySQL olmadan: _main client[DB_NAME] kullanır, olmayan firma 1 döner, dry-run listeler."""
    import json

    import mysql_store

    mod = _load()
    db_name = "orphan_env_db"
    monkeypatch.setenv("TAMKOBI_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DB_NAME", db_name)
    monkeypatch.setenv("MYSQL_DATABASE", db_name)
    monkeypatch.setenv("MYSQL_URL", "")
    monkeypatch.setenv("DATABASE_URL", "")

    db = _Db()
    db.companies = _Col()
    created = []

    class _SplitClient:
        """MySQLClient ayrımı: koleksiyon istemcide değil, client[db] üzerindedir."""

        def __init__(self):
            created.append(self)
            self.names = []
            self.closed = False

        def __getitem__(self, name):
            self.names.append(name)
            return db

        async def close_async(self):
            self.closed = True

        def close(self):
            self.closed = True

    monkeypatch.setattr(mysql_store, "MySQLClient", _SplitClient)

    missing = _run(mod._main("firma_yok", False))
    missing_err = capsys.readouterr().err
    assert missing == 1
    assert "firma bulunamadı" in missing_err
    assert created[-1].names == [db_name]
    assert created[-1].closed is True
    with pytest.raises(AttributeError):
        created[-1].employees

    company = "c_env"
    bonus_id = "prim_env_1"
    employee_name = "Silinmiş Kerem"
    amount = 1375
    db.companies.docs.append({"_id": company, "name": "Env Firma"})
    db.employees.docs.append({"_id": "e_live", "company_id": company, "full_name": "Ayşe"})
    db.bonus_payments.docs.append(_bonus(
        _id=bonus_id, company_id=company, employee_id="gone_emp",
        employee_name=employee_name, amount=amount,
    ))
    db.bonus_payments.docs.append(_bonus(
        _id="prim_live", company_id=company, employee_id="e_live",
        employee_name="Ayşe", amount=40,
    ))

    code = _run(mod._main(company, False))
    out = capsys.readouterr().out
    assert code == 0
    assert created[-1].names == [db_name]
    assert employee_name in out
    assert str(amount) in out
    assert bonus_id in out
    payload = json.loads(out[out.index("{"):])
    assert payload["dry_run"] is True
    row = payload["rows"][0]
    assert row["employee_name"] == employee_name
    assert row["amount"] == amount
    assert row["bonus_id"] == bonus_id
    assert {item["_id"] for item in db.bonus_payments.docs} == {bonus_id, "prim_live"}
