"""Iteration 28 backend tests: Migration (Excel/CSV + BizimHesap), Marketplace products (live Trendyol),
AI order extract, and Orders manual channel + marketplace_status."""
import csv
import io
import os
import time
import pytest
import requests
import openpyxl
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio
from dotenv import dotenv_values

_fe = dotenv_values("/app/frontend/.env")
_be = dotenv_values("/app/backend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _fe.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"
COMPANY = "comp_nexus_main_01"
MONGO_URL = os.environ.get("MONGO_URL") or _be.get("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME") or _be.get("DB_NAME") or "nexus_erp_db"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _post(sess, path, **kw):
    return sess.post(f"{API}{path}", **kw)


# ---------------- Migration – contacts (xlsx) ----------------
def _build_contacts_xlsx() -> bytes:
    wb = openpyxl.Workbook(); ws = wb.active
    ws.append(["Cari Ünvanı", "Vergi No", "Vergi Dairesi", "Telefon", "E-posta", "İl", "Bakiye", "Tür"])
    ws.append(["TEST_QA Müşteri", "1111111110", "Kadıköy", "05300000001", "a@qa.com", "İstanbul", "1.250,50", "Müşteri"])
    ws.append(["TEST_QA Tedarikçi", "2222222220", "Şişli", "05300000002", "b@qa.com", "Ankara", "-500,25", "Tedarikçi"])
    ws.append(["", "3333333330", "Beşiktaş", "05300000003", "c@qa.com", "İzmir", "10", "Müşteri"])
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def test_migration_sources_and_entities(s):
    r = s.get(f"{API}/migration/sources"); assert r.status_code == 200
    d = r.json()
    assert len(d["sources"]) == 7
    codes = {x["code"] for x in d["sources"]}
    assert "bizimhesap" in codes
    assert len(d["entities"]) == 5


def test_migration_templates(s):
    for e in ("contacts", "products"):
        r = s.get(f"{API}/migration/template/{e}"); assert r.status_code == 200
        assert r.content[:2] == b"PK"


@pytest.fixture(scope="module")
def contacts_flow(s):
    """Parse+preview+import+rollback contacts. Returns (batch_id)."""
    data = _build_contacts_xlsx()
    files = {"file": ("contacts.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    form = {"entity": "contacts", "source": "bizimhesap", "company_id": COMPANY}
    r = requests.post(f"{API}/migration/parse", files=files, data=form)
    assert r.status_code == 200, r.text
    parsed = r.json()
    up_id = parsed["upload_id"]
    sm = parsed["suggested_mapping"]
    # Verify auto-mapping
    assert sm.get("name") == "Cari Ünvanı"
    assert sm.get("tax_number_or_id") == "Vergi No"
    assert sm.get("tax_office") == "Vergi Dairesi"
    assert sm.get("phone") == "Telefon"
    assert sm.get("email") == "E-posta"
    assert sm.get("city") == "İl"
    assert sm.get("balance") == "Bakiye"
    assert sm.get("type") == "Tür"

    # Preview
    r = _post(s, "/migration/preview", json={"upload_id": up_id, "mapping": sm})
    assert r.status_code == 200, r.text
    pv = r.json()
    assert pv["total"] == 3
    assert pv["valid"] == 2
    assert pv["invalid"] == 1
    err_txt = " ".join(e["errors"][0] for e in pv["errors"])
    assert "Cari Adı" in err_txt and "boş" in err_txt

    # Import
    r = _post(s, "/migration/import", json={"upload_id": up_id, "mapping": sm, "on_duplicate": "skip"})
    assert r.status_code == 200, r.text
    im = r.json()
    assert im["inserted"] == 2
    assert im["failed"] == 1
    batch_id = im["batch_id"]

    # Verify contacts persisted with parsed values
    contacts = s.get(f"{API}/contacts?company_id={COMPANY}").json()
    contacts = contacts if isinstance(contacts, list) else contacts.get("contacts") or contacts.get("items") or []
    musteri = next((c for c in contacts if c.get("name") == "TEST_QA Müşteri"), None)
    tedarikci = next((c for c in contacts if c.get("name") == "TEST_QA Tedarikçi"), None)
    assert musteri is not None
    assert tedarikci is not None
    assert abs(float(musteri.get("balance") or 0) - 1250.5) < 0.01
    assert tedarikci.get("type") == "supplier"

    # Batches list
    bl = s.get(f"{API}/migration/batches?company_id={COMPANY}").json()
    assert any(b["id"] == batch_id for b in bl)

    # Errors CSV
    r = s.get(f"{API}/migration/batches/{batch_id}/errors.csv")
    assert r.status_code == 200
    assert "boş" in r.text or "Cari" in r.text

    # Rollback
    r = _post(s, f"/migration/batches/{batch_id}/rollback")
    assert r.status_code == 200
    assert r.json()["deleted"] == 2

    # Rollback again → 400
    r = _post(s, f"/migration/batches/{batch_id}/rollback")
    assert r.status_code == 400

    # Verify contacts removed
    contacts2 = s.get(f"{API}/contacts?company_id={COMPANY}").json()
    contacts2 = contacts2 if isinstance(contacts2, list) else contacts2.get("contacts") or contacts2.get("items") or []
    assert not any(c.get("name", "").startswith("TEST_QA") for c in contacts2)
    return batch_id


def test_contacts_migration_flow(contacts_flow):
    assert contacts_flow


# ---------------- Migration – products (CSV, on_duplicate update) ----------------
def _build_products_csv() -> bytes:
    return ("Stok Kodu;Ürün Adı;Barkod;Satış Fiyatı;Stok\n"
            "TESTQA-A;TEST_QA Ürün A;8690000QA0001;199,90;10\n"
            "TESTQA-B;TEST_QA Ürün B;8690000QA0002;349,50;5\n").encode("utf-8")


def test_products_migration_and_update_reimport(s):
    # First import
    r = requests.post(f"{API}/migration/parse", files={"file": ("p.csv", _build_products_csv(), "text/csv")},
                      data={"entity": "products", "source": "other", "company_id": COMPANY})
    assert r.status_code == 200, r.text
    p1 = r.json()
    m1 = p1["suggested_mapping"]
    assert m1.get("sku") == "Stok Kodu"
    assert m1.get("name") == "Ürün Adı"
    assert m1.get("barcode") == "Barkod"
    assert m1.get("sale_price") == "Satış Fiyatı"
    assert m1.get("stock_quantity") == "Stok"
    r = _post(s, "/migration/import", json={"upload_id": p1["upload_id"], "mapping": m1, "on_duplicate": "skip"})
    assert r.status_code == 200, r.text
    batch1 = r.json()["batch_id"]
    assert r.json()["inserted"] == 2

    # Re-parse with second CSV where prices change and re-import with 'update'
    csv2 = ("Stok Kodu;Ürün Adı;Barkod;Satış Fiyatı;Stok\n"
            "TESTQA-A;TEST_QA Ürün A (v2);8690000QA0001;259,00;10\n"
            "TESTQA-B;TEST_QA Ürün B (v2);8690000QA0002;399,00;5\n").encode("utf-8")
    r = requests.post(f"{API}/migration/parse", files={"file": ("p2.csv", csv2, "text/csv")},
                      data={"entity": "products", "source": "other", "company_id": COMPANY})
    assert r.status_code == 200
    p2 = r.json()
    r = _post(s, "/migration/import", json={"upload_id": p2["upload_id"], "mapping": p2["suggested_mapping"], "on_duplicate": "update"})
    assert r.status_code == 200, r.text
    up = r.json()
    assert up["updated"] == 2
    assert up["inserted"] == 0
    batch2 = up["batch_id"]

    # Rollback update batch → prev values restored
    r = _post(s, f"/migration/batches/{batch2}/rollback"); assert r.status_code == 200
    # Rollback first insert batch → deletes products
    r = _post(s, f"/migration/batches/{batch1}/rollback"); assert r.status_code == 200
    # Verify gone
    prods = s.get(f"{API}/products?company_id={COMPANY}").json()
    prods = prods if isinstance(prods, list) else prods.get("products") or prods.get("items") or []
    assert not any((p.get("sku") or "").startswith("TESTQA-") for p in prods)


# ---------------- Migration – invoices ----------------
def _build_invoices_xlsx() -> bytes:
    wb = openpyxl.Workbook(); ws = wb.active
    ws.append(["Fatura No", "Tür", "Cari Adı", "Tarih", "Genel Toplam", "Ödeme Durumu"])
    ws.append(["TESTQA-FAT-001", "sales", "TEST_QA AutoContact", "15.01.2026", "1200", "unpaid"])
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def test_invoices_migration_and_rollback(s):
    r = requests.post(f"{API}/migration/parse", files={"file": ("inv.xlsx", _build_invoices_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                      data={"entity": "invoices", "source": "other", "company_id": COMPANY})
    assert r.status_code == 200, r.text
    up = r.json()
    r = _post(s, "/migration/import", json={"upload_id": up["upload_id"], "mapping": up["suggested_mapping"], "on_duplicate": "skip"})
    assert r.status_code == 200, r.text
    imp = r.json()
    assert imp["inserted"] == 1
    batch_id = imp["batch_id"]

    # Confirm invoice + auto contact
    invs = s.get(f"{API}/invoices?company_id={COMPANY}").json()
    invs = invs if isinstance(invs, list) else invs.get("invoices") or []
    my_inv = next((i for i in invs if i.get("invoice_number") == "TESTQA-FAT-001"), None)
    assert my_inv is not None
    assert my_inv.get("e_type") == "paper"

    # Rollback → deletes invoice and auto contact
    r = _post(s, f"/migration/batches/{batch_id}/rollback"); assert r.status_code == 200
    contacts = s.get(f"{API}/contacts?company_id={COMPANY}").json()
    contacts = contacts if isinstance(contacts, list) else contacts.get("contacts") or contacts.get("items") or []
    assert not any(c.get("name") == "TEST_QA AutoContact" for c in contacts)


# ---------------- BizimHesap ----------------
def test_bizimhesap_config_flow(s):
    # Initial state
    r = s.get(f"{API}/migration/bizimhesap/config?company_id={COMPANY}"); assert r.status_code == 200
    assert r.json()["configured"] is False

    # Test with no token → 400
    r = _post(s, "/migration/bizimhesap/test", json={"company_id": COMPANY})
    assert r.status_code == 400
    assert "token" in r.json().get("detail", "").lower()

    # Save token
    r = s.put(f"{API}/migration/bizimhesap/config", json={"company_id": COMPANY, "token": "dummy-token-1234"})
    assert r.status_code == 200
    d = r.json()
    assert d["configured"] is True
    assert d["token_mask"] == "••••1234"

    # Test now → 400/502 for invalid token
    r = _post(s, "/migration/bizimhesap/test", json={"company_id": COMPANY})
    assert r.status_code in (400, 502)

    # Cleanup config via Mongo direct
    async def _clear():
        c = AsyncIOMotorClient(MONGO_URL)
        await c[DB_NAME].migration_api_configs.delete_one({"company_id": COMPANY, "provider": "bizimhesap"})
        c.close()
    asyncio.get_event_loop().run_until_complete(_clear())

    r = s.get(f"{API}/migration/bizimhesap/config?company_id={COMPANY}")
    assert r.json()["configured"] is False


# ---------------- Marketplace products (READ-ONLY, no push) ----------------
def test_marketplace_products_live(s):
    r = s.get(f"{API}/marketplace/products?company_id={COMPANY}&channel=trendyol")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["live"] is True
    assert d["count"] >= 60
    assert isinstance(d["matched"], int)
    row = d["rows"][0]
    for k in ("barcode", "title", "sale_price", "quantity", "approved"):
        assert k in row
    assert isinstance(d.get("products"), list)


def test_marketplace_product_create_and_delete(s):
    fake_barcode = "QA000TEST123"
    r = _post(s, "/marketplace/product-create", json={
        "company_id": COMPANY, "channel": "trendyol",
        "product_name": "TEST_QA Marketplace Kartı", "barcode": fake_barcode,
        "sale_price": 99.9, "stock_quantity": 3, "vat_rate": 20})
    assert r.status_code == 200, r.text
    prod = r.json()["product"]
    pid = prod.get("id") or prod.get("_id")
    assert prod.get("barcode") == fake_barcode

    # Delete → soft delete to trash
    r = s.delete(f"{API}/products/{pid}")
    assert r.status_code in (200, 204)

    # Find trash entry
    t = s.get(f"{API}/trash?company_id={COMPANY}&entity_type=product").json()
    items = t.get("items") or []
    entry = next((x for x in items if (x.get("data") or {}).get("_id") == pid or x.get("entity_id") == pid), None)
    if entry:
        tid = entry.get("id") or entry.get("_id")
        s.delete(f"{API}/trash/{tid}")


# ---------------- Orders: manual channel + marketplace_status ----------------
def test_orders_manual_and_marketplace_status(s):
    # Manual order
    payload = {"company_id": COMPANY, "channel": "manual", "customer_name": "TEST_QA Manual Müş",
               "customer_phone": "05330000001", "shipping_address": "Test", "city": "İstanbul",
               "items": [{"product_id": "", "product_name": "TEST_QA Kalem", "sku": "", "quantity": 2, "unit_price": 50, "total": 100}],
               "total_amount": 100}
    r = _post(s, "/orders", json=payload)
    assert r.status_code in (200, 201), r.text
    order = r.json()
    order = order.get("order") or order
    oid = order.get("id") or order.get("_id")
    assert order.get("contact_id"), "auto-linked contact expected"

    # List includes marketplace_status for Trendyol orders
    orders_resp = s.get(f"{API}/orders?company_id={COMPANY}").json()
    orders = orders_resp if isinstance(orders_resp, list) else orders_resp.get("orders") or []
    ty = [o for o in orders if o.get("channel") == "trendyol"]
    if ty:
        assert "marketplace_status" in ty[0]

    # Cleanup: delete order + auto contact + purge trash
    s.delete(f"{API}/orders/{oid}")
    contact_id = order.get("contact_id")
    if contact_id:
        s.delete(f"{API}/contacts/{contact_id}")
    for et in ("order", "contact"):
        t = s.get(f"{API}/trash?company_id={COMPANY}&entity_type={et}").json()
        for it in (t.get("items") or []):
            data = it.get("data") or {}
            if "TEST_QA" in str(data.get("customer_name") or data.get("name") or ""):
                s.delete(f"{API}/trash/{it.get('id') or it.get('_id')}")


# ---------------- AI order extract ----------------
def test_ai_order_extract_and_confirm(s):
    csv_txt = ("Müşteri;Telefon;Ürün;Adet;Birim Fiyat\n"
               "TEST_QA AI Müşteri;05340000001;Ürün X;2;100,00\n"
               "TEST_QA AI Müşteri;05340000001;Ürün Y;1;250,00\n"
               "TEST_QA AI İkinci;05340000002;Ürün Z;3;40,00\n").encode("utf-8")
    files = {"file": ("orders.csv", csv_txt, "text/csv")}
    r = requests.post(f"{API}/ai/order-extract?company_id={COMPANY}", files=files, timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["count"] >= 1
    orders = d["orders"]
    # 2 customers grouped
    names = {o["customer_name"] for o in orders}
    assert any("TEST_QA AI" in n for n in names)
    for o in orders:
        assert o.get("contact_id") is None
        for it in o["items"]:
            assert "quantity" in it and "unit_price" in it and "total" in it

    # Confirm
    r = _post(s, "/ai/order-extract/confirm", json={"company_id": COMPANY, "orders": orders})
    assert r.status_code == 200, r.text
    cf = r.json()
    assert cf["created"] >= 1
    created_orders = cf["orders"]
    for o in created_orders:
        assert (o.get("order_number") or "").startswith("ORD")
        assert o.get("source") == "ai_import"
        assert o.get("contact_id")

    # Cleanup: orders, auto contacts, purge trash
    contact_ids = set()
    for o in created_orders:
        oid = o.get("id") or o.get("_id")
        if oid:
            s.delete(f"{API}/orders/{oid}")
        if o.get("contact_id"):
            contact_ids.add(o["contact_id"])
    for cid in contact_ids:
        s.delete(f"{API}/contacts/{cid}")
    for et in ("order", "contact"):
        t = s.get(f"{API}/trash?company_id={COMPANY}&entity_type={et}").json()
        for it in (t.get("items") or []):
            data = it.get("data") or {}
            if "TEST_QA AI" in str(data.get("customer_name") or data.get("name") or ""):
                s.delete(f"{API}/trash/{it.get('id') or it.get('_id')}")
