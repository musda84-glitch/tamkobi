"""GİB kontör cüzdanı, paket listesi ve e-belge tüketimi."""
import requests

from conftest import API, TEST_COMPANY_ID

ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


class TestGibCredits:
    def test_wallet_and_packs(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
        assert r.status_code == 200, r.text
        g = s.get(f"{API}/account/gib-credits", params={"company_id": TEST_COMPANY_ID}, timeout=20)
        assert g.status_code == 200, g.text
        d = g.json()
        assert d["balance"] >= 0
        ids = {p["id"] for p in d["packs"]}
        assert "gib_100" in ids
        assert all(p["credits"] > 0 for p in d["packs"])

    def test_gift_then_consume_on_einvoice(self):
        s = requests.Session()
        assert s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20).status_code == 200
        before = s.get(f"{API}/account/gib-credits", params={"company_id": TEST_COMPANY_ID}, timeout=20).json()["balance"]
        gift = s.post(f"{API}/system/gib-credits/gift", json={"company_id": TEST_COMPANY_ID, "credits": 3, "note": "test"}, timeout=20)
        assert gift.status_code == 200, gift.text
        mid = s.get(f"{API}/account/gib-credits", params={"company_id": TEST_COMPANY_ID}, timeout=20).json()["balance"]
        assert mid == before + 3
        invs = s.get(f"{API}/invoices", params={"company_id": TEST_COMPANY_ID}, timeout=20).json()
        draft = next((i for i in invs if i.get("status") == "draft" and i.get("e_type") != "paper"), None)
        if not draft:
            return
        sent = s.post(f"{API}/invoices/{draft['id']}/send-to-gib", json={}, timeout=20)
        assert sent.status_code == 200, sent.text
        assert sent.json().get("gib_credits_left") == mid - 1

    def test_unknown_pack_checkout(self):
        s = requests.Session()
        assert s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20).status_code == 200
        r = s.post(f"{API}/payments/checkout", json={"company_id": TEST_COMPANY_ID, "pack_id": "gib_does_not_exist", "origin_url": "http://localhost"}, timeout=20)
        assert r.status_code == 400
