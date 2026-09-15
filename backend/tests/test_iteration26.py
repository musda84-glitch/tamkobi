"""Iteration 26: Profitability & channel fees tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://isletme-one.preview.emergentagent.com").rstrip("/")
COMPANY_ID = "comp_nexus_main_01"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def test_profitability_structure(api):
    r = api.get(f"{BASE_URL}/api/marketplace/profitability", params={"company_id": COMPANY_ID, "days": 60})
    assert r.status_code == 200, r.text
    data = r.json()
    # top-level keys
    for k in ("days", "total", "channels", "orders", "top_products", "low_margin"):
        assert k in data, f"missing {k}"
    total = data["total"]
    for k in ("orders", "revenue", "net_profit", "commission", "margin_pct"):
        assert k in total
    # b2b / manual excluded
    channels = [c["channel"] for c in data["channels"]]
    assert "b2b" not in channels
    assert "manual" not in channels
    # order rows should not contain cancelled/returned status
    for o in data["orders"]:
        assert o.get("status") not in ("cancelled", "returned")
        for k in ("revenue", "sale_vat", "commission", "commission_vat", "service_fee", "cargo_fee", "product_cost", "net_profit", "margin_pct"):
            assert k in o, f"order missing {k}"
    # channels have fee_settings & channel_id
    for c in data["channels"]:
        assert "fee_settings" in c
        for f in ("commission_rate", "service_fee", "cargo_fee"):
            assert f in c["fee_settings"]


def test_profitability_calculations_trendyol(api):
    r = api.get(f"{BASE_URL}/api/marketplace/profitability", params={"company_id": COMPANY_ID, "days": 60})
    data = r.json()
    trend = next((c for c in data["channels"] if c["channel"] == "trendyol"), None)
    assert trend is not None, "trendyol channel missing"
    rate = float(trend["fee_settings"]["commission_rate"])
    # find a trendyol order
    ty_orders = [o for o in data["orders"] if o["channel"] == "trendyol"]
    assert ty_orders, "no trendyol orders in window"
    o = ty_orders[0]
    revenue = o["revenue"]
    assert o.get("commission_rate") == rate, f"commission_rate missing/mismatch: {o.get('commission_rate')} vs {rate}"
    expected_commission = round(revenue * rate / 100, 2)
    assert abs(o["commission"] - expected_commission) < 0.02, f"commission mismatch: {o['commission']} vs {expected_commission}"
    expected_cvat = round(expected_commission * 0.20, 2)
    assert abs(o["commission_vat"] - expected_cvat) < 0.02
    expected_sale_vat = round(revenue - revenue / 1.20, 2)
    assert abs(o["sale_vat"] - expected_sale_vat) < 0.02
    expected_net = round(revenue - o["sale_vat"] - o["commission"] - o["commission_vat"] - o["service_fee"] - o["cargo_fee"] - o["product_cost"], 2)
    assert abs(o["net_profit"] - expected_net) < 0.05


def test_fees_update_and_recompute(api):
    # get trendyol channel id
    r = api.get(f"{BASE_URL}/api/marketplace/profitability", params={"company_id": COMPANY_ID, "days": 60})
    data = r.json()
    trend = next(c for c in data["channels"] if c["channel"] == "trendyol")
    chan_id = trend["channel_id"]
    assert chan_id, "trendyol channel_id missing"

    # PUT new fees
    up = api.put(f"{BASE_URL}/api/integrations/ecommerce/{chan_id}/fees", json={"commission_rate": 25, "service_fee": 15})
    assert up.status_code == 200, up.text
    body = up.json()
    assert body["fees"]["commission_rate"] == 25.0
    assert body["fees"]["service_fee"] == 15.0

    # Re-check profitability
    r2 = api.get(f"{BASE_URL}/api/marketplace/profitability", params={"company_id": COMPANY_ID, "days": 60})
    d2 = r2.json()
    trend2 = next(c for c in d2["channels"] if c["channel"] == "trendyol")
    assert float(trend2["fee_settings"]["commission_rate"]) == 25.0
    assert float(trend2["fee_settings"]["service_fee"]) == 15.0
    # recomputed commission for a trendyol order
    ty_o = next(o for o in d2["orders"] if o["channel"] == "trendyol")
    assert abs(ty_o["commission"] - round(ty_o["revenue"] * 25 / 100, 2)) < 0.02

    # Restore
    restore = api.put(f"{BASE_URL}/api/integrations/ecommerce/{chan_id}/fees", json={"commission_rate": 21.5, "service_fee": 12.99})
    assert restore.status_code == 200
    assert restore.json()["fees"]["commission_rate"] == 21.5
    assert restore.json()["fees"]["service_fee"] == 12.99


def test_fees_invalid(api):
    r = api.get(f"{BASE_URL}/api/marketplace/profitability", params={"company_id": COMPANY_ID, "days": 60})
    trend = next(c for c in r.json()["channels"] if c["channel"] == "trendyol")
    chan_id = trend["channel_id"]
    bad1 = api.put(f"{BASE_URL}/api/integrations/ecommerce/{chan_id}/fees", json={"commission_rate": 150})
    assert bad1.status_code == 400
    bad2 = api.put(f"{BASE_URL}/api/integrations/ecommerce/{chan_id}/fees", json={"commission_rate": -1})
    assert bad2.status_code == 400
    nf = api.put(f"{BASE_URL}/api/integrations/ecommerce/nonexistent_xyz/fees", json={"commission_rate": 20})
    assert nf.status_code == 404


def test_real_trendyol_order_preserved(api):
    # regression: order 11571862893 still exists
    r = api.get(f"{BASE_URL}/api/orders", params={"company_id": COMPANY_ID})
    assert r.status_code == 200
    nums = [str(o.get("order_number")) for o in r.json()]
    assert "11571862893" in nums, "real trendyol order 11571862893 not found"
