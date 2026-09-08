"""Least-privilege MySQL accounts for TamKobi.

Roles (not one shared root/app password):

- tamkobi          app DML + CREATE TABLE IF NOT EXISTS (no DROP/FILE/SUPER)
- tamkobi_backup   SELECT (+ LOCK TABLES) for dumps
- tamkobi_migrate  DDL on tamkobi.* for schema changes / in-place restore
- tamkobi_dba      CREATE DATABASE + user admin; ALL on tamkobi / tamkobi_%
- root             strong password; remote root@% is locked after harden

Passwords are generated with secrets.token_urlsafe(32) and written only to
gitignored .env files — never committed.
"""
from __future__ import annotations

import argparse
import os
import re
import secrets
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote, urlparse

APP_USER = "tamkobi"
BACKUP_USER = "tamkobi_backup"
MIGRATE_USER = "tamkobi_migrate"
DBA_USER = "tamkobi_dba"
APP_DATABASE = "tamkobi"
SCRATCH_DB_PATTERN = "tamkobi\\_%"

# Runtime API (mysql_store): SELECT/INSERT/REPLACE/DELETE + CREATE TABLE IF NOT EXISTS.
# REPLACE needs DELETE. No DROP, ALTER, INDEX, FILE, SUPER, GRANT OPTION.
APP_PRIVILEGES = (
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "REFERENCES",
)

BACKUP_PRIVILEGES = ("SELECT", "LOCK TABLES", "SHOW VIEW")

MIGRATE_PRIVILEGES = (
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "DROP",
    "ALTER",
    "INDEX",
    "REFERENCES",
    "CREATE TEMPORARY TABLES",
    "LOCK TABLES",
    "CREATE VIEW",
    "SHOW VIEW",
)

# Global: create scratch DBs and manage users. Not FILE / SUPER / SHUTDOWN / GRANT OPTION.
DBA_GLOBAL_PRIVILEGES = ("CREATE", "CREATE USER", "RELOAD", "PROCESS", "SHOW DATABASES")

FORBIDDEN_APP_TOKENS = (
    "ALL PRIVILEGES",
    "DROP",
    "ALTER",
    "FILE",
    "SUPER",
    "SHUTDOWN",
    "GRANT OPTION",
    "CREATE USER",
    "RELOAD",
    "PROCESS",
    "REPLICATION",
    "CREATE ROLE",
    "SYSTEM_USER",
)

AUTH_PLUGIN = "mysql_native_password"


def generate_password(nbytes: int = 32) -> str:
    """URL-safe password (A-Z a-z 0-9 - _) so .env and DATABASE_URL stay unquoted-simple."""
    while True:
        pw = secrets.token_urlsafe(nbytes)
        if len(pw) >= 24 and re.search(r"[A-Z]", pw) and re.search(r"[a-z]", pw) and re.search(r"[0-9]", pw):
            return pw


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


def mysql_admin_settings() -> dict:
    url = (os.environ.get("MYSQL_URL") or os.environ.get("DATABASE_URL") or "").strip()
    host, port = "127.0.0.1", 3306
    if url.startswith("mysql"):
        if url.startswith("mysql+"):
            url = "mysql://" + url.split("://", 1)[1]
        parsed = urlparse(url)
        host = parsed.hostname or host
        port = parsed.port or port
    return {
        "host": os.environ.get("MYSQL_HOST", host),
        "port": int(os.environ.get("MYSQL_PORT", port)),
        "user": os.environ.get("MYSQL_ROOT_USER", "root"),
        "password": os.environ.get("MYSQL_ROOT_CURRENT_PASSWORD")
        or os.environ.get("MYSQL_ROOT_PASSWORD")
        or os.environ.get("DB_PASSWORD")
        or "tamkobi",
        "charset": "utf8mb4",
    }


def connect(user: str, password: str, database: Optional[str] = None, **overrides):
    import pymysql

    cfg = mysql_admin_settings()
    cfg.update(overrides)
    return pymysql.connect(
        host=cfg["host"],
        port=int(cfg["port"]),
        user=user,
        password=password,
        database=database,
        charset="utf8mb4",
        autocommit=True,
    )


def _ident(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_\\%]+", name):
        raise ValueError(f"unsafe identifier: {name!r}")
    return name


def grant_sql(privileges: Sequence[str], database: str, user: str, host: str, with_grant: bool = False) -> str:
    privs = ", ".join(privileges)
    extra = " WITH GRANT OPTION" if with_grant else ""
    return (
        f"GRANT {privs} ON `{_ident(database)}`.* "
        f"TO `{_ident(user)}`@`{_ident(host)}`{extra}"
    )


def parse_grant_tokens(grant_row: str) -> List[str]:
    text = grant_row.upper()
    if "ON *.*" in text or "ON `MYSQL`" in text:
        scope = "global"
    else:
        scope = "db"
    tokens = []
    if "ALL PRIVILEGES" in text:
        tokens.append("ALL PRIVILEGES")
    if "WITH GRANT OPTION" in text:
        tokens.append("GRANT OPTION")
    for name in (
        "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "INDEX",
        "FILE", "SUPER", "SHUTDOWN", "PROCESS", "RELOAD", "CREATE USER", "REFERENCES",
        "LOCK TABLES", "SHOW VIEW", "SHOW DATABASES",
    ):
        if re.search(rf"(?:^|[\s,]){re.escape(name)}(?:[\s,]|$)", text):
            tokens.append(name)
    return tokens


def app_grants_are_limited(grant_rows: Iterable[str]) -> Tuple[bool, str]:
    """True when the app account has only USAGE globally plus APP_PRIVILEGES on tamkobi.*."""
    rows = [r.upper() for r in grant_rows]
    joined = "\n".join(rows)
    if "ALL PRIVILEGES" in joined:
        return False, "ALL PRIVILEGES"
    if "WITH GRANT OPTION" in joined:
        return False, "GRANT OPTION"
    for bad in ("FILE", "SUPER", "SHUTDOWN", "CREATE USER", "REPLICATION", "PROCESS", "RELOAD"):
        if bad in joined:
            return False, bad
    for row in rows:
        if " ON *.*" in row and "USAGE" not in row.split(" ON *.*", 1)[0]:
            return False, "global data privilege"
        if "ON `TAMKOBI`" in row or "ON TAMKOBI." in row:
            head = row.split(" ON ", 1)[0]
            if re.search(r"\bDROP\b", head):
                return False, "DROP"
            if re.search(r"\bALTER\b", head) and "ALTER ROUTINE" not in head:
                return False, "ALTER"
    if not all(p in joined for p in ("SELECT", "INSERT", "UPDATE", "DELETE", "CREATE")):
        return False, "missing DML"
    return True, "ok"


def upsert_env_file(path: Path, updates: Dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    seen = set()
    out: List[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in line:
            key = line.split("=", 1)[0].strip()
            if key in updates:
                out.append(f"{key}={updates[key]}")
                seen.add(key)
                continue
        out.append(line)
    missing = [k for k in updates if k not in seen]
    if missing:
        if out and out[-1] != "":
            out.append("")
        out.append("# MySQL least-privilege accounts (generated; do not commit)")
        for key in missing:
            out.append(f"{key}={updates[key]}")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def env_updates(
    *,
    host: str,
    port: int,
    database: str,
    root_password: str,
    app_password: str,
    backup_password: str,
    migrate_password: str,
    dba_password: str,
) -> Dict[str, str]:
    qpw = quote(app_password, safe="")
    return {
        "MYSQL_HOST": host,
        "MYSQL_PORT": str(port),
        "MYSQL_DATABASE": database,
        "DB_NAME": database,
        "MYSQL_USER": APP_USER,
        "MYSQL_PASSWORD": app_password,
        "DATABASE_URL": f"mysql://{APP_USER}:{qpw}@{host}:{port}/{database}",
        "MYSQL_ROOT_PASSWORD": root_password,
        "MYSQL_BACKUP_USER": BACKUP_USER,
        "MYSQL_BACKUP_PASSWORD": backup_password,
        "MYSQL_MIGRATE_USER": MIGRATE_USER,
        "MYSQL_MIGRATE_PASSWORD": migrate_password,
        "MYSQL_DBA_USER": DBA_USER,
        "MYSQL_DBA_PASSWORD": dba_password,
    }


def _ensure_user(cur, user: str, host: str, password: str) -> None:
    cur.execute(
        f"CREATE USER IF NOT EXISTS `{_ident(user)}`@`{_ident(host)}` "
        f"IDENTIFIED WITH {AUTH_PLUGIN} BY %s",
        (password,),
    )
    cur.execute(
        f"ALTER USER `{_ident(user)}`@`{_ident(host)}` "
        f"IDENTIFIED WITH {AUTH_PLUGIN} BY %s",
        (password,),
    )
    cur.execute(f"REVOKE ALL PRIVILEGES, GRANT OPTION FROM `{_ident(user)}`@`{_ident(host)}`")


def apply_hardening(
    *,
    root_password: str,
    app_password: str,
    backup_password: str,
    migrate_password: str,
    dba_password: str,
    lock_remote_root: bool = True,
    current_root_password: Optional[str] = None,
) -> dict:
    admin = mysql_admin_settings()
    current = current_root_password if current_root_password is not None else admin["password"]
    conn = connect("root", current)
    report = {"users": [], "locked_remote_root": False, "dropped_test_db": False}
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1")

        for user, password, db_privs in (
            (APP_USER, app_password, APP_PRIVILEGES),
            (BACKUP_USER, backup_password, BACKUP_PRIVILEGES),
            (MIGRATE_USER, migrate_password, MIGRATE_PRIVILEGES),
        ):
            _ensure_user(cur, user, "%", password)
            cur.execute(grant_sql(db_privs, APP_DATABASE, user, "%"))
            report["users"].append(user)

        _ensure_user(cur, DBA_USER, "%", dba_password)
        cur.execute(
            f"GRANT {', '.join(DBA_GLOBAL_PRIVILEGES)} ON *.* TO `{DBA_USER}`@`%`"
        )
        cur.execute(f"GRANT ALL PRIVILEGES ON `{APP_DATABASE}`.* TO `{DBA_USER}`@`%`")
        cur.execute(f"GRANT ALL PRIVILEGES ON `{SCRATCH_DB_PATTERN}`.* TO `{DBA_USER}`@`%`")
        report["users"].append(DBA_USER)

        # Root: rotate both accounts to the new password, then lock remote root.
        for host in ("localhost", "%"):
            cur.execute(
                f"ALTER USER `root`@`{_ident(host)}` IDENTIFIED WITH {AUTH_PLUGIN} BY %s",
                (root_password,),
            )
        cur.execute("ALTER USER `root`@`localhost` ACCOUNT UNLOCK")
        if lock_remote_root:
            cur.execute("ALTER USER `root`@`%` ACCOUNT LOCK")
            report["locked_remote_root"] = True

        cur.execute("SELECT user, host FROM mysql.user WHERE user=''")
        for user, host in cur.fetchall():
            cur.execute(f"DROP USER `{user}`@`{host}`")
            report.setdefault("dropped_anonymous", []).append(f"{user}@{host}")

        cur.execute("SHOW DATABASES LIKE 'test'")
        if cur.fetchone():
            cur.execute("DROP DATABASE test")
            report["dropped_test_db"] = True

        cur.execute("FLUSH PRIVILEGES")
        return report
    finally:
        conn.close()


def verify_accounts(passwords: dict) -> dict:
    checks = {}
    # App can read docs, cannot read mysql.user, cannot drop database.
    conn = connect(APP_USER, passwords["app"], APP_DATABASE)
    try:
        cur = conn.cursor()
        cur.execute("SHOW GRANTS")
        grants = [r[0] for r in cur.fetchall()]
        ok, reason = app_grants_are_limited(grants)
        if not ok:
            raise AssertionError(f"app grants too broad: {reason}: {grants}")
        cur.execute("SELECT COUNT(*) FROM docs")
        checks["app_select_docs"] = cur.fetchone()[0]
        try:
            cur.execute("SELECT user FROM mysql.user LIMIT 1")
            raise AssertionError("app user must not read mysql.user")
        except Exception as exc:
            if "AssertionError" in type(exc).__name__:
                raise
            checks["app_blocked_mysql_user"] = True
        try:
            cur.execute(f"DROP DATABASE `{APP_DATABASE}`")
            raise AssertionError("app user must not DROP DATABASE")
        except Exception as exc:
            if "AssertionError" in type(exc).__name__:
                raise
            checks["app_blocked_drop_database"] = True
    finally:
        conn.close()

    conn = connect(BACKUP_USER, passwords["backup"], APP_DATABASE)
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM docs")
        checks["backup_select_docs"] = cur.fetchone()[0]
        try:
            cur.execute(
                "INSERT INTO docs (collection, id, doc) VALUES (%s,%s,%s)",
                ("_harden_probe", "x", "{}"),
            )
            raise AssertionError("backup user must not INSERT")
        except Exception as exc:
            if "AssertionError" in type(exc).__name__:
                raise
            checks["backup_blocked_insert"] = True
    finally:
        conn.close()

    conn = connect(MIGRATE_USER, passwords["migrate"], APP_DATABASE)
    try:
        cur = conn.cursor()
        cur.execute(
            "CREATE TABLE IF NOT EXISTS _harden_migrate_probe (id INT PRIMARY KEY) "
            "ENGINE=InnoDB"
        )
        cur.execute("DROP TABLE IF EXISTS _harden_migrate_probe")
        checks["migrate_can_ddl"] = True
    finally:
        conn.close()

    conn = connect(DBA_USER, passwords["dba"], APP_DATABASE)
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM docs")
        checks["dba_select_docs"] = cur.fetchone()[0]
    finally:
        conn.close()

    # Remote root must fail when locked.
    try:
        connect("root", passwords["root"], APP_DATABASE)
        checks["remote_root_locked"] = False
    except Exception:
        checks["remote_root_locked"] = True

    return checks


def harden(
    *,
    write_env: bool = True,
    lock_remote_root: bool = True,
    repo_root: Optional[Path] = None,
    rotate: bool = True,
) -> dict:
    load_env(repo_root)
    root = repo_root or Path(__file__).resolve().parents[1]
    admin = mysql_admin_settings()

    def _must_rotate(env_key: str) -> str:
        existing = (os.environ.get(env_key) or "").strip()
        if existing and existing not in {"tamkobi", "changeme", "change-me", "password", "root"} and not rotate:
            return existing
        return generate_password()

    passwords = {
        "root": _must_rotate("MYSQL_ROOT_PASSWORD"),
        "app": _must_rotate("MYSQL_PASSWORD"),
        "backup": _must_rotate("MYSQL_BACKUP_PASSWORD"),
        "migrate": _must_rotate("MYSQL_MIGRATE_PASSWORD"),
        "dba": _must_rotate("MYSQL_DBA_PASSWORD"),
    }
    report = apply_hardening(
        root_password=passwords["root"],
        app_password=passwords["app"],
        backup_password=passwords["backup"],
        migrate_password=passwords["migrate"],
        dba_password=passwords["dba"],
        lock_remote_root=lock_remote_root,
        current_root_password=admin["password"],
    )
    updates = env_updates(
        host=str(admin["host"]),
        port=int(admin["port"]),
        database=os.environ.get("MYSQL_DATABASE") or os.environ.get("DB_NAME") or APP_DATABASE,
        root_password=passwords["root"],
        app_password=passwords["app"],
        backup_password=passwords["backup"],
        migrate_password=passwords["migrate"],
        dba_password=passwords["dba"],
    )
    if write_env:
        upsert_env_file(root / "backend" / ".env", updates)
        upsert_env_file(root / ".env", updates)
        # Subsequent calls in this process should see the new secrets.
        os.environ.update(updates)
    checks = verify_accounts(passwords)
    report["verify"] = checks
    report["env_written"] = write_env
    # Never return raw passwords.
    report["password_bytes"] = {k: len(v) for k, v in passwords.items()}
    return report


def main(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Generate strong MySQL passwords and apply least-privilege grants")
    p.add_argument("--no-write-env", action="store_true", help="Do not update gitignored .env files")
    p.add_argument("--keep-remote-root", action="store_true", help="Do not ACCOUNT LOCK root@%")
    p.add_argument("--no-rotate", action="store_true", help="Keep existing non-weak passwords")
    args = p.parse_args(argv)
    report = harden(
        write_env=not args.no_write_env,
        lock_remote_root=not args.keep_remote_root,
        rotate=not args.no_rotate,
    )
    import json

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
