"""Dump and restore the TamKobi MySQL database without requiring the mysql client.

Snapshots are gzip JSON (canonical for this tool) plus a sibling .sql.gz for DBAs.
Generated/virtual columns are omitted from INSERT lists so restore works on both
the canonical schema and live databases that added extras (company_id, system_logs).
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlparse

DEFAULT_KEEP_DAYS = 14
DEFAULT_DIR_NAME = "backups/mysql"
TEST_DATABASE = "tamkobi_schema_test"


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = val


def load_env(repo_root: Optional[Path] = None) -> None:
    root = repo_root or Path(__file__).resolve().parents[1]
    _load_dotenv(root / "backend" / ".env")
    _load_dotenv(root / ".env")


def _ssl_from_env() -> Dict[str, Any]:
    import db_ssl

    mode, ca = db_ssl.from_env()
    return {"ssl_mode": mode, "ssl_ca": ca}


def mysql_settings(user: Optional[str] = None, password: Optional[str] = None, db: Optional[str] = None) -> Dict[str, Any]:
    url = (os.environ.get("MYSQL_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if url.startswith("mysql"):
        if url.startswith("mysql+"):
            url = "mysql://" + url.split("://", 1)[1]
        parsed = urlparse(url)
        database = (parsed.path or "/tamkobi").lstrip("/") or "tamkobi"
        database = database.split("?")[0] or "tamkobi"
        return {
            "host": parsed.hostname or os.environ.get("MYSQL_HOST", "127.0.0.1"),
            "port": parsed.port or int(os.environ.get("MYSQL_PORT", "3306")),
            "user": user or unquote(parsed.username or os.environ.get("MYSQL_USER", "tamkobi")),
            "password": password if password is not None else unquote(parsed.password or os.environ.get("MYSQL_PASSWORD", "tamkobi")),
            "database": db or os.environ.get("MYSQL_DATABASE") or os.environ.get("DB_NAME") or database,
            "charset": "utf8mb4",
            **_ssl_from_env(),
        }
    return {
        "host": os.environ.get("MYSQL_HOST", "127.0.0.1"),
        "port": int(os.environ.get("MYSQL_PORT", "3306")),
        "user": user or os.environ.get("MYSQL_USER", "tamkobi"),
        "password": password if password is not None else os.environ.get("MYSQL_PASSWORD", os.environ.get("DB_PASSWORD", "tamkobi")),
        "database": db or os.environ.get("MYSQL_DATABASE") or os.environ.get("DB_NAME") or "tamkobi",
        "charset": "utf8mb4",
        **_ssl_from_env(),
    }


def connect(settings: Optional[dict] = None, database: Optional[str] = None):
    import pymysql

    import db_ssl

    cfg = dict(settings or mysql_settings())
    if database is not None:
        cfg["database"] = database
    return pymysql.connect(
        host=cfg["host"],
        port=int(cfg["port"]),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg.get("database") or None,
        charset=cfg.get("charset") or "utf8mb4",
        autocommit=True,
        cursorclass=pymysql.cursors.Cursor,
        **db_ssl.connect_kwargs(cfg),
    )


def _is_generated(extra: str) -> bool:
    extra = (extra or "").upper()
    return "GENERATED" in extra or "VIRTUAL" in extra or extra.startswith("STORED")


def _table_columns(cur, table: str) -> List[dict]:
    cur.execute(f"SHOW FULL COLUMNS FROM `{table}`")
    # Field, Type, Collation, Null, Key, Default, Extra, Privileges, Comment
    cols = []
    for row in cur.fetchall():
        cols.append({"name": row[0], "type": row[1], "null": row[3], "extra": row[6] or ""})
    return cols


def _writable_columns(cols: Sequence[dict]) -> List[str]:
    return [c["name"] for c in cols if not _is_generated(c["extra"])]


def snapshot_database(settings: Optional[dict] = None) -> dict:
    cfg = settings or mysql_settings()
    conn = connect(cfg)
    try:
        cur = conn.cursor()
        cur.execute("SELECT DATABASE()")
        dbname = cur.fetchone()[0]
        cur.execute("SHOW TABLES")
        tables = [r[0] for r in cur.fetchall()]
        out = {
            "format": "tamkobi-mysql-snapshot-v1",
            "database": dbname,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "tables": {},
        }
        for table in tables:
            cur.execute(f"SHOW CREATE TABLE `{table}`")
            create_sql = cur.fetchone()[1]
            cols = _table_columns(cur, table)
            writable = _writable_columns(cols)
            col_list = ", ".join(f"`{c}`" for c in writable)
            rows: List[list] = []
            if writable:
                cur.execute(f"SELECT {col_list} FROM `{table}`")
                for raw in cur.fetchall():
                    rows.append([_jsonable(v) for v in raw])
            out["tables"][table] = {
                "create": create_sql,
                "columns": writable,
                "column_meta": cols,
                "row_count": len(rows),
                "rows": rows,
            }
        return out
    finally:
        conn.close()


def _jsonable(v):
    if v is None:
        return None
    if isinstance(v, (bytes, bytearray)):
        try:
            return v.decode("utf-8")
        except UnicodeDecodeError:
            import base64

            return {"$b64": base64.b64encode(v).decode("ascii")}
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if isinstance(v, (dict, list)):
        return v
    return v


def _sql_literal(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, dict) and "$b64" in v:
        return "X'" + bytes(v["$b64"], "ascii").hex() + "'"  # placeholder; restore uses pymysql params
    if isinstance(v, (dict, list)):
        s = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    else:
        s = str(v)
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r") + "'"


def snapshot_to_sql(snap: dict) -> str:
    lines = [
        f"-- TamKobi MySQL snapshot {snap.get('created_at')}",
        f"-- database {snap.get('database')}",
        "SET NAMES utf8mb4;",
        "SET FOREIGN_KEY_CHECKS=0;",
        "",
    ]
    for table, body in snap.get("tables", {}).items():
        lines.append(f"DROP TABLE IF EXISTS `{table}`;")
        create = body["create"]
        # SHOW CREATE TABLE is for the source schema; keep as-is.
        if not create.rstrip().endswith(";"):
            create = create.rstrip() + ";"
        lines.append(create)
        cols = body.get("columns") or []
        if cols and body.get("rows"):
            col_sql = ", ".join(f"`{c}`" for c in cols)
            for row in body["rows"]:
                vals = ", ".join(_sql_literal(v) for v in row)
                lines.append(f"INSERT INTO `{table}` ({col_sql}) VALUES ({vals});")
        lines.append("")
    lines.append("SET FOREIGN_KEY_CHECKS=1;")
    return "\n".join(lines) + "\n"


def default_backup_dir(repo_root: Optional[Path] = None) -> Path:
    override = os.environ.get("MYSQL_BACKUP_DIR", "").strip()
    if override:
        return Path(override)
    root = repo_root or Path(__file__).resolve().parents[1]
    return root / DEFAULT_DIR_NAME


def write_snapshot(snap: dict, dest_dir: Path, prefix: Optional[str] = None) -> Tuple[Path, Path]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    name = prefix or snap.get("database") or "tamkobi"
    json_path = dest_dir / f"{name}-{stamp}.json.gz"
    sql_path = dest_dir / f"{name}-{stamp}.sql.gz"
    payload = json.dumps(snap, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_path.write_bytes(gzip.compress(payload, compresslevel=6))
    sql_path.write_bytes(gzip.compress(snapshot_to_sql(snap).encode("utf-8"), compresslevel=6))
    meta = {
        "json": str(json_path),
        "sql": str(sql_path),
        "database": snap.get("database"),
        "created_at": snap.get("created_at"),
        "tables": {t: body.get("row_count") for t, body in snap.get("tables", {}).items()},
    }
    (dest_dir / f"{name}-{stamp}.meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return json_path, sql_path


def rotate_backups(dest_dir: Path, keep_days: int = DEFAULT_KEEP_DAYS, prefix: str = "tamkobi") -> List[Path]:
    if keep_days < 0 or not dest_dir.is_dir():
        return []
    cutoff = time.time() - keep_days * 86400
    removed: List[Path] = []
    for path in dest_dir.iterdir():
        if not path.name.startswith(prefix + "-"):
            continue
        if path.suffix not in {".gz", ".json"} and not path.name.endswith(".meta.json"):
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed.append(path)
        except OSError:
            continue
    return removed


def load_snapshot_file(path: Path) -> dict:
    raw = path.read_bytes()
    if path.name.endswith(".gz"):
        raw = gzip.decompress(raw)
    text = raw.decode("utf-8")
    if path.name.endswith(".sql") or path.name.endswith(".sql.gz"):
        raise ValueError("SQL dumps restore via mysql client; use the .json.gz snapshot")
    data = json.loads(text)
    if data.get("format") != "tamkobi-mysql-snapshot-v1":
        raise ValueError(f"unknown snapshot format: {data.get('format')}")
    return data


def _root_settings(target_db: str) -> dict:
    """Connect as root when creating/dropping a database (restore-to-temp)."""
    base = mysql_settings()
    root_pw = os.environ.get("MYSQL_ROOT_PASSWORD") or os.environ.get("DB_PASSWORD") or base["password"]
    return {
        **base,
        "user": os.environ.get("MYSQL_ROOT_USER", "root"),
        "password": root_pw,
        "database": target_db,
    }


def ensure_database(name: str, as_root: bool = True) -> None:
    cfg = _root_settings(name) if as_root else mysql_settings(db=None)
    conn = connect({**cfg, "database": "mysql"} if as_root else {**mysql_settings(), "database": None})
    try:
        cur = conn.cursor()
        cur.execute(
            f"CREATE DATABASE IF NOT EXISTS `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        )
    finally:
        conn.close()


def drop_database(name: str) -> None:
    if name in {"mysql", "information_schema", "performance_schema", "sys"}:
        raise ValueError("refusing to drop system database")
    cfg = _root_settings(name)
    conn = connect({**cfg, "database": "mysql"})
    try:
        cur = conn.cursor()
        cur.execute(f"DROP DATABASE IF EXISTS `{name}`")
    finally:
        conn.close()


INSERT_CHUNK = 200


def restore_snapshot(
    snap: dict,
    target_db: str,
    drop_tables: bool = True,
    as_root: bool = False,
    settings: Optional[dict] = None,
) -> dict:
    """Recreate every table from `snap` in `target_db`.

    `settings` restores into an arbitrary server (another host); without it the
    target is the configured local server, optionally reached as root.
    """
    if settings is not None:
        cfg = dict(settings)
    elif as_root:
        ensure_database(target_db, as_root=True)
        cfg = _root_settings(target_db)
    else:
        cfg = mysql_settings(db=target_db)
    conn = connect(cfg, database=target_db)
    restored = {}
    try:
        cur = conn.cursor()
        cur.execute("SET FOREIGN_KEY_CHECKS=0")
        if drop_tables:
            cur.execute("SHOW TABLES")
            existing = [r[0] for r in cur.fetchall()]
            for table in existing:
                cur.execute(f"DROP TABLE IF EXISTS `{table}`")
        for table, body in snap.get("tables", {}).items():
            create = body["create"]
            # Rewrite CREATE TABLE to not include source DB qualifiers.
            create = re.sub(r"CREATE TABLE `[^`]+`\.", "CREATE TABLE ", create)
            cur.execute(create)
            cols = body.get("columns") or []
            rows = body.get("rows") or []
            if cols and rows:
                placeholders = ",".join(["%s"] * len(cols))
                col_sql = ", ".join(f"`{c}`" for c in cols)
                sql = f"INSERT INTO `{table}` ({col_sql}) VALUES ({placeholders})"
                payload = [tuple(_bind(v) for v in row) for row in rows]
                # Chunked so a large docs table stays under max_allowed_packet.
                for start in range(0, len(payload), INSERT_CHUNK):
                    cur.executemany(sql, payload[start : start + INSERT_CHUNK])
            restored[table] = len(rows)
        cur.execute("SET FOREIGN_KEY_CHECKS=1")
        return restored
    finally:
        conn.close()


def _bind(v):
    if isinstance(v, dict) and "$b64" in v:
        import base64

        return base64.b64decode(v["$b64"])
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    return v


def verify_snapshot_file(path: Path) -> dict:
    snap = load_snapshot_file(path)
    tables = snap.get("tables") or {}
    if "docs" not in tables:
        raise AssertionError("snapshot missing docs table")
    if "meta_indexes" not in tables:
        raise AssertionError("snapshot missing meta_indexes table")
    docs = tables["docs"]
    if "collection" not in docs.get("columns", []) or "doc" not in docs.get("columns", []):
        raise AssertionError("docs columns incomplete")
    return {
        "database": snap.get("database"),
        "tables": {t: b.get("row_count") for t, b in tables.items()},
        "path": str(path),
    }


def backup(dest_dir: Optional[Path] = None, keep_days: Optional[int] = None) -> dict:
    load_env()
    dest = dest_dir or default_backup_dir()
    keep = DEFAULT_KEEP_DAYS if keep_days is None else keep_days
    snap = snapshot_database()
    json_path, sql_path = write_snapshot(snap, dest)
    removed = rotate_backups(dest, keep_days=keep, prefix=snap.get("database") or "tamkobi")
    verify_snapshot_file(json_path)
    return {
        "json": str(json_path),
        "sql": str(sql_path),
        "database": snap.get("database"),
        "tables": {t: b.get("row_count") for t, b in snap["tables"].items()},
        "rotated": [str(p) for p in removed],
    }


def restore(path: Path, target_db: Optional[str] = None, yes: bool = False, as_root: bool = False) -> dict:
    load_env()
    snap = load_snapshot_file(path)
    dest = target_db or os.environ.get("MYSQL_DATABASE") or snap.get("database") or "tamkobi"
    if not yes:
        raise SystemExit(f"refusing to restore into `{dest}` without --yes")
    counts = restore_snapshot(snap, dest, drop_tables=True, as_root=as_root or dest != snap.get("database"))
    return {"database": dest, "tables": counts, "source": str(path)}


def _cmd_backup(args: argparse.Namespace) -> int:
    load_env()
    dest = Path(args.dir) if args.dir else default_backup_dir()
    result = backup(dest_dir=dest, keep_days=args.keep)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def _cmd_restore(args: argparse.Namespace) -> int:
    load_env()
    as_root = args.as_root or (args.database and args.database != mysql_settings()["database"])
    result = restore(Path(args.file), target_db=args.database, yes=args.yes, as_root=as_root)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def _cmd_verify(args: argparse.Namespace) -> int:
    info = verify_snapshot_file(Path(args.file))
    print(json.dumps(info, indent=2, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="TamKobi MySQL backup/restore")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("backup", help="Write gzip snapshot + SQL dump")
    b.add_argument("--dir", default=None, help="Backup directory (default backups/mysql)")
    b.add_argument("--keep", type=int, default=int(os.environ.get("MYSQL_BACKUP_KEEP", DEFAULT_KEEP_DAYS)))
    b.set_defaults(func=_cmd_backup)
    r = sub.add_parser("restore", help="Restore a .json.gz snapshot")
    r.add_argument("file")
    r.add_argument("--database", default=None, help="Target database name")
    r.add_argument("--yes", action="store_true", help="Required; acknowledges overwrite")
    r.add_argument("--as-root", action="store_true", help="CREATE DATABASE as root")
    r.set_defaults(func=_cmd_restore)
    v = sub.add_parser("verify", help="Validate a snapshot file")
    v.add_argument("file")
    v.set_defaults(func=_cmd_verify)
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
