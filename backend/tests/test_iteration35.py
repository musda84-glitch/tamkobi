"""Iteration 35: Pricing Center + Morning Summary."""
import os
import math
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://isletme-one.preview.emergentagent.com").rstrip("/")
CID = "comp_nexus_main_01"


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- PRICING ----
class TestPricing:
    def test_put_trendyol_rule(self, sess):
        r = sess.put(f"{BASE}/api/pricing/rules/trendyol", json={
            "company_id": CID, "margin_pct": 40, "rounding": "0.99",
            "margin_base": "cost", "include_cargo": True, "include_service_fee": True,
            "min_price": 0, "max_price": 0, "list_price_markup_pct": 10
        })
        assert r.status_code == 200, r.text
        assert r.json()["rule"]["margin_pct"] == 40.0

    def test_get_rules(self, sess):
        r = sess.get(f"{BASE}/api/pricing/rules", params={"company_id": CID})
        assert r.status_code == 200
        assert r.json().get("trendyol", {}).get("margin_pct") == 40.0

    def test_compute_trendyol(self, sess):
        r = sess.post(f"{BASE}/api/pricing/compute", json={"company_id": CID, "channel": "trendyol"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] >= 50, f"count={data['count']}"
        assert data["priced"] >= 10, f"priced={data['priced']}"
        assert data.get("push_supported") is True
        fees = data["fees"]
        # verify each priced row
        for row in data["rows"]:
            if row.get("suggested") is None:
                assert row.get("reason") == "Alış fiyatı yok"
                continue
            assert row["cost"] > 0
            # Ends in .99
            frac = round(row["suggested"] - math.floor(row["suggested"]), 2)
            assert abs(frac - 0.99) < 1e-6, f"suggested {row['suggested']} not ending .99"
            # list_price ~ suggested*1.10
            assert abs(row["list_price"] - round(row["suggested"] * 1.10, 2)) < 0.02
            # Because price is rounded UP to .99, margin_pct is >= 40 with small overshoot
            # (max overshoot ≈ (1 - comm)/cost * 100 which is bigger for cheap items)
            assert row["margin_pct"] >= 39.9, f"margin_pct={row['margin_pct']} for cost={row['cost']}"
            # net_profit >= cost*0.4 minus tiny tolerance
            expected = row["cost"] * 0.4
            assert row["net_profit"] >= expected - 0.5, f"net_profit={row['net_profit']} vs {expected}"
        # Verify formula on one row
        priced_rows = [r for r in data["rows"] if r.get("suggested") is not None]
        row = priced_rows[0]
        comm = float(fees.get("commission_rate") or 0) / 100 * (1 + float(fees.get("commission_vat_rate") or 0) / 100)
        fixed = float(fees.get("service_fee") or 0) + float(fees.get("cargo_fee") or 0)
        raw = (row["cost"] * 1.4 + fixed) / (1 - comm)
        # suggested must be >= raw and end in .99
        assert row["suggested"] >= raw - 0.01, f"suggested {row['suggested']} < raw {raw}"

    def test_compute_inline_rule(self, sess):
        r = sess.post(f"{BASE}/api/pricing/compute", json={
            "company_id": CID, "channel": "trendyol",
            "rule": {"margin_pct": 30, "rounding": "0.90", "margin_base": "cost",
                     "include_cargo": True, "include_service_fee": True,
                     "min_price": 0, "max_price": 0, "list_price_markup_pct": 0}
        })
        assert r.status_code == 200
        for row in r.json()["rows"]:
            if row.get("suggested") is not None:
                frac = round(row["suggested"] - math.floor(row["suggested"]), 2)
                assert abs(frac - 0.90) < 1e-6, f"got {row['suggested']}"
        # Ensure not persisted
        rules = sess.get(f"{BASE}/api/pricing/rules", params={"company_id": CID}).json()
        assert rules["trendyol"]["margin_pct"] == 40.0
        assert rules["trendyol"]["rounding"] == "0.99"

    def test_compute_shopphp_push_supported_false(self, sess):
        r = sess.post(f"{BASE}/api/pricing/compute", json={"company_id": CID, "channel": "shopphp"})
        assert r.status_code == 200
        assert r.json().get("push_supported") is False

    def test_restore_rule(self, sess):
        r = sess.put(f"{BASE}/api/pricing/rules/trendyol", json={
            "company_id": CID, "margin_pct": 30, "rounding": "0.90",
            "margin_base": "cost", "include_cargo": True, "include_service_fee": True,
            "min_price": 0, "max_price": 0, "list_price_markup_pct": 0
        })
        assert r.status_code == 200
        assert r.json()["rule"]["margin_pct"] == 30.0


# ---- MORNING SUMMARY ----
class TestSummary:
    def test_preview(self, sess):
        r = sess.get(f"{BASE}/api/reports/morning-summary/preview", params={"company_id": CID})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["summary"]["orders_total"] >= 0
        assert "Sabah Özeti" in d["text"]
        assert "Kritik stok" in d["text"]

    def test_put_settings_with_email(self, sess):
        r = sess.put(f"{BASE}/api/reports/morning-summary/settings", json={
            "company_id": CID, "enabled": False, "time": "08:30",
            "emails": ["qa@test.com"], "whatsapp_numbers": []
        })
        assert r.status_code == 200
        assert "qa@test.com" in r.json()["emails"]

    def test_send_with_email_no_smtp(self, sess):
        r = sess.post(f"{BASE}/api/reports/morning-summary/send", json={"company_id": CID})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] in ("success", "error")
        # Email attempted (SMTP may or may not be configured in this env)
        email = d.get("result", {}).get("email", {})
        assert email is not None and "ok" in email
        if not email["ok"]:
            assert email.get("error")
        # last_sent set
        s = sess.get(f"{BASE}/api/reports/morning-summary/settings", params={"company_id": CID}).json()
        assert s.get("last_sent")

    def test_send_no_recipients(self, sess):
        sess.put(f"{BASE}/api/reports/morning-summary/settings", json={
            "company_id": CID, "enabled": False, "time": "08:30",
            "emails": [], "whatsapp_numbers": []
        })
        r = sess.post(f"{BASE}/api/reports/morning-summary/send", json={"company_id": CID})
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "error"
        assert "Alıcı tanımlı değil" in d["message"]

    def test_cleanup(self, sess):
        r = sess.put(f"{BASE}/api/reports/morning-summary/settings", json={
            "company_id": CID, "enabled": False, "time": "08:00",
            "emails": [], "whatsapp_numbers": []
        })
        assert r.status_code == 200
