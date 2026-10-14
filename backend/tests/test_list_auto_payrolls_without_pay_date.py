"""Salt okunur otomatik bordro listesi: pay_start_date boş personel."""
import importlib.util
import os
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "list_auto_payrolls_without_pay_date.py"


def _load():
    spec = importlib.util.spec_from_file_location("list_auto_payrolls_without_pay_date", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_cli_defaults_to_dry_run_and_lists_only():
    mod = _load()
    args = mod.build_parser().parse_args([])
    assert args.dry_run is True
    assert args.company == ""
    text = SCRIPT.read_text()
    assert "delete_one" not in text and "delete_many" not in text
    assert "--apply" not in text
    assert "hiçbir şey silmez" in text.lower() or "silmez" in text


def test_match_rows_only_auto_payrolls_without_pay_date():
    mod = _load()
    payrolls = [
        {
            "_id": "p_auto", "employee_id": "e1", "company_id": "c1", "period": "2026-10",
            "manual": False, "source_type": "personnel_payment", "source_id": "mov1",
            "final_payable": 12000,
        },
        {
            "_id": "p_manual", "employee_id": "e1", "company_id": "c1", "period": "2026-09",
            "manual": True, "source_type": "personnel_payment", "source_id": "mov2",
            "final_payable": 5000,
        },
        {
            "_id": "p_dated", "employee_id": "e2", "company_id": "c1", "period": "2026-10",
            "manual": False, "source_type": "personnel_payment", "source_id": "mov3",
            "final_payable": 8000,
        },
        {
            "_id": "p_other", "employee_id": "e1", "company_id": "c1", "period": "2026-08",
            "manual": False, "source_type": "payroll", "source_id": "mov4",
            "final_payable": 1000,
        },
    ]
    employees = [
        {"_id": "e1", "full_name": "Ali", "pay_start_date": None},
        {"_id": "e2", "full_name": "Veli", "pay_start_date": "2026-01-01"},
    ]
    rows = mod.match_rows(payrolls, employees, [{"_id": "mov1"}])
    assert [r["payroll_id"] for r in rows] == ["p_auto"]
    assert rows[0]["suggested_personnel_movement_id"] == "mov1"
    assert "mov1" in rows[0]["correction"]


def test_collect_report_does_not_mutate_db():
    import asyncio

    mod = _load()

    class Col:
        def __init__(self, docs):
            self.docs = list(docs)
            self.writes = 0

        def find(self, q=None, projection=None):
            q = q or {}
            rows = []
            for d in self.docs:
                ok = True
                for k, v in q.items():
                    if isinstance(v, dict) and "$in" in v:
                        if d.get(k) not in v["$in"]:
                            ok = False
                            break
                    elif d.get(k) != v:
                        ok = False
                        break
                if ok:
                    rows.append(d)
            return FakeCur(rows)

        async def delete_one(self, q):
            self.writes += 1

    class FakeCur:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, n):
            return list(self.rows[:n])

    class FakeDb:
        def __init__(self):
            self.payrolls = Col([{
                "_id": "p1", "employee_id": "e1", "company_id": "c1", "period": "2026-10",
                "manual": False, "source_type": "personnel_payment",
                "source_id": "m1", "final_payable": 10000,
            }])
            self.employees = Col([{"_id": "e1", "company_id": "c1", "full_name": "Ali", "pay_start_date": ""}])
            self.personnel_movements = Col([{"_id": "m1", "company_id": "c1"}])

    db = FakeDb()
    report = asyncio.run(mod.collect_report(db, "c1"))
    assert report["dry_run"] is True
    assert report["deleted"] == 0
    assert report["count"] == 1
    assert report["rows"][0]["suggested_personnel_movement_id"] == "m1"
    assert db.payrolls.writes == 0
    assert os.path.basename(SCRIPT) == "list_auto_payrolls_without_pay_date.py"


def test_main_real_mysql_client_has_payrolls_and_closes(monkeypatch):
    """_main MySQLClient'ı db sanmaz: client[ad].payrolls vardır, bağlantı kapanır.

    Sahte veritabanı yok. Sorgu MySQL'e gitmez; koleksiyon nesnesi gerçek istemciden gelir.
    """
    import asyncio

    from mysql_store import MySQLClient, MySQLCollection, MySQLDatabase, mysql_settings_from_env

    mod = _load()
    monkeypatch.setattr("dotenv.load_dotenv", lambda *_a, **_k: False)
    import setup_state

    monkeypatch.setattr(setup_state, "apply_saved_secrets", lambda: None)

    seen = {}
    closed = []
    orig_close = MySQLClient.close_async

    async def track_close(self):
        closed.append(self)
        await orig_close(self)

    def observe_find(self, query=None, projection=None):
        seen["collection"] = self
        seen["db"] = self._db

        class _Cur:
            async def to_list(self, _n):
                return []

        return _Cur()

    monkeypatch.setattr(MySQLClient, "close_async", track_close)
    monkeypatch.setattr(MySQLCollection, "find", observe_find)

    assert asyncio.run(mod._main("co_real_client")) == 0

    db_name = str(mysql_settings_from_env().get("db") or "tamkobi")
    assert len(closed) == 1
    client = closed[0]
    database = client[db_name]
    assert isinstance(database, MySQLDatabase)
    assert database is seen["db"]
    assert isinstance(database.payrolls, MySQLCollection)
    assert database.payrolls.name == "payrolls"
    assert seen["collection"].name == "payrolls"
    assert seen["collection"]._db is database
    try:
        client.payrolls
    except AttributeError:
        pass
    else:
        raise AssertionError("MySQLClient.payrolls AttributeError vermeli")
