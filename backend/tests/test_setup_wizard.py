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


def test_database_settings_keep_the_tls_mode(data_dir):
    save_database_settings(
        {"host": "10.0.0.8", "port": 3306, "user": "app", "password": "s3cret", "db": "shop", "ssl_mode": "required"}
    )
    assert load_database_settings()["ssl_mode"] == "required"
    assert public_defaults()["ssl_mode"] == "required"


def test_settings_file_without_a_tls_mode_follows_the_host(data_dir, monkeypatch):
    """A database.json from before the TLS field must not mean plaintext."""
    import json

    from mysql_store import mysql_settings_from_env

    def legacy(host: str) -> None:
        (data_dir / "database.json").write_text(
            json.dumps({"host": host, "port": 3306, "user": "app", "password": "s3cret", "db": "shop"}),
            encoding="utf-8",
        )

    monkeypatch.setenv("MYSQL_SSL_MODE", "disabled")
    legacy("db.firma.com")
    assert load_database_settings()["ssl_mode"] == "verify_identity"
    assert mysql_settings_from_env()["ssl_mode"] == "verify_identity"
    assert public_defaults()["ssl_mode"] == "verify_identity"

    legacy("127.0.0.1")
    assert load_database_settings()["ssl_mode"] == "disabled"

    # The environment may still raise the floor for such a file.
    monkeypatch.setenv("MYSQL_SSL_MODE", "verify_identity")
    assert load_database_settings()["ssl_mode"] == "verify_identity"


def test_saving_settings_records_a_real_tls_mode(data_dir, monkeypatch):
    """What is written back must not read as "no choice" next time."""
    monkeypatch.delenv("MYSQL_SSL_MODE", raising=False)
    save_database_settings({"host": "db.firma.com", "port": 3306, "user": "app", "password": "p", "db": "shop"})
    import json

    assert json.loads((data_dir / "database.json").read_text(encoding="utf-8"))["ssl_mode"] == "verify_identity"


def test_wizard_verifies_remote_hosts_by_default(data_dir, monkeypatch):
    from setup_install import DbProbe, _settings_from

    monkeypatch.delenv("MYSQL_SSL_MODE", raising=False)
    remote = _settings_from(DbProbe(db_host="db.firma.com", db_name="tamkobi", db_user="app"))
    assert remote["ssl_mode"] == "verify_identity"
    # An empty mode from the form means "decide from the host", not "plaintext".
    blank = _settings_from(DbProbe(db_host="db.firma.com", db_name="tamkobi", db_user="app", ssl_mode=""))
    assert blank["ssl_mode"] == "verify_identity"
    local = _settings_from(DbProbe(db_host="127.0.0.1", db_name="tamkobi", db_user="app"))
    assert local["ssl_mode"] == "disabled"
    assert public_defaults()["ssl_mode"] == "disabled"


def test_wizard_keeps_the_deployment_tls_mode(data_dir, monkeypatch):
    from setup_install import DbProbe, _settings_from

    monkeypatch.setenv("MYSQL_SSL_MODE", "required")
    monkeypatch.setenv("MYSQL_HOST", "127.0.0.1")
    assert _settings_from(DbProbe(db_host="127.0.0.1", db_name="tamkobi", db_user="app"))["ssl_mode"] == "required"
    assert public_defaults()["ssl_mode"] == "required"
    chosen = _settings_from(
        DbProbe(db_host="127.0.0.1", db_name="tamkobi", db_user="app", ssl_mode="disabled")
    )
    assert chosen["ssl_mode"] == "disabled"


def test_wizard_rejects_verification_without_a_ca(data_dir):
    from fastapi import HTTPException
    from setup_install import DbProbe, _settings_from

    with pytest.raises(HTTPException) as err:
        _settings_from(DbProbe(db_host="db.firma.com", db_name="tamkobi", db_user="app", ssl_mode="verify_ca"))
    assert err.value.status_code == 400
    with pytest.raises(HTTPException):
        _settings_from(DbProbe(db_host="db.firma.com", db_name="tamkobi", db_user="app", ssl_mode="belki"))


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


def test_migrate_fails_hard_only_when_installed():
    from migrate import migrate_error_exit_code

    assert migrate_error_exit_code(False) == 0
    assert migrate_error_exit_code(True) == 1
