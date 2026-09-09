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


@pytest.fixture()
def ca_file(tmp_path):
    """A real CA bundle, since ssl refuses to load an empty one."""
    system = ssl.get_default_verify_paths().cafile
    if not system or not Path(system).is_file():
        pytest.skip("no system CA bundle to copy")
    path = tmp_path / "ca.pem"
    path.write_bytes(Path(system).read_bytes())
    return str(path)


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
        ("VERIFY_IDENTITY", "verify_identity"),
        ("verify", "verify_identity"),
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
def test_other_machines_default_to_verified_tls(host):
    assert db_ssl.default_mode(host) == "verify_identity"


def test_disabled_mode_passes_no_ssl_argument():
    assert db_ssl.connect_kwargs({"ssl_mode": "disabled"}) == {}


def test_required_mode_encrypts_without_certificate_check():
    ctx = db_ssl.context("required")
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.verify_mode == ssl.CERT_NONE
    assert db_ssl.connect_kwargs({"ssl_mode": "required"})["ssl"] is not None


def test_default_mode_verifies_the_chain_and_the_hostname():
    ctx = db_ssl.context(db_ssl.default_mode("db.firma.com"))
    assert ctx.verify_mode == ssl.CERT_REQUIRED
    assert ctx.check_hostname is True


def test_verify_ca_checks_the_chain_but_not_the_name(ca_file):
    ctx = db_ssl.context("verify_ca", ca_file)
    assert ctx.verify_mode == ssl.CERT_REQUIRED
    assert ctx.check_hostname is False


def test_verify_ca_needs_an_existing_ca_file(tmp_path):
    with pytest.raises(ValueError, match="CA"):
        db_ssl.context("verify_ca")
    with pytest.raises(ValueError, match="bulunamadı"):
        db_ssl.context("verify_ca", str(tmp_path / "yok.pem"))


def test_verify_identity_may_use_the_system_store(ca_file):
    assert db_ssl.context("verify_identity").check_hostname is True
    assert db_ssl.context("verify_identity", ca_file).verify_mode == ssl.CERT_REQUIRED
    with pytest.raises(ValueError, match="bulunamadı"):
        db_ssl.context("verify_identity", "/tmp/yok-boyle-bir-ca.pem")


def test_unverified_warning_only_for_other_machines(caplog):
    db_ssl._warned.clear()
    with caplog.at_level("WARNING", logger="tamkobi.db"):
        db_ssl.warn_if_unverified({"host": "127.0.0.1", "ssl_mode": "disabled"})
        db_ssl.warn_if_unverified({"host": "db.firma.com", "ssl_mode": "verify_identity"})
        assert caplog.messages == []
        db_ssl.warn_if_unverified({"host": "db.firma.com", "ssl_mode": "required"})
        db_ssl.warn_if_unverified({"host": "db.firma.com", "ssl_mode": "disabled"})
    assert len(caplog.messages) == 1
    assert "unverified" in caplog.messages[0]


def test_explain_speaks_up_only_about_certificates():
    assert db_ssl.explain(ValueError("Access denied for user")) == ""
    assert "sertifika" in db_ssl.explain(ssl.SSLCertVerificationError("certificate verify failed"))


def test_resolve_prefers_the_environment_then_the_host(monkeypatch):
    monkeypatch.setenv("MYSQL_SSL_MODE", "required")
    monkeypatch.setenv("MYSQL_SSL_CA", " /tmp/ca.pem ")
    assert db_ssl.resolve("db.firma.com") == ("required", "/tmp/ca.pem")
    assert db_ssl.resolve("127.0.0.1")[0] == "required"
    monkeypatch.setenv("MYSQL_SSL_MODE", "")
    assert db_ssl.resolve("db.firma.com")[0] == "verify_identity"
    assert db_ssl.resolve("127.0.0.1")[0] == "disabled"
    monkeypatch.delenv("MYSQL_SSL_MODE")
    assert db_ssl.resolve("db.firma.com")[0] == "verify_identity"


def test_a_new_target_never_inherits_a_weaker_mode(monkeypatch):
    """The deployment's own `disabled` must not follow us to another server."""
    monkeypatch.setenv("MYSQL_SSL_MODE", "disabled")
    monkeypatch.setenv("MYSQL_SSL_CA", "/tmp/ca.pem")
    assert db_ssl.for_target("db.firma.com") == ("verify_identity", "/tmp/ca.pem")
    assert db_ssl.for_target("127.0.0.1")[0] == "disabled"

    # A configured CA still comes along; the name check is only dropped when
    # the operator asks for verify_ca on the form.
    monkeypatch.setenv("MYSQL_SSL_MODE", "verify_ca")
    assert db_ssl.for_target("db.firma.com") == ("verify_identity", "/tmp/ca.pem")
    assert db_ssl.for_target("127.0.0.1")[0] == "verify_ca"

    monkeypatch.delenv("MYSQL_SSL_MODE")
    assert db_ssl.for_target("db.firma.com")[0] == "verify_identity"
    assert db_ssl.for_target("localhost")[0] == "disabled"
