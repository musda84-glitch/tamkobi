"""Ortak fotoğrafı — model + partner_photo yükleme."""
import io
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models import Partner  # noqa: E402
import storage_manager as sm  # noqa: E402

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001"
    "0d0a2db40000000049454e44ae426082"
)

_frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _frontend_env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api" if BASE_URL else ""
COMPANY = os.environ.get("TEST_COMPANY_ID") or "comp_nexus_main_01"
ADMIN = os.environ.get("TEST_ADMIN_EMAIL", "admin@nexus.com")
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


def test_partner_model_keeps_photo_url():
    p = Partner(
        company_id=COMPANY,
        name="Foto Ortak",
        share_percent=10,
        photo_url="/api/files/tamkobi/accounts/x/partners/p.png",
    )
    dumped = p.to_mongo()
    assert dumped.get("photo_url") == "/api/files/tamkobi/accounts/x/partners/p.png"


def test_partner_photo_uses_partners_area():
    assert sm.area_for_entity("partner_photo") == "partners"
    path = sm.object_path("comp_demo", "partner_photo", "png")
    assert "/accounts/comp_demo/partners/" in path


@pytest.fixture
def api_client():
    if not API:
        pytest.skip("REACT_APP_BACKEND_URL missing")
    s = requests.Session()
    try:
        r = s.post(f"{API}/auth/login", json={"email": ADMIN, "password": ADMIN_PW}, timeout=30)
    except requests.RequestException as exc:
        pytest.skip(f"admin login unavailable: {exc}")
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    return s


def _make_partner(api_client, name):
    r = api_client.post(
        f"{API}/banking/partners",
        json={"company_id": COMPANY, "name": name, "share_percent": 1},
        timeout=30,
    )
    assert r.status_code == 200, r.text[:500]
    return r.json()


def test_create_partner_persists_photo_url(api_client):
    url = "/api/files/tamkobi/accounts/demo/partners/preview.png"
    name = f"TEST_FotoOrt_{uuid.uuid4().hex[:8]}"
    r = api_client.post(
        f"{API}/banking/partners",
        json={"company_id": COMPANY, "name": name, "share_percent": 1, "photo_url": url},
        timeout=30,
    )
    assert r.status_code == 200, r.text[:500]
    pid = r.json()["id"]
    try:
        assert r.json().get("photo_url") == url
        got = api_client.get(f"{API}/banking/partners", params={"company_id": COMPANY}, timeout=30).json()
        row = next(x for x in got if x["id"] == pid)
        assert row.get("photo_url") == url
        cleared = api_client.put(f"{API}/banking/partners/{pid}", json={"photo_url": ""}, timeout=30)
        assert cleared.status_code == 200, cleared.text[:400]
        assert not (cleared.json() or {}).get("photo_url")
    finally:
        api_client.delete(f"{API}/banking/partners/{pid}", timeout=30)


def test_upload_sets_partner_photo_url(api_client):
    p = _make_partner(api_client, f"TEST_FotoOrtUp_{uuid.uuid4().hex[:8]}")
    pid = p["id"]
    try:
        up = api_client.post(
            f"{API}/files/upload",
            params={"entity": "partner_photo", "entity_id": pid, "company_id": COMPANY},
            files={"file": ("photo.png", io.BytesIO(PNG), "image/png")},
            timeout=60,
        )
        assert up.status_code == 200, up.text[:500]
        url = up.json()["url"]
        assert url.startswith("/api/files/")
        got = api_client.get(f"{API}/banking/partners", params={"company_id": COMPANY}, timeout=30).json()
        row = next(x for x in got if x["id"] == pid)
        assert row.get("photo_url") == url
        alias = api_client.post(
            f"{API}/files/upload",
            params={"entity": "partner", "entity_id": pid, "company_id": COMPANY},
            files={"file": ("photo2.png", io.BytesIO(PNG), "image/png")},
            timeout=60,
        )
        assert alias.status_code == 200, alias.text[:400]
        got2 = api_client.get(f"{API}/banking/partners", params={"company_id": COMPANY}, timeout=30).json()
        row2 = next(x for x in got2 if x["id"] == pid)
        assert row2.get("photo_url") == alias.json()["url"]
    finally:
        api_client.delete(f"{API}/banking/partners/{pid}", timeout=30)
