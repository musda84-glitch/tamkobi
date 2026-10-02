"""Gelen fatura PDF/XML — İşNet InvoiceDirection=Incoming."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import e_invoice


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_is_incoming_invoice_and_direction():
    assert e_invoice._is_incoming_invoice({"direction": "incoming"}) is True
    assert e_invoice._is_incoming_invoice({"source": "edoc_inbox"}) is True
    assert e_invoice._is_incoming_invoice({"gib_status": "Gelen E-Fatura Onaylandı"}) is True
    assert e_invoice._is_incoming_invoice({"invoice_type": "sales", "einvoice_state": "sent"}) is False
    assert e_invoice._invoice_soap_direction({"direction": "incoming"}) == "Incoming"
    assert e_invoice._invoice_soap_direction({"einvoice_state": "sent"}) == "Outgoing"


def test_fetch_integrator_pdf_passes_incoming_direction():
    inv = {
        "_id": "inv_in",
        "company_id": "c1",
        "e_type": "e_invoice",
        "direction": "incoming",
        "source": "edoc_inbox",
        "status": "approved",
        "gib_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "invoice_number": "UUU2026999464697",
        "gib_status": "Gelen E-Fatura Onaylandı",
    }
    settings = {"provider": "isnet", "status": "configured", "company_tax_id": "4810173324"}
    fake_db = MagicMock()
    fake_db.invoices.find_one = AsyncMock(return_value=inv)
    fake_db.einvoice_settings.find_one = AsyncMock(return_value=settings)
    e_invoice.init(fake_db)

    dl = AsyncMock(return_value=b"%PDF-1.4 incoming")
    with patch("e_invoice.isnet.download_invoice_pdf", dl):
        out = _run(e_invoice.fetch_integrator_pdf("inv_in"))
    assert out.startswith(b"%PDF")
    assert dl.await_args.kwargs.get("direction") == "Incoming"
