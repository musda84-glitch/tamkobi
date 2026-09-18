"""Enpara, QNB'den ayrı provider; api.enpara.com account-statement."""
import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

import bank_providers as bp


def test_providers_split_enpara_and_qnb():
    assert "enpara" in bp.PROVIDERS
    assert "qnb" in bp.PROVIDERS
    assert bp.PROVIDERS["enpara"]["live_url"] == "https://api.enpara.com"
    assert "qnb.com" not in bp.PROVIDERS["enpara"]["live_url"]
    assert "Enpara" in bp.PROVIDERS["enpara"]["name"]
    assert "QNB" in bp.PROVIDERS["qnb"]["name"]
    assert "access_token" in bp.PROVIDERS["enpara"]["fields"]


def test_has_credentials_enpara_access_token_only():
    assert bp.has_credentials({"provider": "enpara", "access_token": "eyJabc"})
    assert not bp.has_credentials({"provider": "enpara"})
    assert bp.has_credentials({"provider": "enpara", "client_id": "a", "client_secret": "b"})


def test_err_text_empty_exception():
    class E(Exception):
        def __str__(self):
            return ""
    assert bp._err_text(E()) == "E"


def test_normalize_tr_fields_and_dates():
    rows = bp._normalize_tx_rows({
        "hareketler": [
            {"fisNo": "F1", "tutar": "1.250,50", "borcAlacak": "A", "aciklama": "Gelen", "islemTarihi": "10.09.2026"},
            {"referansNo": "R2", "borc": "40,00", "Aciklama": "Giden", "tarih": "11/09/2026"},
        ],
        "bakiye": "9.876,54",
    })
    assert len(rows) == 2
    assert rows[0]["external_id"] == "F1"
    assert rows[0]["direction"] == "credit"
    assert rows[0]["amount"] == 1250.5
    assert rows[0]["date"] == "2026-09-10"
    assert rows[1]["direction"] == "debit"
    assert rows[1]["amount"] == 40.0
    assert bp._extract_balance({"bakiye": "9.876,54"}) == 9876.54


def test_enpara_probe_ok_with_access_token():
    conn = {"provider": "enpara", "mode": "live", "access_token": "tok123", "client_id": "cid"}

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = "[]"

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.test_connection(conn)

    out = asyncio.run(_run())
    assert out["ok"] is True
    assert out["simulated"] is False
    assert "Enpara" in out["message"]
    args, kwargs = mock_client.get.await_args
    assert args[0] == "https://api.enpara.com/v1/account-statement/list"
    assert kwargs["headers"]["Authorization"] == "Bearer tok123"


def test_enpara_probe_invalid_token():
    conn = {"provider": "enpara", "mode": "live", "access_token": "bad"}

    mock_resp = MagicMock()
    mock_resp.status_code = 401
    mock_resp.text = '{"error":"Invalid Access Token"}'

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.test_connection(conn)

    out = asyncio.run(_run())
    assert out["ok"] is False
    assert "Access Token" in out["message"] or "geçersiz" in out["message"].lower()


def test_enpara_fetch_normalizes_rows():
    conn = {"provider": "enpara", "mode": "live", "access_token": "tok", "bank_account_number": "TR330011100000000000000001"}
    since = datetime.now(timezone.utc) - timedelta(days=3)

    stmt_resp = MagicMock()
    stmt_resp.status_code = 200
    stmt_resp.text = "{}"
    stmt_resp.json = MagicMock(return_value={
        "status": "completed",
        "bakiye": 1500.25,
        "transactions": [
            {"transactionId": "X1", "amount": 100.5, "direction": "credit", "description": "Gelen", "transactionDate": "2026-09-10"},
            {"id": "X2", "amount": -40, "explanation": "Giden", "date": "2026-09-11"},
        ]
    })

    mock_client = AsyncMock()
    mock_client.post = AsyncMock()
    mock_client.get = AsyncMock(return_value=stmt_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.fetch_transactions(conn, since)

    out = asyncio.run(_run())
    assert out["simulated"] is False
    assert len(out["transactions"]) == 2
    assert out["transactions"][0]["external_id"] == "X1"
    assert out["transactions"][0]["direction"] == "credit"
    assert out["transactions"][1]["direction"] == "debit"
    assert out["balance"] == 1500.25
    args, kwargs = mock_client.get.await_args
    assert args[0] == "https://api.enpara.com/v1/account-statement"
    assert "startDateTime" in (kwargs.get("params") or {})
    assert "endDateTime" in (kwargs.get("params") or {})
    assert kwargs["params"]["iban"] == "TR330011100000000000000001"
    mock_client.post.assert_not_called()


def test_enpara_fetch_empty_completed_is_success():
    conn = {"provider": "enpara", "mode": "live", "access_token": "tok", "bank_account_number": "TR330011100000000000000001"}
    since = datetime.now(timezone.utc) - timedelta(days=3)

    stmt_resp = MagicMock()
    stmt_resp.status_code = 200
    stmt_resp.text = "{}"
    stmt_resp.json = MagicMock(return_value={"status": "completed", "transactions": [], "bakiye": 10})

    mock_client = AsyncMock()
    mock_client.post = AsyncMock()
    mock_client.get = AsyncMock(return_value=stmt_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.fetch_transactions(conn, since)

    out = asyncio.run(_run())
    assert out["transactions"] == []
    assert out["balance"] == 10.0


def test_enpara_async_ticket_polls_ticket_no():
    conn = {"provider": "enpara", "mode": "live", "access_token": "tok", "bank_account_number": "TR330011100000000000000001"}
    since = datetime.now(timezone.utc) - timedelta(days=3)

    miss = MagicMock()
    miss.status_code = 404
    miss.text = "not found"
    miss.json = MagicMock(side_effect=ValueError("no json"))

    ticket_resp = MagicMock()
    ticket_resp.status_code = 200
    ticket_resp.text = "{}"
    ticket_resp.json = MagicMock(return_value={"ticketNo": "T9"})

    ready = MagicMock()
    ready.status_code = 200
    ready.text = "{}"
    ready.json = MagicMock(return_value={
        "status": "completed",
        "bakiye": 80,
        "transactions": [
            {"transactionId": "A1", "amount": 20, "direction": "credit", "description": "Gelen", "transactionDate": "2026-09-12"},
        ],
    })

    async def _get(url, **kwargs):
        if "/async-ticket/T9" in url or (kwargs.get("params") or {}).get("ticketNo") == "T9":
            return ready
        return miss

    bad = MagicMock()
    bad.status_code = 400
    bad.text = '{"code":"400"}'
    bad.json = MagicMock(return_value={"code": "400", "message": "Bad Request", "errors": [{"code": "400-1", "message": "skip"}]})

    async def _post(url, **kwargs):
        if str(url).endswith("/async-ticket"):
            return ticket_resp
        return bad

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=_get)
    mock_client.post = AsyncMock(side_effect=_post)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.fetch_transactions(conn, since)

    out = asyncio.run(_run())
    assert out["transactions"][0]["external_id"] == "A1"
    assert out["balance"] == 80.0
    posted = mock_client.post.await_args
    assert posted.args[0].endswith("/v1/account-transactions/async-ticket")
    body = posted.kwargs.get("json") or {}
    assert "startDateTime" in body and "endDateTime" in body
    assert "accountInfo" not in body


def test_payload_variants_match_gravitee_schema():
    start = datetime(2026, 9, 10, tzinfo=timezone.utc)
    end = datetime(2026, 9, 17, tzinfo=timezone.utc)
    iban = "TR330011100000000000000001"
    assert len(iban) == 26
    variants = bp._enpara_payload_variants(start, end, iban, "")
    assert variants
    assert len(variants) <= 12
    first = variants[0]
    # QNB Gravitee: startDateTime/endDateTime string, iban 26-char string — nested object yok
    assert first["startDateTime"].startswith("2026-09-10")
    assert first["endDateTime"].startswith("2026-09-17")
    assert first.get("iban") == iban
    assert "accountInfo" not in first
    assert not any(isinstance(v, dict) for v in first.values())
    assert all("startDateTime" in p and "endDateTime" in p for p in variants)


def test_iban_parts():
    p = bp._iban_parts("TR33 00111 0 00000000000001")
    assert p["iban"].startswith("TR")
    assert p["bankCode"] == "00111"
    assert p["accountNumber"]


def test_enpara_iban_must_be_26_alnum():
    assert bp._enpara_iban_26("TR33 0011 1000 0000 0000 0000 01") == "TR330011100000000000000001"
    assert len(bp._enpara_iban_26("TR330011100000000000000001")) == 26
    assert bp._enpara_iban_26("TR00") == ""
    assert bp._ticket_id_from({"ticketNo": "T9"}) == "T9"


def test_api_error_detail_parses_enpara_400():
    resp = MagicMock()
    resp.text = '{"code":"400","message":"Bad Request","errors":[{"code":"400-1","message":"Invalid iban"}]}'
    resp.json = MagicMock(return_value={
        "code": "400",
        "message": "Bad Request",
        "errors": [{"code": "400-1", "message": "Invalid iban"}],
    })
    detail = bp._api_error_detail(resp)
    assert "Invalid iban" in detail
    assert "400-1" in detail


def test_api_error_detail_nested_object_message():
    resp = MagicMock()
    resp.text = "{}"
    resp.json = MagicMock(return_value={
        "code": "400",
        "message": "Bad Request",
        "errors": [{"code": "400-1", "message": {"type": "object", "field": "accountInfo"}}],
    })
    detail = bp._api_error_detail(resp)
    assert "accountInfo" in detail or "object" in detail

