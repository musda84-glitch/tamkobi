"""Physical MySQL schema map, catalog, and backup/restore automation."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000")

from mysql_backup import (  # noqa: E402
    TEST_DATABASE,
    backup,
    drop_database,
    load_env,
    load_snapshot_file,
    mysql_settings,
    restore_snapshot,
    snapshot_database,
    snapshot_to_sql,
    verify_snapshot_file,
    write_snapshot,
)
from mysql_store import SCHEMA_SQL  # noqa: E402
from schema_catalog import (  # noqa: E402
    CHARSET,
    COLLATION,
    COLLECTION_NAMES,
    COLLECTIONS,
    CORE_COLLECTIONS,
    ENGINE,
    OPTIONAL_PHYSICAL_TABLES,
    PHYSICAL_COLUMNS,
    PHYSICAL_TABLES,
    STARTUP_INDEXES,
)

SCHEMA_FILE = BACKEND / "schema.mysql.sql"


def _create_tables(sql: str) -> dict:
    found = {}
    for m in re.finditer(
        r"CREATE TABLE IF NOT EXISTS\s+([a-z_]+)\s*\((.*?)\)\s*ENGINE=",
        sql,
        flags=re.S | re.I,
    ):
        found[m.group(1)] = re.sub(r"\s+", " ", m.group(2)).strip()
    return found


def test_schema_sql_defines_canonical_tables():
    text = SCHEMA_FILE.read_text(encoding="utf-8")
    assert "CHARACTER SET utf8mb4" in text
    assert "utf8mb4_unicode_ci" in text
    tables = _create_tables(text)
    assert tuple(tables) == PHYSICAL_TABLES or set(PHYSICAL_TABLES) <= set(tables)
    for name, cols in PHYSICAL_COLUMNS.items():
        body = tables[name].upper()
        for col in cols:
            assert col.upper() in body, (name, col)
    assert "PRIMARY KEY (COLLECTION, ID)" in tables["docs"].upper()
    assert "PRIMARY KEY (COLLECTION, NAME)" in tables["meta_indexes"].upper()
    assert "JSON NOT NULL" in tables["docs"].upper()


def test_runtime_schema_sql_matches_file():
    file_tables = _create_tables(SCHEMA_FILE.read_text(encoding="utf-8"))
    runtime_tables = _create_tables(SCHEMA_SQL)
    assert set(file_tables) == set(runtime_tables) == set(PHYSICAL_TABLES)
    for name in PHYSICAL_TABLES:
        file_norm = re.sub(r"\s+", "", file_tables[name]).upper()
        run_norm = re.sub(r"\s+", "", runtime_tables[name]).upper()
        assert file_norm == run_norm, name


def test_catalog_covers_core_and_valid_names():
    assert set(CORE_COLLECTIONS) <= set(COLLECTION_NAMES)
    for name, meta in COLLECTIONS.items():
        assert re.fullmatch(r"[a-z][a-z0-9_]{1,63}", name), name
        assert meta["scope"] in {"platform", "tenant"}
        assert meta["description"]
        assert meta["keys"]
    emails = [i for i in STARTUP_INDEXES if i["collection"] == "users" and i["unique"]]
    assert emails and emails[0]["fields"] == ("email",)


def test_docs_page_exists():
    doc = (ROOT / "docs" / "mysql-schema.md").read_text(encoding="utf-8")
    assert "`docs`" in doc and "`meta_indexes`" in doc
    assert "scripts/mysql_backup.sh" in doc
    for name in CORE_COLLECTIONS:
        assert f"`{name}`" in doc


def _connect_or_skip():
    load_env()
    try:
        from mysql_backup import connect

        conn = connect()
        conn.ping(reconnect=True)
        return conn
    except Exception as exc:  # pragma: no cover - skip when MySQL is down
        pytest.skip(f"MySQL not reachable: {exc}")


def test_live_physical_schema():
    conn = _connect_or_skip()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME "
            "FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=%s",
            (mysql_settings()["database"],),
        )
        charset, coll = cur.fetchone()
        assert charset == CHARSET
        assert coll == COLLATION
        cur.execute("SHOW TABLES")
        tables = {r[0] for r in cur.fetchall()}
        assert set(PHYSICAL_TABLES) <= tables
        for extra in OPTIONAL_PHYSICAL_TABLES:
            # Presence is optional; just assert naming if present.
            if extra in tables:
                assert re.fullmatch(r"[a-z_]+", extra)
        cur.execute("SHOW FULL COLUMNS FROM docs")
        cols = {r[0]: r for r in cur.fetchall()}
        for name in PHYSICAL_COLUMNS["docs"]:
            assert name in cols
        assert cols["doc"][1].lower().startswith("json")
        cur.execute("SHOW INDEX FROM docs")
        pk = [(r[2], r[4]) for r in cur.fetchall() if r[2] == "PRIMARY"]
        assert [c for _, c in pk] == ["collection", "id"]
        cur.execute(
            "SELECT ENGINE, TABLE_COLLATION FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='docs'",
            (mysql_settings()["database"],),
        )
        engine, tcoll = cur.fetchone()
        assert engine == ENGINE
        assert tcoll == COLLATION
    finally:
        conn.close()


def test_live_startup_indexes_and_core_collections():
    conn = _connect_or_skip()
    try:
        cur = conn.cursor()
        cur.execute("SELECT collection, name, unique_index FROM meta_indexes")
        rows = {(r[0], r[1]): int(r[2]) for r in cur.fetchall()}
        for spec in STARTUP_INDEXES:
            key = (spec["collection"], spec["name"])
            assert key in rows, f"missing index {key}"
            assert bool(rows[key]) == spec["unique"]
        cur.execute("SELECT DISTINCT collection FROM docs")
        present = {r[0] for r in cur.fetchall()}
        missing = [c for c in CORE_COLLECTIONS if c not in present]
        assert not missing, f"seeded DB missing collections: {missing}"
    finally:
        conn.close()


def test_snapshot_sql_mentions_canonical_tables():
    load_env()
    try:
        snap = snapshot_database()
    except Exception as exc:
        pytest.skip(f"MySQL not reachable: {exc}")
    sql = snapshot_to_sql(snap)
    assert "CREATE TABLE `docs`" in sql or "CREATE TABLE IF NOT EXISTS `docs`" in sql or "CREATE TABLE `docs`" in sql
    assert "docs" in snap["tables"] and "meta_indexes" in snap["tables"]
    assert "JSON" in snap["tables"]["docs"]["create"].upper()


def test_backup_restore_roundtrip(tmp_path):
    load_env()
    try:
        snap = snapshot_database()
    except Exception as exc:
        pytest.skip(f"MySQL not reachable: {exc}")
    json_path, sql_path = write_snapshot(snap, tmp_path, prefix="roundtrip")
    assert json_path.is_file() and sql_path.is_file()
    info = verify_snapshot_file(json_path)
    assert info["tables"]["docs"] == snap["tables"]["docs"]["row_count"]
    loaded = load_snapshot_file(json_path)
    try:
        restore_snapshot(loaded, TEST_DATABASE, drop_tables=True, as_root=True)
        from mysql_backup import connect

        cfg = mysql_settings()
        dst = connect(
            {
                **cfg,
                "user": os.environ.get("MYSQL_ROOT_USER", "root"),
                "password": os.environ.get("MYSQL_ROOT_PASSWORD")
                or os.environ.get("DB_PASSWORD")
                or cfg["password"],
                "database": TEST_DATABASE,
            }
        )
        try:
            cur = dst.cursor()
            cur.execute("SELECT COUNT(*) FROM docs")
            assert cur.fetchone()[0] == snap["tables"]["docs"]["row_count"]
            cur.execute("SELECT COUNT(*) FROM meta_indexes")
            assert cur.fetchone()[0] == snap["tables"]["meta_indexes"]["row_count"]
            cur.execute("SELECT collection, id FROM docs LIMIT 1")
            row = cur.fetchone()
            if row:
                src = connect(cfg)
                try:
                    sc = src.cursor()
                    sc.execute(
                        "SELECT doc FROM docs WHERE collection=%s AND id=%s",
                        (row[0], row[1]),
                    )
                    orig = sc.fetchone()
                finally:
                    src.close()
                cur.execute(
                    "SELECT doc FROM docs WHERE collection=%s AND id=%s",
                    (row[0], row[1]),
                )
                copied = cur.fetchone()
                assert orig and copied
        finally:
            dst.close()
    finally:
        try:
            drop_database(TEST_DATABASE)
        except Exception:
            pass


def test_backup_helper_writes_meta(tmp_path):
    load_env()
    try:
        result = backup(dest_dir=tmp_path, keep_days=1)
    except Exception as exc:
        pytest.skip(f"MySQL not reachable: {exc}")
    assert Path(result["json"]).is_file()
    assert "docs" in result["tables"]
