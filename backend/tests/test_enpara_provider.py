"""Enpara, QNB'den ayrı provider; api.enpara.com account-statement."""
import asyncio
import base64
import json
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

import bank_providers as bp


def _jwt(exp_offset_sec: int) -> str:
    payload = {"exp": int(datetime.now(timezone.utc).timestamp()) + exp_offset_sec, "sub": "enpara"}

    def b64url(obj):
        raw = json.dumps(obj, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return f"{b64url({'alg': 'none', 'typ': 'JWT'})}.{b64url(payload)}.sig"


def test_providers_split_enpara_and_qnb():
    assert "enpara" in bp.PROVIDERS
    assert "qnb" in bp.PROVIDERS
    assert bp.PROVIDERS["enpara"]["live_url"] == "https://api.enpara.com"
    assert "qnb.com" not in bp.PROVIDERS["enpara"]["live_url"]
    assert "Enpara" in bp.PROVIDERS["enpara"]["name"]
    assert "QNB" in bp.PROVIDERS["qnb"]["name"]
    assert "access_token" in bp.PROVIDERS["enpara"]["fields"]
    assert "api_key" in bp.PROVIDERS["enpara"]["fields"]


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


def test_enpara_token_url_is_gravitee_am():
    urls = bp._enpara_token_urls({"provider": "enpara", "mode": "live"})
    assert urls[0] == "https://api.enpara.com/securedomain/oauth/token"
    assert all("/oauth2/accesstoken" not in u for u in urls)


def test_enpara_refresh_posts_securedomain_oauth():
    conn = {"provider": "enpara", "mode": "live", "client_id": "cid", "client_secret": "sec"}
    ok = MagicMock()
    ok.status_code = 200
    ok.content = b'{"access_token":"NEWTOK"}'
    ok.text = '{"access_token":"NEWTOK"}'
    ok.json = MagicMock(return_value={"access_token": "NEWTOK"})

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=ok)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._enpara_refresh_access_token(conn)

    token = asyncio.run(_run())
    assert token == "NEWTOK"
    args, kwargs = mock_client.post.await_args
    assert args[0] == "https://api.enpara.com/securedomain/oauth/token"
    assert kwargs["data"]["grant_type"] == "client_credentials"


def test_enpara_refresh_skips_404_epg96_then_hits_am():
    conn = {"provider": "enpara", "mode": "live", "client_id": "cid", "client_secret": "sec", "token_url": "https://api.enpara.com/oauth2/accesstoken"}
    dead = MagicMock()
    dead.status_code = 500
    dead.content = b'"404-EPG96-STATUS"'
    dead.text = '"404-EPG96-STATUS"'
    dead.json = MagicMock(side_effect=ValueError("html"))

    ok = MagicMock()
    ok.status_code = 200
    ok.content = b'{"access_token":"OK"}'
    ok.text = '{"access_token":"OK"}'
    ok.json = MagicMock(return_value={"access_token": "OK"})

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=[dead, ok])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._enpara_refresh_access_token(conn)

    token = asyncio.run(_run())
    assert token == "OK"
    posted = [c.args[0] for c in mock_client.post.await_args_list]
    assert posted[0].endswith("/oauth2/accesstoken")
    assert any(u.endswith("/securedomain/oauth/token") for u in posted)


def test_enpara_ip_block_does_not_refresh():
    conn = {
        "provider": "enpara", "mode": "live", "access_token": "tok",
        "client_id": "cid", "client_secret": "sec",
        "bank_account_number": "TR330011100000000000000001",
    }
    since = datetime.now(timezone.utc) - timedelta(days=1)
    blocked = MagicMock()
    blocked.status_code = 403
    blocked.text = '{"message":"Your IP is not allowed"}'
    blocked.json = MagicMock(return_value={"message": "Your IP is not allowed"})

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=blocked)
    mock_client.post = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.fetch_transactions(conn, since)

    try:
        asyncio.run(_run())
        assert False, "expected IP error"
    except RuntimeError as e:
        assert "IP" in str(e)
    mock_client.post.assert_not_called()


def test_jwt_expired_helper():
    assert bp._jwt_expired("not-a-jwt") is None
    assert bp._jwt_expired(_jwt(3600)) is False
    assert bp._jwt_expired(_jwt(-120)) is True
    assert bp._jwt_expired(_jwt(10)) is True  # skew_sec=30


def test_api_error_detail_oauth_access_denied():
    resp = MagicMock()
    resp.text = '{"error":"access_denied"}'
    resp.json = MagicMock(return_value={"error": "access_denied"})
    assert "access_denied" in bp._api_error_detail(resp)


def test_enpara_headers_include_gravitee_api_key():
    h = bp._enpara_headers("tok", {"api_key": "gk-1"}, for_get=True)
    assert h["Authorization"] == "Bearer tok"
    assert h["X-Gravitee-Api-Key"] == "gk-1"
    assert "Content-Type" not in h
    h2 = bp._enpara_headers("tok", {}, for_get=False)
    assert "X-Gravitee-Api-Key" not in h2
    assert h2["Content-Type"] == "application/json"


def test_enpara_unexpired_jwt_access_denied_does_not_refresh():
    token = _jwt(3600)
    conn = {
        "provider": "enpara", "mode": "live", "access_token": token,
        "client_id": "cid", "client_secret": "sec",
        "bank_account_number": "TR330011100000000000000001",
    }
    since = datetime.now(timezone.utc) - timedelta(days=1)
    denied = MagicMock()
    denied.status_code = 401
    denied.text = '{"error":"access_denied"}'
    denied.json = MagicMock(return_value={"error": "access_denied"})

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=denied)
    mock_client.post = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.fetch_transactions(conn, since)

    try:
        asyncio.run(_run())
        assert False, "expected access_denied"
    except RuntimeError as e:
        msg = str(e)
        assert "access_denied" in msg
        assert "IP" in msg
        assert "Account Statement" in msg
    mock_client.post.assert_not_called()


def test_enpara_expired_jwt_refreshes_then_fetches():
    expired = _jwt(-120)
    conn = {
        "provider": "enpara", "mode": "live", "access_token": expired,
        "client_id": "cid", "client_secret": "sec",
        "bank_account_number": "TR330011100000000000000001",
    }
    since = datetime.now(timezone.utc) - timedelta(days=1)

    tok_ok = MagicMock()
    tok_ok.status_code = 200
    tok_ok.content = b'{"access_token":"NEWJWT"}'
    tok_ok.text = '{"access_token":"NEWJWT"}'
    tok_ok.json = MagicMock(return_value={"access_token": "NEWJWT"})

    stmt_resp = MagicMock()
    stmt_resp.status_code = 200
    stmt_resp.text = "{}"
    stmt_resp.json = MagicMock(return_value={
        "status": "completed",
        "bakiye": 12,
        "transactions": [{"transactionId": "R1", "amount": 5, "direction": "credit", "description": "Gelen", "transactionDate": "2026-09-10"}],
    })

    async def _post(url, **kwargs):
        assert "oauth" in str(url) or "token" in str(url)
        return tok_ok

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=_post)
    mock_client.get = AsyncMock(return_value=stmt_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.fetch_transactions(conn, since)

    out = asyncio.run(_run())
    assert out["transactions"][0]["external_id"] == "R1"
    assert out["access_token"] == "NEWJWT"
    assert mock_client.post.await_count >= 1
    args, kwargs = mock_client.get.await_args
    assert kwargs["headers"]["Authorization"] == "Bearer NEWJWT"


def test_enpara_probe_unexpired_jwt_access_denied_skips_refresh():
    token = _jwt(7200)
    conn = {
        "provider": "enpara", "mode": "live", "access_token": token,
        "client_id": "cid", "client_secret": "sec", "api_key": "gk-9",
    }
    denied = MagicMock()
    denied.status_code = 401
    denied.text = '{"error":"access_denied"}'
    denied.json = MagicMock(return_value={"error": "access_denied"})

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=denied)
    mock_client.post = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.test_connection(conn)

    out = asyncio.run(_run())
    assert out["ok"] is False
    assert "access_denied" in out["message"]
    assert "IP" in out["message"]
    mock_client.post.assert_not_called()
    args, kwargs = mock_client.get.await_args
    assert kwargs["headers"]["Authorization"] == f"Bearer {token}"
    assert kwargs["headers"]["X-Gravitee-Api-Key"] == "gk-9"


def test_enpara_access_token_expired_without_secret_raises():
    conn = {"provider": "enpara", "mode": "live", "access_token": _jwt(-90)}

    async def _run():
        return await bp._enpara_access_token(conn)

    try:
        asyncio.run(_run())
        assert False, "expected expired token error"
    except RuntimeError as e:
        assert "süresi dolmuş" in str(e).lower() or "Access Token" in str(e)

