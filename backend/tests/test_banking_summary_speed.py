"""Kasa/ortak özet uçları: sorgu sayısı sabit, GET yazmaz, başka şirket okunmaz."""
from __future__ import annotations

import copy
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mysql_store import match_query  # noqa: E402


def _run(coro):
    import asyncio
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, length=None):
        rows = self._docs if length is None else self._docs[:length]
        return copy.deepcopy(rows)


class CountingCollection:
    def __init__(self, name, docs, log, scanned):
        self.name = name
        self.docs = docs
        self.log = log
        self.scanned = scanned

    def _pool(self, query):
        q = query or {}
        cid = q.get("company_id") if isinstance(q, dict) else None
        if isinstance(cid, str):
            pool = [d for d in self.docs if d.get("company_id") == cid]
            self.scanned.setdefault(self.name, set()).add(cid)
        else:
            pool = list(self.docs)
            ids = {d.get("company_id") for d in pool}
            self.scanned.setdefault(self.name, set()).update(ids)
        return [d for d in pool if match_query(d, q)]

    def find(self, query=None, projection=None):
        self.log.append(("find", self.name, copy.deepcopy(query), projection))
        return _Cursor(self._pool(query))

    async def find_one(self, query=None, projection=None):
        self.log.append(("find_one", self.name, copy.deepcopy(query), projection))
        rows = self._pool(query)
        return copy.deepcopy(rows[0]) if rows else None

    async def update_one(self, *args, **kwargs):
        self.log.append(("update", self.name))
        return None

    async def insert_one(self, *args, **kwargs):
        self.log.append(("insert", self.name))
        return None

    async def delete_one(self, *args, **kwargs):
        self.log.append(("delete", self.name))
        return None


class CountingDB:
    def __init__(self):
        self.log = []
        self.scanned = {}
        self._cols = {}

    def col(self, name, docs):
        self._cols[name] = CountingCollection(name, docs, self.log, self.scanned)
        return self._cols[name]

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._cols[name]


def _finds(log, name):
    return [row for row in log if row[0] == "find" and row[1] == name]


def _writes(log):
    return [row for row in log if row[0] in ("update", "insert", "delete")]


def _seed(n_cash, n_partners):
    accounts = []
    for i in range(n_cash):
        accounts.append({
            "_id": f"cash{i}",
            "company_id": "co",
            "type": "cash_box",
            "account_name": f"Kasa {i}",
            "bank_name": "Kasa",
            "current_balance": 0,
        })
    accounts.append({
        "_id": "bank",
        "company_id": "co",
        "type": "bank",
        "account_name": "Vadesiz",
        "bank_name": "Banka",
        "current_balance": 50,
        "bank_reported_balance": 500,
    })
    bank_txs = []
    for i in range(20000):
        bank_txs.append({
            "_id": f"m{i}",
            "company_id": "co",
            "account_id": f"cash{i % 10}",
            "type": "inflow",
            "amount": 1,
            "source": "manual",
        })
    for i in range(50000):
        bank_txs.append({
            "_id": f"o{i}",
            "company_id": "other",
            "account_id": f"cash{i % 10}",
            "type": "inflow",
            "amount": 999,
            "source": "manual",
        })
    partners = []
    ptxs = []
    for i in range(n_partners):
        partners.append({
            "_id": f"p{i}",
            "company_id": "co",
            "name": f"Ortak {i}",
            "share_percent": 20,
            "balance": 0,
            "total_capital_in": 0,
            "total_withdrawn": 0,
            "total_profit_share": 0,
            "created_at": f"2026-01-{i + 1:02d}",
        })
        ptxs.append({
            "_id": f"in{i}",
            "company_id": "co",
            "partner_id": f"p{i}",
            "type": "capital_in",
            "amount": 100,
        })
        ptxs.append({
            "_id": f"out{i}",
            "company_id": "co",
            "partner_id": f"p{i}",
            "type": "withdrawal",
            "amount": 40,
        })
    for i in range(5000):
        ptxs.append({
            "_id": f"op{i}",
            "company_id": "other",
            "partner_id": f"p{i % 5}",
            "type": "capital_in",
            "amount": 5000,
        })
    return accounts, bank_txs, partners, ptxs


USER = {"is_super_admin": True, "company_ids": ["co"]}


def test_list_and_summary_query_count_stays_flat_and_get_does_not_write():
    import server

    accounts10, bank_txs, partners5, ptxs = _seed(10, 5)
    accounts2 = [a for a in accounts10 if a["type"] != "cash_box" or a["_id"] in ("cash0", "cash1")]
    prev = server.db
    try:
        db2 = CountingDB()
        db2.col("bank_accounts", accounts2)
        db2.col("bank_transactions", bank_txs)
        db2.col("bank_connections", [])
        server.db = db2
        rows2 = _run(server.list_bank_accounts("co"))
        finds2 = _finds(db2.log, "bank_transactions")

        db10 = CountingDB()
        db10.col("bank_accounts", accounts10)
        db10.col("bank_transactions", bank_txs)
        db10.col("bank_connections", [])
        server.db = db10
        t0 = time.perf_counter()
        rows10 = _run(server.list_bank_accounts("co"))
        list_ms = (time.perf_counter() - t0) * 1000
        finds10 = _finds(db10.log, "bank_transactions")

        assert len(finds2) == len(finds10) == 2
        by_field = {}
        for row in finds10:
            query = row[2] or {}
            assert query.get("company_id") == "co"
            assert "$or" not in query
            assert row[3] and row[3].get("amount") == 1
            if "account_id" in query:
                by_field["account_id"] = query
            if "target_account_id" in query:
                by_field["target_account_id"] = query
        cash_ids = {f"cash{i}" for i in range(10)}
        assert set(by_field["account_id"]["account_id"]["$in"]) == cash_ids
        assert set(by_field["target_account_id"]["target_account_id"]["$in"]) == cash_ids
        assert set((finds2[0][2] or {})) != {"company_id"}
        assert not any(row[0] == "find_one" and row[1] == "bank_transactions" for row in db10.log)
        assert _writes(db10.log) == []
        assert "other" not in db10.scanned.get("bank_transactions", set())
        by_id = {r["id"]: r for r in rows10}
        for i in range(10):
            # 20000 giriş / 10 kasa = 2000. Başka şirketin 999'ları yok.
            assert by_id[f"cash{i}"]["current_balance"] == 2000
            assert "ledger_balance" not in by_id[f"cash{i}"]
            assert "balance_drift" not in by_id[f"cash{i}"]
            assert "bank_balance_drift" not in by_id[f"cash{i}"]
        assert by_id["bank"]["current_balance"] == 50
        stored = {a["_id"]: a["current_balance"] for a in accounts10}
        assert stored["cash0"] == 0
        assert len(rows2) == 3  # 2 kasa + banka

        db_drift = CountingDB()
        db_drift.col("bank_accounts", accounts10)
        db_drift.col("bank_transactions", bank_txs)
        db_drift.col("bank_connections", [])
        server.db = db_drift
        drifted = _run(server.list_bank_accounts("co", with_drift=1))
        drift_finds = _finds(db_drift.log, "bank_transactions")
        assert len(drift_finds) == 1
        assert drift_finds[0][2] == {"company_id": "co"}
        bank = next(r for r in drifted if r["id"] == "bank")
        assert bank["ledger_balance"] == 0
        assert bank["bank_balance_drift"] is True
        cash_drift = next(r for r in drifted if r["id"] == "cash0")
        assert cash_drift["ledger_balance"] == 2000
        assert cash_drift["balance_drift"] is False
        assert _writes(db_drift.log) == []

        def summary(n):
            db = CountingDB()
            db.col("partners", partners5[:n])
            db.col("partner_transactions", ptxs)
            db.col("bank_transactions", bank_txs)
            server.db = db
            t1 = time.perf_counter()
            payload = _run(server.partners_summary("co", USER))
            elapsed = (time.perf_counter() - t1) * 1000
            return payload, db, elapsed

        sum2, db_p2, _ = summary(2)
        sum5, db_p5, sum_ms = summary(5)
        assert len(_finds(db_p2.log, "partner_transactions")) == len(_finds(db_p5.log, "partner_transactions")) == 1
        assert _finds(db_p5.log, "partner_transactions")[0][2]["company_id"] == "co"
        assert not _finds(db_p5.log, "bank_transactions")
        assert _writes(db_p5.log) == []
        assert "other" not in db_p5.scanned.get("partner_transactions", set())
        assert sum2["partner_count"] == 2
        assert sum2["total_cash_in"] == 200
        assert sum2["total_balance"] == 120
        assert sum5["partner_count"] == 5
        assert sum5["total_cash_in"] == 500
        assert sum5["total_cash_out"] == 200
        assert sum5["total_balance"] == 300
        assert sum5["total_cash_net"] == 300
        assert list_ms < 500, list_ms
        assert sum_ms < 500, sum_ms
    finally:
        server.db = prev


def test_repair_bank_match_loads_related_rows_once():
    import bank_match_target

    class Bank:
        def __init__(self):
            self.finds = []
            self.find_ones = 0
            self.docs = [{"_id": f"b{i}", "type": "outflow" if i % 2 == 0 else "inflow"} for i in range(6)]

        def find(self, query=None, projection=None):
            self.finds.append(query)
            ids = set((query or {}).get("_id", {}).get("$in") or [])
            rows = [d for d in self.docs if d["_id"] in ids]

            class C:
                async def to_list(self, n=None):
                    return rows[:n] if n else rows
            return C()

        async def find_one(self, query=None, projection=None):
            self.find_ones += 1
            return None

    class Partners:
        def find(self, query=None, projection=None):
            class C:
                async def to_list(self, n=None):
                    return []
            return C()

        async def update_one(self, *a, **k):
            return None

    class Ptx:
        def __init__(self):
            self.docs = []
            for i in range(6):
                self.docs.append({
                    "_id": f"t{i}",
                    "company_id": "co",
                    "partner_id": f"p{i % 3}",
                    "type": "capital_in",
                    "amount": 10,
                    "source": "bank_match",
                    "related_bank_tx_id": f"b{i}",
                })

        def find(self, query=None, projection=None):
            rows = [d for d in self.docs if match_query(d, query or {})]

            class C:
                async def to_list(self, n=None):
                    return rows[:n] if n else rows
            return C()

        async def update_one(self, query, update):
            for d in self.docs:
                if d.get("_id") == (query or {}).get("_id"):
                    d.update((update or {}).get("$set") or {})

    bank = Bank()
    db = type("DB", (), {})()
    db.partner_transactions = Ptx()
    db.bank_transactions = bank
    db.partners = Partners()
    n = _run(bank_match_target.repair_legacy_bank_match_directions(db, company_id="co"))
    assert n == 3  # yalnız tipi değişen çıkış eşleşmeleri
    assert len(bank.finds) == 1
    assert bank.find_ones == 0
    assert set(bank.finds[0]["_id"]["$in"]) == {f"b{i}" for i in range(6)}
    for d in db.partner_transactions.docs:
        even = int(d["related_bank_tx_id"][1]) % 2 == 0
        assert d["type"] == ("withdrawal" if even else "capital_in")
        assert d["bank_tx_type"] == ("outflow" if even else "inflow")


def test_company_tx_explain_uses_company_index():
    """Canlı MySQL varsa company_id sorgusu indeks kullanır. Yoksa atlanır."""
    from mysql_store import sql_pushdown
    try:
        import pymysql
    except Exception:
        pytest.skip("pymysql yok")
    from mysql_backup import load_env, mysql_settings
    load_env()
    cfg = mysql_settings()
    try:
        conn = pymysql.connect(
            host=cfg["host"], port=int(cfg["port"]), user=cfg["user"], password=cfg["password"],
            database=cfg.get("database") or "tamkobi", charset="utf8mb4", autocommit=True,
            connect_timeout=2, read_timeout=2, write_timeout=2,
        )
    except Exception as exc:
        pytest.skip(f"MySQL yok: {exc}")
    try:
        cur = conn.cursor()
        from mysql_store import schema_upgrade_statements
        cur.execute("SHOW COLUMNS FROM docs")
        cols = {r[0] for r in cur.fetchall()}
        cur.execute("SHOW INDEX FROM docs")
        idxs = {r[2] for r in cur.fetchall()}
        for stmt in schema_upgrade_statements(cols, idxs):
            cur.execute(stmt)
        for collection in ("bank_transactions", "partner_transactions"):
            sql, params = sql_pushdown(collection, {"company_id": "co-index-probe"})
            explain = "EXPLAIN " + sql
            cur.execute(explain, params)
            desc = [d[0] for d in cur.description]
            row = dict(zip(desc, cur.fetchone()))
            key = row.get("key") or row.get("KEY")
            assert key in {
                "idx_docs_coll_company",
                "idx_docs_coll_company_account",
                "idx_docs_coll_company_partner",
            }, row
    finally:
        conn.close()
