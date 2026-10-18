"""Dashboard ciro, today_sales ve kritik stok — geçici MongoDB 27999.

Canlı veritabanına ve 8021 portuna bağlanmaz.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("JWT_SECRET", "test-dashboard-stats-kpis-jwt-secret-not-default-value")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import expenses  # noqa: E402
import pricing  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import stock_critical  # noqa: E402
from mongo_27999 import URL, ensure_mongod  # noqa: E402
from mysql_store import aggregate_rows, match_query  # noqa: E402

CO = "co_stats"
CO_STOCK = "co_stock"


def _run(coro):
    return asyncio.run(coro)


def _bind(db):
    prev = (server.db, saas._db, expenses._db, pricing._db, addons._db)
    server.db = db
    saas._db = db
    expenses._db = db
    pricing._db = db
    addons._db = db
    saas.invalidate()
    return prev


def _restore(prev):
    server.db, saas._db, expenses._db, pricing._db, addons._db = prev
    saas.invalidate()


def _user():
    return {
        "_id": "user-stats",
        "id": "user-stats",
        "email": "stats@example.com",
        "name": "Stats",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [CO, CO_STOCK],
        "active_company_id": CO,
    }


@pytest.fixture(scope="module")
def mongo_url():
    url = ensure_mongod()
    assert url.startswith("mongodb://127.0.0.1:27999")
    assert "8021" not in url
    return url


def test_critical_stock_helper_matches_mongo_filter():
    products = [
        {"name": "bos", "stock_quantity": -3, "min_stock_alert": None, "track_stock": True},
        {"name": "sifir", "stock_quantity": -1, "min_stock_alert": 0, "track_stock": True},
        {"name": "eksi", "stock_quantity": -22, "min_stock_alert": 10, "track_stock": True},
        {"name": "dusuk", "stock_quantity": 2, "min_stock_alert": 5, "track_stock": True},
        {"name": "yeterli", "stock_quantity": 9, "min_stock_alert": 5, "track_stock": True},
        {"name": "servis", "stock_quantity": 0, "min_stock_alert": 10, "track_stock": False},
    ]
    flagged = [p["name"] for p in products if stock_critical._is_critical_stock(p)]
    queried = [p["name"] for p in products if match_query(p, stock_critical.CRITICAL_STOCK_FILTER)]
    assert flagged == ["eksi", "dusuk"]
    assert queried == flagged
    # Geçersiz min Python kuralında kritik değildir. Ortak filtre kullanıcının
    # verdiği $gt/$expr şeklidir; "abc" sayıya çevrilmez.
    assert stock_critical._is_critical_stock(
        {"name": "yazi", "stock_quantity": 1, "min_stock_alert": "abc", "track_stock": True}
    ) is False
    grouped = aggregate_rows(
        [
            {"project_id": "a", "total": 10},
            {"project_id": "a", "total": None},
            {"project_id": "b", "total": 2.5},
            {"project_id": None, "total": 99},
        ],
        [
            {"$match": {"project_id": {"$in": ["a", "b"]}}},
            {"$group": {"_id": "$project_id", "total": {"$sum": {"$ifNull": ["$total", 0]}}}},
        ],
    )
    assert {row["_id"]: row["total"] for row in grouped} == {"a": 10.0, "b": 2.5}


def test_cancelled_invoices_and_today_sales(mongo_url):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=4000)
        db = client["tamkobi_test_dashboard_stats"]
        await client.drop_database("tamkobi_test_dashboard_stats")
        prev = _bind(db)
        try:
            now = server._tr_now()
            today = now.strftime("%Y-%m-%d")
            month = today[:7]
            yesterday = (now.date() - timedelta(days=1)).isoformat()
            prev_day = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m-%d")
            assert not prev_day.startswith(month)
            docs = [
                {"_id": "s-today", "company_id": CO, "invoice_type": "sales", "status": "issued",
                 "grand_total": 100, "issue_date": today},
                {"_id": "s-cancel", "company_id": CO, "invoice_type": "sales", "status": "cancelled",
                 "grand_total": 40, "issue_date": today},
                {"_id": "s-draft", "company_id": CO, "invoice_type": "sales", "status": "draft",
                 "grand_total": 10, "issue_date": today},
                {"_id": "s-canceled", "company_id": CO, "invoice_type": "sales", "status": "canceled",
                 "grand_total": 5, "issue_date": today},
                {"_id": "s-void", "company_id": CO, "invoice_type": "sales", "status": "void",
                 "grand_total": 7, "issue_date": today},
                {"_id": "p-today", "company_id": CO, "invoice_type": "purchase", "status": "issued",
                 "grand_total": 30, "issue_date": today},
                {"_id": "p-cancel", "company_id": CO, "invoice_type": "purchase", "status": "cancelled",
                 "grand_total": 20, "issue_date": today},
                {"_id": "s-prev-cancel", "company_id": CO, "invoice_type": "sales", "status": "cancelled",
                 "grand_total": 200, "issue_date": prev_day},
                {"_id": "p-prev-void", "company_id": CO, "invoice_type": "purchase", "status": "void",
                 "grand_total": 80, "issue_date": prev_day},
            ]
            monthly_sales = 100.0
            if yesterday[:7] == month:
                docs.append({
                    "_id": "s-yest", "company_id": CO, "invoice_type": "sales", "status": "issued",
                    "grand_total": 50, "issue_date": yesterday,
                })
                monthly_sales = 150.0
            await db.invoices.insert_many(docs)
            stats = await server.dashboard_stats_payload(CO)
            assert stats["today_sales"] == 100.0
            assert stats["monthly_sales"] == monthly_sales
            assert stats["monthly_expenses"] == 30
            assert stats["net_profit"] == monthly_sales - 30
            assert stats["sales_change_pct"] is None
            current = next(row for row in stats["chart_data"] if str(row["month"]).endswith("(Güncel)"))
            assert current["gelir"] == monthly_sales
            assert current["gider"] == 30
            assert current["net"] == monthly_sales - 30
            prev_label = stats["chart_data"][stats["chart_data"].index(current) - 1]
            assert prev_label["gelir"] == 0
            assert prev_label["gider"] == 0
            assert prev_label["net"] == 0
            assert "today_sales" in stats
        finally:
            _restore(prev)
            client.close()

    _run(_go())


def test_critical_stock_counts_match_across_surfaces(mongo_url):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=4000)
        db = client["tamkobi_test_dashboard_stock"]
        await client.drop_database("tamkobi_test_dashboard_stock")
        prev = _bind(db)
        try:
            await db.companies.insert_one({"_id": CO_STOCK, "name": "Stok A"})
            await db.products.insert_many([
                {"_id": "bos", "company_id": CO_STOCK, "name": "Bos min", "sku": "BOS",
                 "stock_quantity": -3, "min_stock_alert": None, "track_stock": True, "purchase_price": 1},
                {"_id": "sifir", "company_id": CO_STOCK, "name": "Sifir min", "sku": "SIF",
                 "stock_quantity": -1, "min_stock_alert": 0, "track_stock": True, "purchase_price": 1},
                {"_id": "eksi", "company_id": CO_STOCK, "name": "Eksi", "sku": "EKS",
                 "stock_quantity": -22, "min_stock_alert": 10, "track_stock": True, "purchase_price": 1},
                {"_id": "dusuk", "company_id": CO_STOCK, "name": "Dusuk", "sku": "DUS",
                 "stock_quantity": 2, "min_stock_alert": 5, "track_stock": True, "purchase_price": 1},
                {"_id": "yeterli", "company_id": CO_STOCK, "name": "Yeterli", "sku": "YET",
                 "stock_quantity": 9, "min_stock_alert": 5, "track_stock": True, "purchase_price": 1},
                {"_id": "servis", "company_id": CO_STOCK, "name": "Servis", "sku": "SRV",
                 "stock_quantity": 0, "min_stock_alert": 10, "track_stock": False, "purchase_price": 1},
            ])
            stats = await server.dashboard_stats_payload(CO_STOCK)
            overview = await server.dashboard_overview_payload(CO_STOCK)
            ops = await server.dashboard_ops_alerts_payload(CO_STOCK)
            summary = await pricing.build_summary(CO_STOCK)

            async def fake_advice(context, message, history=None):
                return "ok"

            with patch.object(server, "get_financial_ai_advice", fake_advice), patch.object(addons, "require", AsyncMock()):
                advice = await server.ask_financial_ai(
                    server.FinancialAIChatRequest(message="ozet", company_id=CO_STOCK),
                    _user(),
                )
            crit_task = next(t for t in overview["tasks"] if t["key"] == "critical_stock")
            low = next(g for g in ops["groups"] if g["key"] == "low_stock")
            assert stats["low_stock_count"] == 2
            assert crit_task["count"] == 2
            assert low["count"] == 2
            assert summary["low_stock_count"] == 2
            assert advice["metrics"]["low_stock_count"] == 2
            assert [row["text"] for row in stats["decision"] if "stok kritik" in row["text"]] == ["2 üründe stok kritik."]
            assert [row["id"] for row in stats["low_stock_products"]] == ["eksi", "dusuk"]
            assert [item["shortage"] for item in low["items"]] == [32, 3]
            assert [item["qty"] for item in low["items"]] == [-22, 2]
            assert [item["min"] for item in low["items"]] == [10, 5]
            assert "detail" in low["items"][0]
            assert "EKS" in low["items"][0]["detail"]
        finally:
            _restore(prev)
            client.close()

    _run(_go())
