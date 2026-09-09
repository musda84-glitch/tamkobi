"""First-run install lock and wizard-written MySQL settings (WordPress-style).

The API can boot without a working database so /kurulum can collect credentials.
Existing deployments that already have users are treated as installed even if
the lock file is missing (docker rebuild, volume wipe).
"""
from __future__ import annotations

import json
import os
import stat
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import db_ssl

_DB_NAME_RE_OK = ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")


def data_dir() -> Path:
    override = (os.environ.get("TAMKOBI_DATA_DIR") or "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "data"


def install_path() -> Path:
    return data_dir() / "install.json"


def database_path() -> Path:
    return data_dir() / "database.json"


def _atomic_write(path: Path, payload: dict, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp, mode)
    tmp.replace(path)
    try:
        os.chmod(path, mode | stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass


def load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def load_install() -> dict:
    return load_json(install_path())


def lock_installed() -> bool:
    return bool(load_install().get("installed"))


def load_database_settings() -> Optional[Dict[str, Any]]:
    raw = load_json(database_path())
    if not raw:
        return None
    host = str(raw.get("host") or "").strip() or "127.0.0.1"
    try:
        port = int(raw.get("port") or 3306)
    except (TypeError, ValueError):
        port = 3306
    db = str(raw.get("db") or raw.get("database") or "").strip() or "tamkobi"
    # Files written before the TLS field existed record no mode; db_ssl reads
    # that silence as "decide from the host", not as plaintext.
    ssl_mode, ssl_ca = db_ssl.settings({**raw, "host": host})
    return {
        "host": host,
        "port": port,
        "user": str(raw.get("user") or "tamkobi"),
        "password": str(raw.get("password") or ""),
        "db": db,
        "charset": "utf8mb4",
        "autocommit": True,
        "ssl_mode": ssl_mode,
        "ssl_ca": ssl_ca,
    }


def save_database_settings(settings: dict) -> None:
    ssl_mode, ssl_ca = db_ssl.settings(settings)
    _atomic_write(
        database_path(),
        {
            "host": settings["host"],
            "port": int(settings["port"]),
            "user": settings["user"],
            "password": settings.get("password") or "",
            "db": settings["db"],
            "charset": "utf8mb4",
            "autocommit": True,
            "ssl_mode": ssl_mode,
            "ssl_ca": ssl_ca,
        },
    )


def mark_installed(meta: dict) -> dict:
    doc = {
        "installed": True,
        "installed_at": datetime.now(timezone.utc).isoformat(),
        **{k: v for k, v in meta.items() if k != "installed"},
    }
    prev = load_install()
    if prev.get("jwt_secret") and "jwt_secret" not in doc:
        doc["jwt_secret"] = prev["jwt_secret"]
    _atomic_write(install_path(), doc)
    return doc


def apply_saved_secrets() -> None:
    """Restore JWT_SECRET written by the wizard when the process env is empty/insecure."""
    secret = (load_install().get("jwt_secret") or "").strip()
    if not secret:
        return
    current = (os.environ.get("JWT_SECRET") or "").strip()
    if current in {"", "change-me", "secret", "jwt-secret", "nexus_default_secret_key_99482910"}:
        os.environ["JWT_SECRET"] = secret


def sanitize_db_name(name: str) -> str:
    text = (name or "").strip()
    if not text or len(text) > 64 or any(ch not in _DB_NAME_RE_OK for ch in text):
        raise ValueError("Veritabanı adı yalnızca harf, rakam ve alt çizgi içerebilir.")
    return text


def public_defaults() -> dict:
    """Form defaults for the wizard. Never include the password."""
    file_cfg = load_database_settings()
    if file_cfg:
        return {
            "db_host": file_cfg["host"],
            "db_port": int(file_cfg["port"]),
            "db_name": file_cfg["db"],
            "db_user": file_cfg["user"],
            "ssl_mode": file_cfg["ssl_mode"],
            "ssl_ca": file_cfg["ssl_ca"],
        }
    url = (os.environ.get("MYSQL_URL") or os.environ.get("DATABASE_URL") or "").strip()
    host, port, user, db = "127.0.0.1", 3306, "tamkobi", "tamkobi"
    if url.startswith("mysql"):
        from urllib.parse import unquote, urlparse
        parsed = urlparse("mysql://" + url.split("://", 1)[1] if url.startswith("mysql+") else url)
        host = parsed.hostname or host
        port = parsed.port or port
        user = unquote(parsed.username or user)
        db = ((parsed.path or "/tamkobi").lstrip("/") or db).split("?")[0]
    else:
        host = os.environ.get("MYSQL_HOST", host)
        try:
            port = int(os.environ.get("MYSQL_PORT", str(port)))
        except (TypeError, ValueError):
            port = 3306
        user = os.environ.get("MYSQL_USER", user)
        db = os.environ.get("MYSQL_DATABASE") or os.environ.get("DB_NAME") or db
    mode, ca = db_ssl.resolve(host)
    return {
        "db_host": host,
        "db_port": port,
        "db_name": db,
        "db_user": user,
        "ssl_mode": mode,
        "ssl_ca": ca,
    }
