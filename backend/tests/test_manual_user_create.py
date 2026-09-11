"""Company settings: create a user with a password (no e-mail invite)."""
import uuid

import requests

from conftest import API, TEST_COMPANY_ID

CID = TEST_COMPANY_ID


def test_manual_user_create_login_and_cleanup():
    email = f"manuel_{uuid.uuid4().hex[:8]}@tamkobi.test"
    r = requests.post(
        f"{API}/users",
        json={"company_id": CID, "name": "Manuel Test", "email": email, "password": "manuel1", "role": "sales"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["email"] == email
    assert d["name"] == "Manuel Test"
    assert d["role"] == "sales"
    assert d["is_active"] is True
    assert "password_hash" not in d
    uid = d["id"]

    listed = requests.get(f"{API}/users", params={"company_id": CID}, timeout=20).json()
    assert email in [u["email"] for u in listed["users"]]

    login = requests.post(f"{API}/auth/login", json={"email": email, "password": "manuel1"}, timeout=20)
    assert login.status_code == 200, login.text

    dup = requests.post(
        f"{API}/users",
        json={"company_id": CID, "name": "X", "email": email, "password": "manuel1", "role": "sales"},
        timeout=20,
    )
    assert dup.status_code == 400

    short = requests.post(
        f"{API}/users",
        json={"company_id": CID, "name": "X", "email": f"short_{uuid.uuid4().hex[:6]}@tamkobi.test", "password": "123", "role": "sales"},
        timeout=20,
    )
    assert short.status_code == 400

    bad_role = requests.post(
        f"{API}/users",
        json={"company_id": CID, "name": "X", "email": f"role_{uuid.uuid4().hex[:6]}@tamkobi.test", "password": "manuel1", "role": "nope"},
        timeout=20,
    )
    assert bad_role.status_code == 400

    requests.delete(f"{API}/users/{uid}", timeout=20)
    gone = requests.get(f"{API}/users", params={"company_id": CID}, timeout=20).json()
    assert email not in [u["email"] for u in gone["users"]]


def test_manual_create_cancels_pending_invite():
    email = f"invman_{uuid.uuid4().hex[:8]}@tamkobi.test"
    inv = requests.post(
        f"{API}/users/invite",
        json={"company_id": CID, "email": email, "name": "Davet", "role": "warehouse", "base_url": "https://x"},
        timeout=20,
    )
    assert inv.status_code == 200, inv.text
    listed = requests.get(f"{API}/users", params={"company_id": CID}, timeout=20).json()
    assert email in [i["email"] for i in listed["invites"]]

    r = requests.post(
        f"{API}/users",
        json={"company_id": CID, "name": "Davet Manuel", "email": email, "password": "manuel1", "role": "warehouse"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    listed = requests.get(f"{API}/users", params={"company_id": CID}, timeout=20).json()
    assert email not in [i["email"] for i in listed["invites"]]
    assert email in [u["email"] for u in listed["users"]]
    requests.delete(f"{API}/users/{r.json()['id']}", timeout=20)
