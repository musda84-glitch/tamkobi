"""AI fatura çıkarımı: bozuk JSON / boş kalemde bir kez yeniden dener."""
import asyncio
import json
from unittest.mock import AsyncMock, patch

import ai_service


class _Msg:
    def __init__(self, text):
        self.text = text


def test_extract_invoice_retries_bad_json_then_ok():
    good = {
        "supplier": {"name": "ABC", "tax_number": "123"},
        "invoice_number": "F1",
        "issue_date": "2026-01-01",
        "items": [{"name": "Kalem", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10}],
        "grand_total": 12,
        "confidence": 0.9,
    }
    chat = AsyncMock()
    chat.send_message = AsyncMock(side_effect=["not-json", json.dumps(good)])

    async def _run():
        with patch.object(ai_service, "make_chat", AsyncMock(return_value=chat)):
            with patch.object(ai_service, "UserMessage", _Msg):
                return await ai_service.extract_invoice_from_text("FATURA METNI " + ("x" * 40), "purchase")

    out = asyncio.run(_run())
    assert out["items"][0]["name"] == "Kalem"
    assert chat.send_message.await_count == 2


def test_extract_invoice_retries_empty_items_then_ok():
    empty = {"supplier": {"name": "ABC"}, "items": [], "confidence": 0.1}
    good = {
        "supplier": {"name": "ABC"},
        "items": [{"name": "Ürün", "quantity": 2, "unit_price": 5, "vat_rate": 20, "total": 10}],
        "grand_total": 12,
        "confidence": 0.8,
    }
    chat = AsyncMock()
    chat.send_message = AsyncMock(side_effect=[json.dumps(empty), json.dumps(good)])

    async def _run():
        with patch.object(ai_service, "make_chat", AsyncMock(return_value=chat)):
            with patch.object(ai_service, "UserMessage", _Msg):
                return await ai_service.extract_invoice_from_text("FATURA METNI " + ("y" * 40), "purchase")

    out = asyncio.run(_run())
    assert len(out["items"]) == 1
    assert chat.send_message.await_count == 2
