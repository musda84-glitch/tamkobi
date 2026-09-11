"""GİB kontör cüzdanı, paket listesi, satış aç/kapa ve e-belge tüketimi."""
import sys
from pathlib import Path

import requests

from conftest import API, TEST_COMPANY_ID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gib_credits import sales_from_settings

ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


class TestGibSalesFlagUnit:
    def test_missing_key_means_sales_off(self):
        assert sales_from_settings(None) is False
        assert sales_from_settings({}) is False
        assert sales_from_settings({"gib_credits_sales": False}) is False
        assert sales_from_settings({"gib_credits_sales": 0}) is False
        assert sales_from_settings({"gib_credits_sales": True}) is True


class TestGibCredits:
    def _login(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
        assert r.status_code == 200, r.text
        return s

    def _set_sales(self, s, on):
        r = s.put(f"{API}/system/settings", json={"gib_credits_sales": bool(on)}, timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    def test_wallet_and_packs_default_sales_off(self):
        s = self._login()
        self._set_sales(s, False)
        g = s.get(f"{API}/account/gib-credits", params={"company_id": TEST_COMPANY_ID}, timeout=20)
        assert g.status_code == 200, g.text
        d = g.json()
        assert d["balance"] >= 0
        assert d.get("sales_enabled") is False
        assert d["packs"] == []

    def test_enable_sales_exposes_packs(self):
        s = self._login()
        try:
            st = self._set_sales(s, True)
            assert st.get("gib_credits_sales") is True
            g = s.get(f"{API}/account/gib-credits", params={"company_id": TEST_COMPANY_ID}, timeout=20)
            assert g.status_code == 200, g.text
            d = g.json()
            assert d.get("sales_enabled") is True
            ids = {p["id"] for p in d["packs"]}
            assert "gib_100" in ids
            assert all(p["credits"] > 0 for p in d["packs"])
        finally:
            self._set_sales(s, False)

    def test_gift_then_consume_on_einvoice(self):
        s = self._login()
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

    def test_checkout_blocked_while_sales_off(self):
        s = self._login()
        self._set_sales(s, False)
        r = s.post(f"{API}/payments/checkout", json={"company_id": TEST_COMPANY_ID, "pack_id": "gib_does_not_exist", "origin_url": "http://localhost"}, timeout=20)
        assert r.status_code == 403, r.text
        assert "kapalı" in (r.json().get("detail") or "").lower()

    def test_unknown_pack_checkout_when_sales_on(self):
        s = self._login()
        try:
            self._set_sales(s, True)
            r = s.post(f"{API}/payments/checkout", json={"company_id": TEST_COMPANY_ID, "pack_id": "gib_does_not_exist", "origin_url": "http://localhost"}, timeout=20)
            assert r.status_code == 400, r.text
        finally:
            self._set_sales(s, False)
