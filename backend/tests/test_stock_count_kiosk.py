"""Mobile/tablet stock-count kiosk: scan by barcode or SKU without preloading all items."""
import pytest
import requests

from rbac import module_for_path
from conftest import API, TEST_COMPANY_ID

CID = TEST_COMPANY_ID


def test_stock_count_api_maps_to_sayim_module():
    assert module_for_path("/api/warehouses/stock-counts") == "/sayim"
    assert module_for_path("/api/warehouses/stock-counts/abc/scan") == "/sayim"
    assert module_for_path("/api/warehouses") == "/warehouses"
    assert module_for_path("/api/warehouses/transfers") == "/warehouses"


@pytest.fixture
def client():
    return requests.Session()


def test_kiosk_session_starts_empty_then_scan(client):
    r = client.post(
        f"{API}/warehouses/stock-counts",
        json={"company_id": CID, "name": "TEST_kiosk_sayim", "preload_all": False},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    cid = d["id"]
    assert d["status"] == "open"
    assert d.get("items") == [] or len(d["items"]) == 0

    products = client.get(f"{API}/products", params={"company_id": CID}, timeout=20).json()
    prod = next((p for p in products if p.get("barcode") or p.get("sku")), None)
    assert prod, "need a product with barcode or sku"
    code = prod.get("barcode") or prod.get("sku")
    scan = client.post(f"{API}/warehouses/stock-counts/{cid}/scan", json={"barcode": code, "quantity": 1}, timeout=20)
    assert scan.status_code == 200, scan.text
    item = scan.json()["item"]
    assert item["scanned"] is True
    assert item["counted"] == 1
    assert item["product_name"]

    multi = client.post(f"{API}/warehouses/stock-counts/{cid}/scan", json={"barcode": code, "quantity": 3}, timeout=20)
    assert multi.status_code == 200, multi.text
    assert multi.json()["item"]["counted"] == 4

    sku = prod.get("sku")
    if sku and sku != code:
        scan2 = client.post(f"{API}/warehouses/stock-counts/{cid}/scan", json={"barcode": sku, "quantity": 1}, timeout=20)
        assert scan2.status_code == 200, scan2.text
        assert scan2.json()["item"]["counted"] == 5

    client.delete(f"{API}/warehouses/stock-counts/{cid}", timeout=20)


def test_unknown_barcode_404(client):
    r = client.post(
        f"{API}/warehouses/stock-counts",
        json={"company_id": CID, "name": "TEST_kiosk_bad", "preload_all": False},
        timeout=20,
    )
    assert r.status_code == 200
    cid = r.json()["id"]
    bad = client.post(f"{API}/warehouses/stock-counts/{cid}/scan", json={"barcode": "NO-SUCH-BARCODE-XYZ", "quantity": 1}, timeout=20)
    assert bad.status_code == 404
    client.delete(f"{API}/warehouses/stock-counts/{cid}", timeout=20)
