"""Dump and restore the TamKobi MySQL database without loading the whole DB into RAM.

Primary path: mysqldump --single-transaction --quick --routines | gzip (stream).
Fallback: JSON snapshot written with fetchmany chunks.
Generated/virtual columns are omitted from INSERT lists on the JSON path so restore
works on both the canonical schema and live databases that added extras.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlparse

DEFAULT_KEEP_DAYS = 14
DEFAULT_DIR_NAME = "backups/mysql"
TEST_DATABASE = "tamkobi_schema_test"
FETCHMANY_SIZE = 500


class nullcontext:
    """Minimal stand-in so we need not import contextlib for a no-op stream."""

    def __enter__(self):
        return None

    def __exit__(self, *exc):
        return False


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


def _ssl_for(host: str) -> Dict[str, Any]:
    import db_ssl

    mode, ca = db_ssl.resolve(host)
    return {"ssl_mode": mode, "ssl_ca": ca}


def mysql_settings(user: Optional[str] = None, password: Optional[str] = None, db: Optional[str] = None) -> Dict[str, Any]:
    url = (os.environ.get("MYSQL_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if url.startswith("mysql"):
        if url.startswith("mysql+"):
            url = "mysql://" + url.split("://", 1)[1]
        parsed = urlparse(url)
        database = (parsed.path or "/tamkobi").lstrip("/") or "tamkobi"
        database = database.split("?")[0] or "tamkobi"
        host = parsed.hostname or os.environ.get("MYSQL_HOST", "127.0.0.1")
        return {
            "host": host,
            "port": parsed.port or int(os.environ.get("MYSQL_PORT", "3306")),
            "user": user or unquote(parsed.username or os.environ.get("MYSQL_USER", "tamkobi")),
            "password": password if password is not None else unquote(parsed.password or os.environ.get("MYSQL_PASSWORD", "tamkobi")),
            "database": db or os.environ.get("MYSQL_DATABASE") or os.environ.get("DB_NAME") or database,
            "charset": "utf8mb4",
            **_ssl_for(host),
        }
    host = os.environ.get("MYSQL_HOST", "127.0.0.1")
    return {
        "host": host,
        "port": int(os.environ.get("MYSQL_PORT", "3306")),
        "user": user or os.environ.get("MYSQL_USER", "tamkobi"),
        "password": password if password is not None else os.environ.get("MYSQL_PASSWORD", os.environ.get("DB_PASSWORD", "tamkobi")),
        "database": db or os.environ.get("MYSQL_DATABASE") or os.environ.get("DB_NAME") or "tamkobi",
        "charset": "utf8mb4",
        **_ssl_for(host),
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
    cols = []
    for row in cur.fetchall():
        cols.append({"name": row[0], "type": row[1], "null": row[3], "extra": row[6] or ""})
    return cols


def _writable_columns(cols: Sequence[dict]) -> List[str]:
    return [c["name"] for c in cols if not _is_generated(c["extra"])]


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
        return "X'" + bytes(v["$b64"], "ascii").hex() + "'"
    if isinstance(v, (dict, list)):
        s = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    else:
        s = str(v)
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r") + "'"


def snapshot_database(settings: Optional[dict] = None) -> dict:
    """In-memory snapshot (tests / small DBs). Prefer backup() for production."""
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
                while True:
                    batch = cur.fetchmany(FETCHMANY_SIZE)
                    if not batch:
                        break
                    for raw in batch:
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


def _defaults_file(cfg: dict) -> Path:
    """0600 defaults-file so password is never on argv."""
    fd, name = tempfile.mkstemp(prefix="tamkobi-my-", suffix=".cnf")
    os.close(fd)
    path = Path(name)
    path.chmod(0o600)
    lines = [
        "[client]",
        f"host={cfg['host']}",
        f"port={int(cfg['port'])}",
        f"user={cfg['user']}",
        f"password={cfg['password']}",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def mysqldump_available() -> bool:
    return shutil.which("mysqldump") is not None


def backup_mysqldump_stream(dest_dir: Path, settings: Optional[dict] = None) -> Tuple[Path, dict]:
    """Stream mysqldump of a single database (no --databases → no CREATE DATABASE/USE)."""
    import threading

    cfg = settings or mysql_settings()
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    name = cfg.get("database") or "tamkobi"
    sql_path = dest_dir / f"{name}-{stamp}.sql.gz"
    defaults = _defaults_file(cfg)
    try:
        # Do NOT use --databases: that emits CREATE DATABASE / USE and can overwrite
        # the wrong schema on restore. Pass the DB name as a positional arg instead.
        cmd = [
            "mysqldump",
            f"--defaults-extra-file={defaults}",
            "--single-transaction",
            "--quick",
            "--routines",
            str(cfg["database"]),
        ]
        err_chunks: List[bytes] = []

        def _read_err(pipe):
            try:
                err_chunks.append(pipe.read() or b"")
            except Exception:
                err_chunks.append(b"")

        with subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ},
        ) as proc:
            assert proc.stdout is not None and proc.stderr is not None
            err_t = threading.Thread(target=_read_err, args=(proc.stderr,), daemon=True)
            err_t.start()
            with gzip.open(sql_path, "wb", compresslevel=6) as gz:
                while True:
                    chunk = proc.stdout.read(1024 * 256)
                    if not chunk:
                        break
                    gz.write(chunk)
            rc = proc.wait()
            err_t.join(timeout=30)
        stderr = b"".join(err_chunks).decode("utf-8", "replace")
        if rc != 0:
            sql_path.unlink(missing_ok=True)
            raise RuntimeError(f"mysqldump failed ({rc}): {stderr[:500]}")
    finally:
        try:
            defaults.unlink()
        except OSError:
            pass
    # Reject dumps that still contain USE/CREATE DATABASE (misconfigured mysqldump)
    assert_sql_gz_no_database_switch(sql_path)
    meta = {
        "sql": str(sql_path),
        "json": None,
        "database": cfg.get("database"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "method": "mysqldump-stream",
        "tables": {},
    }
    (dest_dir / f"{name}-{stamp}.meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return sql_path, meta


def assert_sql_gz_no_database_switch(path: Path) -> None:
    """Refuse dumps that switch databases (CREATE DATABASE / USE `…`)."""
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as f:  # type: ignore[arg-type]
        for line in f:
            s = line.strip()
            if not s or s.startswith("--") or s.startswith("/*"):
                continue
            up = s.upper()
            if up.startswith("CREATE DATABASE") or up.startswith("USE ") or up.startswith("USE`"):
                raise ValueError(
                    f"SQL dump must target a single DB via mysql client argv; "
                    f"found database switch: {s[:120]}"
                )


def backup_json_stream(
    dest_dir: Path,
    settings: Optional[dict] = None,
    *,
    write_sql: bool = True,
    stamp: Optional[str] = None,
) -> Tuple[Path, Optional[Path], dict]:
    """Stream JSON.gz with fetchmany — never holds all tables' rows beyond one batch + encoder state."""
    cfg = settings or mysql_settings()
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = stamp or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    name = cfg.get("database") or "tamkobi"
    json_path = dest_dir / f"{name}-{stamp}.json.gz"
    sql_path = dest_dir / f"{name}-{stamp}.sql.gz" if write_sql else None
    created = datetime.now(timezone.utc).isoformat()
    table_counts: Dict[str, int] = {}

    conn = connect(cfg)
    try:
        cur = conn.cursor()
        cur.execute("SELECT DATABASE()")
        dbname = cur.fetchone()[0]
        cur.execute("SHOW TABLES")
        tables = [r[0] for r in cur.fetchall()]

        sf_cm = gzip.open(sql_path, "wt", encoding="utf-8", compresslevel=6) if sql_path else nullcontext()
        with gzip.open(json_path, "wt", encoding="utf-8", compresslevel=6) as jf, sf_cm as sf:
            # Manual JSON object stream for tables
            jf.write('{"format":"tamkobi-mysql-snapshot-v1","database":')
            jf.write(json.dumps(dbname, ensure_ascii=False))
            jf.write(',"created_at":')
            jf.write(json.dumps(created))
            jf.write(',"tables":{')

            if sf is not None:
                sf.write(f"-- TamKobi MySQL snapshot {created}\n")
                sf.write(f"-- database {dbname}\n")
                sf.write("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n")

            first_table = True
            for table in tables:
                cur.execute(f"SHOW CREATE TABLE `{table}`")
                create_sql = cur.fetchone()[1]
                cols = _table_columns(cur, table)
                writable = _writable_columns(cols)
                col_list = ", ".join(f"`{c}`" for c in writable)

                if not first_table:
                    jf.write(",")
                first_table = False
                jf.write(json.dumps(table, ensure_ascii=False))
                jf.write(':{')
                jf.write('"create":')
                jf.write(json.dumps(create_sql, ensure_ascii=False))
                jf.write(',"columns":')
                jf.write(json.dumps(writable, ensure_ascii=False))
                jf.write(',"column_meta":')
                jf.write(json.dumps(cols, ensure_ascii=False))
                jf.write(',"rows":[')

                if sf is not None:
                    sf.write(f"DROP TABLE IF EXISTS `{table}`;\n")
                    create = create_sql if create_sql.rstrip().endswith(";") else create_sql.rstrip() + ";"
                    sf.write(create + "\n")

                count = 0
                first_row = True
                if writable:
                    cur.execute(f"SELECT {col_list} FROM `{table}`")
                    col_sql = ", ".join(f"`{c}`" for c in writable)
                    while True:
                        batch = cur.fetchmany(FETCHMANY_SIZE)
                        if not batch:
                            break
                        for raw in batch:
                            row = [_jsonable(v) for v in raw]
                            if not first_row:
                                jf.write(",")
                            first_row = False
                            jf.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
                            if sf is not None:
                                vals = ", ".join(_sql_literal(v) for v in row)
                                sf.write(f"INSERT INTO `{table}` ({col_sql}) VALUES ({vals});\n")
                            count += 1
                jf.write('],"row_count":')
                jf.write(str(count))
                jf.write("}")
                if sf is not None:
                    sf.write("\n")
                table_counts[table] = count

            jf.write("}}")
            if sf is not None:
                sf.write("SET FOREIGN_KEY_CHECKS=1;\n")
    finally:
        conn.close()

    meta = {
        "json": str(json_path),
        "sql": str(sql_path) if sql_path else None,
        "database": cfg.get("database"),
        "created_at": created,
        "method": "json-fetchmany-stream",
        "tables": table_counts,
    }
    (dest_dir / f"{name}-{stamp}.meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return json_path, sql_path, meta


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
    if path.name.endswith(".sql") or ".sql.gz" in path.name or path.name.endswith(".sql.gz"):
        raise ValueError("SQL dumps restore via restore_sql_gz / mysql client; use the .json.gz snapshot")
    data = json.loads(text)
    if data.get("format") != "tamkobi-mysql-snapshot-v1":
        raise ValueError(f"unknown snapshot format: {data.get('format')}")
    return data


def _root_settings(target_db: str) -> dict:
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
            create = re.sub(r"CREATE TABLE `[^`]+`\.", "CREATE TABLE ", create)
            cur.execute(create)
            cols = body.get("columns") or []
            rows = body.get("rows") or []
            if cols and rows:
                placeholders = ",".join(["%s"] * len(cols))
                col_sql = ", ".join(f"`{c}`" for c in cols)
                sql = f"INSERT INTO `{table}` ({col_sql}) VALUES ({placeholders})"
                payload = [tuple(_bind(v) for v in row) for row in rows]
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


def restore_sql_gz(path: Path, target_db: Optional[str] = None, yes: bool = False) -> dict:
    """Restore a .sql.gz into *only* target_db via mysql client (no USE/CREATE DATABASE in dump)."""
    import threading

    if not yes:
        raise SystemExit("refusing to restore SQL without --yes")
    mysql_bin = shutil.which("mysql")
    if not mysql_bin:
        raise RuntimeError("mysql client not found; install mysql-client or use .json.gz restore")
    assert_sql_gz_no_database_switch(path)
    cfg = mysql_settings(db=target_db)
    dest = target_db or cfg["database"]
    defaults = _defaults_file({**cfg, "database": dest})
    err_chunks: List[bytes] = []
    out_chunks: List[bytes] = []

    def _drain(pipe, bucket: List[bytes]):
        try:
            bucket.append(pipe.read() or b"")
        except Exception:
            bucket.append(b"")

    try:
        with gzip.open(path, "rb") as gz:
            proc = subprocess.Popen(
                [mysql_bin, f"--defaults-extra-file={defaults}", dest],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            assert proc.stdin is not None and proc.stderr is not None and proc.stdout is not None
            err_t = threading.Thread(target=_drain, args=(proc.stderr, err_chunks), daemon=True)
            out_t = threading.Thread(target=_drain, args=(proc.stdout, out_chunks), daemon=True)
            err_t.start()
            out_t.start()
            try:
                shutil.copyfileobj(gz, proc.stdin)
            finally:
                try:
                    proc.stdin.close()
                except Exception:
                    pass
            rc = proc.wait()
            err_t.join(timeout=60)
            out_t.join(timeout=60)
        if rc != 0:
            err = b"".join(err_chunks).decode("utf-8", "replace")[:500]
            raise RuntimeError(f"mysql restore failed: {err}")
    finally:
        try:
            defaults.unlink()
        except OSError:
            pass
    return {"database": dest, "source": str(path), "method": "mysql-sql-gz"}


def verify_snapshot_file(path: Path) -> dict:
    """Validate dump/snapshot without loading the whole JSON into RAM."""
    p = Path(path)
    if p.name.endswith(".sql.gz") or p.name.endswith(".sql"):
        assert_sql_gz_no_database_switch(p)
        opener = gzip.open if p.name.endswith(".gz") else open
        saw_table = False
        with opener(p, "rt", encoding="utf-8", errors="replace") as f:  # type: ignore[arg-type]
            for line in f:
                up = line.upper()
                if "CREATE TABLE" in up or "INSERT INTO" in up:
                    saw_table = True
                    break
        if not saw_table:
            raise AssertionError("sql dump does not look like MySQL SQL")
        return {"database": None, "tables": {}, "path": str(p), "format": "sql"}

    # Stream-scan JSON.gz for required markers (no full json.loads)
    opener = gzip.open if p.name.endswith(".gz") else open
    found_format = False
    found_docs = False
    found_meta = False
    found_collection = False
    found_doc_col = False
    with opener(p, "rb") as f:  # type: ignore[arg-type]
        carry = b""
        while True:
            chunk = f.read(1024 * 256)
            if not chunk:
                break
            buf = carry + chunk
            if b"tamkobi-mysql-snapshot-v1" in buf:
                found_format = True
            if b'"docs"' in buf:
                found_docs = True
            if b'"meta_indexes"' in buf:
                found_meta = True
            if b'"collection"' in buf:
                found_collection = True
            if b'"doc"' in buf:
                found_doc_col = True
            carry = buf[-64:]
            if found_format and found_docs and found_meta and found_collection and found_doc_col:
                break
    if not found_format:
        raise AssertionError("unknown or missing snapshot format marker")
    if not found_docs:
        raise AssertionError("snapshot missing docs table")
    if not found_meta:
        raise AssertionError("snapshot missing meta_indexes table")
    if not found_collection or not found_doc_col:
        raise AssertionError("docs columns incomplete")
    return {"database": None, "tables": {"docs": None, "meta_indexes": None}, "path": str(p), "format": "json-stream"}


def backup(dest_dir: Optional[Path] = None, keep_days: Optional[int] = None) -> dict:
    load_env()
    dest = dest_dir or default_backup_dir()
    keep = DEFAULT_KEEP_DAYS if keep_days is None else keep_days
    cfg = mysql_settings()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    if mysqldump_available():
        # mysqldump only — do NOT also build a full JSON snapshot (RAM).
        sql_path, meta = backup_mysqldump_stream(dest, cfg)
        removed = rotate_backups(dest, keep_days=keep, prefix=cfg.get("database") or "tamkobi")
        verify_snapshot_file(sql_path)
        return {
            "json": None,
            "sql": str(sql_path),
            "database": cfg.get("database"),
            "tables": meta.get("tables") or {},
            "rotated": [str(p) for p in removed],
            "method": "mysqldump-stream",
        }
    json_path, sql_path, meta = backup_json_stream(dest, cfg, stamp=stamp)
    removed = rotate_backups(dest, keep_days=keep, prefix=cfg.get("database") or "tamkobi")
    verify_snapshot_file(json_path)
    return {
        "json": str(json_path),
        "sql": str(sql_path) if sql_path else None,
        "database": cfg.get("database"),
        "tables": meta.get("tables") or {},
        "rotated": [str(p) for p in removed],
        "method": "json-fetchmany-stream",
    }


def restore(path: Path, target_db: Optional[str] = None, yes: bool = False, as_root: bool = False) -> dict:
    load_env()
    p = Path(path)
    if p.name.endswith(".sql.gz") or p.name.endswith(".sql"):
        return restore_sql_gz(p, target_db=target_db, yes=yes)
    snap = load_snapshot_file(p)
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
    b = sub.add_parser("backup", help="Write gzip SQL dump (mysqldump stream) or JSON+SQL snapshot")
    b.add_argument("--dir", default=None, help="Backup directory (default backups/mysql)")
    b.add_argument("--keep", type=int, default=int(os.environ.get("MYSQL_BACKUP_KEEP", DEFAULT_KEEP_DAYS)))
    b.set_defaults(func=_cmd_backup)
    r = sub.add_parser("restore", help="Restore a .json.gz snapshot or .sql.gz dump")
    r.add_argument("file")
    r.add_argument("--database", default=None, help="Target database name")
    r.add_argument("--yes", action="store_true", help="Required; acknowledges overwrite")
    r.add_argument("--as-root", action="store_true", help="CREATE DATABASE as root")
    r.set_defaults(func=_cmd_restore)
    v = sub.add_parser("verify", help="Validate a snapshot / dump file")
    v.add_argument("file")
    v.set_defaults(func=_cmd_verify)
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
