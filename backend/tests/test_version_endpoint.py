"""GET /api/version is public and names the running commit."""
from __future__ import annotations

import requests

from conftest import API


def test_version_unauthenticated():
    r = requests.get(f"{API}/version", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["service"] == "TamKobi API"
    assert "git_sha" in body
    assert "git_sha_short" in body
    assert "source" in body
    assert body["source"] in {"env", "git", "unknown"}
    assert r.headers.get("Cache-Control", "").startswith("no-store")


def test_version_does_not_leak_secrets():
    r = requests.get(f"{API}/version", timeout=15)
    assert r.status_code == 200, r.text
    text = r.text.lower()
    for needle in ("password", "secret", "mysql", "token", "credential"):
        assert needle not in text
