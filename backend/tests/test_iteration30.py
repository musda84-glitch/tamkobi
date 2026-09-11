"""Iteration 30 backend tests.

Covers:
- Migration AI mapping (parse + ai-map with unusual headers)
- BizimHesap connector test + config (rate-limit tolerant, called at most once)
- E-commerce channel catalog + add/delete
- ShopPHP sync-now (idempotent), orders, marketplace products
- Settlement account PUT for ecom_shopphp
"""

import io
import os
import time
import pytest
import requests
from openpyxl import Workbook

from conftest import API, TEST_COMPANY_ID

COMPANY_ID = TEST_COMPANY_ID


def _shopphp_rest_configured() -> bool:
    """ShopPHP kanalında REST kullanıcısı tanımlı mı."""
    r = requests.get(f"{API}/integrations/ecommerce", params={"company_id": COMPANY_ID}, timeout=30)
    r.raise_for_status()
    cfg = next((c for c in r.json() if c.get("channel") == "shopphp"), None)
    return bool(cfg and cfg.get("rest_configured"))


# --------------------------- Migration AI map ---------------------------

@pytest.fixture(scope="module")
def unusual_xlsx_bytes():
    wb = Workbook()
    ws = wb.active
    ws.append(["Firma", "VN", "Şehir/İlçe", "GSM No", "Mail Adresi", "Devir Bakiyesi"])
    ws.append(["Acme Ltd", "1234567890", "İstanbul/Kadıköy", "0532 111 22 33", "info@acme.tr", 1500.55])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


class TestMigrationAIMap:
    def test_parse_and_ai_map(self, unusual_xlsx_bytes):
        # parse
        files = {"file": ("unusual.xlsx", unusual_xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {"entity": "contacts", "source": "other", "company_id": COMPANY_ID}
        r = requests.post(f"{API}/migration/parse", files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        parsed = r.json()
        upload_id = parsed.get("upload_id") or parsed.get("id")
        assert upload_id, f"no upload_id in {parsed}"
        suggested = parsed.get("suggested_mapping") or parsed.get("mapping") or {}
        # Should miss tax and phone (unusual headers)
        mapped_keys = {k for k, v in suggested.items() if v}
        assert "tax_number_or_id" not in mapped_keys or "phone" not in mapped_keys, (
            f"suggested picked up all: {suggested}"
        )

        # ai-map
        r2 = requests.post(f"{API}/migration/ai-map", json={"upload_id": upload_id}, timeout=60)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        mapping = body.get("mapping") or {}
        notes = body.get("notes") or ""
        assert isinstance(notes, str) and len(notes) > 0, f"notes empty: {body}"
        # Check expected mappings
        assert mapping.get("name") == "Firma", mapping
        assert mapping.get("tax_number_or_id") == "VN", mapping
        assert mapping.get("phone") == "GSM No", mapping
        assert mapping.get("email"), mapping
        assert mapping.get("city"), mapping
        assert mapping.get("balance"), mapping
        mapped_count = sum(1 for v in mapping.values() if v)
        assert mapped_count >= 5, f"only {mapped_count} mapped: {mapping}"


# --------------------------- BizimHesap ---------------------------

class TestBizimHesap:
    def test_config_configured(self):
        r = requests.get(f"{API}/migration/bizimhesap/config", params={"company_id": COMPANY_ID}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("configured") is True

    def test_bh_test_once(self):
        # call at most once, accept 200 ok:true or 429
        r = requests.post(f"{API}/migration/bizimhesap/test", json={"company_id": COMPANY_ID}, timeout=60)
        assert r.status_code in (200, 429), r.text
        if r.status_code == 200:
            body = r.json()
            # allow either ok True or nested structure
            assert body.get("ok") is True or body.get("product_count") is not None, body
            pc = body.get("product_count") or (body.get("data") or {}).get("product_count")
            wh = body.get("warehouses") or (body.get("data") or {}).get("warehouses")
            if pc is not None:
                assert pc >= 2000, f"product_count too low: {pc}"
            if wh is not None:
                # warehouses may be int count or list
                cnt = wh if isinstance(wh, int) else len(wh)
                assert cnt == 2, f"warehouses: {wh}"
        else:
            detail = (r.json() or {}).get("detail", "")
            assert "istek sınırı" in detail or "sınır" in detail.lower(), f"unexpected 429 detail: {detail}"


# --------------------------- E-commerce catalog ---------------------------

class TestEcommerceCatalog:
    def test_catalog_structure(self):
        r = requests.get(f"{API}/integrations/ecommerce/catalog", params={"company_id": COMPANY_ID}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        groups = body.get("groups") or body.get("categories") or []
        assert len(groups) == 4, f"expected 4 groups got {len(groups)}: {[g.get('name') for g in groups]}"
        total = 0
        shopphp_added = False
        trendyol_added = False
        for g in groups:
            for ch in g.get("channels", []):
                total += 1
                cid = ch.get("id") or ch.get("channel") or ch.get("code")
                if cid == "shopphp":
                    shopphp_added = ch.get("added") is True
                if cid == "trendyol":
                    trendyol_added = ch.get("added") is True
        assert total == 69, f"total channels {total}"
        assert shopphp_added, "shopphp not added"
        assert trendyol_added, "trendyol not added"

    def test_add_remove_pazarama(self):
        payload = {"company_id": COMPANY_ID, "channel": "pazarama"}
        r1 = requests.post(f"{API}/integrations/ecommerce/add-channel", json=payload, timeout=30)
        assert r1.status_code == 200, r1.text
        body = r1.json() or {}
        ch_obj = body.get("channel") or {}
        new_id = ch_obj.get("id") or body.get("id") or body.get("integration_id")
        assert new_id, r1.json()

        # add again → 400
        r2 = requests.post(f"{API}/integrations/ecommerce/add-channel", json=payload, timeout=30)
        assert r2.status_code == 400, r2.text
        assert "zaten" in r2.text.lower() or "ekli" in r2.text.lower()

        # bogus channel → 400
        r3 = requests.post(f"{API}/integrations/ecommerce/add-channel", json={"company_id": COMPANY_ID, "channel": "bogusxyz"}, timeout=30)
        assert r3.status_code == 400

        # delete new pazarama
        r4 = requests.delete(f"{API}/integrations/ecommerce/{new_id}", params={"company_id": COMPANY_ID}, timeout=30)
        assert r4.status_code == 200, r4.text

        # delete shopphp → 400 (has orders)
        r5 = requests.delete(f"{API}/integrations/ecommerce/ecom_shopphp", params={"company_id": COMPANY_ID}, timeout=30)
        assert r5.status_code == 400, r5.text

    def test_list_shows_shopphp(self):
        r = requests.get(f"{API}/integrations/ecommerce", params={"company_id": COMPANY_ID}, timeout=20)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("integrations", [])
        found = [i for i in items if (i.get("id") == "ecom_shopphp" or i.get("channel") == "shopphp")]
        assert found, f"shopphp not in ecommerce list"
        name = found[0].get("channel_name") or found[0].get("name") or ""
        assert "ShopPHP" in name or "shopphp" in name.lower()


# --------------------------- ShopPHP sync + orders + marketplace ---------------------------

class TestShopPHP:
    def test_sync_now_idempotent(self):
        r = requests.post(f"{API}/integrations/ecommerce/ecom_shopphp/sync-now", params={"days": 30, "company_id": COMPANY_ID}, timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        status = body.get("status") or body.get("result")
        assert status == "success", body
        assert body.get("live") is True, body
        msg = body.get("message") or ""
        assert "ShopPHP" in msg or "shopphp" in msg.lower(), body

    def test_orders_contain_real(self):
        r = requests.get(f"{API}/orders", params={"company_id": COMPANY_ID}, timeout=30)
        assert r.status_code == 200, r.text
        orders = r.json() if isinstance(r.json(), list) else r.json().get("orders", [])
        by_no = {}
        for o in orders:
            for k in ("order_no", "order_number", "external_order_id", "external_id", "id"):
                v = o.get(k)
                if v:
                    by_no[str(v)] = o
        o1 = next((o for no, o in by_no.items() if "430959168" in no), None)
        o2 = next((o for no, o in by_no.items() if "425878531" in no), None)
        assert o1 is not None, f"order 430959168 missing"
        assert o2 is not None, f"order 425878531 missing"
        for o in (o1, o2):
            assert (o.get("channel") == "shopphp") or ("shopphp" in str(o.get("source", "")).lower())
            assert o.get("contact_id"), f"contact_id missing on {o.get('id')}"
            assert o.get("marketplace_status") or o.get("marketplace_status_text"), o
        items = o1.get("items") or []
        assert items and items[0].get("sku") == "KARRE2308-B", items

    def test_marketplace_products_shopphp(self):
        r = requests.get(f"{API}/marketplace/products", params={"company_id": COMPANY_ID, "channel": "shopphp"}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("live") is True, body
        # ShopPHP'ye gönderim REST kullanıcısı tanımlıysa açılıyor, yoksa
        # kapalı. Sabit False beklemek bu kuraldan önceki hali yansıtıyordu ve
        # kurulu ortama göre kırılıyor; bayrak kaynağıyla karşılaştırılıyor.
        assert body.get("push_supported") is _shopphp_rest_configured(), body
        rows = body.get("rows") or body.get("products") or []
        assert len(rows) >= 20, f"only {len(rows)} rows"
        row = rows[0]
        for k in ("barcode", "title", "sale_price", "quantity"):
            assert k in row, f"row missing {k}: {row}"

    def test_push_rejected_for_shopphp(self):
        r = requests.post(f"{API}/marketplace/products/push", json={"company_id": COMPANY_ID, "channel": "shopphp", "products": []}, timeout=30)
        assert r.status_code == 400, r.text


# --------------------------- Settlement account ---------------------------

class TestSettlement:
    def test_put_and_reset_settlement(self):
        r = requests.get(f"{API}/banking/accounts", params={"company_id": COMPANY_ID}, timeout=20)
        assert r.status_code == 200, r.text
        accts = r.json() if isinstance(r.json(), list) else r.json().get("accounts", [])
        # pick a non-integrated account (no external channel binding)
        candidate = None
        for a in accts:
            channel = a.get("integration_channel") or a.get("channel") or ""
            if not channel and a.get("id"):
                candidate = a
                break
        assert candidate, f"no non-integrated bank account found among {len(accts)}"
        acct_id = candidate["id"]

        r1 = requests.put(
            f"{API}/integrations/ecommerce/ecom_shopphp/settlement-account",
            json={"account_id": acct_id, "company_id": COMPANY_ID},
            timeout=20,
        )
        assert r1.status_code == 200, r1.text

        # reset
        r2 = requests.put(
            f"{API}/integrations/ecommerce/ecom_shopphp/settlement-account",
            json={"account_id": None, "company_id": COMPANY_ID},
            timeout=20,
        )
        assert r2.status_code == 200, r2.text
