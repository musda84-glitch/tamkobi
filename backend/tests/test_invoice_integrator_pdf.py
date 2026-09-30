"""GİB gönderilmiş fatura PDF: entegratör zorunlu, yerel şablona sessiz düşme yok."""
from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import saas_docs  # noqa: E402


def test_invoice_pdf_require_integrator_raises_when_missing():
    inv = {
        "_id": "inv_pdf_1",
        "company_id": "c1",
        "invoice_number": "TA202600000095",
        "e_type": "e_archive",
        "status": "approved",
        "einvoice_state": "sent",
        "gib_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "gib_status": "İşNet SOAP API ile GİB'e iletildi",
        "contact_id": "cnt1",
    }
    fake_db = MagicMock()
    fake_db.invoices.find_one = AsyncMock(return_value=inv)
    fake_db.companies.find_one = AsyncMock(return_value={"_id": "c1", "name": "Firma"})
    fake_db.contacts.find_one = AsyncMock(return_value=None)
    saas_docs.init(fake_db)

    with patch("e_invoice.fetch_integrator_pdf", AsyncMock(return_value=None)):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                saas_docs.invoice_pdf("inv_pdf_1", require_integrator=True)
            )
    assert e.value.status_code == 502
    assert "Entegratör" in e.value.detail


def test_invoice_pdf_returns_integrator_bytes_with_header():
    inv = {
        "_id": "inv_pdf_2",
        "company_id": "c1",
        "invoice_number": "AL202600000096",
        "e_type": "e_invoice",
        "status": "approved",
        "einvoice_state": "sent",
        "gib_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "gib_status": "İşNet SOAP API ile GİB'e iletildi",
    }
    fake_db = MagicMock()
    fake_db.invoices.find_one = AsyncMock(return_value=inv)
    saas_docs.init(fake_db)
    pdf = b"%PDF-1.4 integrator"

    with patch("e_invoice.fetch_integrator_pdf", AsyncMock(return_value=pdf)):
        resp = asyncio.get_event_loop().run_until_complete(
            saas_docs.invoice_pdf("inv_pdf_2", require_integrator=True)
        )
    assert resp.body == pdf
    assert resp.headers.get("x-document-source") == "integrator"
    assert "pdf" in (resp.media_type or "")
