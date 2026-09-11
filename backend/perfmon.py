"""Host + MySQL performance snapshots, threshold alerts, and JSONL history."""
from __future__ import annotations

import json
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from mysql_store import mysql_settings_from_env
except Exception:  # pragma: no cover
    mysql_settings_from_env = None  # type: ignore


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return float(default)


CPU_LOAD_RATIO = _f("PERF_CPU_LOAD_RATIO", 0.85)
MEM_PCT = _f("PERF_MEM_PCT", 90)
DISK_PCT = _f("PERF_DISK_PCT", 90)
MYSQL_THREADS = _f("PERF_MYSQL_THREADS", 25)
CONN_PCT = _f("PERF_CONN_PCT", 80)
POOL_HIT_MIN = _f("PERF_BUFFER_HIT_MIN", 99.0)
INTERVAL_SEC = int(_f("PERF_INTERVAL_SEC", 60))


def log_dir() -> Path:
    raw = (os.environ.get("LOG_DIR") or "").strip()
    if raw:
        return Path(raw)
    if Path("/var/log/tamkobi").is_dir() and os.access("/var/log/tamkobi", os.W_OK):
        return Path("/var/log/tamkobi")
    return Path(__file__).resolve().parent.parent / "logs"


def _meminfo() -> Dict[str, Any]:
    out = {"total_kb": 0, "available_kb": 0, "used_pct": 0.0}
    try:
        data = {}
        for line in Path("/proc/meminfo").read_text().splitlines():
            parts = line.split()
            if len(parts) >= 2:
                data[parts[0].rstrip(":")] = int(parts[1])
        total = data.get("MemTotal") or 0
        avail = data.get("MemAvailable") or data.get("MemFree") or 0
        out["total_kb"] = total
        out["available_kb"] = avail
        out["used_pct"] = round(100.0 * (total - avail) / total, 1) if total else 0.0
    except Exception:
        pass
    return out


def _loadavg() -> Dict[str, Any]:
    nproc = os.cpu_count() or 1
    try:
        one, five, fifteen = os.getloadavg()
    except OSError:
        one = five = fifteen = 0.0
    return {
        "nproc": nproc,
        "load_1": round(one, 2),
        "load_5": round(five, 2),
        "load_15": round(fifteen, 2),
        "load_ratio": round(one / nproc, 3) if nproc else 0.0,
    }


def _disk(path: str = "/") -> Dict[str, Any]:
    usage = shutil.disk_usage(path)
    used_pct = round(100.0 * usage.used / usage.total, 1) if usage.total else 0.0
    return {
        "path": path,
        "total_gb": round(usage.total / (1024 ** 3), 2),
        "used_gb": round(usage.used / (1024 ** 3), 2),
        "free_gb": round(usage.free / (1024 ** 3), 2),
        "used_pct": used_pct,
    }


def _mysql_snapshot() -> Dict[str, Any]:
    if mysql_settings_from_env is None:
        return {"ok": False, "error": "mysql_store unavailable"}
    try:
        import db_ssl
        import pymysql
        cfg = mysql_settings_from_env()
        conn = pymysql.connect(
            host=cfg["host"], port=int(cfg["port"]), user=cfg["user"],
            password=cfg["password"], database=cfg["db"], charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor, connect_timeout=3,
            **db_ssl.connect_kwargs(cfg),
        )
    except Exception as e:
        return {"ok": False, "error": str(e)}
    try:
        cur = conn.cursor()
        cur.execute("SHOW GLOBAL STATUS")
        st = {r["Variable_name"]: r["Value"] for r in cur.fetchall()}
        cur.execute(
            "SHOW VARIABLES WHERE Variable_name IN "
            "('max_connections','innodb_buffer_pool_size','slow_query_log','long_query_time','version')"
        )
        var = {r["Variable_name"]: r["Value"] for r in cur.fetchall()}
        cur.execute(
            "SELECT table_name AS name, table_rows AS est_rows, data_length AS data_length, index_length AS index_length "
            "FROM information_schema.tables WHERE table_schema=%s",
            (cfg["db"],),
        )
        raw_tables = cur.fetchall()
        tables = []
        for r in raw_tables:
            lower = {str(k).lower(): v for k, v in r.items()}
            tables.append({
                "name": lower.get("name") or lower.get("table_name"),
                "est_rows": lower.get("est_rows") or lower.get("table_rows"),
                "data_length": int(lower.get("data_length") or 0),
                "index_length": int(lower.get("index_length") or 0),
            })
        cur.execute(
            "SELECT collection, COUNT(*) AS n, ROUND(SUM(LENGTH(doc))/1024,1) AS kb "
            "FROM docs GROUP BY collection ORDER BY n DESC"
        )
        collections = cur.fetchall()
        reads = float(st.get("Innodb_buffer_pool_read_requests") or 0)
        disk = float(st.get("Innodb_buffer_pool_reads") or 0)
        hit = round(100.0 * (reads - disk) / reads, 3) if reads else 100.0
        threads = int(st.get("Threads_connected") or 0)
        running = int(st.get("Threads_running") or 0)
        max_conn = int(var.get("max_connections") or 151)
        return {
            "ok": True,
            "version": var.get("version"),
            "threads_connected": threads,
            "threads_running": running,
            "max_connections": max_conn,
            "conn_pct": round(100.0 * threads / max_conn, 1) if max_conn else 0,
            "questions": int(st.get("Questions") or 0),
            "slow_queries": int(st.get("Slow_queries") or 0),
            "uptime_sec": int(st.get("Uptime") or 0),
            "buffer_pool_bytes": int(var.get("innodb_buffer_pool_size") or 0),
            "buffer_hit_pct": hit,
            "slow_query_log": var.get("slow_query_log"),
            "long_query_time": var.get("long_query_time"),
            "tables": tables,
            "top_collections": collections[:15],
            "collection_count": len(collections),
            "doc_count": sum(int(r["n"]) for r in collections),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        try:
            conn.close()
        except Exception:
            pass


def evaluate(snap: Dict[str, Any]) -> List[Dict[str, str]]:
    alerts: List[Dict[str, str]] = []
    host = snap.get("host") or {}
    load = host.get("load") or {}
    mem = host.get("mem") or {}
    disk = host.get("disk") or {}
    mysql = snap.get("mysql") or {}
    if load.get("load_ratio", 0) >= CPU_LOAD_RATIO:
        alerts.append({"level": "warning", "code": "cpu_load", "message": f"1m load ratio {load.get('load_ratio')} (nproc={load.get('nproc')})"})
    if mem.get("used_pct", 0) >= MEM_PCT:
        alerts.append({"level": "critical", "code": "memory", "message": f"memory {mem.get('used_pct')}% used"})
    if disk.get("used_pct", 0) >= DISK_PCT:
        alerts.append({"level": "critical", "code": "disk", "message": f"disk {disk.get('path')} at {disk.get('used_pct')}%"})
    elif disk.get("used_pct", 0) >= DISK_PCT - 10:
        alerts.append({"level": "warning", "code": "disk", "message": f"disk {disk.get('path')} at {disk.get('used_pct')}%"})
    if mysql.get("ok"):
        if mysql.get("threads_running", 0) >= MYSQL_THREADS:
            alerts.append({"level": "warning", "code": "mysql_threads", "message": f"Threads_running={mysql.get('threads_running')}"})
        if mysql.get("conn_pct", 0) >= CONN_PCT:
            alerts.append({"level": "warning", "code": "mysql_connections", "message": f"connections {mysql.get('conn_pct')}% of max"})
        if mysql.get("buffer_hit_pct", 100) < POOL_HIT_MIN:
            alerts.append({"level": "warning", "code": "buffer_pool", "message": f"InnoDB buffer hit {mysql.get('buffer_hit_pct')}%"})
    elif mysql.get("error"):
        alerts.append({"level": "critical", "code": "mysql_down", "message": str(mysql.get("error"))})
    return alerts


def collect(disk_path: str = "/") -> Dict[str, Any]:
    snap = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "host": {
            "load": _loadavg(),
            "mem": _meminfo(),
            "disk": _disk(disk_path),
        },
        "mysql": _mysql_snapshot(),
        "thresholds": {
            "cpu_load_ratio": CPU_LOAD_RATIO,
            "mem_pct": MEM_PCT,
            "disk_pct": DISK_PCT,
            "mysql_threads": MYSQL_THREADS,
            "conn_pct": CONN_PCT,
            "buffer_hit_min": POOL_HIT_MIN,
        },
    }
    snap["alerts"] = evaluate(snap)
    snap["ok"] = not any(a["level"] == "critical" for a in snap["alerts"])
    return snap


def persist_snapshot(snap: Dict[str, Any], directory: Optional[Path] = None) -> Path:
    directory = Path(directory or log_dir())
    directory.mkdir(parents=True, exist_ok=True)
    latest = directory / "perf-latest.json"
    history = directory / "perf.jsonl"
    slim = dict(snap)
    mysql = dict(slim.get("mysql") or {})
    mysql.pop("tables", None)
    mysql["top_collections"] = (mysql.get("top_collections") or [])[:8]
    slim["mysql"] = mysql
    latest.write_text(json.dumps(slim, ensure_ascii=False, default=str, indent=2), encoding="utf-8")
    with history.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(slim, ensure_ascii=False, default=str) + "\n")
    if snap.get("alerts"):
        try:
            import applog
            for a in snap["alerts"]:
                fn = applog.log_error if a["level"] == "critical" else applog.log_event
                fn("perf_alert", a["message"], code=a["code"], level=a["level"])
        except Exception:
            pass
    return latest


def recommendations(snap: Dict[str, Any]) -> List[str]:
    recs = []
    mysql = snap.get("mysql") or {}
    host = snap.get("host") or {}
    disk = host.get("disk") or {}
    mem = host.get("mem") or {}
    pool = int(mysql.get("buffer_pool_bytes") or 0)
    docs = int(mysql.get("doc_count") or 0)
    if pool and pool < 256 * 1024 * 1024:
        recs.append("InnoDB buffer pool is under 256MB; raise innodb_buffer_pool_size toward 50–70% of dedicated MySQL RAM (see mysql/perf.cnf).")
    if mysql.get("slow_query_log") in {None, "OFF", "0"}:
        recs.append("Enable slow_query_log (long_query_time=1) so overloaded queries are visible in tamkobi-slow.log.")
    if docs > 20000:
        recs.append("docs row count is growing; keep using company_id generated column filters and consider splitting hot collections (invoices, activity_logs) into native tables.")
    if disk.get("used_pct", 0) >= 80:
        recs.append(f"Filesystem {disk.get('path')} is {disk.get('used_pct')}% full; expand disk or purge logs/backups before MySQL cannot extend InnoDB files.")
    if mem.get("used_pct", 0) >= 75:
        recs.append("Host memory is getting tight; cap MySQL buffer pool and avoid increasing max_connections without RAM.")
    if mysql.get("ok") and mysql.get("conn_pct", 0) < 20 and int(mysql.get("max_connections") or 0) > 200:
        recs.append("max_connections is oversized for current use; lower it to protect RAM (each connection ~8–16MB).")
    if not recs:
        recs.append("No urgent scaling action. Keep the 60s perf snapshot and rotate logs.")
    return recs


def write_report(snap: Optional[Dict[str, Any]] = None, dest: Optional[Path] = None) -> Path:
    snap = snap or collect()
    dest = dest or Path(__file__).resolve().parent.parent / "docs" / "mysql-performance-report.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    mysql = snap.get("mysql") or {}
    host = snap.get("host") or {}
    recs = recommendations(snap)
    lines = [
        "# TamKobi MySQL performance report",
        "",
        f"Generated: `{snap.get('ts')}`",
        "",
        "## Host",
        "",
        f"- CPUs: **{(host.get('load') or {}).get('nproc')}** · load 1/5/15: {(host.get('load') or {}).get('load_1')} / {(host.get('load') or {}).get('load_5')} / {(host.get('load') or {}).get('load_15')}",
        f"- Memory used: **{(host.get('mem') or {}).get('used_pct')}%** ({(host.get('mem') or {}).get('available_kb')} kB available)",
        f"- Disk `{ (host.get('disk') or {}).get('path') }`: **{(host.get('disk') or {}).get('used_pct')}%** ({(host.get('disk') or {}).get('free_gb')} GB free)",
        "",
        "## MySQL",
        "",
        f"- Version: `{mysql.get('version')}` ok={mysql.get('ok')}",
        f"- Connections: {mysql.get('threads_connected')}/{mysql.get('max_connections')} ({mysql.get('conn_pct')}%) · running {mysql.get('threads_running')}",
        f"- Buffer pool: {round((mysql.get('buffer_pool_bytes') or 0)/1024/1024)} MB · hit **{mysql.get('buffer_hit_pct')}%**",
        f"- Slow query log: `{mysql.get('slow_query_log')}` long_query_time={mysql.get('long_query_time')} · Slow_queries={mysql.get('slow_queries')}",
        f"- Documents: **{mysql.get('doc_count')}** in **{mysql.get('collection_count')}** collections",
        "",
        "### Top collections",
        "",
        "| collection | rows | KB |",
        "|---|---:|---:|",
    ]
    for c in mysql.get("top_collections") or []:
        lines.append(f"| `{c.get('collection')}` | {c.get('n')} | {c.get('kb')} |")
    lines += ["", "### Tables", "", "| table | est. rows | data | indexes |", "|---|---:|---:|---:|"]
    for t in mysql.get("tables") or []:
        lines.append(f"| `{t.get('name')}` | {t.get('est_rows')} | {t.get('data_length')} | {t.get('index_length')} |")
    lines += ["", "## Alerts", ""]
    if snap.get("alerts"):
        for a in snap["alerts"]:
            lines.append(f"- **{a['level']}** `{a['code']}` — {a['message']}")
    else:
        lines.append("- None at this snapshot.")
    lines += ["", "## Scaling & optimization", ""]
    for i, r in enumerate(recs, 1):
        lines.append(f"{i}. {r}")
    lines += [
        "",
        "## How this monitor runs",
        "",
        "- `python -m perfmon snapshot` — one-shot JSON to stdout",
        "- `python -m perfmon report` — rewrite this markdown",
        "- `backend/scripts/perf-monitor.sh` — cron every minute",
        "- backend `perfmon.loop()` — in-process while the API is up",
        "- Super admin: `GET /api/system/perf`",
        "",
    ]
    dest.write_text("\n".join(lines), encoding="utf-8")
    return dest


async def loop():
    import asyncio
    while True:
        try:
            persist_snapshot(collect())
        except Exception:
            pass
        await asyncio.sleep(max(15, INTERVAL_SEC))


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="TamKobi MySQL/host performance monitor")
    parser.add_argument("command", nargs="?", default="snapshot", choices=["snapshot", "report", "once"])
    args = parser.parse_args(argv)
    snap = collect()
    persist_snapshot(snap)
    if args.command == "report":
        path = write_report(snap)
        print(path)
        return
    print(json.dumps(snap, ensure_ascii=False, default=str, indent=2))


if __name__ == "__main__":
    main()
