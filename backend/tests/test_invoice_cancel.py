"""Invoice cancel endpoint: e-doc only, allow paid, hide cancelled in lists."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_cancel_block_reason_draft_paper_and_e_doc():
    import server

    assert "Taslak" in (server._invoice_cancel_block_reason({"status": "draft"}) or "")
    assert "iptal" in (server._invoice_cancel_block_reason({"status": "cancelled"}) or "").lower()
    assert "e-Fatura" in (server._invoice_cancel_block_reason({
        "status": "approved", "e_type": "paper", "paid_amount": 0,
    }) or "")
    # Ödemeli e-fatura iptal edilebilir (sipariş serbest kalsın)
    assert server._invoice_cancel_block_reason({
        "status": "approved", "paid_amount": 100, "payment_status": "paid", "e_type": "e_invoice",
    }) is None
    assert server._invoice_cancel_block_reason({
        "status": "approved", "paid_amount": 0, "payment_status": "unpaid", "e_type": "e_archive",
    }) is None


def test_cancel_invoice_reverses_and_marks_cancelled():
    import server

    inv = {
        "_id": "inv_c1",
        "status": "approved",
        "e_type": "e_invoice",
        "invoice_type": "purchase",
        "invoice_number": "MTE2026000000002",
        "contact_name": "MATEK",
        "grand_total": 3939.96,
        "effects_applied": True,
        "paid_amount": 50,
        "payment_status": "partially_paid",
        "direction": "incoming",
        "source": "edoc_inbox",
        "gib_status": "Gelen E-Fatura Onaylandı",
        "gib_response": "accepted",
    }
    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value=inv)
    mock_db.invoices.update_one = AsyncMock()
    mock_db.installments.update_many = AsyncMock()
    mock_db.incoming_edocs = MagicMock()
    mock_db.incoming_edocs.update_one = AsyncMock()

    with patch.object(server, "db", mock_db), patch.object(
        server, "_reverse_invoice_effects", AsyncMock()
    ) as rev, patch.object(
        server, "_unlink_orders_from_invoice", AsyncMock()
    ) as unlink, patch.object(
        server, "_cancel_promissory_for_query", AsyncMock()
    ):
        result = _run(server.cancel_invoice("inv_c1", {}))

    rev.assert_awaited_once()
    unlink.assert_awaited_once()
    assert result["status"] == "success"
    assert "iptal" in result["message"].lower()
    assert "sipariş" in result["message"].lower()
    args, kwargs = mock_db.invoices.update_one.await_args
    assert args[0] == {"_id": "inv_c1"}
    assert args[1]["$set"]["status"] == "cancelled"
    assert args[1]["$set"]["gib_status"] == "Gelen E-Fatura İptal"


def test_cancel_invoice_rejects_draft_and_paper():
    import server

    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value={"_id": "d1", "status": "draft", "invoice_number": "T-1"})

    with patch.object(server, "db", mock_db):
        with pytest.raises(HTTPException) as ei:
            _run(server.cancel_invoice("d1", {}))
    assert ei.value.status_code == 400
    assert "Taslak" in ei.value.detail

    mock_db.invoices.find_one = AsyncMock(return_value={
        "_id": "p1", "status": "approved", "e_type": "paper", "invoice_number": "K-1",
    })
    with patch.object(server, "db", mock_db):
        with pytest.raises(HTTPException) as ei2:
            _run(server.cancel_invoice("p1", {}))
    assert ei2.value.status_code == 400
    assert "e-Fatura" in ei2.value.detail
