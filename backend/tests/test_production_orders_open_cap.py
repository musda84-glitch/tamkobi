"""Açık üretim emri, 300 yeni tamamlanmış emrin altında listeden düşmez.

Bellek içi koleksiyon. Canlı veritabanına ve 8021 portuna bağlanmaz.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "test-production-orders-open-cap-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

CID = "co_open_cap"
OTHER = "co_open_other"


def _user():
    return {
        "_id": "u_cap",
        "id": "u_cap",
        "email": "u_cap@example.com",
        "name": "u_cap",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [CID],
        "active_company_id": CID,
    }


def _bind(db):
    prev = (server.db, rbac._db, saas._db, addons._db)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    saas.invalidate()
    return prev


def _restore(prev):
    server.db, rbac._db, saas._db, addons._db = prev
    saas.invalidate()


def test_old_open_order_survives_completed_cap():
    async def _go():
        db = MemDB()
        prev = _bind(db)
        try:
            docs = []
            for i in range(301):
                docs.append({
                    "_id": f"done-{i:04d}",
                    "company_id": CID,
                    "order_code": f"URT-D-{i:04d}",
                    "status": "completed",
                    "created_at": f"2026-06-01T{i:06d}",
                    "planned_quantity": 1,
                    "completed_quantity": 1,
                    "finished_product_name": "Kapalı",
                })
            docs.append({
                "_id": "open-old",
                "company_id": CID,
                "order_code": "URT-OLD",
                "status": "planned",
                "created_at": "2019-01-01T000000",
                "planned_date": "2020-01-02",
                "planned_quantity": 1,
                "completed_quantity": 0,
                "finished_product_name": "Eski Açık",
            })
            docs.append({
                "_id": "foreign-open",
                "company_id": OTHER,
                "order_code": "URT-FOREIGN",
                "status": "planned",
                "created_at": "2026-08-01T000000",
                "planned_date": "2020-01-02",
                "planned_quantity": 1,
                "completed_quantity": 0,
                "finished_product_name": "Yabancı",
            })
            await db.production_orders.insert_many(docs)
            user = _user()

            opened = await server.list_production_orders(company_id=CID, status="open", include_steps=False, user=user)
            opened_ids = [row["id"] for row in opened]
            assert opened_ids == ["open-old"]
            assert opened[0]["status"] == "planned"

            listed = await server.list_production_orders(company_id=CID, include_steps=False, user=user)
            listed_ids = [row["id"] for row in listed]
            assert "open-old" in listed_ids
            assert "foreign-open" not in listed_ids
            assert "done-0000" not in listed_ids
            assert "done-0300" in listed_ids
            assert sum(1 for row in listed if row["status"] == "completed") == 300
            assert len(listed) == 301

            done = await server.list_production_orders(company_id=CID, status="completed", include_steps=False, user=user)
            assert len(done) == 300
            assert all(row["id"] != "open-old" for row in done)
            assert all(row.get("company_id") == CID for row in done)

            kpis = await server.production_order_kpis(company_id=CID, user=user)
            assert kpis["open"] == 1
            assert kpis["late"] == 1
            assert kpis["completed"] == 301
            assert kpis["cancelled"] == 0
            assert kpis["all"] == 302
            assert kpis["in_production"] == 0
        finally:
            _restore(prev)

    asyncio.run(_go())
