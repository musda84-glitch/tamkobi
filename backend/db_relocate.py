"""Move the TamKobi database to another MySQL server (schema + data) and repoint the app.

The document store lives in three tables (docs, meta_indexes, system_logs), so a
relocation is a snapshot of the current server restored into the target server
followed by a settings rewrite. Nothing here needs the mysql client binary.

    python3 backend/db_relocate.py show
    python3 backend/db_relocate.py test --host db.firma.com --db tamkobi --user tamkobi
    python3 backend/db_relocate.py move --host db.firma.com --db tamkobi --user tamkobi --yes

The password comes from --password or the TARGET_MYSQL_PASSWORD environment
variable, so it need not appear in shell history.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Sequence
from urllib.parse import unquote, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mysql_backup
from setup_state import data_dir, load_database_settings, sanitize_db_name, save_database_settings

CORE_TABLES = ("docs", "meta_indexes")
KNOWN_TABLES = ("docs", "meta_indexes", "system_logs")
PASSWORD_ENV = "TARGET_MYSQL_PASSWORD"


def backup_dir() -> Path:
    """Where the pre-move snapshot goes.

    Docker only mounts the data directory, so a repo-relative default would be
    lost with the container that wrote it.
    """
    override = (os.environ.get("MYSQL_BACKUP_DIR") or "").strip()
    return Path(override) if override else data_dir() / "backups"


def store_settings(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize to the shape mysql_store and database.json use (`db` key)."""
    host = str(cfg.get("host") or "").strip()
    user = str(cfg.get("user") or "").strip()
    name = cfg.get("db") if cfg.get("db") is not None else cfg.get("database")
    if not host:
        raise ValueError("Sunucu adresi (host) gerekli.")
    if not user:
        raise ValueError("MySQL kullanıcı adı gerekli.")
    raw_port = cfg.get("port")
    try:
        port = 3306 if raw_port in (None, "") else int(raw_port)
    except (TypeError, ValueError) as exc:
        raise ValueError("Port bir sayı olmalı.") from exc
    if not 1 <= port <= 65535:
        raise ValueError("Port 1-65535 aralığında olmalı.")
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": str(cfg.get("password") or ""),
        "db": sanitize_db_name(str(name or "")),
        "charset": "utf8mb4",
        "autocommit": True,
    }


def dump_settings(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize to the shape mysql_backup uses (`database` key)."""
    s = store_settings(cfg)
    return {
        "host": s["host"],
        "port": s["port"],
        "user": s["user"],
        "password": s["password"],
        "database": s["db"],
        "charset": "utf8mb4",
    }


def settings_from_url(url: str) -> Dict[str, Any]:
    text = (url or "").strip()
    if not text.startswith("mysql"):
        raise ValueError("Bağlantı adresi mysql:// ile başlamalı.")
    if text.startswith("mysql+"):
        text = "mysql://" + text.split("://", 1)[1]
    parsed = urlparse(text)
    return store_settings(
        {
            "host": parsed.hostname or "",
            "port": parsed.port or 3306,
            "user": unquote(parsed.username or ""),
            "password": unquote(parsed.password or ""),
            "db": (parsed.path or "").lstrip("/").split("?")[0],
        }
    )


def public_view(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Connection identity without the password — safe for API responses and logs."""
    s = store_settings(cfg)
    return {"host": s["host"], "port": s["port"], "db": s["db"], "user": s["user"]}


def current_settings() -> Dict[str, Any]:
    from mysql_store import mysql_settings_from_env

    return store_settings(mysql_settings_from_env())


def settings_source() -> str:
    """Where the live connection comes from: the wizard file or the environment."""
    return "file" if load_database_settings() else "env"


def same_server(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    left, right = store_settings(a), store_settings(b)
    return (
        left["host"].lower() == right["host"].lower()
        and left["port"] == right["port"]
        and left["db"] == right["db"]
    )


def table_counts(cfg: Dict[str, Any]) -> Dict[str, int]:
    conn = mysql_backup.connect(dump_settings(cfg))
    try:
        cur = conn.cursor()
        cur.execute("SHOW TABLES")
        tables = [r[0] for r in cur.fetchall()]
        counts: Dict[str, int] = {}
        for table in tables:
            cur.execute(f"SELECT COUNT(*) FROM `{table}`")
            counts[table] = int(cur.fetchone()[0])
        return counts
    finally:
        conn.close()


def drop_database(cfg: Dict[str, Any]) -> None:
    """Drop the database named in `cfg` with those credentials (root is often locked)."""
    target = store_settings(cfg)
    if target["db"] in {"mysql", "information_schema", "performance_schema", "sys"}:
        raise ValueError("Sistem veritabanı silinemez.")
    conn = mysql_backup.connect({**dump_settings(target), "database": None})
    try:
        conn.cursor().execute(f"DROP DATABASE IF EXISTS `{target['db']}`")
    finally:
        conn.close()


def target_state(counts: Optional[Dict[str, int]], error: Optional[str] = None) -> Dict[str, Any]:
    """Decide whether a target may be overwritten silently.

    A copy drops every table in the target schema, so only a schema that is
    both readable and free of data counts as empty. An unreadable target is
    never assumed empty.
    """
    readable = error is None and counts is not None
    tables = dict(counts or {})
    foreign = sorted(t for t in tables if t not in KNOWN_TABLES)
    rows = sum(int(n or 0) for n in tables.values())
    empty = readable and not rows and not foreign
    if not readable:
        summary = f"Hedef veritabanının içeriği okunamadı: {error}"
    elif empty:
        summary = "Hedef boş, taşımaya hazır"
    elif foreign:
        summary = "Hedefte TamKobi'ye ait olmayan tablolar var: " + ", ".join(foreign)
    else:
        summary = f"Hedefte zaten {rows} satır veri var (docs: {int(tables.get('docs') or 0)})"
    return {
        "tables": tables,
        "readable": readable,
        "error": error,
        "foreign_tables": foreign,
        "existing_rows": rows,
        "existing_docs": int(tables.get("docs") or 0),
        "empty": empty,
        "summary": summary,
    }


def inspect_target(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Probe the target server, creating the database when the user may."""
    from setup_install import probe_database

    target = store_settings(cfg)
    info = probe_database(target)
    try:
        state = target_state(table_counts(target))
    except Exception as exc:
        state = target_state(None, error=str(exc))
    return {
        "target": public_view(target),
        "server_version": info.get("server_version"),
        "created": bool(info.get("created")),
        **state,
    }


def _snapshot_source(source: Dict[str, Any], backup_dir: Optional[Path]) -> tuple:
    snap = mysql_backup.snapshot_database(dump_settings(source))
    for table in CORE_TABLES:
        if table not in (snap.get("tables") or {}):
            raise RuntimeError(f"Kaynak veritabanında `{table}` tablosu yok; taşıma iptal edildi.")
    path = None
    if backup_dir is not None:
        json_path, _sql_path = mysql_backup.write_snapshot(snap, Path(backup_dir))
        mysql_backup.verify_snapshot_file(json_path)
        path = str(json_path)
    return snap, path


def copy_database(
    target: Dict[str, Any],
    source: Optional[Dict[str, Any]] = None,
    overwrite: bool = False,
    repoint: bool = True,
    backup_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Snapshot the live database into `target`, verify row counts, then repoint.

    The app keeps using the old server until verification passes, so a failed
    copy leaves a working install behind.
    """
    src = store_settings(source or current_settings())
    dst = store_settings(target)
    if same_server(src, dst):
        raise ValueError("Hedef sunucu ve veritabanı şu an kullanılanla aynı.")

    probe = inspect_target(dst)
    if not probe["empty"] and not overwrite:
        raise ValueError(
            f"{probe['summary']}. Taşıma hedefteki tüm tabloları siler; "
            "devam etmek için 'üzerine yaz' seçeneğini kullanın."
        )

    snap, snapshot_path = _snapshot_source(src, backup_dir)
    expected = {t: int(b.get("row_count") or 0) for t, b in snap["tables"].items()}
    restored = mysql_backup.restore_snapshot(
        snap, dst["db"], drop_tables=True, settings=dump_settings(dst)
    )
    actual = table_counts(dst)
    mismatch = {
        t: {"source": n, "target": int(actual.get(t, -1))}
        for t, n in expected.items()
        if int(actual.get(t, -1)) != n
    }
    if mismatch:
        raise RuntimeError(
            "Hedefteki satır sayıları kaynakla eşleşmedi, bağlantı değiştirilmedi: "
            f"{json.dumps(mismatch, ensure_ascii=False)}"
        )

    if repoint:
        save_database_settings(dst)
    return {
        "source": public_view(src),
        "target": public_view(dst),
        "server_version": probe.get("server_version"),
        "database_created": probe.get("created"),
        "snapshot": snapshot_path,
        "tables": expected,
        "restored": restored,
        "verified": True,
        "repointed": bool(repoint),
    }


def _target_from_args(args: argparse.Namespace) -> Dict[str, Any]:
    if getattr(args, "url", None):
        target = settings_from_url(args.url)
    else:
        target = store_settings(
            {"host": args.host, "port": args.port, "user": args.user, "db": args.db, "password": ""}
        )
    if args.password is not None:
        target["password"] = args.password
    elif not target["password"]:
        target["password"] = os.environ.get(PASSWORD_ENV, "")
    return target


def _cmd_show(_args: argparse.Namespace) -> int:
    mysql_backup.load_env()
    current = current_settings()
    try:
        counts = table_counts(current)
        reachable = True
    except Exception as exc:
        counts, reachable = {"error": str(exc)}, False
    print(
        json.dumps(
            {"current": public_view(current), "settings_source": settings_source(), "reachable": reachable, "tables": counts},
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


def _cmd_test(args: argparse.Namespace) -> int:
    mysql_backup.load_env()
    info = inspect_target(_target_from_args(args))
    print(json.dumps(info, indent=2, ensure_ascii=False))
    return 0


def _cmd_move(args: argparse.Namespace) -> int:
    mysql_backup.load_env()
    target = _target_from_args(args)
    if not args.yes:
        raise SystemExit(
            f"`{target['db']}` veritabanına taşımak için --yes gerekli "
            f"(hedef {target['host']}:{target['port']})."
        )
    dest = None if args.no_backup else Path(args.backup_dir or backup_dir())
    result = copy_database(
        target,
        overwrite=args.overwrite,
        repoint=not args.no_repoint,
        backup_dir=dest,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if result["repointed"]:
        print("\nBağlantı ayarı yazıldı. Değişikliğin geçerli olması için backend'i yeniden başlatın.", file=sys.stderr)
    return 0


def _add_target_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--url", default=None, help="mysql://kullanici:sifre@sunucu:3306/veritabani")
    p.add_argument("--host", default=None, help="Hedef MySQL sunucusu")
    p.add_argument("--port", type=int, default=3306)
    p.add_argument("--db", default=None, help="Hedef veritabanı adı")
    p.add_argument("--user", default=None, help="Hedef MySQL kullanıcısı")
    p.add_argument("--password", default=None, help=f"Boş bırakılırsa {PASSWORD_ENV} kullanılır")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="TamKobi veritabanını başka bir MySQL sunucusuna taşı")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("show", help="Kullanılan veritabanı ve tablo satır sayıları")
    s.set_defaults(func=_cmd_show)

    t = sub.add_parser("test", help="Hedef sunucuya bağlan, gerekirse veritabanını oluştur")
    _add_target_args(t)
    t.set_defaults(func=_cmd_test)

    m = sub.add_parser("move", help="Tabloları ve verileri hedefe kopyala, uygulamayı hedefe bağla")
    _add_target_args(m)
    m.add_argument("--yes", action="store_true", help="Zorunlu; taşımayı onaylar")
    m.add_argument("--overwrite", action="store_true", help="Hedefteki mevcut TamKobi verisini sil")
    m.add_argument("--no-repoint", action="store_true", help="Sadece kopyala; bağlantıyı değiştirme")
    m.add_argument("--no-backup", action="store_true", help="Yedek dosyası yazma")
    m.add_argument("--backup-dir", default=None, help="Yedek klasörü (varsayılan backend/data/backups)")
    m.set_defaults(func=_cmd_move)
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (ValueError, RuntimeError) as exc:
        print(f"Hata: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
