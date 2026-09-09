"""First-run installer lock file and live setup API."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000")

from setup_state import (  # noqa: E402
    apply_saved_secrets,
    lock_installed,
    load_database_settings,
    load_install,
    mark_installed,
    public_defaults,
    sanitize_db_name,
    save_database_settings,
)


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("TAMKOBI_DATA_DIR", str(tmp_path))
    return tmp_path


def test_sanitize_db_name_rejects_injection():
    with pytest.raises(ValueError):
        sanitize_db_name("tamkobi; drop table docs")
    with pytest.raises(ValueError):
        sanitize_db_name("")
    assert sanitize_db_name("tamkobi_app") == "tamkobi_app"


def test_lock_roundtrip(data_dir):
    assert lock_installed() is False
    mark_installed({"site_name": "Acme", "admin_email": "a@example.com"})
    info = load_install()
    assert info["installed"] is True
    assert info["site_name"] == "Acme"
    assert info["admin_email"] == "a@example.com"
    assert lock_installed() is True
    assert (data_dir / "install.json").is_file()


def test_database_settings_roundtrip(data_dir):
    save_database_settings(
        {"host": "10.0.0.8", "port": 3307, "user": "app", "password": "s3cret", "db": "shop"}
    )
    cfg = load_database_settings()
    assert cfg["host"] == "10.0.0.8"
    assert cfg["port"] == 3307
    assert cfg["user"] == "app"
    assert cfg["password"] == "s3cret"
    assert cfg["db"] == "shop"
    defaults = public_defaults()
    assert defaults["db_host"] == "10.0.0.8"
    assert "password" not in defaults


def test_probe_live_mysql(data_dir):
    from mysql_backup import load_env
    from mysql_store import mysql_settings_from_env
    from setup_install import probe_database

    load_env()
    cfg = mysql_settings_from_env()
    try:
        info = probe_database(cfg)
    except RuntimeError as exc:
        pytest.skip(f"MySQL not reachable: {exc}")
    assert info["ok"] is True
    assert info["database"]


def test_apply_saved_jwt_when_insecure(data_dir, monkeypatch):
    mark_installed({"jwt_secret": "wizard-generated-secret-value-not-default"})
    monkeypatch.setenv("JWT_SECRET", "change-me")
    apply_saved_secrets()
    assert os.environ["JWT_SECRET"] == "wizard-generated-secret-value-not-default"
