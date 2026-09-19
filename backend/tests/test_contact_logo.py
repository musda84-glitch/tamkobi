"""Cari (contact) logo_url — model + yükleme endpointi."""
import io
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models import Contact  # noqa: E402
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


def test_contact_model_keeps_logo_url():
    c = Contact(
        company_id=COMPANY,
        type="customer",
        name="Logo Test Cari",
        tax_number_or_id="1111111111",
        logo_url="/api/files/tamkobi/accounts/x/contacts/logo.png",
    )
    dumped = c.to_mongo()
    assert dumped.get("logo_url", dumped.get("logoUrl")) == "/api/files/tamkobi/accounts/x/contacts/logo.png"


def test_contact_upload_area_is_contacts():
    assert sm.area_for_entity("contact") == "contacts"
    path = sm.object_path("comp_demo", "contact", "png")
    assert "/accounts/comp_demo/contacts/" in path
    assert path.endswith(".png")


@pytest.fixture
def api_client():
    if not API:
        pytest.skip("REACT_APP_BACKEND_URL missing")
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN, "password": ADMIN_PW}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    return s


def test_create_contact_persists_logo_url(api_client):
    url = "/api/files/tamkobi/accounts/demo/contacts/preview.png"
    name = f"TEST_LogoCari_{uuid.uuid4().hex[:8]}"
    r = api_client.post(
        f"{API}/contacts",
        json={
            "company_id": COMPANY,
            "type": "customer",
            "name": name,
            "tax_number_or_id": f"9{uuid.uuid4().hex[:10]}",
            "logo_url": url,
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text[:500]
    cid = r.json()["id"]
    try:
        assert r.json().get("logo_url") == url
        ov = api_client.get(f"{API}/contacts/{cid}/overview", timeout=30)
        assert ov.status_code == 200, ov.text[:400]
        assert ov.json()["contact"].get("logo_url") == url
        cleared = api_client.put(f"{API}/contacts/{cid}", json={"logo_url": ""}, timeout=30)
        assert cleared.status_code == 200, cleared.text[:400]
        assert not (cleared.json() or {}).get("logo_url")
    finally:
        api_client.delete(f"{API}/contacts/{cid}", timeout=30)


def test_upload_sets_contact_logo_url(api_client):
    name = f"TEST_LogoUp_{uuid.uuid4().hex[:8]}"
    cr = api_client.post(
        f"{API}/contacts",
        json={"company_id": COMPANY, "type": "supplier", "name": name, "tax_number_or_id": f"8{uuid.uuid4().hex[:10]}"},
        timeout=30,
    )
    assert cr.status_code == 200, cr.text[:500]
    cid = cr.json()["id"]
    try:
        up = api_client.post(
            f"{API}/files/upload",
            params={"entity": "contact", "entity_id": cid, "company_id": COMPANY},
            files={"file": ("logo.png", io.BytesIO(PNG), "image/png")},
            timeout=60,
        )
        assert up.status_code == 200, up.text[:500]
        url = up.json()["url"]
        assert url.startswith("/api/files/")
        ov = api_client.get(f"{API}/contacts/{cid}/overview", timeout=30).json()
        assert ov["contact"].get("logo_url") == url
        alias = api_client.post(
            f"{API}/files/upload",
            params={"entity": "contacts", "entity_id": cid, "company_id": COMPANY},
            files={"file": ("logo2.png", io.BytesIO(PNG), "image/png")},
            timeout=60,
        )
        assert alias.status_code == 200, alias.text[:400]
        ov2 = api_client.get(f"{API}/contacts/{cid}/overview", timeout=30).json()
        assert ov2["contact"].get("logo_url") == alias.json()["url"]
    finally:
        api_client.delete(f"{API}/contacts/{cid}", timeout=30)
