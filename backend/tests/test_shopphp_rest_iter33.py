"""Iteration 33 - ShopPHP REST write-back credentials/push tests.
No real store creds available; test error paths + UI-support endpoints only.
Cleans up state at end.
"""
import os
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://isletme-one.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
COMPANY_ID = "comp_nexus_main_01"
SHOPPHP_CHAN_ID = "ecom_shopphp"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def shopphp_order(h):
    r = requests.get(f"{API}/orders", headers=h, params={"company_id": COMPANY_ID}, timeout=30)
    assert r.status_code == 200
    orders = r.json()
    sp = [o for o in orders if (o.get("channel") == "shopphp")]
    if not sp:
        pytest.skip("No shopphp orders available")
    return sp[0]


@pytest.fixture(scope="module")
def trendyol_order(h):
    r = requests.get(f"{API}/orders", headers=h, params={"company_id": COMPANY_ID}, timeout=30)
    orders = r.json()
    ty = [o for o in orders if o.get("channel") == "trendyol"]
    if not ty:
        pytest.skip("No trendyol orders")
    return ty[0]


# ---- Initial state: rest_configured false, no rest_password_enc leak ----
def test_1_list_no_creds(h):
    r = requests.get(f"{API}/integrations/ecommerce", headers=h, params={"company_id": COMPANY_ID}, timeout=15)
    assert r.status_code == 200
    lst = r.json()
    sp = next((c for c in lst if c.get("channel") == "shopphp"), None)
    assert sp is not None
    # Password never exposed
    assert "rest_password_enc" not in sp
    # Not yet configured
    assert sp.get("rest_configured") is False, sp.get("rest_configured")


def test_2_push_no_creds_shopphp_order(h, shopphp_order):
    r = requests.post(f"{API}/orders/{shopphp_order['id']}/push-shopphp", headers=h, timeout=15)
    assert r.status_code == 400
    detail = r.json().get("detail", "")
    assert "REST API kullanıcı bilgileri girilmemiş" in detail, detail


def test_3_push_on_trendyol_order(h, trendyol_order):
    r = requests.post(f"{API}/orders/{trendyol_order['id']}/push-shopphp", headers=h, timeout=15)
    assert r.status_code == 400
    detail = r.json().get("detail", "")
    assert "ShopPHP" in detail or "shopphp" in detail.lower()


def test_4_rest_test_no_creds(h):
    r = requests.post(f"{API}/integrations/ecommerce/{SHOPPHP_CHAN_ID}/rest-test", headers=h, timeout=15)
    assert r.status_code == 400
    assert "girilmemiş" in r.json().get("detail", "").lower() or "girilmemiş" in r.json().get("detail", "")


# ---- Set creds ----
def test_5_put_credentials(h):
    r = requests.put(
        f"{API}/integrations/ecommerce/{SHOPPHP_CHAN_ID}/rest-credentials",
        headers=h,
        json={"rest_email": "qa@test.com", "rest_password": "x", "rest_auto_push": False},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("rest_configured") is True
    assert body.get("rest_auto_push") is False


def test_6_list_after_creds(h):
    r = requests.get(f"{API}/integrations/ecommerce", headers=h, params={"company_id": COMPANY_ID}, timeout=15)
    assert r.status_code == 200
    sp = next((c for c in r.json() if c.get("channel") == "shopphp"), None)
    assert sp["rest_configured"] is True
    assert sp.get("rest_auto_push") is False
    assert "rest_password_enc" not in sp


def test_7_rest_test_invalid_creds(h):
    r = requests.post(f"{API}/integrations/ecommerce/{SHOPPHP_CHAN_ID}/rest-test", headers=h, timeout=30)
    assert r.status_code in (400, 502), f"expected 400/502 not {r.status_code}: {r.text}"


def test_8_push_shopphp_invalid_creds(h, shopphp_order):
    r = requests.post(f"{API}/orders/{shopphp_order['id']}/push-shopphp", headers=h, timeout=30)
    assert r.status_code in (400, 502), f"unexpected {r.status_code}: {r.text}"
    # Order should reflect ok=false
    r2 = requests.get(f"{API}/orders", headers=h, params={"company_id": COMPANY_ID}, timeout=30)
    o = next((x for x in r2.json() if x.get("id") == shopphp_order["id"]), None)
    assert o and o.get("shopphp_push"), "shopphp_push missing on order"
    assert o["shopphp_push"].get("ok") is False
    assert o["shopphp_push"].get("error")


# ---- Regression: approve/status hook silent (creds present but auto_push=False so still silent) ----
def test_9_status_update_still_200(h, shopphp_order):
    cur = shopphp_order.get("order_status") or "pending"
    r = requests.put(f"{API}/orders/{shopphp_order['id']}/status", headers=h, json={"order_status": cur}, timeout=20)
    assert r.status_code == 200, r.text


def test_10_sync_now(h):
    r = requests.post(f"{API}/integrations/ecommerce/{SHOPPHP_CHAN_ID}/sync-now", headers=h, params={"days": 30}, timeout=60)
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "success"


# ---- Cleanup ----
def test_99_cleanup(h, shopphp_order):
    # Reset creds via API (sets rest_email empty, rest_auto_push true default) then unset via mongo
    import subprocess, json as _json
    # unset rest_password_enc and shopphp_push directly
    cmds = [
        f"db.integration_configs.updateOne({{_id:'{SHOPPHP_CHAN_ID}'}}, {{$unset:{{rest_password_enc:1}}, $set:{{rest_email:'', rest_auto_push:true}}}})",
        f"db.orders.updateOne({{_id:'{shopphp_order['id']}'}}, {{$unset:{{shopphp_push:1}}}})",
        "db.shopphp_push_logs.deleteMany({order_number: {$exists: true}})",
    ]
    for c in cmds:
        subprocess.run(["mongosh", "nexus_erp_db", "--quiet", "--eval", c], check=False, capture_output=True)
    # Verify
    r = requests.get(f"{API}/integrations/ecommerce", headers=h, params={"company_id": COMPANY_ID}, timeout=15)
    sp = next((c for c in r.json() if c.get("channel") == "shopphp"), None)
    assert sp["rest_configured"] is False, sp
