"""Unit tests for report query pushdown and manager insight helpers (no live DB)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mysql_store import sql_pushdown


def test_report_invoice_query_pushes_company_date_and_status():
    sql, params = sql_pushdown(
        "invoices",
        {
            "company_id": "comp_nexus_main_01",
            "status": {"$ne": "cancelled"},
            "issue_date": {"$gte": "2026-01-01", "$lte": "2026-12-31"},
            "invoice_type": {"$in": ["sales", "purchase"]},
        },
    )
    assert "company_id=%s" in sql
    assert "LIKE" not in sql
    assert ">=" in sql and "<=" in sql
    assert params[0] == "invoices"
    assert "comp_nexus_main_01" in params
    assert "2026-01-01" in params and "2026-12-31" in params
    assert "sales" in params and "purchase" in params


def test_accountant_month_regex_is_prefix_like():
    sql, params = sql_pushdown(
        "invoices",
        {"company_id": "c1", "issue_date": {"$regex": "^2026-09"}},
    )
    assert "LIKE %s" in sql
    assert "2026-09%" in params


def test_issue_q_and_insights():
    from report_helpers import issue_q, report_insights

    q = issue_q("c1", "2026-01-01", "2026-12-31", {"invoice_type": {"$in": ["sales", "purchase"]}})
    assert q["company_id"] == "c1"
    assert q["status"] == {"$ne": "cancelled"}
    assert q["issue_date"] == {"$gte": "2026-01-01", "$lte": "2026-12-31"}
    assert q["invoice_type"]["$in"] == ["sales", "purchase"]
    assert issue_q("c1", None, None) == {"company_id": "c1", "status": {"$ne": "cancelled"}}

    sales = report_insights("sales", [{"name": "Acme", "gross": 100}], {"gross": 100, "open": 40})
    assert sales and any("Acme" in i["text"] for i in sales)
    aging = report_insights("aging", [{"name": "X", "type": "receivable", "d90p": 50}], {"d90p": 50, "d1_30": 0, "d31_60": 0, "d61_90": 0})
    assert any(i["level"] == "alert" for i in aging)
    stock = report_insights("stock", [], {"critical": 2, "low": 1})
    assert any("stok sıfır" in i["text"] for i in stock)
    vat = report_insights("vat", [], {"payable_vat": 12})
    assert any("KDV" in i["text"] for i in vat)
    profit = report_insights("profit", [{"name": "Zarar", "profit": -1}], {"net_margin": 5})
    assert any("marj" in i["text"].lower() or "Zarar" in i["text"] for i in profit)
    assert len(report_insights("cashflow", [], {"net": -10, "projected": 1})) <= 4
