"""Gelen e-belge PDF/XML indirme yardımcıları."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import edocs


def test_safe_filename_strips_unsafe():
    assert edocs._safe_filename("YOE202600000001", "pdf") == "YOE202600000001.pdf"
    assert edocs._safe_filename("a/b\\c name", "xml") == "a_b_c_name.xml"
    assert edocs._safe_filename("", "pdf") == "ebelge.pdf"


def test_fetch_incoming_pdf_requires_ettn():
    with pytest.raises(HTTPException) as e:
        asyncio.get_event_loop().run_until_complete(
            edocs._fetch_incoming_edoc_pdf({"number": "X"}, "comp1")
        )
    assert e.value.status_code == 404
    assert "ETTN" in e.value.detail


def test_fetch_incoming_pdf_calls_isnet_incoming():
    doc = {
        "number": "YOE202600000001",
        "uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "source": "isnet",
    }
    settings = {"provider": "isnet", "status": "configured", "mode": "test"}
    fake_db = MagicMock()
    fake_db.einvoice_settings.find_one = AsyncMock(return_value=settings)

    with patch.object(edocs, "_db", fake_db), patch("isnet.is_ettn_uuid", return_value=True), patch(
        "isnet.download_invoice_pdf", AsyncMock(return_value=b"%PDF-1.4 ok")
    ) as dl:
        pdf = asyncio.get_event_loop().run_until_complete(
            edocs._fetch_incoming_edoc_pdf(doc, "comp1")
        )
    assert pdf.startswith(b"%PDF")
    assert dl.await_args.kwargs.get("direction") == "Incoming"
    assert dl.await_args.kwargs.get("e_type") == "e_invoice"
