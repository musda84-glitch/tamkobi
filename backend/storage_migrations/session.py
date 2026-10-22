"""Hedef veritabanı bağlantısı. Legacy ve canlı kimlik reddedilir."""
from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from urllib.parse import unquote, urlparse

from .errors import DryRunError, LegacyTargetError, MigrationError
from .masking import add_secret

_READ = re.compile(r"^(select|show|pragma|with|explain)\b", re.IGNORECASE)
_LOOPBACK = frozenset({"localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"})

_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  state VARCHAR(16) NOT NULL,
  step_no INTEGER NOT NULL,
  applied_at VARCHAR(40) NOT NULL
)
""".strip()


class Session:
    """Tek hedef. read_only iken yazan ifade çalışmaz."""

    def __init__(self, conn, dialect: str, *, read_only: bool):
        self.conn = conn
        self.dialect = dialect
        self.read_only = read_only
        self.missing = False

    def execute(self, sql: str, params=None):
        statement = sql.strip().rstrip(";").strip()
        if self.read_only and not _READ.match(statement):
            raise DryRunError("dry-run yazmaz")
        adapted = statement
        if self.dialect == "mysql" and params:
            adapted = statement.replace("?", "%s")
        cursor = self.conn.cursor()
        if params:
            cursor.execute(adapted, tuple(params))
        else:
            cursor.execute(adapted)
        return cursor

    def fetchall(self, sql: str, params=None):
        return self.execute(sql, params).fetchall()

    def commit(self) -> None:
        if self.read_only or self.conn is None:
            return
        self.conn.commit()

    def rollback(self) -> None:
        if self.conn is None:
            return
        self.conn.rollback()

    def close(self) -> None:
        conn = self.conn
        self.conn = None
        if conn is not None:
            conn.close()

    def tables(self) -> set[str]:
        if self.conn is None:
            return set()
        if self.dialect == "sqlite":
            rows = self.fetchall(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
            )
        else:
            rows = self.fetchall(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = DATABASE()"
            )
        return {str(row[0]).lower() for row in rows}


class MissingSession(Session):
    """Dosya yok. Dry-run dosyayı oluşturmaz."""

    def __init__(self):
        super().__init__(None, "sqlite", read_only=True)
        self.missing = True

    def tables(self) -> set[str]:
        return set()

    def execute(self, sql: str, params=None):
        raise DryRunError("dry-run yazmaz")

    def commit(self) -> None:
        return

    def rollback(self) -> None:
        return

    def close(self) -> None:
        return


def schema_sql() -> str:
    return _SCHEMA


def connect(dsn: str, *, write: bool) -> Session:
    """DSN'i loglamadan aç. Canlı MySQL kimliğiyle çakışırsa açma."""
    add_secret(dsn)
    assert_not_live(dsn)
    scheme = dsn.split("://", 1)[0].lower()
    if scheme in ("sqlite", "sqlite3"):
        return _connect_sqlite(dsn, write=write)
    if scheme in ("mysql", "mariadb") or scheme.startswith("mysql+") or scheme.startswith("mariadb+"):
        return _connect_mysql(dsn, write=write)
    raise MigrationError("Desteklenmeyen hedef.")


def assert_not_live(dsn: str) -> None:
    ident = mysql_identity(dsn)
    if ident is None:
        return
    live = live_mysql_identity()
    if live is not None and ident == live:
        raise LegacyTargetError("Canlı uygulama veritabanı reddedildi.")


def canonical_host(host: str) -> str:
    """localhost, 127.0.0.1 ve ::1 aynı kimlik sayılır. Bağlantı adresini değiştirmez."""
    text = str(host or "").strip().lower()
    if len(text) >= 2 and text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    if text in _LOOPBACK:
        return "loopback"
    return text


def mysql_identity(dsn: str):
    text = str(dsn or "").strip()
    if not text.startswith("mysql") and not text.startswith("mariadb"):
        return None
    parsed = urlparse(_normalize_mysql(text))
    host = canonical_host(parsed.hostname or "")
    name = (parsed.path or "").lstrip("/").split("?")[0]
    if not host or not name:
        raise MigrationError("MySQL hedefi eksik.")
    return (host, parsed.port or 3306, name)


def live_mysql_identity():
    """Ayarlıysa canlı kimlik. Varsayılan host uydurulmaz, bağlantı açılmaz."""
    url = (os.environ.get("MYSQL_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if url.startswith("mysql") or url.startswith("mariadb"):
        return mysql_identity(url)
    host = (os.environ.get("MYSQL_HOST") or "").strip()
    name = (os.environ.get("MYSQL_DATABASE") or os.environ.get("DB_NAME") or "").strip()
    if not host or not name:
        return None
    try:
        port = int(os.environ.get("MYSQL_PORT") or "3306")
    except ValueError:
        return None
    return (canonical_host(host), port, name)


def sqlite_path(dsn: str) -> str:
    parsed = urlparse(dsn)
    path = parsed.path or ""
    if path in ("/:memory:", "/:memory"):
        return ":memory:"
    if path.startswith("/") and len(path) > 1:
        return path
    raise MigrationError("SQLite yolu çözülemedi.")


def _normalize_mysql(dsn: str) -> str:
    if dsn.startswith("mysql+") or dsn.startswith("mariadb+"):
        return "mysql://" + dsn.split("://", 1)[1]
    if dsn.startswith("mariadb://"):
        return "mysql://" + dsn.split("://", 1)[1]
    return dsn


def _connect_sqlite(dsn: str, *, write: bool) -> Session:
    path = sqlite_path(dsn)
    if path == ":memory:":
        if not write:
            return MissingSession()
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        return Session(conn, "sqlite", read_only=False)
    if not write:
        if not os.path.exists(path):
            return MissingSession()
        uri = Path(path).resolve().as_uri() + "?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")
        return Session(conn, "sqlite", read_only=True)
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return Session(conn, "sqlite", read_only=False)


def _connect_mysql(dsn: str, *, write: bool) -> Session:
    import pymysql

    parsed = urlparse(_normalize_mysql(dsn))
    database = (parsed.path or "").lstrip("/").split("?")[0]
    if not parsed.hostname or not database:
        raise MigrationError("MySQL hedefi eksik.")
    conn = pymysql.connect(
        host=parsed.hostname,
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        database=database,
        charset="utf8mb4",
        autocommit=False,
        connect_timeout=5,
    )
    if not write:
        try:
            cursor = conn.cursor()
            cursor.execute("SET SESSION TRANSACTION READ ONLY")
            conn.commit()
        except Exception:
            conn.rollback()
    return Session(conn, "mysql", read_only=not write)
