"""TLS modes shared by every MySQL connection path."""
from __future__ import annotations

import os
import ssl
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000")

import db_ssl  # noqa: E402


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, "disabled"),
        ("", "disabled"),
        ("off", "disabled"),
        ("REQUIRED", "required"),
        ("require", "required"),
        ("true", "required"),
        ("verify-ca", "verify_ca"),
        ("verify_identity", "verify_ca"),
    ],
)
def test_normalize_mode(value, expected):
    assert db_ssl.normalize_mode(value) == expected


def test_normalize_mode_rejects_unknown():
    with pytest.raises(ValueError):
        db_ssl.normalize_mode("maybe")


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "::1", ""])
def test_local_hosts_default_to_plaintext(host):
    assert db_ssl.default_mode(host) == "disabled"


@pytest.mark.parametrize("host", ["db.firma.com", "10.0.0.5", "mysql"])
def test_remote_hosts_default_to_tls(host):
    assert db_ssl.default_mode(host) == "required"


def test_disabled_mode_passes_no_ssl_argument():
    assert db_ssl.connect_kwargs({"ssl_mode": "disabled"}) == {}


def test_required_mode_encrypts_without_certificate_check():
    ctx = db_ssl.context("required")
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.verify_mode == ssl.CERT_NONE
    assert db_ssl.connect_kwargs({"ssl_mode": "required"})["ssl"] is not None


def test_verify_ca_needs_an_existing_ca_file(tmp_path):
    with pytest.raises(ValueError, match="CA"):
        db_ssl.context("verify_ca")
    with pytest.raises(ValueError, match="bulunamadı"):
        db_ssl.context("verify_ca", str(tmp_path / "yok.pem"))


def test_verify_ca_requires_the_certificate(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_bytes(ssl.get_default_verify_paths().cafile and Path(ssl.get_default_verify_paths().cafile).read_bytes() or b"")
    if not ca.stat().st_size:
        pytest.skip("no system CA bundle to build a context from")
    ctx = db_ssl.context("verify_ca", str(ca))
    assert ctx.verify_mode == ssl.CERT_REQUIRED


def test_plaintext_warning_only_for_other_machines(caplog):
    db_ssl._warned.clear()
    with caplog.at_level("WARNING", logger="tamkobi.db"):
        db_ssl.warn_if_plaintext({"host": "127.0.0.1", "ssl_mode": "disabled"})
        db_ssl.warn_if_plaintext({"host": "db.firma.com", "ssl_mode": "required"})
        assert caplog.messages == []
        db_ssl.warn_if_plaintext({"host": "db.firma.com", "ssl_mode": "disabled"})
        db_ssl.warn_if_plaintext({"host": "db.firma.com", "ssl_mode": "disabled"})
    assert len(caplog.messages) == 1
    assert "not encrypted" in caplog.messages[0]


def test_env_settings(monkeypatch):
    monkeypatch.setenv("MYSQL_SSL_MODE", "required")
    monkeypatch.setenv("MYSQL_SSL_CA", " /tmp/ca.pem ")
    assert db_ssl.from_env() == ("required", "/tmp/ca.pem")
