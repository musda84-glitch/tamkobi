"""Relocating the TamKobi database to another MySQL server."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000")

import db_relocate  # noqa: E402

SCRATCH_DB = "tamkobi_relocate_test"


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    """Never let a test rewrite the real backend/data/database.json."""
    monkeypatch.setenv("TAMKOBI_DATA_DIR", str(tmp_path))
    return tmp_path


def test_store_settings_normalizes():
    cfg = db_relocate.store_settings(
        {"host": " db.firma.com ", "port": "3307", "user": " app ", "password": "s3cret", "database": "tamkobi_app"}
    )
    assert cfg == {
        "host": "db.firma.com",
        "port": 3307,
        "user": "app",
        "password": "s3cret",
        "db": "tamkobi_app",
        "charset": "utf8mb4",
        "autocommit": True,
        "ssl_mode": "disabled",
        "ssl_ca": "",
    }


@pytest.mark.parametrize(
    "bad",
    [
        {"host": "", "user": "app", "db": "tamkobi"},
        {"host": "db", "user": "", "db": "tamkobi"},
        {"host": "db", "user": "app", "db": "tamkobi; drop table docs"},
        {"host": "db", "user": "app", "db": ""},
        {"host": "db", "user": "app", "db": "tamkobi", "port": 0},
        {"host": "db", "user": "app", "db": "tamkobi", "port": "abc"},
    ],
)
def test_store_settings_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        db_relocate.store_settings(bad)


def test_settings_from_url_decodes_credentials():
    cfg = db_relocate.settings_from_url("mysql+pymysql://app:p%40ss@db.firma.com:3307/tamkobi")
    assert cfg["host"] == "db.firma.com"
    assert cfg["port"] == 3307
    assert cfg["user"] == "app"
    assert cfg["password"] == "p@ss"
    assert cfg["db"] == "tamkobi"


def test_settings_from_url_rejects_other_schemes():
    with pytest.raises(ValueError):
        db_relocate.settings_from_url("postgres://app@db/tamkobi")


def test_public_view_hides_password():
    view = db_relocate.public_view({"host": "db", "port": 3306, "user": "app", "password": "s3cret", "db": "tamkobi"})
    assert view == {"host": "db", "port": 3306, "db": "tamkobi", "user": "app", "ssl_mode": "disabled", "ssl_ca": ""}
    assert "s3cret" not in str(view)


def test_store_settings_carries_tls_options():
    cfg = db_relocate.store_settings(
        {"host": "db.firma.com", "user": "app", "db": "tamkobi", "ssl_mode": "REQUIRED"}
    )
    assert cfg["ssl_mode"] == "required"
    assert db_relocate.dump_settings(cfg)["ssl_mode"] == "required"


def test_store_settings_requires_ca_for_verification():
    with pytest.raises(ValueError, match="CA"):
        db_relocate.store_settings({"host": "db", "user": "app", "db": "tamkobi", "ssl_mode": "verify_ca"})


def test_reading_settings_survives_a_missing_ca_file():
    """A CA that walked away must not break the panel that would fix it."""
    cfg = db_relocate.store_settings(
        {"host": "db", "user": "app", "db": "tamkobi", "ssl_mode": "verify_ca", "ssl_ca": "/yok/ca.pem"}
    )
    assert cfg["ssl_ca"] == "/yok/ca.pem"
    assert db_relocate.public_view(cfg)["ssl_mode"] == "verify_ca"
    with pytest.raises(ValueError, match="bulunamadı"):
        db_relocate.table_counts(cfg)


def test_same_server_compares_host_port_and_database():
    a = {"host": "DB.firma.com", "port": 3306, "user": "app", "db": "tamkobi"}
    assert db_relocate.same_server(a, {**a, "host": "db.firma.com"}) is True
    assert db_relocate.same_server(a, {**a, "db": "tamkobi_yedek"}) is False
    assert db_relocate.same_server(a, {**a, "port": 3307}) is False


def test_target_state_empty_only_when_readable_and_clean():
    state = db_relocate.target_state({})
    assert state["empty"] is True and state["readable"] is True
    assert db_relocate.target_state({"docs": 0, "meta_indexes": 0, "system_logs": 0})["empty"] is True


def test_target_state_unreadable_is_never_empty():
    state = db_relocate.target_state(None, error="Access denied for user")
    assert state["readable"] is False
    assert state["empty"] is False
    assert "okunamadı" in state["summary"]


def test_target_state_flags_rows_and_foreign_tables():
    rows = db_relocate.target_state({"docs": 12, "meta_indexes": 0})
    assert rows["empty"] is False and rows["existing_docs"] == 12

    foreign = db_relocate.target_state({"docs": 0, "wp_posts": 0})
    assert foreign["empty"] is False
    assert foreign["foreign_tables"] == ["wp_posts"]
    assert "wp_posts" in foreign["summary"]


def test_copy_refuses_the_current_server(data_dir):
    current = {"host": "db", "port": 3306, "user": "app", "password": "x", "db": "tamkobi"}
    with pytest.raises(ValueError, match="aynı"):
        db_relocate.copy_database(current, source=current, backup_dir=None)


def test_dump_settings_uses_backup_key_names():
    cfg = db_relocate.dump_settings({"host": "db", "port": 3306, "user": "app", "password": "x", "db": "tamkobi"})
    assert cfg["database"] == "tamkobi"
    assert "db" not in cfg


def _live_source_or_skip():
    import mysql_backup

    mysql_backup.load_env()
    source = db_relocate.current_settings()
    try:
        counts = db_relocate.table_counts(source)
    except Exception as exc:  # pragma: no cover - skip when MySQL is down
        pytest.skip(f"MySQL not reachable: {exc}")
    if not counts.get("docs"):
        pytest.skip("source database has no docs rows to copy")
    return source, counts


def _scratch_target(source: dict) -> dict:
    """Creating a database needs the DDL account on a hardened server."""
    user = os.environ.get("MYSQL_DBA_USER")
    password = os.environ.get("MYSQL_DBA_PASSWORD")
    if user and password:
        return {**source, "user": user, "password": password, "db": SCRATCH_DB}
    return {**source, "db": SCRATCH_DB}


def test_live_copy_into_scratch_database(data_dir):
    """Copy the live database into a scratch schema without repointing the app."""
    import mysql_backup

    source, source_counts = _live_source_or_skip()
    target = _scratch_target(source)
    try:
        db_relocate.inspect_target(target)
    except Exception as exc:  # pragma: no cover - user may lack CREATE DATABASE
        pytest.skip(f"cannot prepare scratch database: {exc}")
    try:
        conn = mysql_backup.connect(db_relocate.dump_settings(target))
        conn.cursor().execute("CREATE TABLE IF NOT EXISTS musteri_tablosu (id INT PRIMARY KEY)")
        conn.close()
        probe = db_relocate.inspect_target(target)
        assert probe["empty"] is False
        assert "musteri_tablosu" in probe["foreign_tables"]
        with pytest.raises(ValueError, match="musteri_tablosu"):
            db_relocate.copy_database(target, source=source, repoint=False, backup_dir=None)

        result = db_relocate.copy_database(target, source=source, overwrite=True, repoint=False, backup_dir=None)
        assert result["verified"] is True
        assert result["repointed"] is False
        assert result["tables"]["docs"] == source_counts["docs"]
        copied = db_relocate.table_counts(target)
        for table, rows in result["tables"].items():
            assert copied.get(table) == rows, table
        assert not (data_dir / "database.json").exists()
    finally:
        try:
            db_relocate.drop_database(target)
        except Exception:
            pass
