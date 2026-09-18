
"""Banka açık bankacılık sağlayıcıları.

Enpara (api.enpara.com) QNB'den ayrı bir bankadır; QNB Open Banking ayrı kayıttır.
"""
from __future__ import annotations

import base64
import hashlib
import json
import random
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx

PROVIDERS = {
    "kuveytturk": {
        "name": "Kuveyt Türk API Market",
        "sandbox_url": "https://apitest.kuveytturk.com.tr/prep",
        "live_url": "https://api.kuveytturk.com.tr",
        "identity_sandbox_url": "https://idprep.kuveytturk.com.tr",
        "identity_live_url": "https://id.kuveytturk.com.tr",
        "token_path": "/api/connect/token",
        "docs": "https://developer.kuveytturk.com.tr/",
        "fields": ["client_id", "client_secret", "private_key", "customer_number"],
        "hint": "API Market: Identity Server client_credentials (sandbox idprep / canlı id.kuveytturk.com.tr → /api/connect/token). Her API isteği RSA-SHA256 Signature ister — PKCS8 PEM private key yapıştırın. Sandbox API: apitest.kuveytturk.com.tr/prep",
    },
    "enpara": {
        "name": "Enpara Şirketim API",
        "sandbox_url": "https://api.enpara.com",
        "live_url": "https://api.enpara.com",
        "token_path": "/securedomain/oauth/token",
        "docs": "https://developer.qnb.com.tr/",  # portal Enpara ürününü de listeler; API host api.enpara.com
        "fields": ["access_token", "refresh_token", "client_id", "client_secret", "customer_number"],
        "hint": "Hesap Hareketleri: POST /v1/account-statement JSON (startDateTime, endDateTime; iban/accountNo opsiyonel). /list POST JSON. Ticket GET /v1/account-statement/ticket?ticketNo= (405 ise POST {ticketNo}). Access Token, Refresh Token ve Client ID yalnızca sunucuda saklanır; Enpara istekleri tarayıcıdan gitmez. Client Secret opsiyonel (yenileme). IBAN 26 hane. Production IP 85.95.240.136 whitelist’te olmalı (401 access_denied sıkça IP; 405 METHOD NOT ALLOWED IP değildir).",
    },
    "qnb": {
        "name": "QNB Open Banking",
        "sandbox_url": "https://sandbox-api.qnb.com.tr",
        "live_url": "https://api.qnb.com.tr",
        "token_path": "/oauth2/token",
        "docs": "https://developer.qnb.com.tr/",
        "fields": ["client_id", "client_secret", "customer_number"],
        "hint": "QNB (eski Finansbank) açık bankacılık. Enpara için 'Enpara Şirketim API' sağlayıcısını seçin.",
    },
    "finfree": {
        "name": "Finfree / Fintech Hub (BKM Açık Bankacılık)",
        "sandbox_url": "https://sandbox.finfree.com.tr",
        "live_url": "https://api.finfree.com.tr",
        "token_path": "/oauth/token",
        "docs": "https://finfree.com.tr/",
        "fields": ["api_key", "client_id", "client_secret"],
    },
    "other": {
        "name": "Diğer Banka (Genel OAuth2)",
        "sandbox_url": "",
        "live_url": "",
        "token_path": "/oauth/token",
        "docs": "",
        "fields": ["client_id", "client_secret", "base_url"],
    },
}

CONNECTION_SECRET_KEYS = (
    "client_id",
    "client_secret",
    "api_key",
    "access_token",
    "refresh_token",
    "private_key",
)


def is_masked_secret(value: Any) -> bool:
    return str(value or "").startswith("••••")


def _plain_secret(conn: dict, key: str) -> str:
    val = str(conn.get(key) or "").strip()
    if not val or is_masked_secret(val):
        return ""
    return val


def mask_secret_value(val: str) -> str:
    val = str(val or "")
    if not val:
        return val
    if "BEGIN" in val:
        body = "".join(
            val.replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replace("-----BEGIN RSA PRIVATE KEY-----", "")
            .replace("-----END RSA PRIVATE KEY-----", "")
            .split()
        )
        return "••••" + (body[-4:] if body else "")
    return "••••" + val[-4:]


def mask_connection_secrets(doc: dict) -> dict:
    """API yanıtı için sırları maskele; Client ID Enpara'da da sırdır."""
    out = dict(doc or {})
    for key in CONNECTION_SECRET_KEYS:
        raw = out.get(key)
        if raw:
            out[key] = mask_secret_value(str(raw))
    return out


def drop_masked_secrets(payload: dict) -> dict:
    """PUT gövdesinde maskeli yer tutucuyu gerçek sırın üzerine yazma."""
    out = dict(payload or {})
    for key in CONNECTION_SECRET_KEYS:
        if key in out and is_masked_secret(out.get(key)):
            out.pop(key)
    return out


def public_test_result(test: dict) -> dict:
    """Test/probe yanıtından token önizlemesi ve sır alanlarını çıkar."""
    allowed = ("ok", "simulated", "message")
    return {k: test[k] for k in allowed if k in (test or {})}


SIM_COUNTERPARTIES = [
    ("Trendyol Pazaryeri Ödemesi", "credit", "Trendyol"),
    ("Hepsiburada Hakediş", "credit", "Hepsiburada"),
    ("Mega Bilişim Ltd. Şti. Havale", "credit", "Mega Bilişim"),
    ("Anadolu Elektronik Tedarik EFT", "debit", "Anadolu Elektronik"),
    ("Yurtiçi Kargo Fatura Ödemesi", "debit", "Yurtiçi Kargo"),
    ("SGK Prim Ödemesi", "debit", "SGK"),
    ("Kira Ödemesi - Ofis", "debit", "Ofis Kira"),
    ("POS Blokeli Hesap Çözülmesi", "credit", "POS"),
    ("Elektrik Faturası - CK Enerji", "debit", "CK Enerji"),
    ("Yıldız Teknoloji A.Ş. Fatura Tahsilatı", "credit", "Yıldız Teknoloji"),
]


def _base_url(conn: dict) -> str:
    meta = PROVIDERS.get(conn.get("provider"), PROVIDERS["other"])
    if conn.get("base_url"):
        return conn["base_url"].rstrip("/")
    return (meta["live_url"] if conn.get("mode") == "live" else meta["sandbox_url"]).rstrip("/")


def has_credentials(conn: dict) -> bool:
    if conn.get("provider") == "enpara":
        return bool(
            _plain_secret(conn, "access_token")
            or (_plain_secret(conn, "client_id") and _plain_secret(conn, "client_secret"))
            or _plain_secret(conn, "refresh_token")
        )
    if conn.get("provider") == "kuveytturk":
        return bool(_plain_secret(conn, "client_id") and _plain_secret(conn, "client_secret"))
    return bool(_plain_secret(conn, "client_id") and _plain_secret(conn, "client_secret"))


def _err_text(exc: BaseException) -> str:
    msg = str(exc).strip()
    return msg or exc.__class__.__name__


def _basic_auth_header(client_id: str, client_secret: str) -> str:
    raw = f"{client_id}:{client_secret}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


async def _oauth_token(conn: dict) -> str:
    meta = PROVIDERS.get(conn.get("provider"), PROVIDERS["other"])
    url = _base_url(conn) + meta["token_path"]
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(url, data={
            "grant_type": "client_credentials",
            "client_id": _plain_secret(conn, "client_id"),
            "client_secret": _plain_secret(conn, "client_secret"),
            "scope": conn.get("scope") or "accounts transactions",
        })
        resp.raise_for_status()
        data = resp.json()
        token = data.get("access_token") or data.get("accessToken")
        if not token:
            raise RuntimeError("Token yanıtında access_token yok.")
        return token


def _kuveyt_identity_host(conn: dict) -> str:
    meta = PROVIDERS["kuveytturk"]
    live = conn.get("mode") == "live"
    return (meta["identity_live_url"] if live else meta["identity_sandbox_url"]).rstrip("/")


def _kuveyt_token_urls(conn: dict) -> List[str]:
    """Identity Server: POST {idhost}/api/connect/token — not api.kuveytturk.com.tr/oauth/token."""
    urls: List[str] = []
    custom = (conn.get("token_url") or "").strip().rstrip("/")
    if custom:
        urls.append(custom)
        if not custom.endswith("/token"):
            urls.append(custom + "/api/connect/token")
    host = _kuveyt_identity_host(conn)
    urls.append(host + "/api/connect/token")
    seen = set()
    out = []
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def _kuveyt_normalize_pem(raw: str) -> str:
    s = (raw or "").strip().replace("\r\n", "\n")
    if "BEGIN" in s:
        return s
    body = "".join(s.split())
    if not body:
        return ""
    wrapped = "\n".join(body[i:i + 64] for i in range(0, len(body), 64))
    return f"-----BEGIN PRIVATE KEY-----\n{wrapped}\n-----END PRIVATE KEY-----"


def _kuveyt_private_key_pem(conn: dict) -> str:
    """PKCS8 (BEGIN PRIVATE KEY) or PKCS1 (BEGIN RSA PRIVATE KEY). api_key only if it looks like PEM."""
    for key in ("private_key", "api_key"):
        raw = _plain_secret(conn, key)
        if not raw:
            continue
        if key == "api_key" and "BEGIN" not in raw and "MII" not in raw:
            continue
        pem = _kuveyt_normalize_pem(raw)
        if pem:
            return pem
    return ""


def _kuveyt_load_private_key(pem: str):
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    try:
        return load_pem_private_key(pem.encode("utf-8"), password=None)
    except Exception as e:
        raise RuntimeError(
            "Kuveyt Türk RSA özel anahtarı okunamadı. PKCS8 PEM "
            "(-----BEGIN PRIVATE KEY-----) beklenir. "
            f"{_err_text(e)}"
        ) from e


def _kuveyt_query_string(params: Optional[Dict[str, Any]]) -> str:
    """Official SignatureGenerator: ?k=v&k2=v2 in given order, values as-is (not URL-encoded)."""
    if not params:
        return ""
    parts = []
    for k, v in params.items():
        if v is None or v == "":
            continue
        parts.append(f"{k}={v}")
    if not parts:
        return ""
    return "?" + "&".join(parts)


def _kuveyt_sign(access_token: str, pem: str, *, query_string: str = "", json_body: str = "") -> str:
    """SHA256withRSA over UTF-8 payload, Base64. GET: token.trim()+query; POST: token+jsonBody."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    if json_body:
        payload = (access_token or "") + json_body
    else:
        payload = (access_token or "").strip() + (query_string or "")
    key = _kuveyt_load_private_key(pem)
    sig = key.sign(payload.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(sig).decode("ascii")


def _kuveyt_headers(
    token: str,
    conn: dict,
    *,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[str] = None,
) -> Dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "LanguageId": "1",
    }
    pem = _kuveyt_private_key_pem(conn)
    if pem:
        if json_body is not None:
            headers["Signature"] = _kuveyt_sign(token, pem, json_body=json_body)
            headers["Content-Type"] = "application/json"
        else:
            headers["Signature"] = _kuveyt_sign(token, pem, query_string=_kuveyt_query_string(params))
    elif json_body is not None:
        headers["Content-Type"] = "application/json"
    return headers


async def _kuveyt_access_token(conn: dict) -> str:
    client_id = _plain_secret(conn, "client_id")
    client_secret = _plain_secret(conn, "client_secret")
    if not client_id or not client_secret:
        raise RuntimeError("Kuveyt Türk Client ID / Client Secret gerekli (client_credentials).")

    scopes: List[str] = []
    custom_scope = (conn.get("scope") or "").strip()
    if custom_scope:
        scopes.append(custom_scope)
    for s in ("public", "public accounts", ""):
        if s not in scopes:
            scopes.append(s)

    last_err = "Token uç noktası yanıt vermedi."
    async with httpx.AsyncClient(timeout=20) as client:
        for url in _kuveyt_token_urls(conn):
            for scope in scopes:
                form = {
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                }
                if scope:
                    form["scope"] = scope
                try:
                    resp = await client.post(
                        url,
                        data=form,
                        headers={
                            "Content-Type": "application/x-www-form-urlencoded",
                            "Accept": "application/json",
                        },
                    )
                    if resp.status_code < 400:
                        data = resp.json() if resp.content else {}
                        token = (data or {}).get("access_token") or (data or {}).get("accessToken")
                        if token:
                            return token
                        last_err = f"{url} → access_token yok"
                        continue
                    last_err = _oauth_error_text(resp, url)
                    blob = (getattr(resp, "text", None) or "").lower()
                    if resp.status_code in (400, 401) and "scope" in blob:
                        continue
                except Exception as e:
                    last_err = f"{url} → {_err_text(e)}"
    raise RuntimeError(
        "Kuveyt Türk token alınamadı (Identity Server client_credentials). "
        "Client ID/Secret ve ortamı kontrol edin "
        f"(sandbox: idprep.kuveytturk.com.tr / canlı: id.kuveytturk.com.tr). ({last_err[:180]})"
    )


async def _kuveyt_probe(conn: dict) -> Dict[str, Any]:
    token = await _kuveyt_access_token(conn)
    pem = _kuveyt_private_key_pem(conn)
    extra = " RSA-SHA256 imza anahtarı yok — hesap hareketi için PKCS8 PEM gerekli."
    if pem:
        base = _base_url(conn)
        headers = _kuveyt_headers(token, conn)
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(f"{base}/v1/data/banks", headers=headers)
            if resp.status_code in (401, 403):
                detail = _api_error_detail(resp)
                blob = f"{detail} {getattr(resp, 'text', '') or ''}".lower()
                if "sign" in blob or "imza" in blob or resp.status_code == 401:
                    raise RuntimeError(
                        f"Kuveyt Türk imza/yetki hatası (HTTP {resp.status_code}). "
                        "PKCS8 PEM private key ve Signature başlığını kontrol edin. "
                        f"{detail[:160]}"
                    )
            extra = " RSA-SHA256 Signature doğrulandı." if resp.status_code < 400 else ""
    return {
        "ok": True,
        "simulated": False,
        "message": f"Kuveyt Türk Identity Server client_credentials doğrulandı.{extra}",
    }


def _kuveyt_account_suffix(conn: dict) -> str:
    raw = (conn.get("bank_account_number") or "").strip().replace(" ", "").upper()
    if not raw or raw == "-":
        return ""
    if raw.startswith("TR") and len(raw) >= 16:
        acct = raw[10:]
        return acct.lstrip("0") or acct
    return raw


def _enpara_dead_route(resp) -> bool:
    text = getattr(resp, "text", None) or ""
    code = getattr(resp, "status_code", 0) or 0
    return "404-EPG96" in text or "404-QPG97" in text or code == 404


def _jwt_expired(token: str, *, skew_sec: int = 30) -> Optional[bool]:
    """True=süresi dolmuş, False=geçerli, None=JWT değil / exp yok."""
    raw = (token or "").strip()
    parts = raw.split(".")
    if len(parts) != 3:
        return None
    try:
        pad = "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + pad))
        exp = payload.get("exp")
        if exp is None:
            return None
        now = datetime.now(timezone.utc).timestamp()
        return int(exp) <= now + skew_sec
    except Exception:
        return None


def _enpara_auth_blob(resp) -> str:
    return f"{getattr(resp, 'text', '') or ''} {_api_error_detail(resp)}".lower()


def _enpara_method_not_allowed(resp) -> bool:
    if getattr(resp, "status_code", 0) != 405:
        return False
    blob = _enpara_auth_blob(resp)
    return "method not allowed" in blob or "405" in blob


def _enpara_ip_blocked(resp) -> bool:
    """Gerçek IP filtresi. 'METHOD NOT ALLOWED' içindeki 'not allowed' IP değildir."""
    if getattr(resp, "status_code", 0) not in (401, 403):
        return False
    blob = _enpara_auth_blob(resp)
    if "method not allowed" in blob:
        return False
    return any(
        x in blob
        for x in ("your ip", "ip is not", "ip not allowed", "whitelist", "not permitted", "ip filtering")
    )


def _enpara_access_denied(resp) -> bool:
    if getattr(resp, "status_code", 0) not in (401, 403):
        return False
    blob = _enpara_auth_blob(resp)
    return "access_denied" in blob or "unauthorized" in blob


def _enpara_token_urls(conn: dict) -> List[str]:
    """Gravitee AM: POST /securedomain/oauth/token (api.enpara.com kök oauth2/* 404-EPG96)."""
    urls: List[str] = []
    custom = (conn.get("token_url") or "").strip().rstrip("/")
    if custom:
        urls.append(custom)
    base = _base_url(conn) or "https://api.enpara.com"
    for path in (
        "/securedomain/oauth/token",
        "/securedomain/oidc/token",
        "/oauth2/token",
        "/oauth/token",
    ):
        urls.append(base + path)
    seen = set()
    out = []
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def _oauth_error_text(resp, url: str) -> str:
    try:
        data = resp.json()
    except Exception:
        data = None
    if isinstance(data, dict) and (data.get("error") or data.get("error_description")):
        err = data.get("error") or ""
        desc = data.get("error_description") or data.get("message") or ""
        return f"{url} → {err}: {desc}".strip()
    return f"{url} → HTTP {resp.status_code}: {(getattr(resp, 'text', None) or '')[:120]}"


async def _enpara_refresh_access_token(conn: dict) -> str:
    """Refresh Token (portal) veya client_credentials → Gravitee AM /securedomain/oauth/token."""
    client_id = _plain_secret(conn, "client_id")
    client_secret = _plain_secret(conn, "client_secret")
    refresh = _plain_secret(conn, "refresh_token")
    if not client_id:
        raise RuntimeError("Enpara Client ID gerekli (token yenileme). Portalden Access Token yapıştırın.")
    if not refresh and not client_secret:
        raise RuntimeError(
            "Enpara token yenilemek için Refresh Token veya Client Secret gerekli. "
            "Portalden Access Token + Refresh Token yapıştırın."
        )

    last_err = "Token uç noktası yanıt vermedi."
    async with httpx.AsyncClient(timeout=20) as client:
        for url in _enpara_token_urls(conn):
            forms = []
            if refresh:
                forms.append({"grant_type": "refresh_token", "refresh_token": refresh})
            if client_secret:
                forms.append({"grant_type": "client_credentials"})
            hit_real_am = False
            for form in forms:
                try:
                    headers = {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                    }
                    body = {**form, "client_id": client_id}
                    if client_secret:
                        headers["Authorization"] = _basic_auth_header(client_id, client_secret)
                        body["client_secret"] = client_secret
                    resp = await client.post(url, data=body, headers=headers)
                    if _enpara_dead_route(resp):
                        last_err = f"{url} → yok (404-EPG96)"
                        break
                    if resp.status_code >= 400 and client_secret:
                        resp = await client.post(
                            url,
                            data=body,
                            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
                        )
                        if _enpara_dead_route(resp):
                            last_err = f"{url} → yok (404-EPG96)"
                            break
                    hit_real_am = True
                    if resp.status_code < 400:
                        data = resp.json() if resp.content else {}
                        token = (data or {}).get("access_token") or (data or {}).get("accessToken")
                        if token:
                            conn["access_token"] = str(token)
                            new_rt = (data or {}).get("refresh_token") or (data or {}).get("refreshToken")
                            if new_rt:
                                conn["refresh_token"] = str(new_rt)
                            return str(token)
                        last_err = f"{url} → access_token yok"
                        continue
                    last_err = _oauth_error_text(resp, url)
                except Exception as e:
                    last_err = f"{url} → {_err_text(e)}"
                    continue
            if hit_real_am:
                break
    raise RuntimeError(
        "Enpara token alınamadı. Developer portalından Access Token + Refresh Token yapıştırın "
        f"(token URL: /securedomain/oauth/token). ({last_err[:180]})"
    )


def _enpara_can_refresh(conn: dict) -> bool:
    if not _plain_secret(conn, "client_id"):
        return False
    if _plain_secret(conn, "refresh_token"):
        return True
    return bool(_plain_secret(conn, "client_secret"))


def _enpara_should_refresh_on_auth_error(resp, token: str) -> bool:
    """401/403 sonrası client_credentials yenilemesi.

    Hâlâ geçerli JWT veya Gravitee access_denied/IP = portal token'ı ezme.
    """
    if getattr(resp, "status_code", 0) not in (401, 403):
        return False
    if _enpara_ip_blocked(resp):
        return False
    expired = _jwt_expired(token)
    if expired is False:
        return False
    if _enpara_access_denied(resp) and expired is not True:
        return False
    return True


async def _enpara_access_token(conn: dict) -> str:
    stored = _plain_secret(conn, "access_token")
    if stored:
        expired = _jwt_expired(stored)
        if expired is True:
            if _enpara_can_refresh(conn):
                return await _enpara_refresh_access_token(conn)
            raise RuntimeError(
                "Enpara Access Token süresi dolmuş. Developer portalından yeni Access Token yapıştırın."
            )
        return stored
    return await _enpara_refresh_access_token(conn)


def _is_simulated(conn: dict) -> bool:
    return conn.get("mode") == "simulation" or not has_credentials(conn)


async def _enpara_probe(conn: dict) -> Dict[str, Any]:
    """Kısa pencereli POST /v1/account-statement JSON — GET /list production’da 405."""
    token = await _enpara_access_token(conn)
    base = _base_url(conn) or "https://api.enpara.com"
    headers = _enpara_headers(token, conn, for_get=False)
    end = datetime.now(timezone.utc)
    since = end - timedelta(days=1)
    account = _enpara_account_ref(conn)
    customer = (conn.get("customer_number") or "").strip()
    payloads = _enpara_payload_variants(since, end, account, customer)
    body = payloads[0] if payloads else {
        "startDateTime": since.strftime("%Y-%m-%dT00:00:00"),
        "endDateTime": end.strftime("%Y-%m-%dT23:59:59"),
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(f"{base}/v1/account-statement", headers=headers, json=body)
        if resp.status_code in (401, 403):
            if _enpara_should_refresh_on_auth_error(resp, token) and _enpara_can_refresh(conn):
                token = await _enpara_refresh_access_token(conn)
                headers = _enpara_headers(token, conn, for_get=False)
                resp = await client.post(f"{base}/v1/account-statement", headers=headers, json=body)
            if resp.status_code in (401, 403):
                _enpara_raise_auth(resp)
        if resp.status_code >= 500:
            raise RuntimeError(f"Enpara API sunucu hatası: HTTP {resp.status_code}")
        if _enpara_method_not_allowed(resp):
            extra = " HTTP 405 — hareket POST /v1/account-statement JSON (startDateTime/endDateTime)."
        elif resp.status_code >= 400:
            extra = f" HTTP {resp.status_code}."
        else:
            extra = ""
    if token:
        conn["access_token"] = token
    return {
        "ok": True,
        "simulated": False,
        "message": f"Enpara api.enpara.com doğrulandı (account-statement).{extra}",
    }


async def test_connection(conn: dict) -> Dict[str, Any]:
    if _is_simulated(conn):
        return {"ok": True, "simulated": True, "message": "API kimlik bilgisi girilmedi. Bağlantı SİMÜLE modda çalışıyor."}
    try:
        if conn.get("provider") == "enpara":
            return await _enpara_probe(conn)
        if conn.get("provider") == "kuveytturk":
            return await _kuveyt_probe(conn)
        token = await _oauth_token(conn)
        if token:
            conn["access_token"] = token
        return {"ok": True, "simulated": False, "message": "OAuth2 token alındı. Banka bağlantısı doğrulandı."}
    except httpx.HTTPStatusError as e:
        body = (e.response.text or "")[:120]
        return {"ok": False, "simulated": False, "message": f"Banka API hatası: HTTP {e.response.status_code} {body}".strip()}
    except Exception as e:
        return {"ok": False, "simulated": False, "message": f"Bağlantı kurulamadı: {_err_text(e)}"}


def _simulate_transactions(conn: dict, since: datetime) -> List[Dict[str, Any]]:
    seed = int(hashlib.sha256(f"{conn.get('_id')}-{datetime.now(timezone.utc).strftime('%Y-%m-%d-%H')}".encode()).hexdigest(), 16)
    rng = random.Random(seed)
    count = rng.randint(3, 6)
    txs = []
    for i in range(count):
        desc, direction, cp = rng.choice(SIM_COUNTERPARTIES)
        day = datetime.now(timezone.utc) - timedelta(days=rng.randint(0, 6), hours=rng.randint(0, 20))
        amount = round(rng.uniform(450, 28500), 2)
        txs.append({
            "external_id": f"SIM-{hashlib.sha256(f'{seed}-{i}'.encode()).hexdigest()[:12].upper()}",
            "date": day.strftime("%Y-%m-%d"),
            "amount": amount,
            "direction": direction,
            "description": desc,
            "counterparty": cp,
            "currency": "TRY",
            "is_simulated": True,
        })
    return txs


def _dig_list(raw: Any, keys: tuple) -> Optional[list]:
    if isinstance(raw, list):
        return raw
    if not isinstance(raw, dict):
        return None
    for k in keys:
        v = raw.get(k)
        if isinstance(v, list):
            return v
        if isinstance(v, dict):
            nested = _dig_list(v, keys)
            if nested is not None:
                return nested
    return None


def _parse_amount(val: Any) -> float:
    if val is None or val == "":
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace(" ", "").replace("₺", "").replace("TL", "")
    if "," in s and "." in s:
        # 1.234,56 → 1234.56
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _normalize_date(val: Any) -> str:
    s = str(val or "").strip()
    if not s:
        return ""
    # 17.09.2026 or 17/09/2026
    for sep in (".", "/"):
        parts = s.split(sep)
        if len(parts) == 3 and len(parts[2]) == 4 and len(parts[0]) <= 2:
            d, m, y = parts
            return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
    return s[:10]


def _normalize_tx_rows(raw: Any) -> List[Dict[str, Any]]:
    rows = _dig_list(raw, (
        "value", "data", "transactions", "items", "accountTransactions",
        "statementLines", "lines", "hareketler", "Hareketler", "accountStatement",
        "statement", "results", "content", "transactionList",
    ))
    if rows is None:
        return []
    txs = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        # Ticket / durum satırlarını hareket sanma
        status = str(r.get("status") or r.get("ticketStatus") or r.get("state") or "").lower()
        if status in ("pending", "processing", "queued", "waiting", "inprogress", "in_progress") and not (
            r.get("amount") or r.get("tutar") or r.get("Amount") or r.get("transactionAmount")
        ):
            continue
        amount = _parse_amount(
            r.get("amount") or r.get("Amount") or r.get("transactionAmount")
            or r.get("tutar") or r.get("Tutar") or r.get("islemtutari") or r.get("islemTutari")
            or r.get("creditAmount") or r.get("debitAmount")
        )
        credit = _parse_amount(r.get("creditAmount") or r.get("alacak") or r.get("Alacak") or r.get("credit"))
        debit = _parse_amount(r.get("debitAmount") or r.get("borc") or r.get("Borc") or r.get("borç") or r.get("debit"))
        if credit and not debit:
            amount, direction = credit, "credit"
        elif debit and not credit:
            amount, direction = debit, "debit"
        else:
            direction_hint = str(
                r.get("direction") or r.get("creditDebitIndicator") or r.get("type")
                or r.get("islemYonu") or r.get("hareketTipi") or r.get("borcAlacak") or ""
            ).lower()
            if direction_hint in ("credit", "alacak", "a", "in", "inflow", "cr", "c", "+"):
                direction = "credit"
            elif direction_hint in ("debit", "borc", "borç", "b", "out", "outflow", "dr", "d", "-"):
                direction = "debit"
            else:
                direction = "credit" if amount >= 0 else "debit"
            amount = abs(amount)
        if amount == 0:
            continue
        date = _normalize_date(
            r.get("transactionDate") or r.get("bookingDate") or r.get("date") or r.get("valueDate")
            or r.get("islemTarihi") or r.get("IslemTarihi") or r.get("valorTarihi") or r.get("tarih")
        )
        txs.append({
            "external_id": str(
                r.get("transactionId") or r.get("id") or r.get("referenceNo") or r.get("bookingId")
                or r.get("fisNo") or r.get("dekontNo") or r.get("referansNo") or r.get("refNo")
                or hashlib.sha256(str(r).encode()).hexdigest()[:16]
            ),
            "date": date,
            "amount": amount,
            "direction": direction,
            "description": (
                r.get("description") or r.get("explanation") or r.get("narrative")
                or r.get("aciklama") or r.get("Aciklama") or r.get("islemAciklama") or "Banka Hareketi"
            ),
            "counterparty": (
                r.get("counterpartyName") or r.get("senderName") or r.get("counterparty")
                or r.get("karsiHesapAdi") or r.get("gonderenAdi") or r.get("aliciAdi") or ""
            ),
            "currency": r.get("currency") or r.get("currencyCode") or r.get("paraBirimi") or "TRY",
            "is_simulated": False,
        })
    return txs


def _extract_balance(raw: Any) -> Optional[float]:
    if not isinstance(raw, dict):
        return None
    candidates = (
        raw.get("balance"), raw.get("currentBalance"), raw.get("availableBalance"),
        raw.get("bakiye"), raw.get("Bakiye"), raw.get("guncelBakiye"), raw.get("hesapBakiyesi"),
        raw.get("ledgerBalance"), raw.get("accountBalance"),
    )
    for c in candidates:
        if isinstance(c, dict):
            c = c.get("amount") or c.get("value") or c.get("tutar")
        if c is not None and c != "":
            return _parse_amount(c)
    data = raw.get("data") if isinstance(raw.get("data"), dict) else None
    if data:
        return _extract_balance(data)
    return None


def _ticket_id_from(data: Any) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    for k in ("ticketNo", "ticketId", "ticket", "id", "requestId", "jobId"):
        v = data.get(k)
        if v and not isinstance(v, (dict, list)):
            return str(v)
    for nest in (data.get("data"), data.get("value"), data.get("result")):
        tid = _ticket_id_from(nest) if isinstance(nest, dict) else None
        if tid:
            return tid
    return None


def _ticket_ready(data: Any) -> Optional[bool]:
    """True=hazır, False=bekliyor, None=bilinmiyor."""
    if not isinstance(data, dict):
        return None
    nested = data.get("data") if isinstance(data.get("data"), dict) else {}
    status = str(
        data.get("status")
        or data.get("ticketStatus")
        or data.get("state")
        or nested.get("status")
        or ""
    ).lower()
    if status in ("completed", "complete", "ready", "done", "success", "succeeded", "finished", "ok", "hazir", "tamamlandi", "tamamlandı"):
        return True
    if status in ("pending", "processing", "queued", "waiting", "inprogress", "in_progress", "running", "created", "new"):
        return False
    return None


def _enpara_account_ref(conn: dict) -> str:
    for key in ("bank_account_number", "iban", "account_number"):
        v = (conn.get(key) or "").strip().replace(" ", "").upper()
        if v and v != "-":
            return v
    return ""


def _enpara_headers(token: str, conn: dict, *, for_get: bool = False) -> Dict[str, str]:
    # Bearer = Gravitee OAuth2 plan. API Key planı varsa X-Gravitee-Api-Key.
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    api_key = _plain_secret(conn, "api_key")
    if api_key:
        headers["X-Gravitee-Api-Key"] = api_key
    if not for_get:
        headers["Content-Type"] = "application/json"
    return headers


def _is_iban(ref: str) -> bool:
    r = (ref or "").strip().upper().replace(" ", "")
    return len(r) >= 15 and r.startswith("TR") and r[2:].isalnum()


def _iban_parts(iban: str) -> Dict[str, str]:
    """TR IBAN: TR + 2 kontrol + 5 banka + 1 rezerv + hesap no."""
    raw = (iban or "").strip().upper().replace(" ", "")
    out = {"iban": raw}
    if _is_iban(raw) and len(raw) >= 16:
        out["bankCode"] = raw[4:9]
        acct = raw[10:]
        out["accountNumber"] = acct.lstrip("0") or acct
        out["accountNumberRaw"] = acct
    return out


def _stringify_err_msg(val: Any) -> str:
    if val is None or val == "":
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, (int, float, bool)):
        return str(val)
    if isinstance(val, dict):
        # JSON Schema: {"type":"object"} veya {en, tr}
        for k in ("message", "msg", "detail", "tr", "en", "type", "keyword", "field", "path", "property"):
            if val.get(k):
                inner = _stringify_err_msg(val[k])
                if inner:
                    extra = val.get("field") or val.get("path") or val.get("property") or val.get("instancePath")
                    return f"{extra} {inner}".strip() if extra and extra != val.get(k) else inner
        try:
            return json.dumps(val, ensure_ascii=False)
        except Exception:
            return str(val)
    if isinstance(val, list):
        return "; ".join(filter(None, (_stringify_err_msg(x) for x in val[:4])))
    return str(val)


def _enpara_iban_26(account: str) -> str:
    """Gravitee şeması: iban string, minLength=26, maxLength=26, [a-zA-Z0-9]."""
    raw = (account or "").strip().upper().replace(" ", "")
    if len(raw) == 26 and raw.isalnum():
        return raw
    if _is_iban(raw) and len(raw) >= 26:
        return raw[:26]
    return ""


def _enpara_account_no(account: str) -> str:
    raw = (account or "").strip().upper().replace(" ", "")
    if not raw or raw == "-":
        return ""
    iban = _enpara_iban_26(raw)
    if iban:
        parts = _iban_parts(iban)
        return parts.get("accountNumber") or ""
    return raw


def _string_params(payload: Dict[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k, v in payload.items():
        if v is None or isinstance(v, (dict, list)):
            continue
        s = str(v).strip()
        if s:
            out[k] = s
    return out


def _enpara_payload_variants(start: datetime, end: datetime, account: str, customer: str) -> List[Dict[str, Any]]:
    """QNB/Enpara Gravitee Account Statement + Account Transactions şeması.

    Zorunlu: startDateTime, endDateTime (string). Opsiyonel: iban (tam 26), accountNo (string).
    Nested object (accountInfo) JSON Schema'da yok — 400-1 'object' üretir.
    """
    del customer  # şemada yok; imza uyumu
    iban = _enpara_iban_26(account)
    acct_no = _enpara_account_no(account)
    start_d, end_d = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    ranges = [
        (f"{start_d}T00:00:00", f"{end_d}T23:59:59"),
        (f"{start_d}T00:00:00.000", f"{end_d}T23:59:59.999"),
        (f"{start_d} 00:00:00", f"{end_d} 23:59:59"),
        (start_d, end_d),
    ]
    variants: List[Dict[str, Any]] = []

    def add(p: Dict[str, Any]):
        variants.append(p)

    for sd, ed in ranges:
        base = {"startDateTime": sd, "endDateTime": ed}
        if iban and acct_no:
            add({**base, "iban": iban, "accountNo": acct_no})
        if iban:
            add({**base, "iban": iban})
        if acct_no:
            add({**base, "accountNo": acct_no})
        add(dict(base))

    seen = set()
    uniq = []
    for p in variants:
        key = json.dumps(p, sort_keys=True, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(p)
    return uniq[:12]


def _api_error_detail(resp) -> str:
    text = (getattr(resp, "text", None) or "")[:500]
    try:
        data = resp.json()
    except Exception:
        return text
    if not isinstance(data, dict):
        return text
    parts = []
    top_msg = _stringify_err_msg(data.get("message"))
    if top_msg:
        parts.append(top_msg)
    if data.get("code"):
        parts.append(f"code={data['code']}")
    oauth_err = data.get("error")
    if isinstance(oauth_err, str):
        desc = data.get("error_description") or ""
        bit = f"{oauth_err}: {desc}".strip() if desc else oauth_err
        if bit not in parts:
            parts.append(bit)
        errs = data.get("errors") or data.get("violations") or []
    else:
        errs = data.get("errors") or data.get("error") or data.get("violations") or []
    if isinstance(errs, dict):
        errs = [errs]
    if isinstance(errs, list):
        for e in errs[:5]:
            if isinstance(e, dict):
                msg = _stringify_err_msg(
                    e.get("message") or e.get("msg") or e.get("detail") or e.get("reason") or e.get("description")
                )
                loc = e.get("field") or e.get("path") or e.get("property") or e.get("instancePath") or e.get("source")
                code = e.get("code") or e.get("keyword")
                bit = " ".join(x for x in (str(code) if code else "", f"[{loc}]" if loc else "", msg) if x)
                parts.append(bit.strip() or json.dumps(e, ensure_ascii=False)[:180])
            else:
                parts.append(str(e))
    return " | ".join(parts) if parts else text


def _enpara_raise_auth(resp):
    detail = _api_error_detail(resp)
    blob = f"{detail} {getattr(resp, 'text', '') or ''}".lower()
    code = getattr(resp, "status_code", 401) or 401
    if _enpara_ip_blocked(resp) or "access_denied" in blob:
        raise RuntimeError(
            "Enpara 401 access_denied: istek reddedildi. "
            "Production sunucu IP’sini Enpara/QNB developer portalındaki uygulama IP listesine ekleyin "
            "ve Account Statement aboneliğini kontrol edin. "
            "Süresi dolmuşsa portalden yeni Access Token yapıştırın "
            "(client_credentials token bu API için yeterli olmayabilir). "
            f"({detail[:160]})"
        )
    raise RuntimeError(
        f"Enpara yetkilendirme hatası (HTTP {code}). "
        f"Portalden Access Token’ı yenileyin. {detail}"
    )


async def _fetch_enpara_statement(conn: dict, since: datetime) -> Dict[str, Any]:
    """Enpara Hesap Hareketleri — production POST JSON; katalog GET iddiası yalnızca 405 yedek.

    POST https://api.enpara.com/v1/account-statement  JSON {startDateTime, endDateTime, iban?, accountNo?}
    GET  https://api.enpara.com/v1/account-statement/ticket?ticketNo=  (405 ise POST {ticketNo})
    POST https://api.enpara.com/v1/account-statement/list  JSON {} veya iban/tarih
    Abone olunmayan /v1/account-transactions/* çağrılmaz.
    """
    import asyncio

    stored_token = _plain_secret(conn, "access_token")
    token = await _enpara_access_token(conn)
    base = _base_url(conn) or "https://api.enpara.com"
    post_headers = _enpara_headers(token, conn, for_get=False)
    get_headers = _enpara_headers(token, conn, for_get=True)
    account = _enpara_account_ref(conn)
    customer = (conn.get("customer_number") or "").strip()
    end = datetime.now(timezone.utc)
    if (end - since).days > 30:
        since = end - timedelta(days=30)
    payloads = _enpara_payload_variants(since, end, account, customer)
    last_detail = ""
    got_ok_empty = False
    balance: Optional[float] = None
    refreshed_token: Optional[str] = token if token and token != stored_token else None
    best_400 = ""

    def _pack(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        out: Dict[str, Any] = {"transactions": rows, "balance": balance, "access_token": refreshed_token}
        if refreshed_token and conn.get("refresh_token"):
            out["refresh_token"] = conn.get("refresh_token")
        return out

    async with httpx.AsyncClient(timeout=45) as client:
        async def _maybe_refresh(resp):
            nonlocal token, post_headers, get_headers, refreshed_token
            if not _enpara_should_refresh_on_auth_error(resp, token):
                return resp
            if not _enpara_can_refresh(conn):
                _enpara_raise_auth(resp)
            token = await _enpara_refresh_access_token(conn)
            refreshed_token = token
            post_headers = _enpara_headers(token, conn, for_get=False)
            get_headers = _enpara_headers(token, conn, for_get=True)
            return None

        async def _get(path: str, *, params=None):
            url = f"{base}{path}"
            resp = await client.get(url, headers=get_headers, params=params or {})
            retried = await _maybe_refresh(resp)
            if retried is None:
                resp = await client.get(url, headers=get_headers, params=params or {})
            return resp

        async def _post(path: str, *, json_body=None):
            url = f"{base}{path}"
            body = json_body if json_body is not None else {}
            resp = await client.post(url, headers=post_headers, json=body)
            retried = await _maybe_refresh(resp)
            if retried is None:
                resp = await client.post(url, headers=post_headers, json=body)
            return resp

        def _consume(data: Any, *, as_statement: bool = True) -> Optional[Dict[str, Any]]:
            nonlocal balance, got_ok_empty
            bal = _extract_balance(data)
            if bal is not None:
                balance = bal
            rows = _normalize_tx_rows(data)
            if rows:
                return _pack(rows)
            ready = _ticket_ready(data)
            if ready is False:
                return None
            if as_statement and ready is True:
                got_ok_empty = True
                return _pack([])
            return None

        def _note_400(label: str, resp, payload: Optional[dict] = None):
            nonlocal last_detail, best_400
            keys = ",".join((payload or {}).keys())
            last_detail = f"{label} HTTP {resp.status_code} ({keys}): {_api_error_detail(resp)}"
            if resp.status_code == 400:
                if (not best_400) or ("object" in best_400 and "object" not in last_detail) or len(last_detail) > len(best_400):
                    best_400 = last_detail

        async def _handle_statement(resp, payload: dict, label: str) -> Optional[Dict[str, Any]]:
            nonlocal got_ok_empty, last_detail
            if resp.status_code in (401, 403):
                _enpara_raise_auth(resp)
            keys = ",".join((payload or {}).keys())
            last_detail = f"{label} HTTP {resp.status_code} ({keys}): {_api_error_detail(resp)}"
            if resp.status_code >= 400:
                _note_400(label, resp, payload)
                return None
            try:
                data = resp.json()
            except Exception:
                data = {}
            out = _consume(data, as_statement=True)
            if out and out.get("transactions"):
                return out
            if out is not None and _ticket_ready(data) is True:
                return out
            tid = _ticket_id_from(data)
            if tid:
                polled = await _poll_ticket(tid)
                if polled:
                    return polled
            got_ok_empty = True
            return None

        async def _poll_ticket(ticket_id: str) -> Optional[Dict[str, Any]]:
            nonlocal last_detail
            use_post = False
            for attempt in range(10):
                if attempt:
                    await asyncio.sleep(1.5)
                if not use_post:
                    resp = await _get(
                        "/v1/account-statement/ticket",
                        params={"ticketNo": ticket_id, "pageNo": "1", "pageSize": "100"},
                    )
                    if _enpara_method_not_allowed(resp):
                        use_post = True
                    else:
                        last_detail = f"GET /v1/account-statement/ticket HTTP {resp.status_code}: {_api_error_detail(resp)}"
                if use_post:
                    resp = await _post(
                        "/v1/account-statement/ticket",
                        json_body={"ticketNo": ticket_id},
                    )
                    last_detail = f"POST /v1/account-statement/ticket HTTP {resp.status_code}: {_api_error_detail(resp)}"
                if resp.status_code in (401, 403):
                    _enpara_raise_auth(resp)
                if resp.status_code >= 400:
                    continue
                try:
                    data = resp.json()
                except Exception:
                    continue
                if _ticket_ready(data) is False:
                    continue
                out = _consume(data, as_statement=True)
                if out is not None:
                    return out
            return None

        # 1) POST /v1/account-statement JSON {startDateTime, endDateTime, iban?, accountNo?}
        statement_post_405 = False
        for payload in payloads:
            resp = await _post("/v1/account-statement", json_body=payload)
            if _enpara_method_not_allowed(resp):
                statement_post_405 = True
                last_detail = f"POST /v1/account-statement HTTP {resp.status_code}: {_api_error_detail(resp)}"
                break
            out = await _handle_statement(resp, payload, "POST /v1/account-statement")
            if out is not None:
                return out

        # Katalog GET iddiası: yalnızca POST 405 olursa query-string yedek
        if statement_post_405:
            for payload in payloads:
                qs = _string_params(payload)
                resp = await _get("/v1/account-statement", params=qs)
                out = await _handle_statement(resp, payload, "GET /v1/account-statement")
                if out is not None:
                    return out

        # 2) POST /v1/account-statement/list — kayıtlı hesaplar / bakiye (GET production’da 405)
        list_body: Dict[str, Any] = {}
        iban = _enpara_iban_26(account)
        if iban:
            list_body["iban"] = iban
        if payloads:
            if payloads[0].get("startDateTime"):
                list_body["startDateTime"] = payloads[0]["startDateTime"]
            if payloads[0].get("endDateTime"):
                list_body["endDateTime"] = payloads[0]["endDateTime"]
        resp = await _post("/v1/account-statement/list", json_body=list_body)
        if _enpara_method_not_allowed(resp):
            pass
        elif resp.status_code in (401, 403):
            _enpara_raise_auth(resp)
        else:
            last_detail = f"POST /v1/account-statement/list HTTP {resp.status_code}: {_api_error_detail(resp)}"
            if resp.status_code < 400:
                try:
                    data = resp.json()
                except Exception:
                    data = None
                if data is not None:
                    out = _consume(data, as_statement=False)
                    if out and out.get("transactions"):
                        return out
                    bal = _extract_balance(data)
                    if bal is not None:
                        balance = bal

    if got_ok_empty or balance is not None:
        return _pack([])

    if best_400:
        last_detail = best_400
    hint = " Access Token, Refresh Token, Client ID ve 26 haneli IBAN’ı kontrol edin."
    if not account:
        hint = " Düzenle → Hesap No/IBAN alanına Enpara IBAN’ınızı girin (tam 26 karakter, boşluksuz)."
    elif "400" in last_detail:
        hint = (
            " İstek reddedildi (400). POST /v1/account-statement JSON gövdesinde startDateTime/endDateTime ister; "
            "IBAN tam 26 karakter olmalı (nested accountInfo yok). Ticket: GET /v1/account-statement/ticket?ticketNo= "
            "(405 ise POST {ticketNo})."
        )
    elif "method not allowed" in last_detail.lower() or "HTTP 405" in last_detail:
        hint = (
            " HTTP 405 (METHOD NOT ALLOWED) IP engeli değildir. "
            "Hareket POST /v1/account-statement JSON (startDateTime, endDateTime) ile alınır. "
            "Production çıkış 85.95.240.136 whitelist hatırlatmasıdır, 405 nedeni değil."
        )
    elif any(x in last_detail.lower() for x in ("your ip", "ip is not", "whitelist", "ip filtering")):
        hint = " Sunucu IP’si Enpara portalında izinli değil (tamkobi.com çıkışı 85.95.240.136)."
    raise RuntimeError(f"Enpara hesap hareketi alınamadı.{hint} Son yanıt: {last_detail[:360]}")


async def _fetch_kuveyt_transactions(conn: dict, since: datetime) -> Dict[str, Any]:
    """API Market: Bearer + RSA-SHA256 Signature. GET query string is part of the signed payload."""
    pem = _kuveyt_private_key_pem(conn)
    if not pem:
        raise RuntimeError(
            "Kuveyt Türk hesap hareketi için RSA private key (PKCS8 PEM) gerekli. "
            "Developer portalındaki imza anahtarını Düzenle ekranına yapıştırın."
        )
    token = await _kuveyt_access_token(conn)
    base = _base_url(conn)
    account = (conn.get("bank_account_number") or "").strip().replace(" ", "")
    suffix = _kuveyt_account_suffix(conn)
    customer = (conn.get("customer_number") or "").strip()
    end = datetime.now(timezone.utc)
    start_d, end_d = since.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    last_detail = ""
    balance: Optional[float] = None

    ranges = [
        {"beginDate": start_d, "endDate": end_d},
        {"startDate": start_d, "endDate": end_d},
        {"startDateTime": f"{start_d}T00:00:00", "endDateTime": f"{end_d}T23:59:59"},
    ]
    ident: Dict[str, str] = {}
    if suffix:
        ident["accountNumber"] = suffix
        ident["accountSuffix"] = suffix
    if account:
        ident["iban"] = account.replace(" ", "").upper()
    if customer:
        ident["customerNumber"] = customer
        ident["customerId"] = customer

    param_sets: List[Dict[str, str]] = []
    for rng in ranges:
        param_sets.append(dict(rng))
        for extra in (
            {k: ident[k] for k in ("accountNumber",) if k in ident},
            {k: ident[k] for k in ("iban",) if k in ident},
            {k: ident[k] for k in ("accountSuffix",) if k in ident},
            {k: ident[k] for k in ident if k in ("accountNumber", "customerNumber")},
        ):
            if extra:
                param_sets.append({**rng, **extra})
    seen = set()
    uniq: List[Dict[str, str]] = []
    for p in param_sets:
        key = json.dumps(p, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(p)

    paths = ["/v1/accounts/transactions"]
    if suffix:
        paths.append(f"/v1/accounts/{suffix}/transactions")
        paths.append(f"/v1/accounts/{suffix}/accounttransactions")

    async with httpx.AsyncClient(timeout=45) as client:
        async def _get(path: str, params: Optional[Dict[str, str]] = None):
            qs_params = {k: v for k, v in (params or {}).items() if v not in (None, "")}
            headers = _kuveyt_headers(token, conn, params=qs_params or None)
            url = f"{base}{path}" + _kuveyt_query_string(qs_params)
            return await client.get(url, headers=headers)

        resp = await _get("/v1/accounts")
        last_detail = f"GET /v1/accounts HTTP {resp.status_code}: {_api_error_detail(resp)}"
        if resp.status_code in (401, 403):
            raise RuntimeError(
                f"Kuveyt Türk yetkilendirme hatası (HTTP {resp.status_code}). "
                "client_credentials token ve RSA-SHA256 Signature’ı kontrol edin. "
                f"{_api_error_detail(resp)[:200]}"
            )
        if resp.status_code < 400:
            try:
                data = resp.json()
            except Exception:
                data = None
            if data is not None:
                bal = _extract_balance(data)
                if bal is not None:
                    balance = bal
                rows = _normalize_tx_rows(data)
                if rows:
                    return {"transactions": rows, "balance": balance, "access_token": None}

        for path in paths:
            for params in uniq[:8]:
                resp = await _get(path, params)
                last_detail = f"GET {path} HTTP {resp.status_code} ({','.join(params)}): {_api_error_detail(resp)}"
                if resp.status_code in (401, 403):
                    raise RuntimeError(
                        f"Kuveyt Türk yetkilendirme hatası (HTTP {resp.status_code}). "
                        f"{_api_error_detail(resp)[:200]}"
                    )
                if resp.status_code >= 400:
                    continue
                try:
                    data = resp.json()
                except Exception:
                    continue
                bal = _extract_balance(data)
                if bal is not None:
                    balance = bal
                rows = _normalize_tx_rows(data)
                if rows:
                    return {"transactions": rows, "balance": balance, "access_token": None}
                if _ticket_ready(data) is True:
                    return {"transactions": [], "balance": balance, "access_token": None}

    if balance is not None:
        return {"transactions": [], "balance": balance, "access_token": None}
    hint = " Client ID/Secret, PKCS8 PEM ve hesap no/IBAN’ı kontrol edin."
    if not account and not suffix:
        hint = " Düzenle → Hesap No/IBAN alanına Kuveyt hesap numaranızı girin."
    raise RuntimeError(f"Kuveyt Türk hesap hareketi alınamadı.{hint} Son yanıt: {last_detail[:360]}")


async def _fetch_live_transactions(conn: dict, since: datetime) -> Dict[str, Any]:
    if conn.get("provider") == "enpara":
        return await _fetch_enpara_statement(conn, since)
    if conn.get("provider") == "kuveytturk":
        return await _fetch_kuveyt_transactions(conn, since)
    token = await _oauth_token(conn)
    base = _base_url(conn)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    params = {"beginDate": since.strftime("%Y-%m-%d"), "endDate": datetime.now(timezone.utc).strftime("%Y-%m-%d")}
    if conn.get("bank_account_number"):
        params["accountNumber"] = conn["bank_account_number"]
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{base}/v1/accounts/transactions", headers=headers, params=params)
        resp.raise_for_status()
        payload = resp.json()
    return {"transactions": _normalize_tx_rows(payload), "balance": _extract_balance(payload), "access_token": None}


async def fetch_transactions(conn: dict, since: datetime) -> Dict[str, Any]:
    if _is_simulated(conn):
        return {"simulated": True, "transactions": _simulate_transactions(conn, since), "balance": None}
    live = await _fetch_live_transactions(conn, since)
    return {
        "simulated": False,
        "transactions": live.get("transactions") or [],
        "balance": live.get("balance"),
        "access_token": live.get("access_token"),
        "refresh_token": live.get("refresh_token"),
    }
