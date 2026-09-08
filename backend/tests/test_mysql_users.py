"""Least-privilege MySQL account model and live grant checks."""
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

from mysql_users import (  # noqa: E402
    APP_PRIVILEGES,
    APP_USER,
    BACKUP_PRIVILEGES,
    BACKUP_USER,
    DBA_GLOBAL_PRIVILEGES,
    DBA_USER,
    FORBIDDEN_APP_TOKENS,
    MIGRATE_PRIVILEGES,
    MIGRATE_USER,
    app_grants_are_limited,
    generate_password,
    grant_sql,
    load_env,
)


def test_generate_password_is_strong_and_env_safe():
    pw = generate_password()
    assert len(pw) >= 32
    assert re.fullmatch(r"[A-Za-z0-9_-]+", pw)
    assert re.search(r"[A-Z]", pw) and re.search(r"[a-z]", pw) and re.search(r"[0-9]", pw)


def test_app_grant_sql_has_no_drop_or_file():
    sql = grant_sql(APP_PRIVILEGES, "tamkobi", "tamkobi", "%")
    assert "SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES" in sql
    assert "DROP" not in sql
    assert "FILE" not in sql
    assert "ALL PRIVILEGES" not in sql
    assert "WITH GRANT OPTION" not in sql
    backup = grant_sql(BACKUP_PRIVILEGES, "tamkobi", BACKUP_USER, "%")
    assert "INSERT" not in backup
    assert "SELECT" in backup


def test_app_grants_parser_rejects_all_privileges():
    ok, reason = app_grants_are_limited(
        ["GRANT ALL PRIVILEGES ON `tamkobi`.* TO `tamkobi`@`%`"]
    )
    assert not ok and "ALL" in reason.upper()
    ok, reason = app_grants_are_limited(
        [
            "GRANT USAGE ON *.* TO `tamkobi`@`%`",
            "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES ON `tamkobi`.* TO `tamkobi`@`%`",
        ]
    )
    assert ok, reason
    ok, _ = app_grants_are_limited(
        ["GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP ON `tamkobi`.* TO `tamkobi`@`%`"]
    )
    assert not ok


def test_init_script_matches_catalog():
    text = (BACKEND / "docker" / "mysql-init-privileges.sh").read_text(encoding="utf-8")
    assert "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES" in text
    assert "GRANT SELECT, LOCK TABLES, SHOW VIEW" in text
    assert "ACCOUNT LOCK" not in text  # remote root locked only after dba exists (harden)
    for token in ("FILE", "SUPER", "GRANT OPTION ON"):
        assert token not in text
    docs = (ROOT / "docs" / "mysql-users.md").read_text(encoding="utf-8")
    assert APP_USER in docs and DBA_USER in docs and BACKUP_USER in docs


def test_forbidden_tokens_documented():
    assert "FILE" in FORBIDDEN_APP_TOKENS and "SUPER" in FORBIDDEN_APP_TOKENS
    assert "DROP" in MIGRATE_PRIVILEGES and "DROP" not in APP_PRIVILEGES
    assert "CREATE USER" in DBA_GLOBAL_PRIVILEGES
    assert "CREATE USER" not in APP_PRIVILEGES


def _grants_for(user: str, password: str):
    from mysql_users import connect

    conn = connect(user, password, "tamkobi")
    try:
        cur = conn.cursor()
        cur.execute("SHOW GRANTS")
        return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def test_live_app_user_is_least_privilege():
    load_env()
    pw = os.environ.get("MYSQL_PASSWORD") or ""
    if not pw or pw in {"tamkobi", "change-me-app"}:
        pytest.skip("hardened MYSQL_PASSWORD not configured")
    grants = _grants_for(APP_USER, pw)
    ok, reason = app_grants_are_limited(grants)
    assert ok, (reason, grants)
    from mysql_users import connect

    conn = connect(APP_USER, pw, "tamkobi")
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM docs")
        assert cur.fetchone()[0] >= 0
        with pytest.raises(Exception):
            cur.execute("SELECT user FROM mysql.user LIMIT 1")
        with pytest.raises(Exception):
            cur.execute("DROP DATABASE tamkobi")
    finally:
        conn.close()


def test_live_backup_cannot_write():
    load_env()
    pw = os.environ.get("MYSQL_BACKUP_PASSWORD") or ""
    if not pw or pw.startswith("change-me"):
        pytest.skip("MYSQL_BACKUP_PASSWORD not configured")
    from mysql_users import connect

    conn = connect(BACKUP_USER, pw, "tamkobi")
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM docs")
        cur.fetchone()
        with pytest.raises(Exception):
            cur.execute(
                "INSERT INTO docs (collection, id, doc) VALUES (%s,%s,%s)",
                ("_priv_probe", "1", "{}"),
            )
    finally:
        conn.close()


def test_live_remote_root_locked():
    load_env()
    pw = os.environ.get("MYSQL_ROOT_PASSWORD") or ""
    if not pw or pw in {"tamkobi", "change-me-root"}:
        pytest.skip("MYSQL_ROOT_PASSWORD not rotated")
    from mysql_users import connect

    with pytest.raises(Exception):
        connect("root", pw, "tamkobi")
