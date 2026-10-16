"""SQL ORDER BY / LIMIT pushdown matches the historical Python read path.

Flag MYSQL_STORE_SQL_PUSHDOWN defaults on. ``0`` is the previous path:
partial sql_pushdown, then match_query, sort_docs, slice, project_doc.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture(autouse=True)
def _restore_pushdown_flag():
    previous = os.environ.get("MYSQL_STORE_SQL_PUSHDOWN")
    yield
    if previous is None:
        os.environ.pop("MYSQL_STORE_SQL_PUSHDOWN", None)
    else:
        os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = previous


def _canon(docs) -> str:
    return json.dumps(docs, ensure_ascii=False, sort_keys=True, default=str)


def _as_api(docs) -> list:
    """Same id rename list_invoices / list_bank_transactions apply via clean_doc."""
    out = []
    for doc in docs:
        row = dict(doc)
        if "_id" in row:
            row["id"] = str(row.pop("_id"))
        out.append(row)
    return out


def _invoice_query(company_id, type=None, project_id=None, include_cancelled=False):
    """Mirrors backend/server.py list_invoices query construction."""
    query = {"company_id": company_id}
    if type == "export":
        query["trade_kind"] = "export"
        query["invoice_type"] = {"$ne": "dispatch"}
    elif type == "import":
        query["trade_kind"] = "import"
        query["invoice_type"] = {"$ne": "dispatch"}
    elif type and type != "all":
        query["invoice_type"] = type
    else:
        query["invoice_type"] = {"$ne": "dispatch"}
    if project_id:
        query["project_id"] = project_id
    if not include_cancelled:
        query["status"] = {"$nin": ["cancelled", "canceled", "void"]}
    return query


def _bank_query(company_id, account_id=None):
    """Mirrors backend/server.py list_bank_transactions query construction."""
    query = {"company_id": company_id}
    if account_id:
        query["$or"] = [{"account_id": account_id}, {"target_account_id": account_id}]
    return query


class _SqlLog:
    def __init__(self):
        self.statements = []

    def wrap(self, fetch):
        log = self

        async def _wrapped(sql, params):
            log.statements.append(" ".join(sql.split()))
            return await fetch(sql, params)

        return _wrapped


def _page_sqls(statements):
    return [s for s in statements if "ORDER BY" in s and "LIMIT" in s]


def _unordered_doc_scans(statements):
    return [s for s in statements if s.startswith("SELECT doc FROM docs") and "ORDER BY" not in s]


def _settings():
    """Use the process database settings, or the local docker-compose defaults."""
    from mysql_store import mysql_settings_from_env

    if any(os.environ.get(key) for key in ("MYSQL_URL", "DATABASE_URL", "MYSQL_HOST", "MYSQL_PASSWORD")):
        return mysql_settings_from_env()
    return {
        "host": "127.0.0.1",
        "port": 3306,
        "user": "tamkobi",
        "password": "tamkobi",
        "db": "tamkobi_pushdown",
        "charset": "utf8mb4",
        "autocommit": True,
        "ssl_mode": "disabled",
        "ssl_ca": "",
    }


async def _client():
    from mysql_store import MySQLDatabase

    db = MySQLDatabase(_settings())
    await db._ensure()
    return db


def _sample_invoices(company="c1", other="c2"):
    # Insert z before a so insertion order and _id order disagree on ties.
    return [
        {"_id": "z", "company_id": company, "created_at": "2024-01-02", "account_name": "b",
         "status": "open", "invoice_type": "sales", "issue_date": "2024-09-01", "project_id": "p1",
         "trade_kind": "domestic", "invoice_number": "F-Z", "grand_total": 10},
        {"_id": "a", "company_id": company, "created_at": None, "account_name": "A",
         "status": "open", "invoice_type": "sales", "issue_date": "2024-02-01", "project_id": "p1",
         "trade_kind": "export", "invoice_number": "F-A", "grand_total": 3},
        {"_id": "c", "company_id": company, "account_name": "x",
         "status": "open", "invoice_type": "sales", "issue_date": "2024-01-15", "project_id": "p2",
         "trade_kind": "domestic", "invoice_number": "F-C"},
        {"_id": "d", "company_id": company, "created_at": "2024-01-02", "account_name": "a",
         "status": "cancelled", "invoice_type": "sales", "issue_date": "2024-03-01",
         "invoice_number": "F-D"},
        {"_id": "e", "company_id": company, "created_at": "2024-01-01", "account_name": "B",
         "status": "open", "invoice_type": "purchase", "issue_date": "2023-12-01",
         "trade_kind": "import", "invoice_number": "F-E"},
        {"_id": "f", "company_id": company, "created_at": "2023-12-31",
         "status": "void", "invoice_type": "sales", "issue_date": "2024-06-01",
         "invoice_number": "F-F"},
        {"_id": "g", "company_id": other, "created_at": "2024-06-01", "account_name": "other",
         "status": "open", "invoice_type": "sales", "issue_date": "2024-06-01",
         "invoice_number": "F-G", "grand_total": 999},
        {"_id": "h", "company_id": company, "created_at": "2024-01-02",
         "status": "open", "invoice_type": "dispatch", "issue_date": "2024-01-02",
         "invoice_number": "IRS-H"},
        {"_id": "i", "company_id": company, "created_at": "2024-03-01", "account_name": None,
         "status": "draft", "invoice_type": "sales", "issue_date": "2024-07-01",
         "invoice_number": "F-I"},
        {"_id": "j", "company_id": company.upper() if company.islower() else company + "X",
         "created_at": "2024-08-01", "status": "open", "invoice_type": "sales",
         "invoice_number": "F-J"},
        {"_id": "k", "company_id": company, "created_at": "2024-01-02", "account_name": None,
         "status": "Open", "invoice_type": "sales", "issue_date": "2024-01-02",
         "invoice_number": "F-K"},
        {"_id": "m", "company_id": company, "created_at": "2024-04-01",
         "status": ["open", "x"], "invoice_type": "sales", "issue_date": "2024-04-01",
         "invoice_number": "F-M"},
        {"_id": "n", "company_id": company, "created_at": "None", "account_name": "n",
         "status": "open", "invoice_type": "sales", "issue_date": "2024-01-02",
         "invoice_number": "F-N"},
        {"_id": "p", "company_id": company, "created_at": "2024-05-01", "account_name": "p",
         "status": "canceled", "invoice_type": "sales", "issue_date": "2025-01-01",
         "invoice_number": "F-P"},
    ]


def _sample_txs(company="c1", other="c2"):
    return [
        {"_id": "t3", "company_id": company, "account_id": "acc1", "account_name": "Kasa",
         "target_account_id": None, "date": "2024-02-01", "type": "inflow", "amount": 50,
         "created_at": "2024-02-01T00:00:00"},
        {"_id": "t1", "company_id": company, "account_id": "acc2", "account_name": "Banka",
         "target_account_id": "acc1", "date": "2024-03-01", "type": "transfer", "amount": 20,
         "created_at": "2024-03-01T00:00:00"},
        {"_id": "t2", "company_id": company, "account_id": "acc1", "account_name": "Kasa",
         "date": "2024-03-01", "type": "outflow", "amount": 5, "created_at": "2024-03-01T01:00:00"},
        {"_id": "t0", "company_id": company, "account_id": "acc1", "account_name": "Kasa",
         "date": None, "type": "inflow", "amount": 1, "created_at": "2024-01-01T00:00:00"},
        {"_id": "t4", "company_id": company, "account_id": "acc9", "account_name": None,
         "date": "2024-01-15", "type": "inflow", "amount": 8},
        {"_id": "tx", "company_id": other, "account_id": "acc1", "account_name": "Yabancı",
         "date": "2024-06-01", "type": "inflow", "amount": 1000},
    ]


async def _seed(db, name, docs):
    col = db[name]
    await col.delete_many({})
    for doc in docs:
        await col.insert_one(doc)
    return col


async def _both(col, query, sort=None, projection=None, skip=0, limit=None, length=None):
    from mysql_store import sql_page_pushdown_enabled

    async def _once(flag):
        os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = flag
        assert sql_page_pushdown_enabled() is (flag != "0")
        log = _SqlLog()
        orig = col._fetch_rows
        col._fetch_rows = log.wrap(orig)
        try:
            cur = col.find(query, projection)
            if sort is not None:
                if isinstance(sort, str):
                    cur = cur.sort(sort)
                else:
                    cur = cur.sort(sort)
            if skip:
                cur = cur.skip(skip)
            if limit is not None:
                cur = cur.limit(limit)
            rows = await cur.to_list(length)
        finally:
            col._fetch_rows = orig
        return rows, log.statements

    on, on_sql = await _once("1")
    off, off_sql = await _once("0")
    return on, off, on_sql, off_sql


def test_flag_defaults_on_and_zero_disables(monkeypatch):
    from mysql_store import sql_page_pushdown_enabled

    monkeypatch.delenv("MYSQL_STORE_SQL_PUSHDOWN", raising=False)
    assert sql_page_pushdown_enabled() is True
    monkeypatch.setenv("MYSQL_STORE_SQL_PUSHDOWN", "0")
    assert sql_page_pushdown_enabled() is False
    monkeypatch.setenv("MYSQL_STORE_SQL_PUSHDOWN", "1")
    assert sql_page_pushdown_enabled() is True


def test_planner_pushes_list_queries_and_rejects_partial_filters():
    from mysql_store import plan_exact_page

    invoices = plan_exact_page(
        "invoices", _invoice_query("c1"), [("created_at", -1)], 0, None, 1000, None,
    )
    assert invoices is not None
    assert "ORDER BY" in invoices["sql"] and "LIMIT %s" in invoices["sql"]
    assert invoices["params"][-1] == 1000
    assert "JSON_EXTRACT(doc,'$.created_at')" in invoices["sql"]
    assert all(isinstance(p, (str, int)) for p in invoices["params"])
    # values stay parameters; a quote in the company id is not concatenated
    evil = plan_exact_page(
        "invoices", _invoice_query("c1' OR '1'='1"), [("created_at", -1)], 0, None, 1000, None,
    )
    assert "OR '1'" not in evil["sql"]
    assert "c1' OR '1'='1" in evil["params"]

    bank = plan_exact_page(
        "bank_transactions", _bank_query("c1", "acc1"), [("date", -1)], 0, None, 2000, None,
    )
    assert bank is not None and "LIMIT %s" in bank["sql"] and bank["params"][-1] == 2000
    assert "$.account_id" in bank["sql"] and "$.target_account_id" in bank["sql"]

    assert plan_exact_page("invoices", {"company_id": "c1", "n": 1}, [("created_at", -1)], 0, None, 10) is None
    assert plan_exact_page("invoices", {"company_id": "c1", "ok": False}, [("created_at", -1)], 0, None, 10) is None
    assert plan_exact_page("invoices", {"company_id": "c1"}, [("amount", -1)], 0, None, 10) is None
    assert plan_exact_page("invoices", {"company_id": "c1", "a.b": "x"}, [("created_at", -1)], 0, None, 10) is None
    assert plan_exact_page("invoices", {"company_id;drop": "c1"}, [("created_at", -1)], 0, None, 10) is None
    assert plan_exact_page(
        "invoices", {"company_id": "c1"}, [("created_at", -1)], 0, None, 10, {"items.name": 1},
    ) is None
    assert plan_exact_page(
        "invoices", {"company_id": "c1"}, [("created_at", -1)], 0, None, 10, {"secret": 0},
    ) is None
    simple = plan_exact_page(
        "invoices", {"company_id": "c1"}, [("issue_date", -1)], 0, 5, 5,
        {"invoice_number": 1, "contact_name": 1, "_id": 0},
    )
    assert simple is not None and "JSON_OBJECT" in simple["sql"] and "JSON_EXTRACT" in simple["sql"]
    assert "'secret'" not in simple["sql"]


def test_list_endpoint_source_still_uses_the_pushable_read():
    src = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    assert 'db.invoices.find(query).sort("created_at", -1).to_list(1000)' in src
    assert 'db.bank_transactions.find(query).sort("date", -1).to_list(2000)' in src


def test_parse_2000_rows_uses_a_worker_thread():
    import mysql_store

    calls = []
    real = mysql_store.asyncio.to_thread

    async def _fake(fn, rows):
        calls.append(len(rows))
        return fn(rows)

    mysql_store.asyncio.to_thread = _fake
    try:
        small = asyncio.run(mysql_store._loads_rows_async([('{"a": 1}',)] * 1999))
        assert calls == []
        assert len(small) == 1999 and small[0]["a"] == 1
        big = asyncio.run(mysql_store._loads_rows_async([('{"a": 2}',)] * 2000))
        assert calls == [2000]
        assert len(big) == 2000 and big[-1]["a"] == 2
    finally:
        mysql_store.asyncio.to_thread = real


def test_pushdown_matches_python_path_on_the_same_rows():
    async def _run():
        db = await _client()
        name = "push_inv_" + uuid.uuid4().hex[:10]
        try:
            col = await _seed(db, name, _sample_invoices())
            company = "c1"

            cases = [
                ("list", _invoice_query(company), [("created_at", -1)], None, 0, None, 1000),
                ("export", _invoice_query(company, type="export"), [("created_at", -1)], None, 0, None, 1000),
                ("purchase", _invoice_query(company, type="purchase"), [("issue_date", 1)], None, 0, None, 1000),
                ("project", _invoice_query(company, project_id="p1"), [("created_at", -1)], None, 0, None, 1000),
                ("asc", {"company_id": company}, [("created_at", 1)], None, 0, None, 50),
                ("desc", {"company_id": company}, [("created_at", -1)], None, 0, None, 50),
                ("name_asc", {"company_id": company}, [("account_name", 1)], None, 0, None, 50),
                ("name_desc", {"company_id": company}, [("account_name", -1)], None, 0, None, 50),
                # Last direction wins for the whole tuple — same as sort_docs.
                ("multi_last_desc", {"company_id": company}, [("created_at", 1), ("account_name", -1)], None, 0, None, 50),
                ("multi_last_asc", {"company_id": company}, [("created_at", -1), ("account_name", 1)], None, 0, None, 50),
                ("dates", {"company_id": company, "issue_date": {"$gte": "2024-01-01", "$lte": "2024-03-31"}},
                 [("issue_date", 1)], None, 0, None, 50),
                ("or_date", {"company_id": company, "$or": [
                    {"issue_date": {"$gte": "2024-06-01"}},
                    {"invoice_type": "purchase"},
                ]}, [("created_at", 1)], None, 0, None, 50),
                ("ne", {"company_id": company, "invoice_type": {"$ne": "dispatch"}}, [("created_at", -1)], None, 0, None, 50),
                ("nin", {"company_id": company, "status": {"$nin": ["cancelled", "canceled", "void"]}},
                 [("created_at", -1)], None, 0, None, 50),
                ("in", {"company_id": company, "status": {"$in": ["open", "draft"]}}, [("created_at", -1)],
                 None, 0, None, 50),
                ("exists_missing", {"company_id": company, "account_name": {"$exists": False}}, [("created_at", 1)], None, 0, None, 50),
                ("exists_present", {"company_id": company, "account_name": {"$exists": True}}, [("account_name", 1)], None, 0, None, 50),
                ("skip_limit", {"company_id": company}, [("created_at", -1)], None, 2, 3, 3),
                ("empty", {"company_id": "does-not-exist"}, [("created_at", -1)], None, 0, None, 10),
                ("proj", {"company_id": company}, [("created_at", -1)],
                 {"invoice_number": 1, "created_at": 1, "status": 1, "grand_total": 1}, 0, 4, 4),
                ("proj_no_id", {"company_id": company}, [("issue_date", -1)],
                 {"invoice_number": 1, "_id": 0}, 1, 2, 2),
                ("nested_proj_old_path", {"company_id": company}, [("created_at", -1)],
                 {"invoice_number": 1, "items.name": 1}, 0, None, 5),
                ("exclude_proj_old_path", {"company_id": company}, [("created_at", -1)],
                 {"grand_total": 0}, 0, None, 5),
                ("numeric_filter_old_path", {"company_id": company, "grand_total": 10}, [("created_at", -1)], None, 0, None, 10),
                ("bad_sort_old_path", {"company_id": company}, [("invoice_number", 1)], None, 0, None, 5),
            ]
            for label, query, sort, proj, skip, limit, length in cases:
                on, off, on_sql, off_sql = await _both(
                    col, query, sort=sort, projection=proj, skip=skip, limit=limit, length=length,
                )
                assert _canon(on) == _canon(off), label
                assert json.dumps(on, ensure_ascii=False, default=str) == json.dumps(off, ensure_ascii=False, default=str), label
                ids_on = [r.get("_id") or r.get("invoice_number") for r in on]
                assert all(r.get("company_id", company) in (company, None) or "company_id" not in r for r in on), label
                assert "g" not in ids_on and "j" not in ids_on
                pushable = label not in {
                    "nested_proj_old_path", "exclude_proj_old_path", "numeric_filter_old_path", "bad_sort_old_path",
                }
                if pushable:
                    assert _page_sqls(on_sql), (label, on_sql)
                    assert not _unordered_doc_scans(on_sql), (label, on_sql)
                if label in {"numeric_filter_old_path", "bad_sort_old_path", "nested_proj_old_path", "exclude_proj_old_path"}:
                    assert not _page_sqls(on_sql), label
                assert not _page_sqls(off_sql), label

            # Case-folded company id and status must not leak in from the other firm / other case.
            on, off, _, _ = await _both(col, {"company_id": company, "status": {"$ne": "open"}}, sort=[("created_at", -1)], length=50)
            assert _canon(on) == _canon(off)
            assert all(r.get("status") != "open" for r in on)
            assert all(r["_id"] != "g" for r in on)

            os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = "1"
            one_on = await col.find_one({"company_id": company}, sort=[("created_at", -1)])
            os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = "0"
            one_off = await col.find_one({"company_id": company}, sort=[("created_at", -1)])
            assert one_on == one_off and one_on["_id"] == "a"
        finally:
            await db[name].delete_many({})
            await db.close()

    asyncio.run(_run())


def test_list_invoices_and_bank_transactions_responses_match():
    from account_balance import annotate_bank_tx, movement_balance

    async def _run():
        db = await _client()
        inv_name = "push_list_inv_" + uuid.uuid4().hex[:8]
        tx_name = "push_list_tx_" + uuid.uuid4().hex[:8]
        acc_name = "push_list_acc_" + uuid.uuid4().hex[:8]
        try:
            invoices = await _seed(db, inv_name, _sample_invoices())
            txs = await _seed(db, tx_name, _sample_txs())
            await _seed(db, acc_name, [{
                "_id": "acc1", "company_id": "c1", "account_name": "Kasa",
                "type": "cash", "current_balance": 100.0,
            }])

            on, off, on_sql, _ = await _both(
                invoices, _invoice_query("c1"), sort=[("created_at", -1)], length=1000,
            )
            assert json.dumps(_as_api(on), ensure_ascii=False, sort_keys=True) == json.dumps(
                _as_api(off), ensure_ascii=False, sort_keys=True,
            )
            assert _page_sqls(on_sql) and not _unordered_doc_scans(on_sql)
            assert all(r["company_id"] == "c1" for r in on)
            assert all(r.get("invoice_type") != "dispatch" for r in on)
            assert all(r.get("status") not in ("cancelled", "canceled", "void") for r in on)

            for account_id in (None, "acc1"):
                on, off, on_sql, _ = await _both(
                    txs, _bank_query("c1", account_id), sort=[("date", -1)], length=2000,
                )
                api_on = _as_api([annotate_bank_tx(t, account_id) for t in on])
                api_off = _as_api([annotate_bank_tx(t, account_id) for t in off])
                assert json.dumps(api_on, ensure_ascii=False, sort_keys=True) == json.dumps(
                    api_off, ensure_ascii=False, sort_keys=True,
                )
                assert _page_sqls(on_sql) and not _unordered_doc_scans(on_sql)
                assert all(r["company_id"] == "c1" for r in on)
                if account_id:
                    assert all(r.get("account_id") == account_id or r.get("target_account_id") == account_id for r in on)
                    assert any(r.get("target_account_id") == account_id for r in on)
                assert movement_balance(on, "acc1") == movement_balance(off, "acc1")

            os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = "1"
            acc = await db[acc_name].find_one({"_id": "acc1"})
            assert acc["current_balance"] == 100.0
        finally:
            await db[inv_name].delete_many({})
            await db[tx_name].delete_many({})
            await db[acc_name].delete_many({})
            await db.close()

    asyncio.run(_run())


def test_writes_and_balance_math_do_not_depend_on_the_flag():
    from account_balance import movement_balance

    async def _apply(col, flag):
        os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = flag
        await col.delete_many({})
        await col.insert_one({"_id": "1", "company_id": "c1", "created_at": "2024-01-01", "n": 1, "status": "open"})
        await col.insert_many([
            {"_id": "2", "company_id": "c1", "created_at": "2024-01-02", "n": 1, "status": "open"},
            {"_id": "3", "company_id": "c2", "created_at": "2024-01-03", "n": 5, "status": "open"},
        ])
        await col.update_one({"_id": "1", "company_id": "c1"}, {"$set": {"status": "paid"}, "$inc": {"n": 1}})
        await col.update_many({"company_id": "c1"}, {"$inc": {"n": 1}})
        await col.delete_one({"_id": "2", "company_id": "c1"})
        os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = "0"
        rows = await col.find({}).to_list(20)
        rows.sort(key=lambda d: d["_id"])
        return rows

    async def _run():
        db = await _client()
        left = "push_w_" + uuid.uuid4().hex[:8]
        right = "push_w_" + uuid.uuid4().hex[:8]
        try:
            a = await _apply(db[left], "1")
            b = await _apply(db[right], "0")
            assert _canon(a) == _canon(b)
            assert [r["_id"] for r in a] == ["1", "3"]
            assert a[0]["status"] == "paid" and a[0]["n"] == 3
            assert movement_balance(
                [{"account_id": "acc1", "type": "inflow", "amount": 50},
                 {"account_id": "acc1", "type": "outflow", "amount": 20}],
                "acc1",
            ) == 30.0
        finally:
            await db[left].delete_many({})
            await db[right].delete_many({})
            await db.close()

    asyncio.run(_run())


def test_sync_reader_matches_the_async_rules():
    from mysql_store import SyncMySQLDatabase

    db = SyncMySQLDatabase(_settings())
    name = "push_sync_" + uuid.uuid4().hex[:8]
    col = db[name]
    try:
        col.delete_many({})
        for doc in _sample_invoices():
            col.insert_one(doc)
        query = _invoice_query("c1")

        def _read(flag):
            os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = flag
            return col.find(query).sort("created_at", -1).limit(1000).to_list(1000)

        assert _canon(_read("1")) == _canon(_read("0"))
        os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = "1"
        projected = col.find(query, {"invoice_number": 1, "status": 1}).sort("issue_date", 1).skip(1).limit(2).to_list(2)
        os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = "0"
        assert projected == col.find(query, {"invoice_number": 1, "status": 1}).sort("issue_date", 1).skip(1).limit(2).to_list(2)
    finally:
        col.delete_many({})
        db.close()


def test_non_string_sort_value_falls_back_but_still_matches():
    async def _run():
        db = await _client()
        name = "push_num_" + uuid.uuid4().hex[:8]
        try:
            col = await _seed(db, name, [
                {"_id": "s", "company_id": "c1", "created_at": "2024-01-02"},
                {"_id": "n", "company_id": "c1", "created_at": 10},
                {"_id": "m", "company_id": "c1"},
                {"_id": "o", "company_id": "c2", "created_at": 3},
            ])
            on, off, on_sql, _ = await _both(
                col, {"company_id": "c1"}, sort=[("created_at", 1)], length=20,
            )
            assert [r["_id"] for r in on] == [r["_id"] for r in off]
            assert _canon(on) == _canon(off)
            assert not _page_sqls(on_sql)
            assert all(r["company_id"] == "c1" for r in on)
        finally:
            await db[name].delete_many({})
            await db.close()

    asyncio.run(_run())
