"""Credential encryption key must survive process restarts."""
import os
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

import comm_service


@pytest.fixture
def isolated_key_env(tmp_path, monkeypatch):
    monkeypatch.delenv("CREDENTIAL_ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    # Drop any previously generated env key leftovers
    key_file = tmp_path / ".credential_encryption_key"
    if key_file.exists():
        key_file.unlink()
    return tmp_path


def test_fallback_key_persists_across_rebuild(isolated_key_env, monkeypatch):
    monkeypatch.delenv("CREDENTIAL_ENCRYPTION_KEY", raising=False)
    f1 = comm_service.reset_fernet_for_tests()
    key_file = isolated_key_env / ".credential_encryption_key"
    assert key_file.is_file()
    token = f1.encrypt(b"netgsm-secret").decode()

    # Simulate restart: clear in-process env, keep file
    monkeypatch.delenv("CREDENTIAL_ENCRYPTION_KEY", raising=False)
    f2 = comm_service.reset_fernet_for_tests()
    assert f2.decrypt(token.encode()).decode() == "netgsm-secret"
    assert key_file.read_text().strip() == os.environ.get("CREDENTIAL_ENCRYPTION_KEY")


def test_env_key_preferred_over_file(isolated_key_env, monkeypatch):
    env_key = Fernet.generate_key().decode()
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", env_key)
    f = comm_service.reset_fernet_for_tests()
    enc = f.encrypt(b"hello").decode()
    assert Fernet(env_key.encode()).decrypt(enc.encode()).decode() == "hello"


def test_decrypt_accepts_legacy_plaintext(isolated_key_env):
    comm_service.reset_fernet_for_tests()
    assert comm_service.decrypt("plain-api-pass") == "plain-api-pass"
    assert comm_service.try_decrypt("plain-api-pass") == "plain-api-pass"


def test_try_decrypt_returns_none_for_foreign_token(isolated_key_env):
    comm_service.reset_fernet_for_tests()
    foreign = Fernet.generate_key()
    bad = Fernet(foreign).encrypt(b"secret").decode()
    assert comm_service.looks_like_fernet_token(bad)
    assert comm_service.try_decrypt(bad) is None


def test_encrypt_decrypt_roundtrip(isolated_key_env):
    comm_service.reset_fernet_for_tests()
    enc = comm_service.encrypt("s3cret")
    assert enc.startswith("gAAAA")
    assert comm_service.decrypt(enc) == "s3cret"
