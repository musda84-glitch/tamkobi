"""Iteration 32: ShopPHP robustness (bare xmlc code OR full URL, any slot) + dashboard money masking."""
import os
import time
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except FileNotFoundError:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE = _load_backend_url()
COMPANY = "comp_nexus_main_01"

ADMIN = {"email": "admin@nexus.com", "password": "admin123"}
DEPO = {"email": "depo@nexus.com", "password": "depo123"}

URL_ORDERS = "https://www.willhome.com.tr/xml.php?c=siparisler&xmlc=25d7e750b1"
URL_PROD = "https://www.willhome.com.tr/xml.php?c=shopphp&xmlc=4612835257"
URL_STOCK = "https://www.willhome.com.tr/xml.php?c=alter&xmlc=a26078d69d"


def _login(creds):
    r = requests.post(f"{BASE}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login {creds['email']} failed: {r.status_code} {r.text[:200]}"
    return r.json().get("access_token") or r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def depo_token():
    return _login(DEPO)


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- ShopPHP integration --------------------------------------------

def test_ecommerce_list_has_shopphp_connected(admin_token):
    r = requests.get(f"{BASE}/api/integrations/ecommerce?company_id={COMPANY}", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    channels = data if isinstance(data, list) else data.get("channels") or data.get("integrations") or []
    shop = next((c for c in channels if (c.get("channel") or c.get("code") or c.get("id") or "").endswith("shopphp") or (c.get("channel") == "shopphp")), None)
    assert shop, f"shopphp channel not found in {channels}"
    status = shop.get("status") or shop.get("connection_status")
    assert status == "connected", f"expected connected, got {status}: {shop}"


def test_shopphp_test_connection_success(admin_token):
    r = requests.post(f"{BASE}/api/integrations/ecommerce/ecom_shopphp/test-connection", headers=_h(admin_token), timeout=120)
    assert r.status_code == 200, r.text[:400]
    j = r.json()
    assert j.get("status") == "success", j
    msg = j.get("message", "")
    # message should mention order XML count and product count
    assert "sipariş" in msg.lower() or "siparis" in msg.lower(), msg
    assert "ürün" in msg.lower() or "urun" in msg.lower(), msg


def test_shopphp_sync_now(admin_token):
    r = requests.post(f"{BASE}/api/integrations/ecommerce/ecom_shopphp/sync-now?days=30", headers=_h(admin_token), timeout=180)
    assert r.status_code == 200, r.text[:400]
    j = r.json()
    assert j.get("status") == "success", j
    assert j.get("live") is True, j


def test_orders_has_shopphp(admin_token):
    r = requests.get(f"{BASE}/api/orders?channel=shopphp", headers=_h(admin_token), timeout=60)
    assert r.status_code == 200, r.text[:200]
    orders = r.json() if isinstance(r.json(), list) else r.json().get("orders", [])
    shopphp_orders = [o for o in orders if o.get("channel") == "shopphp"]
    assert len(shopphp_orders) >= 1, f"expected shopphp orders, got {len(shopphp_orders)}"
    # each should have contact_id
    with_contact = [o for o in shopphp_orders if o.get("contact_id")]
    assert len(with_contact) >= 1, f"no shopphp orders with contact_id"


def test_marketplace_products_shopphp(admin_token):
    r = requests.get(f"{BASE}/api/marketplace/products?company_id={COMPANY}&channel=shopphp", headers=_h(admin_token), timeout=120)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    assert j.get("live") is True, j
    rows = j.get("products") or j.get("items") or j.get("rows") or j.get("data") or []
    assert len(rows) >= 20, f"expected >=20 products got {len(rows)}"


# ---------- Robustness: URLs in wrong slots --------------------------------

def _put_shopphp(admin_token, api_key, api_secret, supplier_id):
    payload = {"api_key": api_key, "api_secret": api_secret, "supplier_id": supplier_id}
    r = requests.put(f"{BASE}/api/integrations/ecommerce/ecom_shopphp", headers=_h(admin_token), json=payload, timeout=30)
    assert r.status_code in (200, 204), f"PUT failed: {r.status_code} {r.text[:300]}"
    return r


def test_shopphp_full_urls_correct_slots(admin_token):
    _put_shopphp(admin_token, URL_ORDERS, URL_PROD, URL_STOCK)
    r = requests.post(f"{BASE}/api/integrations/ecommerce/ecom_shopphp/test-connection", headers=_h(admin_token), timeout=120)
    assert r.status_code == 200
    assert r.json().get("status") == "success", r.json()


def test_shopphp_urls_swapped_slots_still_works(admin_token):
    # swap api_key and api_secret so URLs are in wrong slots; code should auto-sort by c=
    _put_shopphp(admin_token, URL_PROD, URL_ORDERS, URL_STOCK)
    r = requests.post(f"{BASE}/api/integrations/ecommerce/ecom_shopphp/test-connection", headers=_h(admin_token), timeout=120)
    assert r.status_code == 200
    j = r.json()
    assert j.get("status") == "success", j


def test_shopphp_empty_api_key_errors(admin_token):
    _put_shopphp(admin_token, "", URL_PROD, URL_STOCK)
    r = requests.post(f"{BASE}/api/integrations/ecommerce/ecom_shopphp/test-connection", headers=_h(admin_token), timeout=60)
    j = r.json()
    assert j.get("status") == "error", j
    assert "sipariş" in (j.get("message") or "").lower() or "siparis" in (j.get("message") or "").lower(), j


def test_zzz_restore_shopphp(admin_token):
    _put_shopphp(admin_token, URL_ORDERS, URL_PROD, URL_STOCK)
    r = requests.post(f"{BASE}/api/integrations/ecommerce/ecom_shopphp/test-connection", headers=_h(admin_token), timeout=120)
    assert r.json().get("status") == "success"


# ---------- Dashboard masking ----------------------------------------------

def _get_warehouse_role_id(admin_token):
    r = requests.get(f"{BASE}/api/roles?company_id={COMPANY}", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200, r.text[:200]
    roles = r.json() if isinstance(r.json(), list) else r.json().get("roles", [])
    role = next((x for x in roles if x.get("code") == "warehouse"), None)
    assert role, f"warehouse role not found in {[r.get('code') for r in roles]}"
    return role["id"], role.get("features", {})


def _set_view_prices(admin_token, role_id, value):
    r = requests.get(f"{BASE}/api/roles?company_id={COMPANY}", headers=_h(admin_token), timeout=30)
    roles = r.json() if isinstance(r.json(), list) else r.json().get("roles", [])
    role = next(x for x in roles if x["id"] == role_id)
    features = dict(role.get("features") or {})
    features["view_prices"] = value
    payload = {"features": features, "permissions": role.get("permissions", {})}
    r = requests.put(f"{BASE}/api/roles/{role_id}", headers=_h(admin_token), json=payload, timeout=30)
    assert r.status_code == 200, f"role PUT failed: {r.status_code} {r.text[:200]}"


def test_dashboard_masking_when_view_prices_false(admin_token, depo_token):
    role_id, _orig = _get_warehouse_role_id(admin_token)
    try:
        _set_view_prices(admin_token, role_id, False)
        time.sleep(0.3)
        for path in ("/api/dashboard/overview", "/api/dashboard/stats"):
            r = requests.get(f"{BASE}{path}", headers=_h(depo_token), timeout=30)
            assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:300]}"
            hdr = r.headers.get("X-Prices-Masked", "")
            assert hdr in ("1", "true", "True"), f"{path}: missing X-Prices-Masked (headers={dict(r.headers)})"
            j = r.json()
            for k in ("total_bank_balance", "total_receivables", "total_payables", "monthly_sales"):
                if k in j:
                    assert j[k] == 0, f"{path}: {k} not masked, got {j[k]}"
    finally:
        _set_view_prices(admin_token, role_id, True)
