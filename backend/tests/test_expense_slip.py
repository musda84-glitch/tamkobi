"""Gider pusulası kes: issued invoice becomes a linked purchase slip."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_expense_slip_block_reason():
    import server

    assert "Taslak" in (server._expense_slip_block_reason({"status": "draft", "contact_id": "c", "items": [{}]}) or "")
    assert server._expense_slip_block_reason({
        "status": "approved",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "contact_id": "c1",
        "items": [{"name": "Kalem", "quantity": 1}],
    }) is None
    assert "Gelen" in (server._expense_slip_block_reason({
        "status": "approved",
        "invoice_type": "purchase",
        "e_type": "e_invoice",
        "direction": "incoming",
        "contact_id": "c1",
        "items": [{}],
    }) or "")


def test_create_expense_slip_from_issued_sales_invoice():
    import server

    inv = {
        "_id": "inv_nx",
        "company_id": "comp",
        "status": "approved",
        "e_type": "e_invoice",
        "invoice_type": "sales",
        "invoice_number": "NX202675412859",
        "contact_id": "c1",
        "contact_name": "ERSAY HOME",
        "grand_total": 100,
        "subtotal": 84.75,
        "vat_total": 15.25,
        "items": [{"name": "Ürün", "quantity": 1, "unit_price": 84.75}],
        "currency": "TRY",
    }
    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value=inv)
    mock_db.invoices.insert_one = AsyncMock()
    mock_db.invoices.update_one = AsyncMock()

    with patch.object(server, "db", mock_db), patch.object(
        server, "_next_number", AsyncMock(return_value="GP-2026-0007")
    ), patch.object(server, "_apply_invoice_effects", AsyncMock()) as effects:
        result = _run(server.create_expense_slip_from_invoice("inv_nx"))

    assert result["status"] == "success"
    assert "GP-2026-0007" in result["message"]
    effects.assert_awaited_once()
    inserted = mock_db.invoices.insert_one.await_args.args[0]
    assert inserted["e_type"] == "expense_slip"
    assert inserted["invoice_type"] == "purchase"
    assert inserted["status"] == "approved"
    assert inserted["source_invoice_id"] == "inv_nx"
    assert inserted["contact_name"] == "ERSAY HOME"
    assert inserted.get("withholding_rate") == 0
    link = mock_db.invoices.update_one.await_args.args
    assert link[0] == {"_id": "inv_nx"}
    assert link[1]["$set"]["expense_slip_number"] == "GP-2026-0007"


def test_create_expense_slip_copies_withholding():
    import server

    inv = {
        "_id": "inv_wh",
        "company_id": "comp",
        "status": "approved",
        "e_type": "e_archive",
        "invoice_type": "sales",
        "invoice_number": "NX1",
        "contact_id": "c1",
        "contact_name": "Satıcı",
        "contact_tax_id": "11111111111",
        "contact_tax_office": "Kadıköy",
        "grand_total": 90,
        "subtotal": 100,
        "vat_total": 0,
        "withholding_rate": 0.2,
        "withholding_code": "GVK94",
        "withholding_amount": 20,
        "items": [{"name": "Hizmet", "quantity": 1, "unit_price": 100}],
        "currency": "TRY",
    }
    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value=inv)
    mock_db.invoices.insert_one = AsyncMock()
    mock_db.invoices.update_one = AsyncMock()

    with patch.object(server, "db", mock_db), patch.object(
        server, "_next_number", AsyncMock(return_value="GP-2026-0008")
    ), patch.object(server, "_apply_invoice_effects", AsyncMock()):
        result = _run(server.create_expense_slip_from_invoice("inv_wh"))

    inserted = mock_db.invoices.insert_one.await_args.args[0]
    assert result["status"] == "success"
    assert inserted["withholding_rate"] == 0.2
    assert inserted["withholding_amount"] == 20
    assert inserted["contact_tax_office"] == "Kadıköy"
    assert inserted["contact_tax_id"] == "11111111111"


def test_expense_slip_rejects_draft():
    import server

    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value={"_id": "d1", "status": "draft", "contact_id": "c", "items": [{}]})
    with patch.object(server, "db", mock_db):
        with pytest.raises(HTTPException) as ei:
            _run(server.create_expense_slip_from_invoice("d1"))
    assert ei.value.status_code == 400
    assert "Taslak" in ei.value.detail
