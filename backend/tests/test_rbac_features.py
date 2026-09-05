"""Iteration 31: Role features (view_prices, header_*) + masking middleware tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://isletme-one.preview.emergentagent.com").rstrip("/")
COMPANY_ID = "comp_nexus_main_01"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@nexus.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    data = r.json()
    return data.get("access_token") or data.get("token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def roles_data(admin_headers):
    r = requests.get(f"{BASE_URL}/api/roles", params={"company_id": COMPANY_ID}, headers=admin_headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_roles_features_shape(roles_data):
    feats = roles_data.get("features")
    assert isinstance(feats, list) and len(feats) == 5
    keys = {f["key"] for f in feats}
    assert keys == {"view_prices", "header_barcode", "header_virman", "header_invoice", "header_ai"}
    for f in feats:
        assert f.get("label")
    # Each role has features dict
    for role in roles_data["roles"]:
        assert isinstance(role.get("features"), dict)
        assert set(role["features"].keys()) == keys


def test_admin_role_features_update_forbidden(roles_data, admin_headers):
    admin_role = next(r for r in roles_data["roles"] if r["code"] == "admin")
    r = requests.put(f"{BASE_URL}/api/roles/{admin_role['id']}",
                     json={"features": {"view_prices": False}}, headers=admin_headers)
    assert r.status_code == 400, r.text


def test_warehouse_features_toggle_off(roles_data, admin_headers):
    wh = next(r for r in roles_data["roles"] if r["code"] == "warehouse")
    r = requests.put(f"{BASE_URL}/api/roles/{wh['id']}",
                     json={"features": {"view_prices": False, "header_virman": False}}, headers=admin_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["features"]["view_prices"] is False
    assert data["features"]["header_virman"] is False


@pytest.fixture(scope="module")
def depo_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "depo@nexus.com", "password": "depo123"})
    assert r.status_code == 200, r.text
    return r.json()


def test_depo_login_features(depo_token):
    user = depo_token.get("user", {})
    feats = user.get("features") or {}
    assert feats.get("view_prices") is False
    assert feats.get("header_virman") is False


def test_depo_products_masked(depo_token):
    tok = depo_token.get("access_token") or depo_token.get("token")
    r = requests.get(f"{BASE_URL}/api/products", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.headers.get("X-Prices-Masked") == "1"
    data = r.json()
    items = data if isinstance(data, list) else (data.get("products") or data.get("items") or [])
    assert items, "expected some products"
    for p in items[:20]:
        for k in ("sale_price", "purchase_price", "list_price"):
            if k in p and isinstance(p[k], (int, float)):
                assert p[k] == 0, f"{k} not masked: {p[k]}"


def test_depo_orders_masked(depo_token):
    tok = depo_token.get("access_token") or depo_token.get("token")
    r = requests.get(f"{BASE_URL}/api/orders", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.headers.get("X-Prices-Masked") == "1"
    data = r.json()
    orders = data if isinstance(data, list) else (data.get("orders") or data.get("items") or [])
    for o in orders[:20]:
        if "total_amount" in o and isinstance(o["total_amount"], (int, float)):
            assert o["total_amount"] == 0


def test_depo_dashboard_still_200(depo_token):
    tok = depo_token.get("access_token") or depo_token.get("token")
    # Try a few common dashboard endpoints
    for path in ["/api/dashboard/overview", "/api/dashboard/summary", "/api/dashboard/stats", "/api/dashboard"]:
        r = requests.get(f"{BASE_URL}{path}", headers={"Authorization": f"Bearer {tok}"})
        if r.status_code == 404:
            continue
        assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:200]}"
        return
    pytest.skip("no dashboard endpoint found")


def test_admin_products_not_masked(admin_headers):
    r = requests.get(f"{BASE_URL}/api/products", headers=admin_headers)
    assert r.status_code == 200
    assert r.headers.get("X-Prices-Masked") != "1"


def test_zzz_restore_warehouse_features(admin_headers):
    r = requests.get(f"{BASE_URL}/api/roles", params={"company_id": COMPANY_ID}, headers=admin_headers)
    wh = next(x for x in r.json()["roles"] if x["code"] == "warehouse")
    r2 = requests.put(f"{BASE_URL}/api/roles/{wh['id']}",
                      json={"features": {"view_prices": True, "header_barcode": True, "header_virman": True,
                                         "header_invoice": True, "header_ai": True}}, headers=admin_headers)
    assert r2.status_code == 200
    assert r2.json()["features"]["view_prices"] is True
    assert r2.json()["features"]["header_virman"] is True
