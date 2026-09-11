"""Performance monitor and schema-upgrade helpers (MySQL optional)."""
import json
from pathlib import Path

import perfmon
from mysql_store import schema_upgrade_statements, _simple_eq


def test_schema_upgrade_adds_company_id():
    stmts = schema_upgrade_statements(set(), set())
    assert any("ADD COLUMN company_id" in s for s in stmts)
    assert any("idx_docs_coll_company" in s for s in stmts)
    assert schema_upgrade_statements({"company_id"}, {"idx_docs_coll_company"}) == []


def test_simple_eq_skips_operators():
    assert _simple_eq({"company_id": "c1"}, "company_id") == "c1"
    assert _simple_eq({"company_id": {"$in": ["c1"]}}, "company_id") is None
    assert _simple_eq(None, "company_id") is None


def test_evaluate_disk_and_memory_alerts():
    snap = {
        "host": {
            "load": {"load_ratio": 0.2, "nproc": 4},
            "mem": {"used_pct": 95},
            "disk": {"used_pct": 96, "path": "/"},
        },
        "mysql": {"ok": True, "threads_running": 1, "conn_pct": 5, "buffer_hit_pct": 99.9},
    }
    codes = {a["code"] for a in perfmon.evaluate(snap)}
    assert "memory" in codes
    assert "disk" in codes


def test_persist_and_report(tmp_path, monkeypatch):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    monkeypatch.setenv("LOG_DB_PERSIST", "0")
    snap = {
        "ts": "2026-01-01T00:00:00+00:00",
        "ok": True,
        "alerts": [],
        "host": {"load": {"nproc": 2, "load_1": 0.1, "load_5": 0.1, "load_15": 0.1, "load_ratio": 0.05},
                 "mem": {"used_pct": 10, "available_kb": 1000},
                 "disk": {"path": "/", "used_pct": 20, "free_gb": 10}},
        "mysql": {"ok": True, "version": "8.0", "threads_connected": 1, "max_connections": 80,
                  "conn_pct": 1, "threads_running": 1, "buffer_pool_bytes": 128*1024*1024,
                  "buffer_hit_pct": 99.9, "slow_query_log": "OFF", "long_query_time": "1",
                  "slow_queries": 0, "doc_count": 10, "collection_count": 2,
                  "top_collections": [{"collection": "users", "n": 3, "kb": 1}],
                  "tables": [{"name": "docs", "est_rows": 10, "data_length": 100, "index_length": 0}]},
    }
    latest = perfmon.persist_snapshot(snap, directory=tmp_path)
    assert latest.exists()
    payload = json.loads(latest.read_text())
    assert payload["mysql"]["version"] == "8.0"
    recs = perfmon.recommendations(snap)
    assert any("slow_query_log" in r for r in recs)
    dest = tmp_path / "report.md"
    perfmon.write_report(snap, dest)
    text = dest.read_text()
    assert "TamKobi MySQL performance report" in text
    assert "`users`" in text


def test_collect_has_host_keys():
    snap = perfmon.collect()
    assert "host" in snap and "mysql" in snap and "alerts" in snap
    assert "load" in snap["host"] and "mem" in snap["host"] and "disk" in snap["host"]
