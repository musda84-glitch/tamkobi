"""Kuveyt Türk API Market: client_credentials + RSA-SHA256 Signature."""
import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

import bank_providers as bp


def _rsa_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")


def test_kuveyt_provider_identity_and_api_hosts():
    meta = bp.PROVIDERS["kuveytturk"]
    assert meta["sandbox_url"] == "https://apitest.kuveytturk.com.tr/prep"
    assert meta["live_url"] == "https://api.kuveytturk.com.tr"
    assert meta["identity_sandbox_url"] == "https://idprep.kuveytturk.com.tr"
    assert meta["identity_live_url"] == "https://id.kuveytturk.com.tr"
    assert meta["token_path"] == "/api/connect/token"
    assert "private_key" in meta["fields"]
    assert "RSA-SHA256" in meta["hint"] or "RSA-SHA256" in meta["hint"].replace(" ", "") or "Signature" in meta["hint"]


def test_kuveyt_token_urls_sandbox_and_live():
    sand = bp._kuveyt_token_urls({"provider": "kuveytturk", "mode": "sandbox"})
    assert sand[0] == "https://idprep.kuveytturk.com.tr/api/connect/token"
    live = bp._kuveyt_token_urls({"provider": "kuveytturk", "mode": "live"})
    assert live[0] == "https://id.kuveytturk.com.tr/api/connect/token"
    custom = bp._kuveyt_token_urls({
        "provider": "kuveytturk", "mode": "live",
        "token_url": "https://id.kuveytturk.com.tr/api/connect/token",
    })
    assert custom[0] == "https://id.kuveytturk.com.tr/api/connect/token"
    assert custom.count("https://id.kuveytturk.com.tr/api/connect/token") == 1


def test_kuveyt_base_url_prep_sandbox():
    assert bp._base_url({"provider": "kuveytturk", "mode": "sandbox"}) == "https://apitest.kuveytturk.com.tr/prep"
    assert bp._base_url({"provider": "kuveytturk", "mode": "live"}) == "https://api.kuveytturk.com.tr"


def test_kuveyt_query_string_order():
    assert bp._kuveyt_query_string(None) == ""
    assert bp._kuveyt_query_string({}) == ""
    qs = bp._kuveyt_query_string({"beginDate": "2026-09-01", "endDate": "2026-09-18", "accountNumber": "123"})
    assert qs == "?beginDate=2026-09-01&endDate=2026-09-18&accountNumber=123"


def test_kuveyt_sign_get_matches_sha256withrsa():
    pem = _rsa_pem()
    token = "access-token-xyz"
    qs = "?beginDate=2026-09-01&endDate=2026-09-18"
    sig = bp._kuveyt_sign(token, pem, query_string=qs)
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    pub = key.public_key()
    pub.verify(
        __import__("base64").b64decode(sig),
        (token + qs).encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )


def test_kuveyt_sign_post_concatenates_json_without_query():
    pem = _rsa_pem()
    token = " tok "
    body = '{"startDate":"2026-09-01"}'
    sig = bp._kuveyt_sign(token, pem, json_body=body)
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    key.public_key().verify(
        __import__("base64").b64decode(sig),
        (token + body).encode("utf-8"),  # POST: no trim
        padding.PKCS1v15(),
        hashes.SHA256(),
    )


def test_kuveyt_headers_include_signature_and_language():
    pem = _rsa_pem()
    conn = {"provider": "kuveytturk", "private_key": pem}
    headers = bp._kuveyt_headers("tok123", conn, params={"beginDate": "2026-09-01"})
    assert headers["Authorization"] == "Bearer tok123"
    assert headers["LanguageId"] == "1"
    assert headers["Signature"]
    assert "Content-Type" not in headers


def test_kuveyt_account_suffix_from_iban():
    # TR + 2 check + 5 bank + 1 reserved + account
    iban = "TR330001100000000000000001"  # 26 chars
    assert len(iban) == 26
    suffix = bp._kuveyt_account_suffix({"bank_account_number": iban})
    assert suffix == iban[10:].lstrip("0")
    assert bp._kuveyt_account_suffix({"bank_account_number": "001234"}) == "001234"


def test_has_credentials_kuveyt_client_pair():
    assert not bp.has_credentials({"provider": "kuveytturk"})
    assert bp.has_credentials({"provider": "kuveytturk", "client_id": "a", "client_secret": "b"})
    assert not bp.has_credentials({"provider": "kuveytturk", "client_id": "a", "private_key": "x"})


def test_kuveyt_token_posts_client_credentials_to_identity():
    conn = {"provider": "kuveytturk", "mode": "sandbox", "client_id": "cid", "client_secret": "sec"}
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b'{"access_token":"kt-token"}'
    mock_resp.json.return_value = {"access_token": "kt-token", "expires_in": 3600}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._kuveyt_access_token(conn)

    token = asyncio.run(_run())
    assert token == "kt-token"
    args, kwargs = mock_client.post.await_args
    assert args[0] == "https://idprep.kuveytturk.com.tr/api/connect/token"
    assert kwargs["data"]["grant_type"] == "client_credentials"
    assert kwargs["data"]["client_id"] == "cid"
    assert kwargs["data"]["client_secret"] == "sec"
    assert kwargs["data"].get("scope") == "public"


def test_kuveyt_probe_signs_banks_get():
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "sandbox",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tokAAA"}'
    token_resp.json.return_value = {"access_token": "tokAAA"}

    banks_resp = MagicMock()
    banks_resp.status_code = 200
    banks_resp.text = "[]"
    banks_resp.json.return_value = []

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(return_value=banks_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.test_connection(conn)

    out = asyncio.run(_run())
    assert out["ok"] is True
    assert out["simulated"] is False
    assert "client_credentials" in out["message"]
    get_args, get_kwargs = mock_client.get.await_args
    assert get_args[0] == "https://apitest.kuveytturk.com.tr/prep/v1/data/banks"
    assert get_kwargs["headers"]["Authorization"] == "Bearer tokAAA"
    assert get_kwargs["headers"]["Signature"]


def test_fetch_kuveyt_requires_private_key():
    conn = {"provider": "kuveytturk", "client_id": "a", "client_secret": "b", "mode": "live"}

    async def _run():
        return await bp._fetch_kuveyt_transactions(conn, datetime.now(timezone.utc) - timedelta(days=7))

    try:
        asyncio.run(_run())
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        assert "PKCS8" in str(e) or "private key" in str(e).lower() or "PEM" in str(e)


def test_fetch_kuveyt_signed_transactions():
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
        "bank_account_number": "12345678",
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tokBBB"}'
    token_resp.json.return_value = {"access_token": "tokBBB"}

    empty_accounts = MagicMock()
    empty_accounts.status_code = 200
    empty_accounts.text = "{}"
    empty_accounts.json.return_value = {}

    tx_resp = MagicMock()
    tx_resp.status_code = 200
    tx_resp.text = '{"value":[]}'
    tx_resp.json.return_value = {
        "transactions": [
            {"transactionId": "KT1", "amount": 150.25, "direction": "credit",
             "description": "Gelen EFT", "transactionDate": "2026-09-10", "currency": "TRY"},
        ],
        "currentBalance": 8800.5,
    }

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(side_effect=[empty_accounts, tx_resp])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._fetch_kuveyt_transactions(conn, datetime(2026, 9, 1, tzinfo=timezone.utc))

    out = asyncio.run(_run())
    assert len(out["transactions"]) == 1
    assert out["transactions"][0]["external_id"] == "KT1"
    assert out["transactions"][0]["amount"] == 150.25
    assert out["balance"] == 8800.5
    get_calls = mock_client.get.await_args_list
    tx_url = get_calls[1].args[0]
    assert "/v1/accounts/transactions?" in tx_url
    assert "beginDate=" in tx_url
    assert get_calls[1].kwargs["headers"]["Signature"]
    assert get_calls[1].kwargs["headers"]["Authorization"] == "Bearer tokBBB"
