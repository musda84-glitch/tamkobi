"""Demo pack: auto-load on signup, clear, reload without touching real rows."""
import os
import uuid

import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/") + "/api"


def _signup():
    email = f"demo_{uuid.uuid4().hex[:8]}@test.com"
    s = requests.Session()
    r = s.post(f"{BASE}/public/signup", json={
        "company_name": f"Demo Firma {uuid.uuid4().hex[:5]}",
        "name": "Demo User",
        "email": email,
        "password": "abc123",
        "plan_id": "plan_standard",
    }, timeout=30)
    assert r.status_code == 200, r.text
    return s, r.json()["company_id"]


class TestDemoPack:
    def test_signup_gets_demo_and_clear_keeps_real_rows(self):
        s, cid = _signup()
        st = s.get(f"{BASE}/demo/status", params={"company_id": cid}, timeout=20)
        assert st.status_code == 200, st.text
        body = st.json()
        assert body["loaded"] is True
        assert body["total"] >= 8
        contacts = s.get(f"{BASE}/contacts", params={"company_id": cid}, timeout=20).json()
        demo_names = {c["name"] for c in contacts}
        assert "Örnek Perakende A.Ş." in demo_names

        real = s.post(f"{BASE}/contacts", json={"company_id": cid, "name": "Gerçek Cari", "type": "customer", "tax_number_or_id": "9999999999"}, timeout=20)
        assert real.status_code in (200, 201), real.text

        clr = s.post(f"{BASE}/demo/clear", params={"company_id": cid}, timeout=20)
        assert clr.status_code == 200, clr.text
        assert clr.json()["deleted"] >= 8
        after = s.get(f"{BASE}/demo/status", params={"company_id": cid}, timeout=20).json()
        assert after["loaded"] is False
        left = s.get(f"{BASE}/contacts", params={"company_id": cid}, timeout=20).json()
        names = [c["name"] for c in left]
        assert "Gerçek Cari" in names
        assert "Örnek Perakende A.Ş." not in names

        load = s.post(f"{BASE}/demo/load", params={"company_id": cid}, timeout=20)
        assert load.status_code == 200, load.text
        again = s.get(f"{BASE}/contacts", params={"company_id": cid}, timeout=20).json()
        names2 = [c["name"] for c in again]
        assert "Gerçek Cari" in names2
        assert "Örnek Perakende A.Ş." in names2
