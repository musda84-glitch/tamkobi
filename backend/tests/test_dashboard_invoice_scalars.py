"""Özet faturaları belge gövdesi olmadan okur."""
import pytest

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


def test_json_null_text_is_missing_and_sql_nullif():
    sql, _params, names = scalar_select_sql(
        "invoices",
        {"company_id": "co", "invoice_type": {"$in": ["sales", "purchase"]}},
        ["paid_amount", "issue_date", "grand_total"],
    )
    assert "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(doc, '$.paid_amount')), 'null')" in sql
    assert "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(doc, '$.issue_date')), 'null')" in sql
    docs = scalar_docs(
        [("inv1", "sales", "null", "null", "100")],
        ["invoice_type", "paid_amount", "issue_date", "grand_total"],
    )
    assert names == ["paid_amount", "issue_date", "grand_total"]
    row = docs[0]
    assert "paid_amount" not in row
    assert "issue_date" not in row
    open_amt = float(row.get("grand_total", 0)) - float(row.get("paid_amount", 0) or 0)
    assert open_amt == 100.0
    assert ((row.get("issue_date") or "") >= "2026-10-01") is False


def test_scalar_rows_uses_find_tenant_guard():
    import asyncio

    import tenant_scope
    from mysql_store import MySQLCollection
    from tenant_scope import TenantScope, TenantScopeViolation, bind, reset

    tenant_scope.set_mode("raise")
    scope = TenantScope(
        company_id="co_a",
        allowed=frozenset({"co_a"}),
        kind="user",
        actor_id="actor",
        reason="test",
    )
    token = bind(scope)
    try:
        with pytest.raises(TenantScopeViolation):
            asyncio.run(MySQLCollection.scalar_rows(
                type("Coll", (), {"name": "invoices"})(),
                {"company_id": "co_b"},
                ["status"],
            ))
    finally:
        reset(token)
