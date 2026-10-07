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
    assert meta["legacy_identity_sandbox_url"] == "https://idprep.kuveytturk.com.tr"
    assert meta["legacy_identity_live_url"] == "https://id.kuveytturk.com.tr"
    assert meta["legacy_token_path"] == "/api/connect/token"
    assert meta["legacy_sandbox_url"] == "https://apitest.kuveytturk.com.tr/prep"
    assert meta["fields"] == ["client_id", "client_secret", "api_key", "private_key"]
    assert "access_token" not in meta["fields"]
    assert "customer_number" not in meta["fields"]
    assert "identity.kuveytturk.com.tr" in meta["hint"]
    assert "gateway.kuveytturk.com.tr" in meta["hint"]
    assert "prep-identity" in meta["hint"]
    assert "prep-gateway" in meta["hint"]
    assert "scope=accounts" in meta["hint"]
    assert "JSEncrypt" in meta["hint"]
    assert "signSha256" in meta["hint"]
    assert "SignatureGenerator2048" in meta["hint"]
    assert "GoLive Talep Yönetimi" in meta["hint"]
    assert "apiekibi@kuveytturk.com.tr" in meta["hint"]
    assert meta["documentation"] == "https://developer.kuveytturk.com.tr/documentation"
    assert meta["signature_tool"] == "https://github.com/KuveytTurk/SignatureGenerator2048"
    assert meta["contact"] == "https://developer.kuveytturk.com.tr/contactus"
    assert meta["jsencrypt_demo"] == "https://travistidwell.com/jsencrypt/demo/"
    assert ".crt" in meta["hint"]
    assert "Signature Invalid" in meta["hint"] or "SHA256RSA" in meta["hint"]
    assert "whitelist" in meta["hint"].lower() or "IP whitelist" in meta["hint"]
    assert "/v1/fx/rates" in meta["hint"]
    assert "/v3/accounts/{ekNo}/transactions" in meta["hint"]
    assert "itemCount" in meta["hint"]
    assert "accountActivities" in meta["hint"]
    assert "getMerchantOrderDetail" in meta["hint"]
    assert "non3DPayment" in meta["hint"]
    assert "/v1/data/banks" not in meta["hint"]


def test_kuveyt_token_urls_sandbox_and_live():
    sand = bp._kuveyt_token_urls({"provider": "kuveytturk", "mode": "sandbox"})
    assert sand[0] == "https://idprep.kuveytturk.com.tr/api/connect/token"
    assert sand[1] == "https://prep-identity.kuveytturk.com.tr/connect/token"
    live = bp._kuveyt_token_urls({"provider": "kuveytturk", "mode": "live"})
    assert live[0] == "https://identity.kuveytturk.com.tr/connect/token"
    assert live[1] == "https://id.kuveytturk.com.tr/api/connect/token"
    custom = bp._kuveyt_token_urls({
        "provider": "kuveytturk", "mode": "live",
        "token_url": "https://prep-identity.kuveytturk.com.tr/connect/token",
    })
    assert custom[0] == "https://prep-identity.kuveytturk.com.tr/connect/token"
    assert custom.count("https://prep-identity.kuveytturk.com.tr/connect/token") == 1
    sdk = bp._kuveyt_normalize_token_url("https://id.kuveytturk.com.tr/connect/token")
    assert sdk == "https://id.kuveytturk.com.tr/api/connect/token"


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


def test_kuveyt_sign_matches_jsencrypt_signSha256_fixture():
    """travist/jsencrypt JSEncrypt.signSha256 golden vector (PKCS1 PEM)."""
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "fixtures/kuveyt/jsencrypt_signSha256.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    pem = data["private_key_pkcs1"]
    assert "BEGIN RSA PRIVATE KEY" in pem
    get = data["get"]
    assert bp._kuveyt_sign(get["token"], pem, query_string=get["query_string"]) == get["signature"]
    post = data["post"]
    assert bp._kuveyt_sign(post["token"], pem, json_body=post["json_body"]) == post["signature"]
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    key.public_key().verify(
        __import__("base64").b64decode(get["signature"]),
        get["payload"].encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )


def test_jsencrypt_bridge_signSha256_is_the_signature():
    """Kuveyt Signature node travist/jsencrypt JSEncrypt.signSha256 ile üretilir."""
    import json
    from pathlib import Path
    from unittest.mock import patch

    path = Path(__file__).resolve().parents[1] / "fixtures/kuveyt/jsencrypt_signSha256.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    pem = data["private_key_pkcs1"]
    get = data["get"]
    direct = bp._jsencrypt_sign_sha256(pem, get["payload"])
    assert direct == get["signature"]
    with patch.object(bp, "_kuveyt_sign_python", side_effect=AssertionError("python yedek kullanılmamalı")):
        assert bp._kuveyt_sign(get["token"], pem, query_string=get["query_string"]) == get["signature"]


def test_frontend_wires_travist_jsencrypt():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    panel = (root / "frontend/src/components/BankConnectionsPanel.jsx").read_text(encoding="utf-8")
    util = (root / "frontend/src/utils/jsencryptKuveyt.js").read_text(encoding="utf-8")
    pkg = (root / "frontend/package.json").read_text(encoding="utf-8")
    assert "github.com/travist/jsencrypt" in panel
    assert "travistidwell.com/jsencrypt/demo" in panel
    assert "KuveytTurk/SignatureGenerator2048" in panel
    assert "generateJsencryptKeyPair" in panel
    assert "conn-jsencrypt-generate-btn" in panel
    assert "API Market" in panel
    assert "GoLive Talep Yönetimi" in panel
    # Golive: 2048-bit RSA; üretim Web Crypto / node-forge (JSEncrypt.signSha256 uyumlu PKCS1).
    assert "KEY_BITS = 2048" in util
    assert "generateJsencryptKeyPair" in util
    assert "BEGIN" in util
    assert "selfSignedCrtFromPrivatePem" in util
    assert "github:travist/jsencrypt" in pkg


def test_kuveyt_sign_pkcs1_jsencrypt_key_format():
    """openssl genrsa / JSEncrypt.getPrivateKey() PKCS1 PEM imzalanır."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    assert "BEGIN RSA PRIVATE KEY" in pem
    token, qs = "tok", "?beginDate=2026-10-06"
    sig = bp._kuveyt_sign(token, pem, query_string=qs)
    key.public_key().verify(
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
    # Golive: Content-Type application/json (GET dahil)
    assert headers["Content-Type"] == "application/json"


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
    """9698082300002 → ek 2 önce; müşteri no path’e girmez. Yalnız V3 suffix path."""
    cands = bp._kuveyt_account_suffix_candidates({
        "bank_account_number": "9698082300002",
        "customer_number": "96980823",
    })
    assert cands[0] == "2"
    assert "96980823" not in cands
    paths = bp._kuveyt_tx_paths({"bank_account_number": "9698082300002"})
    assert paths[0] == "/v3/accounts/2/transactions"
    assert all("/v4/" not in p and "/v1/" not in p for p in paths)
    assert all(p.endswith("/transactions") and "/v3/accounts/" in p for p in paths)
    assert "/v3/accounts/transactions" not in paths
    assert all("accounttransactions" not in p for p in paths)
    assert all("/96980823/" not in p for p in paths)


def test_kuveyt_scope_includes_postman_tx_v4():
    scopes = bp._kuveyt_scope_candidates({})
    assert "public" in scopes
    assert bp._KUVEYT_POSTMAN_TX_SCOPE in scopes
    assert "loans" in bp._KUVEYT_POSTMAN_TX_SCOPE
    assert "accounts" in bp._KUVEYT_POSTMAN_TX_SCOPE


def test_kuveyt_postman_account_transaction_v3_fixture():
    """Yüklenen Postman koleksiyonu token + GET /v3/accounts/*/transactions."""
    import json
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "fixtures/kuveyt/account_transaction_v3.postman_collection.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["info"]["name"] == "1. Account Transaction v3"
    items = {it["name"]: it["request"] for it in data["item"]}
    token = items["Token"]
    assert token["method"] == "POST"
    assert token["url"]["raw"] == "https://prep-identity.kuveytturk.com.tr/connect/token"
    body = {x["key"]: x["value"] for x in token["body"]["urlencoded"]}
    assert body["grant_type"] == "client_credentials"
    assert body["scope"] == bp._KUVEYT_POSTMAN_TX_SCOPE
    tx = items["Account Transaction v3 - v3/accounts/*/transactions"]
    assert tx["method"] == "GET"
    assert tx["url"]["raw"] == "https://prep-gateway.kuveytturk.com.tr/v3/accounts/6/transactions"
    headers = {h["key"]: h["value"] for h in tx["header"]}
    assert headers["Authorization"].startswith("Bearer ")
    assert "Signature" in headers
    qkeys = {q["key"] for q in tx["url"].get("query") or []}
    assert {"beginDate", "endDate", "itemCount"} <= qkeys


def test_kuveyt_tx_query_variants_match_docs_v3():
    since = datetime(2025, 8, 1, tzinfo=timezone.utc)
    end = datetime(2025, 8, 19, tzinfo=timezone.utc)
    variants = bp._kuveyt_tx_query_variants(since, end)
    assert variants[0] == {}
    assert variants[1] == {
        "beginDate": "2025-08-01",
        "endDate": "2025-08-19",
        "itemCount": bp._KUVEYT_TX_ITEM_COUNT,
    }
    assert variants[2] == {"beginDate": "2025-08-01", "endDate": "2025-08-19"}
    assert bp._KUVEYT_TX_ITEM_COUNT != "2"


def test_normalize_kuveyt_account_transactions_v3_envelope():
    """Resmi V3 zarf: value.accountActivities + transactionReference / fxCode / balance."""
    payload = {
        "success": True,
        "value": {
            "executionReferenceId": "ex1",
            "accountActivities": [
                {
                    "suffix": 6,
                    "date": "2025-08-01",
                    "description": "Gelen EFT",
                    "amount": 150.25,
                    "balance": 8800.5,
                    "transactionReference": "KT-REF-1",
                    "businessKey": "BK1",
                    "seqNum": 12,
                    "fxCode": "TRY",
                    "iban": "TR330006200000000000000006",
                }
            ],
        },
    }
    rows = bp._normalize_tx_rows(payload)
    assert len(rows) == 1
    assert rows[0]["external_id"] == "KT-REF-1"
    assert rows[0]["amount"] == 150.25
    assert rows[0]["description"] == "Gelen EFT"
    assert rows[0]["date"] == "2025-08-01"
    assert rows[0]["currency"] == "TRY"
    assert bp._extract_balance(payload) == 8800.5
    assert bp._has_explicit_empty_tx_list({"success": True, "value": {"accountActivities": []}}) is True


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
        assert "public.pem" in str(e) or "pubout" in str(e)


def test_kuveyt_rejects_jsencrypt_default_1024_bit_key():
    """getting-started: JSEncrypt default 1024-bit is demo-only; production min 2048."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    try:
        bp._kuveyt_load_private_key(pem)
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        msg = str(e)
        assert "1024" in msg
        assert "2048" in msg
        assert "openssl genrsa" in msg


def test_kuveyt_load_private_key_missing_pem_fences_hint():
    """JSEncrypt Invalid key = missing BEGIN/END; paste openssl genrsa private.pem fences."""
    try:
        bp._kuveyt_load_private_key("not-a-key")
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        msg = str(e)
        assert "JSEncrypt Invalid key" in msg
        assert "openssl genrsa" in msg
        assert "BEGIN RSA PRIVATE KEY" in msg


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


def test_kuveyt_tx_scope_candidates_prefer_accounts():
    assert bp._kuveyt_tx_scope_candidates({})[0] == "accounts"
    assert bp._kuveyt_scope_candidates({})[0] == "public"
    assert bp._KUVEYT_POSTMAN_TX_SCOPE in bp._kuveyt_tx_scope_candidates({})
    assert bp._KUVEYT_POSTMAN_TX_SCOPE == "public loans accounts transfers cards digital_payments"
    assert "accounts" in bp._kuveyt_tx_scope_candidates({"scope": "custom"})


def test_kuveyt_token_auth_attempts_body_then_basic():
    attempts = bp._kuveyt_token_auth_attempts("cid", "sec", "public")
    assert len(attempts) == 2
    assert attempts[0]["label"] == "body"
    assert "Authorization" not in attempts[0]["headers"]
    assert attempts[0]["data"]["client_id"] == "cid"
    assert attempts[1]["label"] == "basic"
    assert attempts[1]["headers"]["Authorization"].startswith("Basic ")
    sdk = bp._kuveyt_token_auth_attempts(
        "cid", "sec", "public", "https://idprep.kuveytturk.com.tr/api/connect/token"
    )
    assert len(sdk) == 1
    assert sdk[0]["label"] == "body"


def test_kuveyt_token_urls_oidc_connect_token():
    live = bp._kuveyt_token_urls({"provider": "kuveytturk", "mode": "live"})
    assert live == [
        "https://identity.kuveytturk.com.tr/connect/token",
        "https://id.kuveytturk.com.tr/api/connect/token",
    ]
    fixed = bp._kuveyt_token_urls({
        "provider": "kuveytturk", "mode": "live",
        "token_url": "https://identity.kuveytturk.com.tr/api/connect/token",
    })
    assert fixed[0] == "https://identity.kuveytturk.com.tr/connect/token"
    assert "https://id.kuveytturk.com.tr/api/connect/token" in fixed


def test_kuveyt_gateway_urls_include_iuysal_prep_host():
    sand = bp._kuveyt_gateway_urls({"provider": "kuveytturk", "mode": "sandbox"})
    assert sand[0] == "https://prep-gateway.kuveytturk.com.tr"
    assert sand[1] == "https://apitest.kuveytturk.com.tr/prep"
    live = bp._kuveyt_gateway_urls({"provider": "kuveytturk", "mode": "live"})
    assert live[0] == "https://gateway.kuveytturk.com.tr"
    assert live[1] == "https://api.kuveytturk.com.tr"


def test_kuveyt_token_uses_official_sdk_identity_first():
    """iuysal / Android SDK: idprep /api/connect/token önce."""
    conn = {"provider": "kuveytturk", "mode": "sandbox", "client_id": "cid", "client_secret": "sec"}
    good = MagicMock()
    good.status_code = 200
    good.content = b'{"access_token":"sdk-tok"}'
    good.json.return_value = {"access_token": "sdk-tok"}
    good.headers = {"content-type": "application/json"}
    good.text = ""

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=good)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._kuveyt_access_token(conn)

    token = asyncio.run(_run())
    assert token == "sdk-tok"
    urls = [c.args[0] for c in mock_client.post.await_args_list]
    assert urls[0] == "https://idprep.kuveytturk.com.tr/api/connect/token"
    assert mock_client.post.call_count == 1
    assert "Authorization" not in mock_client.post.await_args.kwargs["headers"]
    assert conn["_kuveyt_token_url"] == urls[0]


def test_kuveyt_token_falls_back_to_gravitee_identity():
    """SDK invalid_client → Gravitee prep-identity /connect/token."""
    conn = {"provider": "kuveytturk", "mode": "sandbox", "client_id": "cid", "client_secret": "sec"}
    bad = MagicMock()
    bad.status_code = 401
    bad.content = b'{"error":"invalid_client"}'
    bad.text = '{"error":"invalid_client"}'
    bad.headers = {"content-type": "application/json"}
    bad.json.return_value = {"error": "invalid_client"}
    good = MagicMock()
    good.status_code = 200
    good.content = b'{"access_token":"grav-tok"}'
    good.json.return_value = {"access_token": "grav-tok"}
    good.headers = {"content-type": "application/json"}
    good.text = ""

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=[bad, good])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._kuveyt_access_token(conn)

    token = asyncio.run(_run())
    assert token == "grav-tok"
    urls = [c.args[0] for c in mock_client.post.await_args_list]
    assert urls[0] == "https://idprep.kuveytturk.com.tr/api/connect/token"
    assert urls[1] == "https://prep-identity.kuveytturk.com.tr/connect/token"


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
    mock_client.post = AsyncMock(side_effect=[bad, bad, good])
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
        assert "Sandbox" in msg or "prep-identity" in msg or "idprep" in msg
        assert "Mod=live" in msg
        urls = [c.args[0] for c in mock_client.post.await_args_list]
        assert urls[0] == "https://identity.kuveytturk.com.tr/connect/token"
        assert "https://id.kuveytturk.com.tr/api/connect/token" in urls
        assert any("idprep" in u for u in urls)
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
        assert "/connect/token" in msg or "/api/connect/token" in msg
        assert "<!DOCTYPE" not in msg
        assert "Api Anahtarı" in msg or "UUID" in msg or "secret≈uuid" in msg
        urls = [call.args[0] for call in mock_client.post.await_args_list]
        assert "https://identity.kuveytturk.com.tr/connect/token" in urls
        assert "https://id.kuveytturk.com.tr/api/connect/token" in urls


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
        assert "id.kuveytturk.com.tr" in msg or "identity.kuveytturk.com.tr" in msg
        assert "/connect/token" in msg


def test_kuveyt_probe_signature_invalid_message():
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tokSIG"}'
    token_resp.json.return_value = {"access_token": "tokSIG"}

    fx_resp = MagicMock()
    fx_resp.status_code = 401
    fx_resp.text = '{"error":"Signature Invalid"}'
    fx_resp.json.return_value = {"error": "Signature Invalid"}
    fx_resp.headers = {"content-type": "application/json"}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(return_value=fx_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.test_connection(conn)

    out = asyncio.run(_run())
    assert out["ok"] is False
    msg = out["message"]
    assert "Signature Invalid" in msg
    assert ".crt" in msg or "Public Key" in msg


def test_kuveyt_probe_signs_fx_rates_get():
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "sandbox",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tokAAA"}'
    token_resp.json.return_value = {"access_token": "tokAAA"}

    fx_resp = MagicMock()
    fx_resp.status_code = 200
    fx_resp.text = '{"success":true,"value":[]}'
    fx_resp.json.return_value = {"success": True, "value": []}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(return_value=fx_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.test_connection(conn)

    out = asyncio.run(_run())
    assert out["ok"] is True
    assert out["simulated"] is False
    assert "client_credentials" in out["message"]
    assert "idprep.kuveytturk.com.tr" in (out.get("identity_host") or out["message"])
    get_args, get_kwargs = mock_client.get.await_args
    assert get_args[0] == "https://prep-gateway.kuveytturk.com.tr/v1/fx/rates"
    assert get_kwargs["headers"]["Authorization"] == "Bearer tokAAA"
    assert get_kwargs["headers"]["Signature"]
    assert mock_client.post.call_count >= 1
    posted = [c.args[0] for c in mock_client.post.await_args_list]
    assert all("/v1/vpos/non3DPayment" not in u for u in posted)


def test_fetch_kuveyt_requires_private_key():
    conn = {"provider": "kuveytturk", "client_id": "a", "client_secret": "b", "mode": "live"}

    async def _run():
        return await bp._fetch_kuveyt_transactions(conn, datetime.now(timezone.utc) - timedelta(days=7))

    try:
        asyncio.run(_run())
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        msg = str(e)
        assert "PKCS8" in msg or "private key" in msg.lower() or "PEM" in msg
        assert "openssl genrsa" in msg


def test_fetch_kuveyt_signed_transactions():
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
        "bank_account_number": "6",
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tokBBB"}'
    token_resp.json.return_value = {"access_token": "tokBBB"}

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
    mock_client.cookies = MagicMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(side_effect=[tx_resp])
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
    # Token: hesap hareketi CC scope=accounts önce
    post_kwargs = mock_client.post.await_args.kwargs
    assert post_kwargs["data"].get("scope") == "accounts"
    get_calls = mock_client.get.await_args_list
    tx_url = get_calls[0].args[0]
    assert tx_url == "https://gateway.kuveytturk.com.tr/v3/accounts/6/transactions"
    assert "beginDate=" not in tx_url
    assert all("/v4/" not in c.args[0] for c in get_calls)
    assert all("/v1/accounts" not in c.args[0] for c in get_calls)
    assert get_calls[0].kwargs["headers"]["Signature"]
    assert get_calls[0].kwargs["headers"]["Authorization"] == "Bearer tokBBB"


def test_fetch_kuveyt_invalid_scope_retries_next_tx_scope():
    """Gateway 403 Invalid Scope → kalan CC scope ile yeni token, aynı GET."""
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
        "bank_account_number": "2",
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tokRetry"}'
    token_resp.json.return_value = {"access_token": "tokRetry"}

    denied = MagicMock()
    denied.status_code = 403
    denied.text = '{"message":"Invalid Scope","code":403}'
    denied.json.return_value = {"message": "Invalid Scope", "code": 403}

    ok = MagicMock()
    ok.status_code = 200
    ok.text = '{"transactions":[{"transactionId":"R1","amount":10,"direction":"credit","description":"Gelen","transactionDate":"2026-10-01"}]}'
    ok.json.return_value = {
        "transactions": [
            {"transactionId": "R1", "amount": 10, "direction": "credit",
             "description": "Gelen", "transactionDate": "2026-10-01"},
        ],
    }

    mock_client = AsyncMock()
    mock_client.cookies = MagicMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(side_effect=[denied, ok])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._fetch_kuveyt_transactions(conn, datetime(2026, 9, 1, tzinfo=timezone.utc))

    out = asyncio.run(_run())
    assert out["transactions"][0]["external_id"] == "R1"
    scopes = [c.kwargs["data"].get("scope") for c in mock_client.post.await_args_list]
    assert scopes[0] == "accounts"
    assert "accounts" in scopes
    assert mock_client.post.call_count >= 2
    urls = [c.args[0] for c in mock_client.get.await_args_list]
    assert urls[0] == "https://gateway.kuveytturk.com.tr/v3/accounts/2/transactions"
    assert all("/v3/accounts/2/transactions" in u for u in urls)


def test_jwt_scope_claim_reads_unverified_payload():
    payload = __import__("base64").urlsafe_b64encode(
        b'{"scope":"public accounts","exp":9999999999}'
    ).decode().rstrip("=")
    tok = f"e30.{payload}.sig"
    assert bp._jwt_scope_claim(tok) == "public accounts"
    denied = MagicMock()
    denied.status_code = 403
    denied.text = "Invalid Scope"
    denied.json.side_effect = ValueError("not json")
    assert bp._kuveyt_is_invalid_scope(denied) is True


def test_fetch_kuveyt_parses_official_v3_account_activities():
    """Doküman zarfı: GET 200 + value.accountActivities."""
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
        "bank_account_number": "6",
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tokV3"}'
    token_resp.json.return_value = {"access_token": "tokV3"}
    payload = {
        "success": True,
        "value": {
            "executionReferenceId": "ex1",
            "accountActivities": [
                {
                    "suffix": 6,
                    "date": "2025-08-01",
                    "description": "Havale",
                    "amount": -40.0,
                    "balance": 1200.0,
                    "transactionReference": "V3-1",
                    "fxCode": "TRY",
                }
            ],
        },
    }
    tx_resp = MagicMock()
    tx_resp.status_code = 200
    tx_resp.text = '{"success":true}'
    tx_resp.json.return_value = payload

    mock_client = AsyncMock()
    mock_client.cookies = MagicMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(return_value=tx_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._fetch_kuveyt_transactions(conn, datetime(2025, 8, 1, tzinfo=timezone.utc))

    out = asyncio.run(_run())
    assert out["transactions"][0]["external_id"] == "V3-1"
    assert out["transactions"][0]["amount"] == 40.0
    assert out["transactions"][0]["direction"] == "debit"
    assert out["balance"] == 1200.0
    assert "/v1/vpos/non3DPayment" not in "".join(c.args[0] for c in mock_client.post.await_args_list)


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

    empty_tx = MagicMock()
    empty_tx.status_code = 200
    empty_tx.text = '{"transactions":[]}'
    empty_tx.json.return_value = {"transactions": []}

    mock_client = AsyncMock()
    mock_client.cookies = MagicMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(return_value=empty_tx)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._fetch_kuveyt_transactions(conn, datetime(2026, 9, 1, tzinfo=timezone.utc))

    out = asyncio.run(_run())
    assert out["transactions"] == []
    urls = [c.args[0] for c in mock_client.get.await_args_list]
    assert all("accounttransactions" not in u for u in urls)
    assert any("/v3/accounts/" in u and "/transactions" in u for u in urls)
    assert all("/v4/" not in u and "/v1/data/banks" not in u for u in urls)
    assert all("/v1/accounts/" not in u for u in urls)
    posted = [c.args[0] for c in mock_client.post.await_args_list]
    assert all("/v1/vpos/non3DPayment" not in u for u in posted)


def test_parse_kuveyt_fx_payload_codes_and_jpy_unit():
    data = {
        "success": True,
        "value": [
            {"name": "ABD DOLARI", "fxCode": "USD", "buyRate": 41.1, "sellRate": 41.4},
            {"name": "EURO", "fxCode": "EUR/TRY", "buyRate": 48.0, "sellRate": 48.5},
            {"name": "JAPON YENI", "fxCode": "JPY", "buyRate": 22.0, "sellRate": 23.0},
            {"name": "ALTIN", "fxCode": "XAU", "buyRate": 4300, "sellRate": 4320},
        ],
    }
    rates = bp.parse_kuveyt_fx_payload(data)
    assert set(rates) == {"USD", "EUR", "JPY"}
    assert rates["USD"]["rate"] == 41.4
    assert rates["USD"]["buying"] == 41.1
    assert abs(rates["JPY"]["rate"] - 0.23) < 1e-9
    assert rates["JPY"]["unit"] == 100.0


def test_parse_kuveyt_fx_payload_success_false():
    try:
        bp.parse_kuveyt_fx_payload({"success": False, "message": "product not subscribed"})
        assert False, "expected ValueError"
    except ValueError as e:
        assert "product not subscribed" in str(e)


def test_kuveyt_non3d_payment_requires_confirm_charge():
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
    }
    mock_client = AsyncMock()
    mock_client.post = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.kuveyt_non3d_payment(conn, {"merchantId": 1, "amount": "100"})

    try:
        asyncio.run(_run())
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        assert "confirm_charge" in str(e)
        assert "non3DPayment" in str(e)
    mock_client.post.assert_not_called()


def test_kuveyt_merchant_order_detail_posts_once():
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "sandbox",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tokORD"}'
    token_resp.json.return_value = {"access_token": "tokORD"}

    order_resp = MagicMock()
    order_resp.status_code = 200
    order_resp.text = '{"success":true,"value":{"OrderId":"9"}}'
    order_resp.json.return_value = {"success": True, "value": {"OrderId": "9"}}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=[token_resp, order_resp])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.kuveyt_get_merchant_order_detail(conn, {
                "merchantId": 123, "customerId": 1, "userName": "api",
                "hashData": "abc", "startDate": "01.10.2026", "endDate": "06.10.2026",
            })

    out = asyncio.run(_run())
    assert out["value"]["OrderId"] == "9"
    vpos_posts = [c for c in mock_client.post.await_args_list if "/v1/vpos/getMerchantOrderDetail" in (c.args[0] if c.args else "")]
    assert len(vpos_posts) == 1
    assert vpos_posts[0].args[0].endswith("/v1/vpos/getMerchantOrderDetail")
    assert vpos_posts[0].kwargs["headers"]["Signature"]
    assert vpos_posts[0].kwargs["headers"]["Content-Type"] == "application/json"
    body = vpos_posts[0].kwargs["content"].decode("utf-8")
    assert '"merchantId":123' in body
    assert "non3DPayment" not in body


def test_fetch_kuveyt_fx_rates_signed_get():
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tokFX"}'
    token_resp.json.return_value = {"access_token": "tokFX"}

    fx_resp = MagicMock()
    fx_resp.status_code = 200
    fx_resp.text = '{"success":true}'
    fx_resp.json.return_value = {
        "success": True,
        "value": [{"name": "USD", "fxCode": "USD", "buyRate": 40.0, "sellRate": 40.5}],
    }

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(return_value=fx_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.fetch_kuveyt_fx_rates(conn)

    iso, rates, url = asyncio.run(_run())
    assert rates["USD"]["rate"] == 40.5
    assert url.endswith("/v1/fx/rates")
    assert mock_client.get.await_args.args[0] == "https://gateway.kuveytturk.com.tr/v1/fx/rates"
    assert mock_client.get.await_args.kwargs["headers"]["Signature"]
    posted = [c.args[0] for c in mock_client.post.await_args_list]
    assert all("/v1/vpos/non3DPayment" not in u for u in posted)


def test_fetch_kuveyt_requires_suffix_path():
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
    }

    async def _run():
        return await bp._fetch_kuveyt_transactions(conn, datetime.now(timezone.utc) - timedelta(days=1))

    async def _no_token(_conn):
        raise AssertionError("token must not run without ek no")

    with patch.object(bp, "_kuveyt_account_bearer", side_effect=_no_token):
        try:
            asyncio.run(_run())
            assert False, "expected RuntimeError"
        except RuntimeError as e:
            assert "ek no" in str(e).lower() or "/v3/accounts" in str(e)


def test_kuveyt_probe_success_false_is_not_ok():
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "sandbox",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tok"}'
    token_resp.json.return_value = {"access_token": "tok"}
    fx_resp = MagicMock()
    fx_resp.status_code = 200
    fx_resp.text = '{"success":false,"message":"product not subscribed"}'
    fx_resp.json.return_value = {"success": False, "message": "product not subscribed"}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(return_value=fx_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.test_connection(conn)

    out = asyncio.run(_run())
    assert out["ok"] is False
    assert "product not subscribed" in out["message"]


def test_fetch_kuveyt_dated_query_after_empty_no_query():
    """Resmi SDK: no-query boşsa beginDate/endDate dener."""
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "live",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
        "bank_account_number": "6",
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tok"}'
    token_resp.json.return_value = {"access_token": "tok"}
    empty = MagicMock()
    empty.status_code = 200
    empty.text = '{"transactions":[]}'
    empty.json.return_value = {"transactions": []}
    filled = MagicMock()
    filled.status_code = 200
    filled.text = '{"transactions":[{"transactionId":"D1","amount":9,"direction":"credit","description":"Gelen","transactionDate":"2026-09-10"}]}'
    filled.json.return_value = {
        "transactions": [
            {"transactionId": "D1", "amount": 9, "direction": "credit",
             "description": "Gelen", "transactionDate": "2026-09-10"},
        ],
    }

    mock_client = AsyncMock()
    mock_client.cookies = MagicMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(side_effect=[empty, filled])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._fetch_kuveyt_transactions(conn, datetime(2026, 9, 1, tzinfo=timezone.utc))

    out = asyncio.run(_run())
    assert out["transactions"][0]["external_id"] == "D1"
    urls = [c.args[0] for c in mock_client.get.await_args_list]
    assert "beginDate=" not in urls[0]
    assert "beginDate=" in urls[1]
    assert "itemCount=" in urls[1]


def test_apply_linked_account_number_kuveyt_uses_ek_no():
    acc = {"iban": "TR330006200000000000000006", "account_number": "9698082300006"}
    out = bp.apply_linked_account_number({"provider": "kuveytturk"}, acc)
    assert out["bank_account_number"]
    keep = bp.apply_linked_account_number(
        {"provider": "kuveytturk", "bank_account_number": "6"},
        acc,
    )
    assert keep["bank_account_number"] == "6"
    dash = bp.apply_linked_account_number(
        {"provider": "kuveytturk", "bank_account_number": "-"},
        {"account_number": "2"},
    )
    assert dash["bank_account_number"] == "2"


def test_err_text_read_timeout_includes_url():
    req = httpx.Request("GET", "https://prep-gateway.kuveytturk.com.tr/v1/fx/rates")
    exc = httpx.ReadTimeout("timed out", request=req)
    text = bp._err_text(exc)
    assert "ReadTimeout" in text
    assert "prep-gateway.kuveytturk.com.tr" in text
    assert "/v1/fx/rates" in text
    bare = httpx.ReadTimeout("timed out")
    assert "ReadTimeout" in bp._err_text(bare)
    assert bp._err_text(bare) != ""  # never empty class-only surprise for UI


def test_kuveyt_timeouts_are_generous():
    assert float(bp._KUVEYT_TOKEN_TIMEOUT.read) >= 40
    assert float(bp._KUVEYT_GATEWAY_TIMEOUT.read) >= 35
    assert float(bp._KUVEYT_TOKEN_TIMEOUT.connect) >= 10


def test_kuveyt_probe_fx_read_timeout_names_host():
    """GET /v1/fx/rates ReadTimeout must not surface as bare 'Bağlantı kurulamadı: ReadTimeout'."""
    pem = _rsa_pem()
    conn = {
        "provider": "kuveytturk", "mode": "sandbox",
        "client_id": "cid", "client_secret": "sec", "private_key": pem,
    }
    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.content = b'{"access_token":"tokTO"}'
    token_resp.json.return_value = {"access_token": "tokTO"}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=token_resp)

    async def _get(url, **kwargs):
        req = httpx.Request("GET", url)
        raise httpx.ReadTimeout("timed out", request=req)

    mock_client.get = AsyncMock(side_effect=_get)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp.test_connection(conn)

    out = asyncio.run(_run())
    assert out["ok"] is False
    msg = out["message"]
    assert "ReadTimeout" in msg or "zaman aşımı" in msg.lower() or "süresi aşıldı" in msg
    assert "prep-gateway.kuveytturk.com.tr" in msg
    assert "/v1/fx/rates" in msg
    # bare class-name-only message is the bug we fix
    assert msg.strip() != "Bağlantı kurulamadı: ReadTimeout"
    assert "whitelist" in msg.lower() or "Denenen" in msg


def test_kuveyt_token_timeout_retries_once():
    conn = {
        "provider": "kuveytturk", "mode": "sandbox",
        "client_id": "cid", "client_secret": "sec",
    }
    ok = MagicMock()
    ok.status_code = 200
    ok.content = b'{"access_token":"after-retry"}'
    ok.json.return_value = {"access_token": "after-retry"}

    calls = {"n": 0}

    async def _post(url, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ReadTimeout("timed out", request=httpx.Request("POST", url))
        return ok

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=_post)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def _run():
        with patch.object(httpx, "AsyncClient", return_value=mock_client):
            return await bp._kuveyt_access_token(conn)

    tok = asyncio.run(_run())
    assert tok == "after-retry"
    assert calls["n"] >= 2

