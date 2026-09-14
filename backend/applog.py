"""TamKobi application, auth, error and SQL logging.

File layout under LOG_DIR (default /var/log/tamkobi, else ./logs):
  app.log    important events
  auth.log   logins / logouts / lockouts
  error.log  exceptions and HTTP 5xx
  sql.log    document-store writes and slow queries

Also persists a subset of those records to MySQL table ``system_logs``.
Rotation (size + retention) lives in ``scripts/rotate-logs.sh`` and
``python -m applog rotate``.
"""
from __future__ import annotations

import json
import logging
import os
import time
import traceback
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Dict, Optional

LOG_DIR_ENV = "LOG_DIR"
LOG_MAX_BYTES = int(os.environ.get("LOG_MAX_BYTES", str(50 * 1024 * 1024)))
LOG_BACKUP_COUNT = int(os.environ.get("LOG_BACKUP_COUNT", "14"))
LOG_RETENTION_DAYS = int(os.environ.get("LOG_RETENTION_DAYS", "14"))
LOG_SQL_SLOW_MS = float(os.environ.get("LOG_SQL_SLOW_MS", "200"))
LOG_SLOW_REQUEST_MS = float(os.environ.get("LOG_SLOW_REQUEST_MS", "1500"))

APP_LOGGER = "tamkobi.app"
AUTH_LOGGER = "tamkobi.auth"
ERROR_LOGGER = "tamkobi.error"
SQL_LOGGER = "tamkobi.sql"
ROOT_APP = "TamKobiERP"

_SENSITIVE = {
    "password", "password_hash", "current_password", "new_password", "token",
    "access_token", "refresh_token", "b2b_token", "b2b_password_hash",
    "secret", "api_key", "authorization", "cookie", "credit_card", "card_number",
    "cvv", "pin", "shopfloor_pin_hash",
}
_NOISE_SQL_COLLECTIONS = {"activity_logs", "login_attempts"}
_CRITICAL_COLLECTIONS = {
    "users", "invoices", "contacts", "products", "orders", "companies",
    "bank_transactions", "bank_accounts", "payroll", "employees", "quotes",
    "dispatches", "cheques", "roles", "company_licenses", "integrations",
}

_configured = False
_persist_lock = 0


def log_dir() -> Path:
    raw = (os.environ.get(LOG_DIR_ENV) or "").strip()
    if raw:
        return Path(raw)
    if Path("/var/log/tamkobi").is_dir() and os.access("/var/log/tamkobi", os.W_OK):
        return Path("/var/log/tamkobi")
    p = Path(__file__).resolve().parent.parent / "logs"
    return p


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def redact(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            key = str(k).lower()
            if key in _SENSITIVE or any(s in key for s in ("password", "secret", "token", "authorization")):
                out[k] = "***"
            else:
                out[k] = redact(v)
        return out
    if isinstance(obj, list):
        return [redact(x) for x in obj[:50]]
    if isinstance(obj, str) and len(obj) > 4000:
        return obj[:4000] + "…"
    return obj


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        extra = getattr(record, "event_data", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def _handler(path: Path, level: int) -> RotatingFileHandler:
    path.parent.mkdir(parents=True, exist_ok=True)
    h = RotatingFileHandler(str(path), maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUP_COUNT, encoding="utf-8")
    h.setLevel(level)
    h.setFormatter(JsonFormatter())
    return h


def setup_logging() -> Path:
    """Idempotent: file + stderr handlers for app/auth/error/sql loggers."""
    global _configured
    directory = log_dir()
    directory.mkdir(parents=True, exist_ok=True)
    if _configured:
        return directory

    stderr = logging.StreamHandler()
    stderr.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
    stderr.setLevel(logging.INFO)

    mapping = {
        APP_LOGGER: (directory / "app.log", logging.INFO),
        AUTH_LOGGER: (directory / "auth.log", logging.INFO),
        ERROR_LOGGER: (directory / "error.log", logging.ERROR),
        SQL_LOGGER: (directory / "sql.log", logging.INFO),
        ROOT_APP: (directory / "app.log", logging.INFO),
    }
    for name, (path, level) in mapping.items():
        lg = logging.getLogger(name)
        lg.setLevel(logging.INFO)
        lg.propagate = False
        if not any(isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", "") == str(path) for h in lg.handlers):
            lg.addHandler(_handler(path, level))
        if stderr not in lg.handlers:
            lg.addHandler(stderr)

    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    _configured = True
    return directory


from client_ip import request_ip


def client_ip(request) -> str:
    try:
        return request_ip(request)
    except Exception:
        return "unknown"


def _emit(logger_name: str, level: int, event: str, message: str, **fields):
    setup_logging()
    data = redact({"category": logger_name.split(".")[-1], "event": event, **{k: v for k, v in fields.items() if v is not None}})
    logging.getLogger(logger_name).log(level, message, extra={"event_data": data})
    persist_record({"level": logging.getLevelName(level), "category": data.get("category"), "event": event, "message": message, **data})


def log_event(event: str, message: str = "", **fields):
    _emit(APP_LOGGER, logging.INFO, event, message or event, **fields)


def log_auth(event: str, message: str = "", **fields):
    _emit(AUTH_LOGGER, logging.INFO, event, message or event, **fields)


def log_error(event: str, message: str = "", exc: Optional[BaseException] = None, **fields):
    if exc is not None:
        fields["error_type"] = type(exc).__name__
        fields["error"] = str(exc)
        fields["traceback"] = traceback.format_exc()
    _emit(ERROR_LOGGER, logging.ERROR, event, message or event, **fields)


def log_sql(op: str, collection: str, doc_id: Any = None, duration_ms: float = 0, **fields):
    if collection in _NOISE_SQL_COLLECTIONS:
        return
    slow = duration_ms >= LOG_SQL_SLOW_MS
    write = op in {"INSERT", "REPLACE", "DELETE", "UPDATE"}
    if not write and not slow:
        return
    level = logging.WARNING if slow else logging.INFO
    if write and collection not in _CRITICAL_COLLECTIONS and not slow:
        # still file-log writes on lesser collections, skip MySQL persist
        setup_logging()
        logging.getLogger(SQL_LOGGER).info(
            "%s %s id=%s duration_ms=%.1f", op, collection, doc_id, duration_ms,
            extra={"event_data": {"event": "sql_write", "op": op, "collection": collection, "doc_id": str(doc_id) if doc_id else None, "duration_ms": round(duration_ms, 1)}},
        )
        return
    _emit(
        SQL_LOGGER, level, "sql_slow" if slow and not write else "sql_write",
        f"{op} {collection} id={doc_id} duration_ms={duration_ms:.1f}",
        op=op, collection=collection, doc_id=str(doc_id) if doc_id else None,
        duration_ms=round(duration_ms, 1), **fields,
    )


def persist_record(rec: dict) -> None:
    """Best-effort INSERT into system_logs. Never raises."""
    global _persist_lock
    if os.environ.get("LOG_DB_PERSIST", "1").lower() in {"0", "false", "no"}:
        return
    if _persist_lock:
        return
    category = rec.get("category") or "event"
    event = rec.get("event") or "unknown"
    # Don't persist high-volume SQL file-only noise
    if category == "sql" and rec.get("collection") not in _CRITICAL_COLLECTIONS and rec.get("event") != "sql_slow":
        return
    _persist_lock = 1
    try:
        from mysql_store import mysql_settings_from_env
        import db_ssl
        import pymysql
        cfg = mysql_settings_from_env()
        conn = pymysql.connect(
            host=cfg["host"], port=int(cfg["port"]), user=cfg["user"],
            password=cfg["password"], database=cfg["db"], charset="utf8mb4",
            autocommit=True, connect_timeout=2, **db_ssl.connect_kwargs(cfg),
        )
        try:
            details = {k: v for k, v in rec.items() if k not in {
                "level", "category", "event", "message", "user_id", "user_email",
                "company_id", "ip", "method", "path", "status_code", "duration_ms",
                "collection", "logger",
            }}
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO system_logs
                       (level, category, event, user_id, user_email, company_id, ip,
                        method, path, status_code, duration_ms, collection_name, message, details)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        rec.get("level") or "INFO",
                        category,
                        event[:64],
                        rec.get("user_id"),
                        rec.get("user_email") or rec.get("email"),
                        rec.get("company_id"),
                        rec.get("ip"),
                        rec.get("method"),
                        (rec.get("path") or "")[:512] or None,
                        rec.get("status_code"),
                        rec.get("duration_ms"),
                        rec.get("collection"),
                        (rec.get("message") or event)[:65000],
                        json.dumps(redact(details), ensure_ascii=False, default=str) if details else None,
                    ),
                )
        finally:
            conn.close()
    except Exception:
        pass
    finally:
        _persist_lock = 0


def query_logs(category: Optional[str] = None, event: Optional[str] = None,
               user_email: Optional[str] = None, limit: int = 100) -> list:
    from mysql_store import mysql_settings_from_env
    import db_ssl
    import pymysql
    cfg = mysql_settings_from_env()
    conn = pymysql.connect(
        host=cfg["host"], port=int(cfg["port"]), user=cfg["user"],
        password=cfg["password"], database=cfg["db"], charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor, connect_timeout=5,
        **db_ssl.connect_kwargs(cfg),
    )
    where, args = ["1=1"], []
    if category:
        where.append("category=%s")
        args.append(category)
    if event:
        where.append("event=%s")
        args.append(event)
    if user_email:
        where.append("user_email=%s")
        args.append(user_email)
    sql = f"SELECT id, created_at, level, category, event, user_id, user_email, company_id, ip, method, path, status_code, duration_ms, collection_name, message, details FROM system_logs WHERE {' AND '.join(where)} ORDER BY id DESC LIMIT %s"
    args.append(min(int(limit or 100), 500))
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            rows = cur.fetchall()
        for r in rows:
            if r.get("created_at"):
                r["created_at"] = r["created_at"].isoformat()
            if isinstance(r.get("details"), (bytes, str)):
                try:
                    r["details"] = json.loads(r["details"])
                except Exception:
                    pass
        return rows
    finally:
        conn.close()


def purge_system_logs(retention_days: Optional[int] = None) -> int:
    if os.environ.get("LOG_DB_PERSIST", "1").lower() in {"0", "false", "no"}:
        return 0
    days = int(retention_days if retention_days is not None else LOG_RETENTION_DAYS)
    from mysql_store import mysql_settings_from_env
    import db_ssl
    import pymysql
    cfg = mysql_settings_from_env()
    conn = pymysql.connect(
        host=cfg["host"], port=int(cfg["port"]), user=cfg["user"],
        password=cfg["password"], database=cfg["db"], charset="utf8mb4", autocommit=True,
        **db_ssl.connect_kwargs(cfg),
    )
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM system_logs WHERE created_at < (UTC_TIMESTAMP() - INTERVAL %s DAY)", (days,))
            return int(cur.rowcount or 0)
    finally:
        conn.close()


def rotate_files(directory: Optional[Path] = None, max_bytes: Optional[int] = None,
                 retention_days: Optional[int] = None) -> Dict[str, Any]:
    """Copy-truncate oversized *.log files, gzip snapshots, drop old gz."""
    import gzip
    import shutil
    directory = Path(directory or log_dir())
    max_bytes = int(max_bytes if max_bytes is not None else LOG_MAX_BYTES)
    retention_days = int(retention_days if retention_days is not None else LOG_RETENTION_DAYS)
    directory.mkdir(parents=True, exist_ok=True)
    rotated, deleted = [], []
    cutoff = time.time() - retention_days * 86400
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    for path in sorted(directory.glob("*.log")):
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size < max_bytes:
            continue
        dest = path.with_name(f"{path.name}.{stamp}")
        shutil.copy2(path, dest)
        path.write_text("", encoding="utf-8")
        gz = Path(str(dest) + ".gz")
        with open(dest, "rb") as src, gzip.open(gz, "wb") as out:
            shutil.copyfileobj(src, out)
        dest.unlink(missing_ok=True)
        rotated.append(str(gz))
    for path in directory.glob("*.log.*"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                deleted.append(str(path))
        except OSError:
            continue
    purged = 0
    try:
        purged = purge_system_logs(retention_days)
    except Exception:
        purged = -1
    return {"log_dir": str(directory), "rotated": rotated, "deleted": deleted, "purged_rows": purged, "max_bytes": max_bytes, "retention_days": retention_days}


async def rotation_loop():
    interval = int(os.environ.get("LOG_ROTATE_INTERVAL_SEC", str(6 * 3600)))
    while True:
        await _sleep(interval)
        try:
            rotate_files()
        except Exception:
            logging.getLogger(ERROR_LOGGER).exception("log rotation failed")


async def _sleep(seconds: int):
    import asyncio
    await asyncio.sleep(seconds)


from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest


class RequestLogMiddleware(BaseHTTPMiddleware):
    """5xx and slow API requests."""

    async def dispatch(self, request: StarletteRequest, call_next):
        t0 = time.perf_counter()
        path = request.url.path
        method = request.method
        try:
            response = await call_next(request)
        except Exception as exc:
            log_error(
                "unhandled_exception",
                str(exc),
                exc=exc,
                method=method,
                path=path,
                ip=client_ip(request),
            )
            raise
        ms = (time.perf_counter() - t0) * 1000
        if response.status_code >= 500:
            log_error(
                "http_5xx", f"{method} {path} -> {response.status_code}",
                method=method, path=path, status_code=response.status_code,
                duration_ms=round(ms, 1), ip=client_ip(request),
            )
        elif path.startswith("/api") and ms >= LOG_SLOW_REQUEST_MS and not path.startswith("/api/health"):
            log_event(
                "slow_request", f"{method} {path} {ms:.0f}ms",
                method=method, path=path, status_code=response.status_code,
                duration_ms=round(ms, 1), ip=client_ip(request),
            )
        return response


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="TamKobi log tools")
    parser.add_argument("command", nargs="?", default="rotate", choices=["rotate", "setup"])
    args = parser.parse_args(argv)
    if args.command == "setup":
        p = setup_logging()
        print(f"log dir: {p}")
        return
    print(json.dumps(rotate_files(), indent=2))


if __name__ == "__main__":
    main()
