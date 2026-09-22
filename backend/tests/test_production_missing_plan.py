"""Production missing-plan: depo eksik bildirimleri → üretim emri."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
COMPANY = "comp_nexus_main_01"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


class TestProductionMissingPlan:
    def test_missing_plan_from_pick_notify_and_create(self):
        s = _admin()
        sku = f"MP{uuid.uuid4().hex[:8]}"
        barcode = f"869{uuid.uuid4().int % 10**10:010d}"
        p = s.post(
            f"{API}/products",
            json={
                "company_id": COMPANY,
                "name": "Eksik Plan Test Ürün",
                "sku": sku,
                "barcode": barcode,
                "sale_price": 20,
                "stock_quantity": 0,
                "min_stock_alert": 5,
            },
            timeout=20,
        )
        assert p.status_code in (200, 201), p.text[:300]
        pid = p.json()["id"]

        o = s.post(
            f"{API}/orders",
            json={
                "company_id": COMPANY,
                "channel": "manual",
                "customer_name": "Eksik Plan Cari",
                "shipping_address": "Depo",
                "city": "İstanbul",
                "total_amount": 40,
                "order_status": "approved",
                "items": [
                    {
                        "product_id": pid,
                        "product_name": "Eksik Plan Test Ürün",
                        "sku": sku,
                        "quantity": 2,
                        "unit_price": 20,
                        "total": 40,
                    }
                ],
            },
            timeout=20,
        )
        assert o.status_code in (200, 201), o.text[:400]
        oid = o.json()["id"]

        assert s.get(f"{API}/order-picks/{oid}", timeout=20).status_code == 200
        miss = s.post(f"{API}/order-picks/{oid}/notify-missing", timeout=20)
        assert miss.status_code == 200, miss.text[:300]
        payload = miss.json()
        assert payload.get("missing")
        assert all(
            not str(m.get("product_name") or "").lower().startswith("depo eksik")
            for m in payload.get("missing") or []
        )

        plan = s.get(f"{API}/production/missing-plan", params={"company_id": COMPANY}, timeout=20)
        assert plan.status_code == 200, plan.text[:300]
        body = plan.json()
        assert body.get("notification_count", 0) >= 1
        row = next((x for x in body.get("items") or [] if x.get("product_id") == pid), None)
        assert row, body
        assert float(row.get("missing_qty") or 0) >= 2
        assert any(src.get("order_id") == oid for src in row.get("sources") or [])
        assert not str(row.get("product_name") or "").lower().startswith("depo eksik")
        assert "Eksik Plan Test Ürün" in str(row.get("product_name") or "")
        assert not any(
            str(x.get("product_name") or "").lower().startswith("depo eksik")
            for x in (body.get("items") or [])
        )

        kpis = s.get(f"{API}/production/kpis", params={"company_id": COMPANY}, timeout=20)
        assert kpis.status_code == 200
        assert int(kpis.json().get("missing_notifications") or 0) >= 1

        create = s.post(
            f"{API}/production/missing-plan/create",
            json={
                "company_id": COMPANY,
                "mark_read": True,
                "items": [
                    {
                        "product_id": pid,
                        "product_name": row["product_name"],
                        "planned_quantity": float(row.get("suggested_qty") or row.get("missing_qty") or 2),
                        "notification_ids": row.get("notification_ids") or [],
                        "sources": row.get("sources") or [],
                    }
                ],
            },
            timeout=30,
        )
        assert create.status_code == 200, create.text[:400]
        created = create.json().get("created") or []
        assert created, create.json()
        assert created[0].get("order_code")

        orders = s.get(
            f"{API}/production/orders",
            params={"company_id": COMPANY, "status": "open"},
            timeout=20,
        )
        assert orders.status_code == 200
        assert any(x.get("order_code") == created[0]["order_code"] for x in orders.json())

        ops = s.get(f"{API}/dashboard/ops-alerts", params={"company_id": COMPANY}, timeout=20)
        assert ops.status_code == 200
        pick = next(g for g in ops.json().get("groups", []) if g.get("key") == "pick_missing")
        assert pick["path"].startswith("/production")

    def test_missing_plan_shows_product_from_order_when_session_empty(self):
        """Oturum kalemi boş olsa bile sipariş / bildirim ürün adı ÜRÜN sütununda görünmeli."""
        s = _admin()
        sku = f"MSG{uuid.uuid4().hex[:8]}"
        barcode = f"869{uuid.uuid4().int % 10**10:010d}"
        pname = f"Mesaj Ürün {sku}"
        p = s.post(
            f"{API}/products",
            json={
                "company_id": COMPANY,
                "name": pname,
                "sku": sku,
                "barcode": barcode,
                "sale_price": 15,
                "stock_quantity": 0,
                "min_stock_alert": 1,
            },
            timeout=20,
        )
        assert p.status_code in (200, 201), p.text[:300]
        pid = p.json()["id"]

        o = s.post(
            f"{API}/orders",
            json={
                "company_id": COMPANY,
                "channel": "manual",
                "customer_name": "Mesaj Cari",
                "shipping_address": "Depo",
                "city": "Ankara",
                "total_amount": 30,
                "order_status": "approved",
                "items": [
                    {
                        "product_id": pid,
                        "product_name": pname,
                        "sku": sku,
                        "quantity": 3,
                        "unit_price": 10,
                        "total": 30,
                    }
                ],
            },
            timeout=20,
        )
        assert o.status_code in (200, 201), o.text[:400]
        oid = o.json()["id"]
        onum = o.json().get("order_number") or oid

        assert s.get(f"{API}/order-picks/{oid}", timeout=20).status_code == 200
        miss = s.post(f"{API}/order-picks/{oid}/notify-missing", timeout=20)
        assert miss.status_code == 200, miss.text[:300]

        # Oturum kalemlerini sil — sipariş kalemleri / missing_items / mesaj yedekleri
        try:
            from db import get_sync_database

            sdb = get_sync_database()
            sdb.order_pick_sessions.update_one(
                {"order_id": oid},
                {"$set": {"items": [], "missing_items": []}},
            )
            # Eski bildirimlerde missing_items olmayabilir
            sdb.notifications.update_many(
                {"ref_id": oid, "type": "order_pick_missing"},
                {"$unset": {"missing_items": ""}},
            )
        except Exception as exc:
            print("session clear skipped:", exc)

        plan = s.get(f"{API}/production/missing-plan", params={"company_id": COMPANY}, timeout=20)
        assert plan.status_code == 200, plan.text[:300]
        body = plan.json()
        row = next(
            (
                x for x in body.get("items") or []
                if x.get("product_id") == pid or pname in str(x.get("product_name") or "")
            ),
            None,
        )
        assert row, f"ürün satırı yok; items={[x.get('product_name') for x in body.get('items') or []]} order={onum}"
        assert not str(row.get("product_name") or "").lower().startswith("depo eksik")
        assert pname in str(row.get("product_name") or "") or row.get("product_id") == pid
