"""Özet faturaları belge gövdesi olmadan okur."""
from mysql_store import scalar_docs, scalar_select_sql


def test_overview_invoice_sql_does_not_select_the_document():
    sql, params, names = scalar_select_sql(
        "invoices",
        {"company_id": "co", "invoice_type": {"$in": ["sales", "purchase"]}},
        ["invoice_type", "status", "grand_total", "issue_date"],
        20000,
    )
    assert sql.startswith("SELECT id, ")
    assert " SELECT doc " not in f" {sql} "
    assert "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.invoice_type'))" in sql
    assert "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.grand_total'))" in sql
    assert sql.endswith("LIMIT %s")
    assert params[0] == "invoices"
    assert params[1] == "co"
    assert "sales" in params and "purchase" in params
    assert params[-1] == 20000
    assert names == ["invoice_type", "status", "grand_total", "issue_date"]


def test_scalar_sql_refuses_unpushed_or():
    assert scalar_select_sql(
        "invoices",
        {"company_id": "co", "$or": [{"status": "draft"}]},
        ["status"],
        10,
    ) is None


def test_scalar_docs_skip_nulls_and_keep_numbers_as_text():
    rows = [("inv1", "sales", None, "150.5", "")]
    docs = scalar_docs(rows, ["invoice_type", "status", "grand_total", "issue_date"])
    assert docs == [{"_id": "inv1", "invoice_type": "sales", "grand_total": "150.5"}]
    assert float(docs[0]["grand_total"]) == 150.5
