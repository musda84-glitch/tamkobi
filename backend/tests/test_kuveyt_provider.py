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
    assert meta["sandbox_url"] == "https://prep-gateway.kuveytturk.com.tr"
    assert meta["live_url"] == "https://gateway.kuveytturk.com.tr"
    assert meta["identity_sandbox_url"] == "https://prep-identity.kuveytturk.com.tr"
    assert meta["identity_live_url"] == "https://identity.kuveytturk.com.tr"
    assert meta["token_path"] == "/connect/token"
    assert "private_key" in meta["fields"]
    assert "RSA-SHA256" in meta["hint"] or "RSA-SHA256" in meta["hint"].replace(" ", "") or "Signature" in meta["hint"]


def test_kuveyt_token_urls_sandbox_and_live():
    sand = bp._kuveyt_token_urls({"provider": "kuveytturk", "mode": "sandbox"})
    assert sand[0] == "https://prep-identity.kuveytturk.com.tr/connect/token"
    assert len(sand) == 1
    live = bp._kuveyt_token_urls({"provider": "kuveytturk", "mode": "live"})
    assert live[0] == "https://identity.kuveytturk.com.tr/connect/token"
    assert len(live) == 1
    custom = bp._kuveyt_token_urls({
        "provider": "kuveytturk", "mode": "live",
        "token_url": "https://identity.kuveytturk.com.tr/connect/token",
    })
    assert custom[0] == "https://identity.kuveytturk.com.tr/connect/token"
    assert custom.count("https://identity.kuveytturk.com.tr/connect/token") == 1


def test_kuveyt_base_url_prep_sandbox():
    assert bp._base_url({"provider": "kuveytturk", "mode": "sandbox"}) == "https://prep-gateway.kuveytturk.com.tr"
    assert bp._base_url({"provider": "kuveytturk", "mode": "live"}) == "https://gateway.kuveytturk.com.tr"


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
    conn = {"provider": "kuveytturk", "private_key": pem, "api_key": "gravitee-uuid"}
    headers = bp._kuveyt_headers("tok123", conn, params={"beginDate": "2026-09-01"})
    assert headers["Authorization"] == "Bearer tok123"
    assert headers["LanguageId"] == "1"
    assert headers["Signature"]
    assert headers["X-Gravitee-Api-Key"] == "gravitee-uuid"
    assert "Content-Type" not in headers


def test_kuveyt_account_suffix_from_iban():
    # TR + 2 check + 5 bank + 1 reserved + account
    iban = "TR330001100000000000000001"  # 26 chars
    assert len(iban) == 26
    cands = bp._kuveyt_account_suffix_candidates({"bank_account_number": iban})
    assert iban[10:].lstrip("0") in cands or any(len(c) <= 5 for c in cands)
    # Kısa ek no doğrudan
    assert bp._kuveyt_account_suffix({"bank_account_number": "2"}) == "2"
    assert bp._kuveyt_account_suffix({"bank_account_number": "001"}) == "1"


def test_kuveyt_tx_paths_prefer_ek_no_not_customer():
    """9698082300002 → ek 2 önce; müşteri no path’e girmez."""
    cands = bp._kuveyt_account_suffix_candidates({
        "bank_account_number": "9698082300002",
        "customer_number": "96980823",
    })
    assert cands[0] == "2"
    assert "96980823" not in cands
    paths = bp._kuveyt_tx_paths({"bank_account_number": "9698082300002"})
    assert paths[0] == "/v1/accounts/transactions"
    assert "/v1/accounts/2/transactions" in paths
    assert all("accounttransactions" not in p for p in paths)
    assert all("/96980823/" not in p for p in paths)


def test_has_credentials_kuveyt_client_pair():
    assert not bp.has_credentials({"provider": "kuveytturk"})
    assert bp.has_credentials({"provider": "kuveytturk", "client_id": "a", "client_secret": "b"})
    assert not bp.has_credentials({"provider": "kuveytturk", "client_id": "a", "private_key": "x"})


def test_kuveyt_normalize_secret_strips_paste_artifacts():
    assert bp._kuveyt_normalize_secret('  "abc-uuid"  ') == "abc-uuid"
    assert bp._kuveyt_normalize_secret("\ufeffsec\u200b") == "sec"


def test_kuveyt_normalize_secret_collapses_internal_whitespace():
    """Portal copy often inserts newlines inside Client Secret → invalid_client."""
    assert bp._kuveyt_normalize_secret("ab\ncd\tef") == "abcdef"
    assert bp._kuveyt_normalize_secret("  cid-36  ") == "cid-36"
    assert bp._kuveyt_normalize_secret("sec ret with spaces") == "secretwithspaces"


def test_kuveyt_normalize_connection_secrets_on_save():
    out = bp.normalize_kuveyt_connection_secrets({
        "provider": "kuveytturk",
        "client_id": " aa\nbb ",
        "client_secret": "s e\nc",
        "api_key": " key ",
    })
    assert out["client_id"] == "aabb"
    assert out["client_secret"] == "sec"
    assert out["api_key"] == "key"
    # Non-kuveyt untouched
    other = bp.normalize_kuveyt_connection_secrets({"provider": "enpara", "client_id": " a "})
    assert other["client_id"] == " a "


def _rsa_pkcs1_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")


def test_kuveyt_load_private_key_pkcs8_and_pkcs1():
    pkcs8 = _rsa_pem()
    pkcs1 = _rsa_pkcs1_pem()
    assert bp._kuveyt_load_private_key(pkcs8) is not None
    assert bp._kuveyt_load_private_key(pkcs1) is not None
    # Bare base64 body (headers stripped) still loads
    body = "".join(
        ln for ln in pkcs8.splitlines()
        if ln and not ln.startswith("-----")
    )
    assert bp._kuveyt_load_private_key(body) is not None


def test_kuveyt_load_private_key_rejects_public_key():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    try:
        bp._kuveyt_load_private_key(pub)
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        assert "PUBLIC KEY" in str(e) or "genel anahtar" in str(e)


def test_kuveyt_load_private_key_markdown_fence():
    pem = _rsa_pem()
    fenced = f"```\n{pem}\n```"
    assert bp._kuveyt_load_private_key(fenced) is not None


def test_kuveyt_normalize_connection_secrets_wraps_bare_private_key():
    pem = _rsa_pem()
    body = "".join(ln for ln in pem.splitlines() if ln and not ln.startswith("-----"))
    out = bp.normalize_kuveyt_connection_secrets({
        "provider": "kuveytturk",
        "private_key": body,
    })
    assert "BEGIN PRIVATE KEY" in out["private_key"]
    assert bp._kuveyt_load_private_key(out["private_key"]) is not None


def test_kuveyt_api_key_uuid_not_used_as_private_key():
    pem = bp._kuveyt_private_key_pem({
        "provider": "kuveytturk",
        "api_key": "cc44b566-8006-4712-bf45-1e1b7c64b4da",
    })
    assert pem == ""


def test_kuveyt_cred_swap_hints_client_id_equals_api_key():
    key = "cc44b566-8006-4712-bf45-1e1b7c64b4da"
    hints = bp._kuveyt_cred_swap_hints(key, "long-opaque-secret-value-here", key)
    assert "client_id=api_key" in hints
    fp = bp._kuveyt_cred_fingerprint(key, "long-opaque-secret-value-here", key)
    assert "client_id=api_key" in fp


def test_kuveyt_normalize_mode():
    assert bp._kuveyt_normalize_mode({"mode": "LIVE"}) == "live"
    assert bp._kuveyt_normalize_mode({"mode": "Canlı"}) == "live"
    assert bp._kuveyt_normalize_mode({"mode": "sandbox"}) == "sandbox"
    assert bp._kuveyt_normalize_mode({}) == "sandbox"


def test_kuveyt_scope_candidates_prefer_public():
    assert bp._kuveyt_scope_candidates({})[0] == "public"
    # CC için public önce; özel scope ikinci sırada denenir
    assert bp._kuveyt_scope_candidates({"scope": "payments cards"})[0] == "public"
    assert "payments cards" in bp._kuveyt_scope_candidates({"scope": "payments cards"})


def test_kuveyt_token_auth_attempts_body_then_basic():
    attempts = bp._kuveyt_token_auth_attempts("cid", "sec", "public")
    assert len(attempts) == 2
    assert attempts[0]["label"] == "body"
    assert "Authorization" not in attempts[0]["headers"]
    assert attempts[0]["data"]["client_id"] == "cid"
    assert attempts[1]["label"] == "basic"
    assert attempts[1]["headers"]["Authorization"].startswith("Basic ")


def test_kuveyt_token_urls_oidc_connect_token():
    live = bp._kuveyt_token_urls({"provider": "kuveytturk", "mode": "live"})
    assert live == ["https://identity.kuveytturk.com.tr/connect/token"]
    # Eski /api/connect/token → /connect/token normalize
    fixed = bp._kuveyt_token_urls({
        "provider": "kuveytturk", "mode": "live",
        "token_url": "https://identity.kuveytturk.com.tr/api/connect/token",
    })
    assert fixed[0] == "https://identity.kuveytturk.com.tr/connect/token"
    assert all(u.endswith("/connect/token") and not u.endswith("/api/connect/token") for u in fixed)


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
    assert args[0] == "https://prep-identity.kuveytturk.com.tr/connect/token"
    assert kwargs["data"]["grant_type"] == "client_credentials"
    assert kwargs["data"]["client_id"] == "cid"
    assert kwargs["data"]["client_secret"] == "sec"
    assert kwargs["data"].get("scope") == "public"
    assert "Authorization" not in kwargs["headers"]


def test_kuveyt_token_detects_live_sandbox_mismatch():
    """invalid_client on LIVE but same secrets work on sandbox → teşhis mesajı."""
    conn = {"provider": "kuveytturk", "mode": "LIVE", "client_id": "cid", "client_secret": "sec"}
    bad = MagicMock()
    bad.status_code = 401
    bad.content = b'{"error":"invalid_client"}'
    bad.text = '{"error":"invalid_client"}'
    bad.headers = {"content-type": "application/json"}
    bad.json.return_value = {"error": "invalid_client"}

    good = MagicMock()
    good.status_code = 200
    good.content = b'{"access_token":"sand-tok"}'
    good.json.return_value = {"access_token": "sand-tok"}
    good.headers = {"content-type": "application/json"}
    good.text = ""

    mock_client = AsyncMock()
    # 1) live body fails → 2) alt host (sandbox) succeeds for diagnosis only (still raise)
    mock_client.post = AsyncMock(side_effect=[bad, good])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._kuveyt_access_token(conn)

    try:
        asyncio.run(_run())
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        msg = str(e)
        assert "invalid_client" in msg
        assert "Teşhis" in msg
        assert "Sandbox" in msg or "prep-identity" in msg
        assert "Mod=live" in msg
        urls = [c.args[0] for c in mock_client.post.await_args_list]
        assert urls[0] == "https://identity.kuveytturk.com.tr/connect/token"
        assert urls[1] == "https://prep-identity.kuveytturk.com.tr/connect/token"
        assert all("Authorization" not in c.kwargs["headers"] for c in mock_client.post.await_args_list)


def test_kuveyt_token_invalid_client_keeps_oauth_error_not_html_404():
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "cc44b566-8006-4712-bf45-1e1b7c64b4da",
        "api_key": "cc44b566-8006-4712-bf45-1e1b7c64b4da",
    }
    bad = MagicMock()
    bad.status_code = 401
    bad.content = b'{"error":"invalid_client"}'
    bad.text = "invalid_client:"
    bad.headers = {"content-type": "application/json"}
    bad.json.return_value = {"error": "invalid_client"}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=bad)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._kuveyt_access_token(conn)

    try:
        asyncio.run(_run())
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        msg = str(e)
        assert "invalid_client" in msg
        assert "/connect/token" in msg
        assert "<!DOCTYPE" not in msg
        assert "Api Anahtarı" in msg or "UUID" in msg or "secret≈uuid" in msg
        assert all(call.args[0].endswith("/connect/token") for call in mock_client.post.await_args_list)
        assert not any(call.args[0].endswith("/api/connect/token") for call in mock_client.post.await_args_list)


def test_kuveyt_token_invalid_client_both_hosts_includes_steps():
    conn = {"provider": "kuveytturk", "mode": "live", "client_id": "cid", "client_secret": "wrong-secret-value"}
    bad = MagicMock()
    bad.status_code = 401
    bad.content = b'{"error":"invalid_client"}'
    bad.text = '{"error":"invalid_client"}'
    bad.headers = {"content-type": "application/json"}
    bad.json.return_value = {"error": "invalid_client"}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=bad)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._kuveyt_access_token(conn)

    try:
        asyncio.run(_run())
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        msg = str(e)
        assert "hem Canlı" in msg and "Sandbox" in msg
        assert "Adımlar:" in msg
        assert "Mod=live" in msg
        assert "prep-identity" in msg or "identity.kuveytturk" in msg


def test_kuveyt_token_invalid_client_message_hints_api_key():
    conn = {"provider": "kuveytturk", "mode": "live", "client_id": "cid", "client_secret": "wrong"}
    bad = MagicMock()
    bad.status_code = 401
    bad.content = b'{"error":"invalid_client"}'
    bad.text = "invalid_client:"
    bad.headers = {"content-type": "application/json"}
    bad.json.return_value = {"error": "invalid_client"}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=bad)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._kuveyt_access_token(conn)

    try:
        asyncio.run(_run())
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        msg = str(e)
        assert "invalid_client" in msg
        assert "Api Anahtarı" in msg or "Client Secret" in msg
        assert "identity.kuveytturk.com.tr" in msg
        assert "/connect/token" in msg


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
    assert get_args[0] == "https://prep-gateway.kuveytturk.com.tr/v1/data/banks"
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
    assert "accounttransactions" not in tx_url
    assert get_calls[1].kwargs["headers"]["Signature"]
    assert get_calls[1].kwargs["headers"]["Authorization"] == "Bearer tokBBB"


def test_fetch_kuveyt_accepts_empty_200_transactions():
    """Tarih aralığında hareket yoksa 200+[] başarıdır; accounttransactions 404’e düşülmez."""
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
        "bank_account_number": "9698082300102",
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tok"}'
    token_resp.json.return_value = {"access_token": "tok"}

    empty_accounts = MagicMock()
    empty_accounts.status_code = 200
    empty_accounts.text = "{}"
    empty_accounts.json.return_value = {}

    empty_tx = MagicMock()
    empty_tx.status_code = 200
    empty_tx.text = '{"transactions":[]}'
    empty_tx.json.return_value = {"transactions": []}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(side_effect=[empty_accounts, empty_tx])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._fetch_kuveyt_transactions(conn, datetime(2026, 9, 1, tzinfo=timezone.utc))

    out = asyncio.run(_run())
    assert out["transactions"] == []
    urls = [c.args[0] for c in mock_client.get.await_args_list]
    assert all("accounttransactions" not in u for u in urls)
