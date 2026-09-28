"""Üretim emirleri KPI / liste hızı — tek tarama sayaçları ve SQL COUNT pushdown."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import server
from mysql_store import sql_count_exact


def test_production_kpi_from_orders_counts():
    month = "2026-09"
    rows = [
        {"status": "planned", "end_date": None},
        {"status": "in_production", "end_date": None},
        {"status": "completed", "end_date": "2026-09-12"},
        {"status": "completed", "end_date": "2026-08-01"},
        {"status": "cancelled", "end_date": None},
    ]
    out = server._production_kpi_from_orders(rows, month)
    assert out["open"] == 2
    assert out["in_production"] == 1
    assert out["completed_this_month"] == 1


def test_sql_count_exact_company_and_status_in():
    sql, params = sql_count_exact(
        "production_orders",
        {"company_id": "c1", "status": {"$in": ["planned", "in_production"]}},
    )
    assert sql.startswith("SELECT COUNT(*) FROM docs WHERE")
    assert "company_id=%s" in sql
    assert params[0] == "production_orders"
    assert "c1" in params
    assert "planned" in params


def test_sql_count_exact_rejects_bool_filter():
    assert sql_count_exact(
        "notifications",
        {"company_id": "c1", "type": "order_pick_missing", "is_read": False},
    ) is None


def test_sql_count_exact_empty_query():
    sql, params = sql_count_exact("recipes", {})
    assert sql == "SELECT COUNT(*) FROM docs WHERE collection=%s"
    assert params == ["recipes"]
