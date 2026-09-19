"""Personel fotoğrafı — model + employee_photo yükleme."""
import io
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models import Employee  # noqa: E402
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


def test_employee_model_keeps_photo_url():
    e = Employee(
        company_id=COMPANY,
        full_name="Foto Test",
        tc_kimlik="11111111111",
        department="Üretim",
        position="Operatör",
        phone="05550000000",
        email="foto@test.local",
        salary=1,
        start_date="2026-01-01",
        photo_url="/api/files/tamkobi/accounts/x/employees/p.png",
    )
    dumped = e.to_mongo()
    assert dumped.get("photo_url") == "/api/files/tamkobi/accounts/x/employees/p.png"


def test_employee_photo_uses_employees_area():
    assert sm.area_for_entity("employee_photo") == "employees"
    path = sm.object_path("comp_demo", "employee_photo", "png")
    assert "/accounts/comp_demo/employees/" in path


@pytest.fixture
def api_client():
    if not API:
        pytest.skip("REACT_APP_BACKEND_URL missing")
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN, "password": ADMIN_PW}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    return s


def _make_emp(api_client, name):
    r = api_client.post(
        f"{API}/personnel/employees",
        json={
            "company_id": COMPANY,
            "full_name": name,
            "tc_kimlik": f"1{uuid.uuid4().hex[:10]}",
            "department": "Üretim",
            "position": "Operatör",
            "phone": "05551112233",
            "email": f"ph_{uuid.uuid4().hex[:8]}@test.local",
            "salary": 1000,
            "start_date": "2026-01-01",
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text[:500]
    return r.json()


def test_create_employee_persists_photo_url(api_client):
    url = "/api/files/tamkobi/accounts/demo/employees/preview.png"
    name = f"TEST_FotoEmp_{uuid.uuid4().hex[:8]}"
    r = api_client.post(
        f"{API}/personnel/employees",
        json={
            "company_id": COMPANY,
            "full_name": name,
            "tc_kimlik": f"2{uuid.uuid4().hex[:10]}",
            "department": "Üretim",
            "position": "Operatör",
            "phone": "05551112233",
            "email": f"phc_{uuid.uuid4().hex[:8]}@test.local",
            "salary": 1000,
            "start_date": "2026-01-01",
            "photo_url": url,
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text[:500]
    eid = r.json()["id"]
    try:
        assert r.json().get("photo_url") == url
        got = api_client.get(f"{API}/personnel/employees", params={"company_id": COMPANY}, timeout=30).json()
        row = next(x for x in got if x["id"] == eid)
        assert row.get("photo_url") == url
        cleared = api_client.put(f"{API}/personnel/employees/{eid}", json={"photo_url": ""}, timeout=30)
        assert cleared.status_code == 200, cleared.text[:400]
        assert not (cleared.json() or {}).get("photo_url")
    finally:
        api_client.delete(f"{API}/personnel/employees/{eid}", timeout=30)


def test_upload_sets_employee_photo_url(api_client):
    emp = _make_emp(api_client, f"TEST_FotoUp_{uuid.uuid4().hex[:8]}")
    eid = emp["id"]
    try:
        up = api_client.post(
            f"{API}/files/upload",
            params={"entity": "employee_photo", "entity_id": eid, "company_id": COMPANY},
            files={"file": ("photo.png", io.BytesIO(PNG), "image/png")},
            timeout=60,
        )
        assert up.status_code == 200, up.text[:500]
        url = up.json()["url"]
        assert url.startswith("/api/files/")
        card = api_client.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json()
        assert card["employee"].get("photo_url") == url
        alias = api_client.post(
            f"{API}/files/upload",
            params={"entity": "personnel_photo", "entity_id": eid, "company_id": COMPANY},
            files={"file": ("photo2.png", io.BytesIO(PNG), "image/png")},
            timeout=60,
        )
        assert alias.status_code == 200, alias.text[:400]
        card2 = api_client.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json()
        assert card2["employee"].get("photo_url") == alias.json()["url"]
        # Belge yüklemesi (entity=employee) fotoğrafı ezmemeli
        doc = api_client.post(
            f"{API}/files/upload",
            params={"entity": "employee", "entity_id": eid, "company_id": COMPANY},
            files={"file": ("sozlesme.png", io.BytesIO(PNG), "image/png")},
            timeout=60,
        )
        assert doc.status_code == 200, doc.text[:400]
        card3 = api_client.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json()
        assert card3["employee"].get("photo_url") == alias.json()["url"]
    finally:
        api_client.delete(f"{API}/personnel/employees/{eid}", timeout=30)
