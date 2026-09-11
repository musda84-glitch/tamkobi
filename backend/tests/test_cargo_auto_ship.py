"""Backend tests for /api/cargo/auto-ship (iteration 34)."""
import os
import time
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
COMPANY = "comp_nexus_main_01"


def test_dry_run_shopphp_trendyol():
    r = requests.post(f"{API}/cargo/auto-ship", json={"company_id": COMPANY, "carrier_code": "geliver", "dry_run": True}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    print("dry_run summary:", {k: v for k, v in j.items() if k != "results"})
    assert j["live"] is False
    assert j["candidates"] >= 1
    assert "kargolanabilir" in j.get("message", "")
    # At least one 'ready'
    statuses = {row.get("status") for row in j.get("results", [])}
    assert "ready" in statuses or "skipped" in statuses


def test_no_live_no_allow_sim_returns_400():
    r = requests.post(f"{API}/cargo/auto-ship", json={"company_id": COMPANY, "carrier_code": "geliver"}, timeout=30)
    assert r.status_code == 400, r.text
    assert "canlı API bağlantısı yok" in r.json().get("detail", "")


def test_dry_run_b2b_only():
    r = requests.post(f"{API}/cargo/auto-ship", json={"company_id": COMPANY, "carrier_code": "geliver", "channels": ["b2b"], "dry_run": True}, timeout=30)
    assert r.status_code == 200
    j = r.json()
    for row in j.get("results", []):
        assert (row.get("channel") or "").lower() == "b2b"


def test_runs_list():
    r = requests.get(f"{API}/cargo/auto-ship/runs", params={"company_id": COMPANY}, timeout=30)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_safe_real_run_manual_channel():
    # 1) create manual order
    order_payload = {
        "company_id": COMPANY,
        "channel": "manual",
        "order_status": "approved",
        "customer_name": "QA Kargo Test",
        "shipping_address": "Test Mah. 1",
        "city": "İstanbul",
        "customer_phone": "05551112233",
        "items": [{"product_id": "test_qa_prod_1", "sku": "TEST-QA-1", "product_name": "Test Ürün", "quantity": 1, "unit_price": 100, "total": 100, "desi": 1}],
        "total_amount": 100,
    }
    cr = requests.post(f"{API}/orders", json=order_payload, timeout=30)
    assert cr.status_code in (200, 201), cr.text
    order = cr.json()
    order_id = order.get("_id") or order.get("id")
    assert order_id
    print("Created order:", order_id)

    try:
        # 2) auto-ship on manual channel with allow_simulated + carrier yurtici
        r = requests.post(f"{API}/cargo/auto-ship", json={
            "company_id": COMPANY, "carrier_code": "yurtici", "channels": ["manual"],
            "allow_simulated": True, "default_desi": 1,
        }, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        print("real run summary:", {k: v for k, v in j.items() if k != "results"})
        assert j["created"] >= 1
        # find our row
        my_row = next((row for row in j["results"] if row.get("order_id") == order_id), None)
        assert my_row is not None
        assert my_row.get("status") == "created"
        assert my_row.get("tracking_number")

        # 3) verify order updated
        time.sleep(0.5)
        g = requests.get(f"{API}/orders/{order_id}", timeout=30)
        assert g.status_code == 200
        gord = g.json()
        assert gord.get("cargo_tracking_number")
        assert gord.get("order_status") == "shipped"

        # 4) runs list contains entry
        rl = requests.get(f"{API}/cargo/auto-ship/runs", params={"company_id": COMPANY}, timeout=30)
        assert rl.status_code == 200
        runs = rl.json()
        assert len(runs) >= 1
    finally:
        # Cleanup: delete order, purge trash, delete shipment + run in Mongo
        try:
            requests.delete(f"{API}/orders/{order_id}", timeout=15)
        except Exception as e:
            print("delete order err:", e)
        # Best-effort trash purge via API
        try:
            t = requests.get(f"{API}/trash", params={"entity_type": "order"}, timeout=15)
            if t.status_code == 200:
                for it in t.json():
                    if it.get("original_id") == order_id or it.get("entity_id") == order_id or it.get("_id", "").endswith(order_id):
                        requests.delete(f"{API}/trash/{it.get('_id') or it.get('id')}", timeout=15)
        except Exception as e:
            print("trash cleanup err:", e)
        # Mongo cleanup
        try:
            import asyncio
            from mysql_store import MySQLClient as AsyncIOMotorClient
            mongo_url = os.environ.get("MONGO_URL")
            db_name = os.environ.get("DB_NAME")
            if mongo_url and db_name:
                async def _c():
                    cli = AsyncIOMotorClient(mongo_url)
                    db = cli[db_name]
                    await db.cargo_shipments.delete_many({"order_id": order_id})
                    await db.cargo_auto_runs.delete_many({"results.order_id": order_id})
                    await db.orders.delete_many({"_id": order_id})
                    await db.trash.delete_many({"$or": [{"original_id": order_id}, {"entity_id": order_id}]})
                    cli.close()
                asyncio.get_event_loop().run_until_complete(_c())
        except Exception as e:
            print("mongo cleanup err:", e)
