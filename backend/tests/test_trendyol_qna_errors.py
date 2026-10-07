"""Trendyol QnA BusinessRuleException → okunabilir Türkçe."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

import marketplace_providers as mp


SAMPLE_TIME_LIMIT = (
    '{"timestamp":1791365915600,"exception":"BusinessRuleException","title":"",'
    '"status":400,"requestUri":"/sellers/304401/questions/453742645/answers",'
    '"requestMethod":"POST","correlationId":"06a3c3d9-693e-4a66-ba6c-785f157fd9ab",'
    '"errors":[{"key":"business.rule.question.unanswered.time.limit","message":"B"}]}'
)


def test_trendyol_error_detail_qna_time_limit():
    msg = mp.trendyol_error_detail(400, SAMPLE_TIME_LIMIT)
    assert "cevap süresi dolmuş" in msg.lower()
    assert "Trendyol hata 400:" not in msg
    assert "BusinessRuleException" not in msg
    assert SAMPLE_TIME_LIMIT[:40] not in msg
    assert mp.is_trendyol_qna_time_limit(msg)


def test_trendyol_error_detail_plain_text():
    assert "Trendyol hata 500" in mp.trendyol_error_detail(500, "boom")


def test_trendyol_answer_maps_time_limit_to_400():
    cfg = {"api_key": "k", "api_secret": "s", "supplier_id": "304401"}
    client = mp.TrendyolClient(cfg)
    resp = MagicMock()
    resp.status_code = 400
    resp.text = SAMPLE_TIME_LIMIT
    resp.content = SAMPLE_TIME_LIMIT.encode()

    async def _run():
        with patch.object(client.http, "request", new=AsyncMock(return_value=resp)):
            with pytest.raises(HTTPException) as ei:
                await client.answer("453742645", "maliyet her zaman malzemeden oluşmaz efendim")
            assert ei.value.status_code == 400
            assert "cevap süresi dolmuş" in str(ei.value.detail).lower()
        await client.close()

    asyncio.run(_run())


def test_trendyol_call_keeps_401_message():
    cfg = {"api_key": "k", "api_secret": "s", "supplier_id": "1"}
    client = mp.TrendyolClient(cfg)
    resp = MagicMock()
    resp.status_code = 401
    resp.text = "unauthorized"
    resp.content = b"unauthorized"

    async def _run():
        with patch.object(client.http, "request", new=AsyncMock(return_value=resp)):
            with pytest.raises(HTTPException) as ei:
                await client._call("GET", "/x")
            assert ei.value.status_code == 401
            assert "API Key" in str(ei.value.detail)
        await client.close()

    asyncio.run(_run())
