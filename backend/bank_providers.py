
"""Banka açık bankacılık sağlayıcıları.

Enpara (api.enpara.com) QNB'den ayrı bir bankadır; QNB Open Banking ayrı kayıttır.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import random
import re
import shutil
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

import httpx

PROVIDERS = {
    "kuveytturk": {
        "name": "Kuveyt Türk API Market",
        # Prep = test Gravitee. Canlı: identity.kuveytturk.com.tr + gateway.kuveytturk.com.tr.
        # SDK yedek: idprep|id + apitest|api.
        "sandbox_url": "https://prep-gateway.kuveytturk.com.tr",
        "live_url": "https://gateway.kuveytturk.com.tr",
        "identity_sandbox_url": "https://prep-identity.kuveytturk.com.tr",
        "identity_live_url": "https://identity.kuveytturk.com.tr",
        "token_path": "/connect/token",
        "legacy_sandbox_url": "https://apitest.kuveytturk.com.tr/prep",
        "legacy_live_url": "https://api.kuveytturk.com.tr",
        "legacy_identity_sandbox_url": "https://idprep.kuveytturk.com.tr",
        "legacy_identity_live_url": "https://id.kuveytturk.com.tr",
        "legacy_token_path": "/api/connect/token",
        "docs": "https://developer.kuveytturk.com.tr/",
        "documentation": "https://developer.kuveytturk.com.tr/documentation",
        "signature_tool": "https://github.com/KuveytTurk/SignatureGenerator2048",
        "contact": "https://developer.kuveytturk.com.tr/contactus",
        "contact_email": "apiekibi@kuveytturk.com.tr",
        "jsencrypt_demo": "https://travistidwell.com/jsencrypt/demo/",
        "fields": ["client_id", "client_secret", "api_key", "private_key"],
        "hint": (
            "API Golive: Canlı token https://identity.kuveytturk.com.tr · API https://gateway.kuveytturk.com.tr; "
            "Prep/test: prep-identity + prep-gateway. "
            "Token: POST …/connect/token (client_credentials; hesap hareketi scope=accounts). "
            "İmza: SHA256RSA = PrivateKey + AccessToken + (GET ?query | POST body) — JSEncrypt.signSha256 / "
            "github.com/KuveytTurk/SignatureGenerator2048. "
            "Header: Authorization Bearer, Signature, Content-Type application/json (+ X-Gravitee-Api-Key). "
            "RSA 2048: Private Key TamKobi’de; eşleşen .crt API Market’te. "
            "Canlı: API Market → Uygulamalar → GoLive Talep Yönetimi → +Yeni Talep (yetkili kullanıcı) + IP whitelist. "
            "Abonelik: GET /v1/fx/rates, GET /v3/accounts/{ekNo}/transactions "
            "(beginDate/endDate/itemCount → accountActivities), POST /v1/vpos/getMerchantOrderDetail. "
            "İletişim: apiekibi@kuveytturk.com.tr · developer.kuveytturk.com.tr/contactus. "
            "non3DPayment/EFT otomatik değil."
        ),
    },
    "enpara": {
        "name": "Enpara Şirketim API",
        "sandbox_url": "https://api.enpara.com",
        "live_url": "https://api.enpara.com",
        "token_path": "/securedomain/oauth/token",
        "docs": "https://developer.qnb.com.tr/",  # portal Enpara ürününü de listeler; API host api.enpara.com
        "fields": ["access_token", "refresh_token", "client_id", "client_secret", "customer_number"],
        "hint": "Hesap Hareketleri: POST /v1/account-statement JSON (startDateTime, endDateTime yyyy-MM-ddTHH:mm:ss+HH:mm; iban 26 hane zorunlu — resultCode 364737). status=SUCCESS çoğu zaman ticket üretir — hareket GET/POST /ticket ile alınır; SUCCESS boş ekstre değildir. /list kayıtlı hesap bakiyesi. Access Token, Refresh Token ve Client ID yalnızca sunucuda saklanır. Production IP 85.95.240.136 ve 85.95.240.184 (ikisi de whitelist). HTTP 405 METHOD NOT ALLOWED IP engeli değildir.",
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
    if conn.get("provider") == "kuveytturk":
        live = _kuveyt_normalize_mode(conn) == "live"
    else:
        live = conn.get("mode") == "live"
    return (meta["live_url"] if live else meta["sandbox_url"]).rstrip("/")


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
    """İnsan okunur hata; httpx zaman aşımında boş str(exc) → sınıf adı + istek URL’si."""
    msg = str(exc).strip()
    if isinstance(exc, httpx.TimeoutException):
        url = ""
        try:
            req = exc.request  # httpx: yoksa RuntimeError
            url = str(getattr(req, "url", "") or "").strip()
        except RuntimeError:
            url = ""
        if isinstance(exc, httpx.ReadTimeout):
            kind = "yanıt süresi aşıldı (ReadTimeout)"
        elif isinstance(exc, httpx.ConnectTimeout):
            kind = "bağlantı süresi aşıldı (ConnectTimeout)"
        elif isinstance(exc, httpx.WriteTimeout):
            kind = "yazma süresi aşıldı (WriteTimeout)"
        elif isinstance(exc, httpx.PoolTimeout):
            kind = "havuz süresi aşıldı (PoolTimeout)"
        else:
            kind = msg or "zaman aşımı (Timeout)"
        return f"{kind}: {url}" if url else kind
    return msg or exc.__class__.__name__


# Kuveyt Identity/Gateway bazen yavaş; 20–25s ReadTimeout kullanıcıya çıplak "ReadTimeout" bırakıyordu.
_KUVEYT_TOKEN_TIMEOUT = httpx.Timeout(45.0, connect=15.0)
_KUVEYT_GATEWAY_TIMEOUT = httpx.Timeout(40.0, connect=15.0)


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


def _kuveyt_normalize_mode(conn: dict) -> str:
    """UI/API may send LIVE / Canlı / production — Identity host seçimi için normalize et."""
    m = str(conn.get("mode") or "sandbox").strip().lower()
    if m in ("live", "prod", "production", "canli", "canlı", "prd"):
        return "live"
    return "sandbox"


_KUVEYT_GRAVITEE_ID_HOSTS = ("prep-identity.kuveytturk.com.tr", "identity.kuveytturk.com.tr")
_KUVEYT_SDK_ID_HOSTS = ("idprep.kuveytturk.com.tr", "id.kuveytturk.com.tr")


def _kuveyt_identity_host(conn: dict) -> str:
    meta = PROVIDERS["kuveytturk"]
    live = _kuveyt_normalize_mode(conn) == "live"
    return (meta["identity_live_url"] if live else meta["identity_sandbox_url"]).rstrip("/")


def _kuveyt_sdk_identity_host(conn: dict) -> str:
    """iuysal/kuveytturk + Android SDK Identity (idprep / id)."""
    meta = PROVIDERS["kuveytturk"]
    live = _kuveyt_normalize_mode(conn) == "live"
    return (meta["legacy_identity_live_url"] if live else meta["legacy_identity_sandbox_url"]).rstrip("/")


def _kuveyt_token_path() -> str:
    return PROVIDERS["kuveytturk"].get("token_path") or "/connect/token"


def _kuveyt_sdk_token_path() -> str:
    return PROVIDERS["kuveytturk"].get("legacy_token_path") or "/api/connect/token"


def _kuveyt_host_from_url(url: str) -> str:
    u = (url or "").strip().lower()
    if "://" in u:
        u = u.split("://", 1)[1]
    return u.split("/", 1)[0]


def _kuveyt_normalize_token_url(url: str) -> str:
    """Host’a göre path: Gravitee /connect/token; iuysal SDK /api/connect/token."""
    u = (url or "").strip().rstrip("/")
    if not u:
        return ""
    host = _kuveyt_host_from_url(u)
    if host in _KUVEYT_SDK_ID_HOSTS:
        base = u
        for suf in ("/api/connect/token", "/connect/token"):
            if base.endswith(suf):
                base = base[: -len(suf)]
                break
        return base.rstrip("/") + _kuveyt_sdk_token_path()
    if host in _KUVEYT_GRAVITEE_ID_HOSTS:
        base = u
        for suf in ("/api/connect/token", "/connect/token"):
            if base.endswith(suf):
                base = base[: -len(suf)]
                break
        return base.rstrip("/") + _kuveyt_token_path()
    if u.endswith("/api/connect/token") or u.endswith("/connect/token"):
        return u
    return u + _kuveyt_token_path()


def _kuveyt_token_urls(conn: dict) -> List[str]:
    """Canlı: Gravitee identity.kuveytturk.com.tr önce; Sandbox: SDK idprep önce, prep-identity yedek."""
    urls: List[str] = []
    custom = (conn.get("token_url") or "").strip()
    if custom:
        urls.append(_kuveyt_normalize_token_url(custom))
    gravitee = _kuveyt_identity_host(conn).rstrip("/") + _kuveyt_token_path()
    sdk = _kuveyt_sdk_identity_host(conn).rstrip("/") + _kuveyt_sdk_token_path()
    if _kuveyt_normalize_mode(conn) == "live":
        urls.extend([gravitee, sdk])
    else:
        urls.extend([sdk, gravitee])
    seen = set()
    out = []
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def _kuveyt_alt_token_urls(conn: dict) -> List[str]:
    """Karşı ortam (Canlı↔Sandbox) hem Gravitee hem SDK Identity."""
    flipped = dict(conn)
    flipped["mode"] = "sandbox" if _kuveyt_normalize_mode(conn) == "live" else "live"
    flipped.pop("token_url", None)
    return _kuveyt_token_urls(flipped)


def _kuveyt_gateway_urls(conn: dict) -> List[str]:
    """Gravitee gateway önce; iuysal SDK apitest.../prep (veya api.kuveytturk.com.tr) yedek."""
    urls: List[str] = []
    if conn.get("base_url"):
        urls.append(str(conn.get("base_url")).rstrip("/"))
    meta = PROVIDERS["kuveytturk"]
    live = _kuveyt_normalize_mode(conn) == "live"
    urls.append((meta["live_url"] if live else meta["sandbox_url"]).rstrip("/"))
    urls.append((meta["legacy_live_url"] if live else meta["legacy_sandbox_url"]).rstrip("/"))
    seen = set()
    out = []
    for u in urls:
        if not u or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def _kuveyt_pem_body_b64(raw: str) -> str:
    """Strip PEM fences/labels; return contiguous base64 (or empty)."""
    s = (raw or "").strip()
    if not s:
        return ""
    lines = []
    for line in s.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        t = line.strip()
        if not t or t.startswith("-----"):
            continue
        if t.startswith("Proc-Type:") or t.startswith("DEK-Info:"):
            continue
        lines.append("".join(t.split()))
    return "".join(lines)


def _kuveyt_wrap_pem(body_b64: str, label: str) -> str:
    wrapped = "\n".join(body_b64[i:i + 64] for i in range(0, len(body_b64), 64))
    return f"-----BEGIN {label}-----\n{wrapped}\n-----END {label}-----"


def _kuveyt_clean_pem_paste(raw: str) -> str:
    """Paste artifacts: BOM, zero-width, markdown fences, smart quotes."""
    s = (raw or "").replace("\ufeff", "").replace("\u200b", "").replace("\u00a0", " ")
    s = s.strip().replace("\r\n", "\n").replace("\r", "\n")
    if s.startswith("```"):
        lines = s.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    # Smart quotes sometimes wrap the whole PEM
    if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'") or (s[0] == "\u201c" and s[-1] == "\u201d")):
        s = s[1:-1].strip()
    return s


def _kuveyt_pem_kind(raw: str) -> str:
    """Classify pasted PEM: private|rsa_private|encrypted|public|cert|openssh|unknown|bare."""
    u = (raw or "").upper()
    if "BEGIN ENCRYPTED PRIVATE KEY" in u:
        return "encrypted"
    if "BEGIN OPENSSH PRIVATE KEY" in u:
        return "openssh"
    if "BEGIN RSA PRIVATE KEY" in u:
        return "rsa_private"
    if "BEGIN PRIVATE KEY" in u:
        return "private"
    if "BEGIN PUBLIC KEY" in u or "BEGIN RSA PUBLIC KEY" in u:
        return "public"
    if "BEGIN CERTIFICATE" in u:
        return "cert"
    if "BEGIN" in u:
        return "unknown"
    return "bare"


def _kuveyt_normalize_pem(raw: str) -> str:
    """Return a PEM string suitable for load attempts (may still need alternate labels)."""
    s = _kuveyt_clean_pem_paste(raw)
    if not s:
        return ""
    kind = _kuveyt_pem_kind(s)
    if kind in ("private", "rsa_private", "encrypted", "openssh"):
        return s
    if kind in ("public", "cert", "unknown"):
        return s  # loader will raise a clear error
    body = _kuveyt_pem_body_b64(s) if "BEGIN" in s.upper() else "".join(s.split())
    if not body:
        return ""
    # Prefer PKCS8 label for bare base64; loader also tries PKCS1.
    return _kuveyt_wrap_pem(body, "PRIVATE KEY")


def _kuveyt_pem_candidates(raw: str) -> List[str]:
    """Ordered PEM variants to try when loading a private key."""
    s = _kuveyt_clean_pem_paste(raw)
    if not s:
        return []
    kind = _kuveyt_pem_kind(s)
    out: List[str] = []
    if kind in ("private", "rsa_private", "encrypted", "openssh"):
        out.append(s)
        return out
    if kind in ("public", "cert"):
        out.append(s)
        return out
    body = _kuveyt_pem_body_b64(s) if "BEGIN" in s.upper() else "".join(s.split())
    if not body:
        return []
    # Bare DER-as-base64: try PKCS8 then classic PKCS1 RSA.
    for label in ("PRIVATE KEY", "RSA PRIVATE KEY"):
        out.append(_kuveyt_wrap_pem(body, label))
    return out


def _kuveyt_private_key_raw(conn: dict) -> str:
    """Raw private key paste from private_key (preferred) or PEM-looking api_key."""
    for key in ("private_key", "api_key"):
        raw = _plain_secret(conn, key)
        if not raw:
            continue
        if key == "api_key":
            # Gravitee Api Anahtarı is a short UUID — never treat as RSA key.
            if "BEGIN" not in raw.upper() and "MII" not in raw:
                continue
            if _kuveyt_looks_like_uuid(raw):
                continue
        return raw
    return ""


def _kuveyt_private_key_pem(conn: dict) -> str:
    """Cleaned RSA private key paste (headers optional); empty if missing."""
    raw = _kuveyt_private_key_raw(conn)
    return _kuveyt_clean_pem_paste(raw) if raw else ""


def _kuveyt_require_rsa_size(key):
    """JSEncrypt getting-started: production min 2048-bit (openssl genrsa 2048). Default JS keygen is 1024."""
    bits = int(getattr(key, "key_size", 0) or 0)
    if bits and bits < 2048:
        raise RuntimeError(
            f"Kuveyt Türk RSA anahtarı {bits}-bit. JSEncrypt getting-started üretim için en az 2048-bit ister "
            "(openssl genrsa -out private.pem 2048). JSEncrypt varsayılan 1024-bit demo anahtarını kullanmayın."
        )
    return key


def _kuveyt_load_private_key(pem: str):
    from cryptography.hazmat.primitives.serialization import (
        load_pem_private_key,
        load_der_private_key,
        load_ssh_private_key,
    )

    raw = _kuveyt_clean_pem_paste(pem)
    kind = _kuveyt_pem_kind(raw)
    if kind == "public":
        raise RuntimeError(
            "Kuveyt Türk RSA alanı genel anahtar (PUBLIC KEY) içeriyor. "
            "JSEncrypt/OpenSSL getting-started: openssl rsa -pubout ile üretilen public.pem imza için kullanılmaz. "
            "private.pem yapıştırın — -----BEGIN RSA PRIVATE KEY----- veya -----BEGIN PRIVATE KEY-----."
        )
    if kind == "cert":
        raise RuntimeError(
            "Kuveyt Türk RSA alanı sertifika (CERTIFICATE) içeriyor. "
            "İmza için özel anahtar PEM gerekli (-----BEGIN PRIVATE KEY-----)."
        )
    if kind == "encrypted":
        raise RuntimeError(
            "Kuveyt Türk RSA özel anahtarı şifreli (ENCRYPTED PRIVATE KEY). "
            "Şifresiz PKCS8 PEM kullanın veya anahtarı parola olmadan dışa aktarın."
        )

    errors: List[str] = []
    candidates = _kuveyt_pem_candidates(raw) or ([raw] if raw else [])
    for cand in candidates:
        ck = _kuveyt_pem_kind(cand)
        try:
            if ck == "openssh":
                return _kuveyt_require_rsa_size(load_ssh_private_key(cand.encode("utf-8"), password=None))
            return _kuveyt_require_rsa_size(load_pem_private_key(cand.encode("utf-8"), password=None))
        except RuntimeError:
            raise
        except Exception as e:
            errors.append(_err_text(e))
        try:
            body = _kuveyt_pem_body_b64(cand)
            if body:
                der = base64.b64decode(body, validate=False)
                if der:
                    return _kuveyt_require_rsa_size(load_der_private_key(der, password=None))
        except RuntimeError:
            raise
        except Exception as e:
            errors.append(f"DER:{_err_text(e)}")

    hint = errors[-1] if errors else "boş veya geçersiz"
    if kind == "bare" or any("no BEGIN/END delimiters for a private key" in e for e in errors):
        hint = (
            "PEM başlık/altlık yok (JSEncrypt Invalid key). "
            "openssl genrsa -out private.pem 2048 çıktısının tamamını yapıştırın: "
            "-----BEGIN RSA PRIVATE KEY----- … -----END RSA PRIVATE KEY-----."
        )
    raise RuntimeError(
        "Kuveyt Türk RSA özel anahtarı okunamadı. PKCS8 PEM "
        "(-----BEGIN PRIVATE KEY-----) veya OpenSSL/JSEncrypt PKCS1 "
        "(-----BEGIN RSA PRIVATE KEY-----) beklenir. "
        f"{hint}"
    ) from None


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


_JSENCRYPT_BRIDGE_DIR = Path(__file__).resolve().parent / "jsencrypt_bridge"
_JSENCRYPT_SIGN_JS = _JSENCRYPT_BRIDGE_DIR / "sign.js"


def _kuveyt_sign_payload(access_token: str, *, query_string: str = "", json_body: str = "") -> str:
    """GET: accessToken.trim()+queryString; POST: accessToken+jsonBody (portal JSEncrypt)."""
    if json_body:
        return (access_token or "") + json_body
    return (access_token or "").strip() + (query_string or "")


def _jsencrypt_sign_sha256(pem: str, data: str) -> str:
    """travist/jsencrypt JSEncrypt.signSha256 — github.com/travist/jsencrypt."""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("JSEncrypt için node bulunamadı")
    if not _JSENCRYPT_SIGN_JS.is_file():
        raise RuntimeError("JSEncrypt köprüsü (sign.js) yok")
    proc = subprocess.run(
        [node, str(_JSENCRYPT_SIGN_JS)],
        input=json.dumps({"privateKey": pem, "data": data}, ensure_ascii=False),
        capture_output=True,
        text=True,
        timeout=20,
        cwd=str(_JSENCRYPT_BRIDGE_DIR),
        check=False,
    )
    sig = (proc.stdout or "").strip()
    if proc.returncode != 0 or not sig:
        err = (proc.stderr or proc.stdout or "imza alınamadı").strip()[:240]
        raise RuntimeError(f"JSEncrypt.signSha256 başarısız: {err}")
    return sig


def _kuveyt_sign_python(pem: str, data: str) -> str:
    """JSEncrypt.signSha256 ile aynı: PKCS1-v1.5 + SHA-256 (node yoksa yedek)."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    key = _kuveyt_load_private_key(pem)
    sig = key.sign(data.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(sig).decode("ascii")


def _kuveyt_sign(access_token: str, pem: str, *, query_string: str = "", json_body: str = "") -> str:
    """Kuveyt Signature = travist/jsencrypt JSEncrypt.signSha256.

    GET: accessToken.trim() + queryString (?k=v&…, URL-encode yok).
    POST: accessToken + jsonBody (trim yok).
    """
    payload = _kuveyt_sign_payload(access_token, query_string=query_string, json_body=json_body)
    _kuveyt_load_private_key(pem)
    try:
        return _jsencrypt_sign_sha256(pem, payload)
    except Exception as e:
        logger.warning("JSEncrypt node imza yok, PKCS1 SHA256 yedek: %s", _err_text(e)[:160])
        return _kuveyt_sign_python(pem, payload)


def _kuveyt_headers(
    token: str,
    conn: dict,
    *,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[str] = None,
) -> Dict[str, str]:
    # Golive dokümanı: Signature + access token + Content-Type application/json.
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "LanguageId": "1",
    }
    api_key = _plain_secret(conn, "api_key")
    if api_key:
        headers["X-Gravitee-Api-Key"] = api_key
    pem = _kuveyt_private_key_pem(conn)
    if pem:
        if json_body is not None:
            headers["Signature"] = _kuveyt_sign(token, pem, json_body=json_body)
        else:
            headers["Signature"] = _kuveyt_sign(token, pem, query_string=_kuveyt_query_string(params))
    return headers


def _kuveyt_normalize_secret(val: str) -> str:
    """Paste artifacts: quotes, zero-width, BOM, and accidental whitespace/newlines.

    Portal copy-paste often inserts newlines or spaces inside Client Secret / Müşteri Id;
    Identity Server then returns invalid_client even when the characters are otherwise correct.
    """
    s = (val or "").strip().replace("\ufeff", "").replace("\u200b", "").replace("\u00a0", "")
    if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
        s = s[1:-1].strip()
    # Non-PEM secrets must be a single token — collapse all whitespace.
    if "BEGIN" not in s.upper():
        s = "".join(s.split())
    return s


def normalize_kuveyt_connection_secrets(conn: dict) -> dict:
    """Persist/read path: strip paste noise from Kuveyt identity fields."""
    out = dict(conn or {})
    if (out.get("provider") or "") != "kuveytturk":
        return out
    for key in ("client_id", "client_secret", "api_key"):
        raw = out.get(key)
        if raw and not is_masked_secret(raw):
            out[key] = _kuveyt_normalize_secret(str(raw))
    pk = out.get("private_key")
    if pk and not is_masked_secret(pk):
        cleaned = _kuveyt_clean_pem_paste(str(pk))
        # Persist with proper PEM fences when user pasted bare base64.
        kind = _kuveyt_pem_kind(cleaned)
        if kind == "bare" and cleaned:
            body = "".join(cleaned.split())
            if body:
                cleaned = _kuveyt_wrap_pem(body, "PRIVATE KEY")
        out["private_key"] = cleaned
    return out


# Postman "1. Account Transaction v3" token body scope
_KUVEYT_POSTMAN_TX_SCOPE = "public loans accounts transfers cards digital_payments"
# Resmi V3 query itemCount (Postman örneği 2 — senkron için üst sınır)
_KUVEYT_TX_ITEM_COUNT = "200"


def _kuveyt_scope_candidates(conn: dict) -> List[str]:
    """Official Python/JS samples: client_credentials uses scope=public first.

    Bağlantı testi / genel CC için public önce. Hesap hareketi ayrı aday listesi kullanır.
    """
    out: List[str] = []
    custom = (conn.get("scope") or "").strip()
    for s in (
        "public",
        custom,
        _KUVEYT_POSTMAN_TX_SCOPE,
        "accounts",
        "accounts public",
        "public accounts",
        "",
    ):
        if s is None:
            continue
        s = str(s).strip()
        if s not in out:
            out.append(s)
    return out


def _kuveyt_tx_scope_candidates(conn: dict) -> List[str]:
    """Hesap hareketi CC: Gateway JWT'de accounts ister (403 Invalid Scope).

    Bağlantı testi / fx hâlâ `_kuveyt_scope_candidates` (public önce).
    """
    out: List[str] = []
    custom = (conn.get("scope") or "").strip()
    for s in (
        "accounts",
        custom,
        _KUVEYT_POSTMAN_TX_SCOPE,
        "accounts public",
        "public",
        "",
    ):
        if s is None:
            continue
        s = str(s).strip()
        if s not in out:
            out.append(s)
    return out


def _kuveyt_token_auth_attempts(
    client_id: str, client_secret: str, scope: str, url: str = ""
) -> List[Dict[str, Any]]:
    """OIDC: client_secret_post önce. Gravitee client_secret_basic dener; iuysal SDK yalnızca body."""
    form_base: Dict[str, str] = {"grant_type": "client_credentials"}
    if scope:
        form_base["scope"] = scope
    attempts: List[Dict[str, Any]] = [
        {
            "data": {**form_base, "client_id": client_id, "client_secret": client_secret},
            "headers": {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            "label": "body",
        },
    ]
    host = _kuveyt_host_from_url(url)
    if host not in _KUVEYT_SDK_ID_HOSTS:
        attempts.append(
            {
                "data": {**form_base},
                "headers": {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                    "Authorization": _basic_auth_header(client_id, client_secret),
                },
                "label": "basic",
            }
        )
    return attempts


_KUVEYT_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


def _kuveyt_looks_like_uuid(val: str) -> bool:
    return bool(val and _KUVEYT_UUID_RE.match(val) and len(val) == 36)


def _kuveyt_secret_looks_like_api_key(client_secret: str, api_key: str) -> bool:
    """Portal Api Anahtarı UUID; Client Secret genelde farklı uzun/opaque bir değerdir."""
    sec = (client_secret or "").strip()
    key = (api_key or "").strip()
    if key and sec and sec == key:
        return True
    return _kuveyt_looks_like_uuid(sec)


def _kuveyt_cred_swap_hints(client_id: str, client_secret: str, api_key: str) -> List[str]:
    """Alan karışıklığı: Müşteri Id / Client Secret / Api Anahtarı yer değiştirmiş olabilir."""
    hints: List[str] = []
    cid = (client_id or "").strip()
    sec = (client_secret or "").strip()
    key = (api_key or "").strip()
    if key and cid and cid == key:
        hints.append("client_id=api_key")
    if key and sec and sec == key:
        hints.append("secret=api_key")
    if _kuveyt_secret_looks_like_api_key(sec, key) and "secret=api_key" not in hints:
        hints.append("secret≈uuid")
    if key and _kuveyt_looks_like_uuid(cid) and _kuveyt_looks_like_uuid(key) and cid != key:
        # İkisi de UUID — kullanıcı Api Anahtarı’nı Müşteri Id sanmış olabilir; uyarı değil bilgi
        pass
    return hints


def _kuveyt_cred_fingerprint(client_id: str, client_secret: str, api_key: str) -> str:
    """Log/UI için gizli değerleri göstermeden kimlik özeti."""
    parts = [
        f"client_id={len(client_id)}kr",
        f"secret={len(client_secret)}kr",
        f"api_key={'var' if api_key else 'yok'}",
    ]
    parts.extend(_kuveyt_cred_swap_hints(client_id, client_secret, api_key))
    return ", ".join(parts)


async def _kuveyt_post_token(
    client: httpx.AsyncClient,
    url: str,
    client_id: str,
    client_secret: str,
    scope: str,
) -> tuple[Optional[str], Optional[str], int]:
    """Returns (access_token | None, error_text | None, status_code)."""
    attempts = _kuveyt_token_auth_attempts(client_id, client_secret, scope, url)
    last_err = None
    last_code = 0
    for attempt in attempts:
        resp = None
        for try_i in range(2):  # tek yeniden deneme (yavaş Identity)
            try:
                resp = await client.post(url, data=attempt["data"], headers=attempt["headers"])
                break
            except httpx.TimeoutException as e:
                last_err = f"{url} [{attempt['label']}] → {_err_text(e)}"
                last_code = 0
                if try_i == 0:
                    continue
                resp = None
            except Exception as e:
                last_err = f"{url} [{attempt['label']}] → {_err_text(e)}"
                last_code = 0
                resp = None
                break
        if resp is None:
            continue
        last_code = resp.status_code
        if resp.status_code < 400:
            data = resp.json() if resp.content else {}
            token = (data or {}).get("access_token") or (data or {}).get("accessToken")
            if token:
                return str(token), None, resp.status_code
            last_err = f"{url} [{attempt['label']}] → access_token yok"
            continue
        err_txt = _oauth_error_text(resp, url) + f" [{attempt['label']}]"
        last_err = err_txt
        blob = (getattr(resp, "text", None) or "").lower()
        ctype = (resp.headers.get("content-type") or "").lower()
        is_html = (
            "text/html" in ctype
            or blob.lstrip().startswith("<!doctype")
            or blob.lstrip().startswith("<html")
        )
        if resp.status_code == 404 or is_html:
            return None, err_txt, resp.status_code
        if "invalid_client" in blob:
            return None, err_txt, resp.status_code
    return None, last_err, last_code


async def _kuveyt_access_token(conn: dict, scopes: Optional[List[str]] = None) -> str:
    """Token: Canlı’da identity.kuveytturk.com.tr /connect/token önce; Sandbox’ta idprep SDK önce.

    invalid_client bir host’ta diğer Identity ailesini durdurmaz (farklı OAuth sunucuları).
    404/HTML’de bir sonraki host denenir.
    """
    client_id = _kuveyt_normalize_secret(_plain_secret(conn, "client_id"))
    client_secret = _kuveyt_normalize_secret(_plain_secret(conn, "client_secret"))
    api_key = _kuveyt_normalize_secret(_plain_secret(conn, "api_key"))
    mode = _kuveyt_normalize_mode(conn)
    if not client_id or not client_secret:
        raise RuntimeError(
            "Kuveyt Türk Client ID (Müşteri Id) ve Client Secret gerekli (client_credentials). "
            "Api Anahtarı token için değil; API çağrılarına X-Gravitee-Api-Key olarak gider."
        )

    last_err = "Token uç noktası yanıt vermedi."
    primary_err = ""
    saw_invalid_client = False
    tried_urls: List[str] = []
    scope_list = list(scopes) if scopes is not None else _kuveyt_scope_candidates(conn)
    saw_timeout = False
    async with httpx.AsyncClient(timeout=_KUVEYT_TOKEN_TIMEOUT) as client:
        for url in _kuveyt_token_urls(conn):
            tried_urls.append(url)
            for scope in scope_list:
                token, err, code = await _kuveyt_post_token(client, url, client_id, client_secret, scope)
                if token:
                    conn["_kuveyt_token_url"] = url
                    conn["_kuveyt_token_scope"] = scope
                    return token
                if err:
                    last_err = err
                    blob = err.lower()
                    if not primary_err:
                        primary_err = err
                    if "timeout" in blob or "süresi aşıldı" in blob:
                        saw_timeout = True
                    if "invalid_client" in blob:
                        saw_invalid_client = True
                        break
                    if code == 404 or "html" in blob:
                        break

        alt_hint = ""
        if saw_invalid_client:
            alt_ok = False
            alt_also_invalid = False
            for alt_url in _kuveyt_alt_token_urls(conn):
                if alt_url in tried_urls:
                    continue
                alt_token, alt_err, _ = await _kuveyt_post_token(
                    client, alt_url, client_id, client_secret, "public"
                )
                if alt_token:
                    alt_ok = True
                    other = "Sandbox" if mode == "live" else "Canlı"
                    current = "Canlı" if mode == "live" else "Sandbox"
                    alt_hint = (
                        f" Teşhis: aynı Müşteri Id/Secret {other} Identity’de token aldı "
                        f"({alt_url}), ama bağlantı modu={current}. Portalden {current} "
                        f"uygulama kimliklerini kopyalayın veya bağlantı modunu {other} yapın. "
                    )
                    break
                if alt_err and "invalid_client" in alt_err.lower():
                    alt_also_invalid = True
            if not alt_ok and alt_also_invalid:
                alt_hint = (
                    " Teşhis: hem Canlı hem Sandbox Identity (Gravitee ve idprep/id) "
                    "invalid_client döndü — Müşteri Id / Client Secret portaldeki değerlerle eşleşmiyor. "
                )

    detail = primary_err or last_err
    hint = ""
    if saw_timeout and not saw_invalid_client:
        hosts = ", ".join(tried_urls[:4]) if tried_urls else "Identity"
        hint = (
            f" Identity zaman aşımı: {hosts}. "
            "Sunucu çıkış IP’si banka whitelist’te mi ve identity / prep-identity / idprep erişilebilir mi kontrol edin. "
        )
    if saw_invalid_client:
        swaps = _kuveyt_cred_swap_hints(client_id, client_secret, api_key)
        hint = (
            " invalid_client: Müşteri Id / Client Secret bu Identity ortamında geçersiz "
            "(veya uygulamada client_credentials kapalı). "
            "Portalden Client Secret’i yeniden kopyalayın; Api Anahtarı’nı Client Secret "
            "yerine yazmayın. "
        ) + alt_hint
        if "secret≈uuid" in swaps or "secret=api_key" in swaps:
            hint += (
                "Kayıtlı Client Secret UUID formatında (Api Anahtarı gibi) — "
                "portalden asıl Client Secret’i Client Secret alanına yapıştırın. "
            )
        if "client_id=api_key" in swaps:
            hint += (
                "Müşteri Id ile Api Anahtarı aynı — Müşteri Id alanına portaldeki "
                "Müşteri Id’yi, Api Anahtarı alanına Gravitee anahtarını yazın. "
            )
        if alt_hint and "eşleşmiyor" in alt_hint:
            hint += (
                "Adımlar: 1) Düzenle → Müşteri Id + Client Secret’i portalden tek satır "
                "olarak yeniden yapıştırın (Api Anahtarı değil). 2) Prep/test uygulaması → "
                "Sandbox; canlı onaylı uygulama → Canlı. 3) Kaydet & Test Et. "
            )
    fp = _kuveyt_cred_fingerprint(client_id, client_secret, api_key)
    raise RuntimeError(
        "Kuveyt Türk token alınamadı (Identity Server client_credentials)."
        f"{hint}"
        f"Mod={mode}; {fp}. "
        "Token: POST Gravitee identity|prep-identity …/connect/token veya resmi SDK …/api/connect/token "
        "(body: grant_type, client_id, client_secret, scope=public veya hesap hareketinde accounts). "
        f"(canlı: identity.kuveytturk.com.tr + id.kuveytturk.com.tr / sandbox: idprep + prep-identity). ({detail[:220]})"
    )


async def _kuveyt_refresh_user_token(conn: dict) -> str:
    """authorization_code refresh_token → yeni access_token (Hesap İşlem için)."""
    refresh = _kuveyt_normalize_secret(_plain_secret(conn, "refresh_token"))
    client_id = _kuveyt_normalize_secret(_plain_secret(conn, "client_id"))
    client_secret = _kuveyt_normalize_secret(_plain_secret(conn, "client_secret"))
    if not refresh or not client_id or not client_secret:
        return ""
    for url in _kuveyt_token_urls(conn):
        async with httpx.AsyncClient(timeout=_KUVEYT_TOKEN_TIMEOUT) as client:
            try:
                resp = await client.post(
                    url,
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": refresh,
                        "client_id": client_id,
                        "client_secret": client_secret,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            except Exception:
                continue
            if resp.status_code >= 400:
                continue
            try:
                data = resp.json()
            except Exception:
                continue
            tok = data.get("access_token") or data.get("accessToken") or ""
            if tok:
                return str(tok)
    return ""


async def _kuveyt_account_bearer(conn: dict) -> tuple:
    """Hesap API’si için bearer: önce kullanıcı (auth code) access_token, sonra CC.

    Returns (token, kind) where kind is 'user' | 'cc'.
    CC token Postman Account Transaction v3 scope listesiyle alınır.
    """
    stored = _plain_secret(conn, "access_token")
    if stored:
        expired = _jwt_expired(stored)
        if expired is not True:
            return stored, "user"
        refreshed = await _kuveyt_refresh_user_token(conn)
        if refreshed:
            return refreshed, "user"
    cc = await _kuveyt_access_token(conn, scopes=_kuveyt_tx_scope_candidates(conn))
    return cc, "cc"


async def _kuveyt_probe(conn: dict) -> Dict[str, Any]:
    """Bağlantı testi: token + GET /v1/fx/rates (abonelikteki public CC uç).

    /v1/data/banks bu uygulamada abone değildir.
    """
    token = await _kuveyt_access_token(conn)
    pem = _kuveyt_private_key_pem(conn)
    mode = _kuveyt_normalize_mode(conn)
    identity_used = conn.get("_kuveyt_token_url") or (
        _kuveyt_sdk_identity_host(conn) + _kuveyt_sdk_token_path()
    )
    extra = " RSA-SHA256 imza anahtarı yok — fx/rates ve hareket için PKCS8 PEM gerekli."
    probe_ok = True
    if pem:
        headers = _kuveyt_headers(token, conn)
        last_probe = ""
        probe_ok = False
        timed_out: List[str] = []
        async with httpx.AsyncClient(timeout=_KUVEYT_GATEWAY_TIMEOUT) as client:
            for base in _kuveyt_gateway_urls(conn):
                url = f"{base}/v1/fx/rates"
                resp = None
                for try_i in range(2):
                    try:
                        resp = await client.get(url, headers=headers)
                        break
                    except httpx.TimeoutException as e:
                        last_probe = f"{url} → {_err_text(e)}"
                        if try_i == 0:
                            continue
                        timed_out.append(url)
                        resp = None
                    except httpx.RequestError as e:
                        last_probe = f"{url} → {_err_text(e)}"
                        resp = None
                        break
                if resp is None:
                    extra = f" ({last_probe})"
                    continue
                last_probe = f"{url} HTTP {resp.status_code}"
                if resp.status_code in (401, 403):
                    detail = _api_error_detail(resp)
                    blob = f"{detail} {getattr(resp, 'text', '') or ''}".lower()
                    sig_bad = any(
                        x in blob
                        for x in (
                            "signature invalid",
                            "invalid signature",
                            "signature_invalid",
                            "imza geçersiz",
                            "imza hatası",
                        )
                    ) or ("sign" in blob and "invalid" in blob)
                    if sig_bad or "imza" in blob or ("sign" in blob and resp.status_code in (401, 403)):
                        raise RuntimeError(
                            "Kuveyt Türk Signature Invalid (imza/yetki hatası). "
                            "TamKobi Private Key (.pem) ile API Market’e yüklenen .crt (Public Key) "
                            "aynı anahtar çiftinden olmalı. Anahtar üret → .crt indir → portala yükle → "
                            f"Kaydet & Test Et. HTTP {resp.status_code}. {detail[:160]}"
                        )
                    if resp.status_code == 401:
                        raise RuntimeError(
                            f"Kuveyt Türk imza/yetki hatası (HTTP {resp.status_code}). "
                            "Private Key / Signature veya token geçersiz olabilir. "
                            f"{detail[:160]}"
                        )
                if resp.status_code == 404:
                    extra = f" ({last_probe})"
                    continue
                if resp.status_code >= 400:
                    extra = f" ({last_probe})"
                    continue
                try:
                    data = resp.json()
                except Exception:
                    data = None
                biz = _kuveyt_business_error(data) if data else ""
                if biz:
                    extra = f" GET /v1/fx/rates reddedildi: {biz}"
                    continue
                extra = " GET /v1/fx/rates + RSA-SHA256 Signature doğrulandı."
                probe_ok = True
                break
        if not probe_ok and timed_out:
            raise RuntimeError(
                "Kuveyt Türk gateway zaman aşımı (ReadTimeout). "
                f"Denenen uçlar: {', '.join(timed_out)}. "
                "Sandbox için prep-gateway, canlı için gateway.kuveytturk.com.tr erişilebilir olmalı; "
                "üretim çıkış IP’si banka whitelist’te değilse yanıt gelmez. "
                f"Son: {last_probe[:180]}"
            )
    sdk_host = _kuveyt_sdk_identity_host(conn)
    return {
        "ok": probe_ok,
        "simulated": False,
        "mode": mode,
        "identity_host": identity_used,
        "message": (
            f"Kuveyt Türk Identity Server client_credentials doğrulandı "
            f"(mod={mode}, token={identity_used}, SDK {sdk_host}).{extra}"
        ),
    }


def _kuveyt_account_suffix(conn: dict) -> str:
    """Primary account ek no for path /v3/accounts/{suffix}/transactions."""
    cands = _kuveyt_account_suffix_candidates(conn)
    return cands[0] if cands else ""


def _kuveyt_account_suffix_candidates(conn: dict) -> List[str]:
    """Path {suffix} = hesap ek no (kısa), müşteri no değil.

    Örn. hesap 9698082300002 → ek no 2 (son anlamlı hane); IBAN’dan da ek çıkarılır.
    Müşteri numarası path’e konmaz (Gravitee 404 / yanlış kaynak).
    """
    short: List[str] = []
    long: List[str] = []

    def add_short(s: str):
        s = str(s or "").strip()
        if not s or s in short or s in long:
            return
        if s.isdigit() and len(s) <= 5:
            short.append(s)
        else:
            long.append(s)

    def add_long(s: str):
        s = str(s or "").strip()
        if s and s not in short and s not in long:
            long.append(s)

    raw = (conn.get("bank_account_number") or "").strip().replace(" ", "").upper()
    digits = ""
    if raw and raw != "-":
        if raw.startswith("TR") and len(raw) >= 16:
            acct = raw[10:]
            digits = "".join(ch for ch in acct if ch.isdigit())
            add_long(acct.lstrip("0") or acct)
        else:
            digits = "".join(ch for ch in raw if ch.isdigit())
            compact = digits.lstrip("0") or digits
            if compact and len(compact) <= 5:
                # Kullanıcı doğrudan ek no yazmış (örn. 2, 001, 1234)
                add_short(compact)
            elif digits:
                add_long(raw)
        if digits and len(digits) >= 6:
            # …00002 → ek 2; …001 → ek 1
            for n in (1, 2, 3, 4, 5):
                part = digits[-n:]
                ek = part.lstrip("0")
                if ek:
                    add_short(ek)
    # Explicit small suffix field if ever stored
    for key in ("account_suffix", "accountSuffix"):
        v = str(conn.get(key) or "").strip()
        if v:
            add_short(v.lstrip("0") or v)
    return short + long


def _kuveyt_tx_paths(conn: dict) -> List[str]:
    """Yalnız abone uç: GET /v3/accounts/{suffix}/transactions.

    v4/v1 ve suffiksiz path’ler bu uygulamada abone değildir.
    """
    paths: List[str] = []
    for suf in _kuveyt_account_suffix_candidates(conn)[:8]:
        p = f"/v3/accounts/{suf}/transactions"
        if p not in paths:
            paths.append(p)
    return paths


def _kuveyt_tx_query_variants(since: datetime, end: Optional[datetime] = None) -> List[Dict[str, str]]:
    """Hesap Hareketleriniz V3 query (hepsi opsiyonel).

    https://developer.kuveytturk.com.tr/documentation/hesap-yonetimi-hesaplarnz/hesap-hareketleriniz-v3
    Postman: beginDate=yyyy-MM-dd, endDate, itemCount.
    """
    end = end or datetime.now(timezone.utc)
    start_d, end_d = since.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    return [
        {},
        {"beginDate": start_d, "endDate": end_d, "itemCount": _KUVEYT_TX_ITEM_COUNT},
        {"beginDate": start_d, "endDate": end_d},
    ]


_KUVEYT_FX_CODES = ("USD", "EUR", "GBP", "CHF", "JPY")
_KUVEYT_VPOS_ORDER_PATH = "/v1/vpos/getMerchantOrderDetail"
_KUVEYT_VPOS_NON3D_PATH = "/v1/vpos/non3DPayment"


def _kuveyt_business_error(data: Any) -> str:
    """HTTP 200 + success:false is a Kuveyt business error, not transport OK."""
    if not isinstance(data, dict):
        return ""
    success = data.get("success")
    if success is False or str(success).lower() == "false":
        msg = (
            data.get("message")
            or data.get("errorMessage")
            or data.get("error")
            or data.get("results")
            or "success=false"
        )
        return str(msg)[:300]
    return ""


def _kuveyt_payload_rows(data: Any) -> List[Any]:
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for key in ("value", "values", "data", "result", "results", "fxRates", "items"):
        v = data.get(key)
        if isinstance(v, list):
            return v
        if isinstance(v, dict):
            nested = _kuveyt_payload_rows(v)
            if nested:
                return nested
    return []


def _kuveyt_num(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", ".").replace(" ", ""))
    except (TypeError, ValueError):
        return None


def parse_kuveyt_fx_payload(data: Any) -> Dict[str, dict]:
    """GET /v1/fx/rates → TamKobi kur satırları (name, fxCode, buyRate, sellRate)."""
    err = _kuveyt_business_error(data)
    if err:
        raise ValueError(f"Kuveyt FX: {err}")
    rates: Dict[str, dict] = {}
    for row in _kuveyt_payload_rows(data):
        if not isinstance(row, dict):
            continue
        code = str(
            row.get("fxCode") or row.get("FxCode") or row.get("currency") or ""
        ).strip().upper()
        if "/" in code:
            code = code.split("/")[0].strip()
        if code not in _KUVEYT_FX_CODES:
            continue
        buy = _kuveyt_num(row.get("buyRate") if row.get("buyRate") is not None else row.get("BuyRate"))
        sell = _kuveyt_num(row.get("sellRate") if row.get("sellRate") is not None else row.get("SellRate"))
        if buy is None and sell is None:
            continue
        unit = 1.0
        per_raw = sell if sell is not None else buy or 0
        if code == "JPY" and per_raw > 1:
            unit = 100.0
        per = (sell if sell is not None else buy or 0) / unit
        rates[code] = {
            "currency": code,
            "unit": unit,
            "buying": round((buy or 0) / unit, 6) if buy is not None else None,
            "selling": round((sell or 0) / unit, 6) if sell is not None else None,
            "rate": round(per, 6),
            "name": str(row.get("name") or row.get("Name") or code).strip(),
        }
    return rates


def _kuveyt_compact_json(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


async def fetch_kuveyt_fx_rates(conn: dict) -> tuple:
    """GET /v1/fx/rates (Hazine, public CC). Returns (iso_date, rates, url)."""
    from datetime import date as date_cls

    token = await _kuveyt_access_token(conn)
    pem = _kuveyt_private_key_pem(conn)
    if not pem:
        raise RuntimeError("Kuveyt Türk kurları için RSA private key (PKCS8 PEM) gerekli.")
    last = ""
    timed_out: List[str] = []
    async with httpx.AsyncClient(timeout=_KUVEYT_GATEWAY_TIMEOUT) as client:
        for base in _kuveyt_gateway_urls(conn):
            url = f"{base}/v1/fx/rates"
            headers = _kuveyt_headers(token, conn)
            try:
                resp = await client.get(url, headers=headers)
            except httpx.TimeoutException as e:
                timed_out.append(url)
                last = f"GET {url} → {_err_text(e)}"
                continue
            except httpx.RequestError as e:
                last = f"GET {url} → {_err_text(e)}"
                continue
            last = f"GET {url} HTTP {resp.status_code}: {_api_error_detail(resp)}"
            if resp.status_code == 404:
                continue
            if resp.status_code in (401, 403):
                raise RuntimeError(f"Kuveyt Türk kur API yetki hatası. {last[:220]}")
            if resp.status_code >= 400:
                continue
            try:
                data = resp.json()
            except Exception:
                continue
            try:
                rates = parse_kuveyt_fx_payload(data)
            except ValueError as e:
                last = str(e)
                continue
            if rates:
                return date_cls.today().isoformat(), rates, url
            last = f"GET {url} HTTP {resp.status_code}: kur satırı yok"
    if timed_out:
        raise RuntimeError(
            f"Kuveyt Türk kurları zaman aşımı. Denenen: {', '.join(timed_out)}. {last[:220]}"
        )
    raise RuntimeError(f"Kuveyt Türk kurları alınamadı. {last[:360]}")


async def find_company_kuveyt_connection(db, company_id: str) -> Optional[dict]:
    if db is None or not company_id:
        return None
    try:
        conns = await db.bank_connections.find(
            {"company_id": company_id, "provider": "kuveytturk"}
        ).to_list(50)
    except Exception:
        return None
    for c in conns or []:
        if not _is_simulated(c) and has_credentials(c) and _kuveyt_private_key_pem(c):
            return c
    return None


async def _kuveyt_post_signed(conn: dict, path: str, body: dict, *, token: Optional[str] = None) -> Any:
    """Tek POST + RSA imza. Aynı URL tekrar denenmez (non3D kart çekimi güvenli)."""
    tok = token or await _kuveyt_access_token(conn)
    pem = _kuveyt_private_key_pem(conn)
    if not pem:
        raise RuntimeError("Kuveyt Türk VPOS için RSA private key (PKCS8 PEM) gerekli.")
    raw = _kuveyt_compact_json(body)
    last = ""
    async with httpx.AsyncClient(timeout=30) as client:
        for base in _kuveyt_gateway_urls(conn):
            url = f"{base}{path}"
            headers = _kuveyt_headers(tok, conn, json_body=raw)
            resp = await client.post(url, content=raw.encode("utf-8"), headers=headers)
            last = f"POST {url} HTTP {resp.status_code}: {_api_error_detail(resp)}"
            if resp.status_code == 404:
                continue
            if resp.status_code >= 400:
                raise RuntimeError(f"Kuveyt Türk {path} hatası. {last[:360]}")
            try:
                data = resp.json()
            except Exception:
                raise RuntimeError(f"Kuveyt Türk {path} JSON değil. {last[:360]}")
            err = _kuveyt_business_error(data)
            if err:
                raise RuntimeError(f"Kuveyt Türk {path}: {err}")
            return data
    raise RuntimeError(f"Kuveyt Türk {path} alınamadı. {last[:360]}")


def _kuveyt_vpos_request_body(fields: dict) -> dict:
    inner = {k: v for k, v in (fields or {}).items() if v not in (None, "")}
    return {"request": inner}


async def kuveyt_get_merchant_order_detail(conn: dict, request_fields: dict) -> Any:
    """POST /v1/vpos/getMerchantOrderDetail — sipariş sorgu, kart çekmez."""
    return await _kuveyt_post_signed(conn, _KUVEYT_VPOS_ORDER_PATH, _kuveyt_vpos_request_body(request_fields))


async def kuveyt_non3d_payment(conn: dict, request_fields: dict, *, confirm_charge: bool = False) -> Any:
    """POST /v1/vpos/non3DPayment kart çeker.

    TamKobi probe/senkron/kur çekme bu fonksiyonu çağırmaz.
    confirm_charge=True yalnızca açık bir ödeme akışında kullanılmalıdır.
    """
    if not confirm_charge:
        raise RuntimeError(
            "POST /v1/vpos/non3DPayment kart çeker. TamKobi bu uç noktayı otomatik çağırmaz; "
            "confirm_charge=True yalnızca açık ödeme akışında kullanılır."
        )
    return await _kuveyt_post_signed(conn, _KUVEYT_VPOS_NON3D_PATH, _kuveyt_vpos_request_body(request_fields))


def _enpara_dead_route(resp) -> bool:
    text = getattr(resp, "text", None) or ""
    code = getattr(resp, "status_code", 0) or 0
    return "404-EPG96" in text or "404-QPG97" in text or code == 404


def _jwt_unverified_payload(token: str) -> Optional[dict]:
    """İmza doğrulamadan JWT gövdesi — yalnızca hata teşhisi (token loglanmaz)."""
    raw = (token or "").strip()
    parts = raw.split(".")
    if len(parts) != 3:
        return None
    try:
        pad = "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + pad))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _jwt_scope_claim(token: str) -> str:
    payload = _jwt_unverified_payload(token) or {}
    scp = payload.get("scope") or payload.get("scp") or ""
    if isinstance(scp, (list, tuple)):
        return " ".join(str(x) for x in scp).strip()
    return str(scp).strip()


def _kuveyt_is_invalid_scope(resp, detail: str = "") -> bool:
    blob = f"{detail} {getattr(resp, 'text', '') or ''} {_api_error_detail(resp)}".lower()
    return int(getattr(resp, "status_code", 0) or 0) == 403 and "invalid scope" in blob


def _jwt_expired(token: str, *, skew_sec: int = 30) -> Optional[bool]:
    """True=süresi dolmuş, False=geçerli, None=JWT değil / exp yok."""
    payload = _jwt_unverified_payload(token)
    if not payload:
        return None
    try:
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
    w_start, w_end = _enpara_day_windows(end, end)[-1]
    payloads = _enpara_payload_variants(w_start, w_end, account, customer)
    if not payloads:
        raise RuntimeError(_ENPARA_MISSING_ACCOUNT)
    body = payloads[0]
    del since
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
            try:
                probe_data = resp.json()
            except Exception:
                probe_data = None
            res_err = _enpara_result_error(probe_data)
            if res_err:
                if "364737" in res_err or _enpara_is_missing_account_error(res_err):
                    raise RuntimeError(
                        "Enpara IBAN veya hesap no istiyor (resultCode 364737). "
                        "Düzenle → 26 haneli IBAN girin. "
                        f"{res_err[:220]}"
                    )
                extra = f" Servis uyarısı: {res_err[:200]}"
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
    except httpx.TimeoutException as e:
        return {
            "ok": False,
            "simulated": False,
            "message": (
                f"Bağlantı kurulamadı: {_err_text(e)}. "
                "İstek URL’si yanıt vermedi — banka host erişimi / whitelist kontrol edin."
            ),
        }
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


def _ci_get(raw: Any, *names: str) -> Any:
    """Case-insensitive dict get; skips empty values."""
    if not isinstance(raw, dict):
        return None
    wanted = [n.lower().replace("_", "") for n in names]
    by_norm = {str(k).lower().replace("_", ""): v for k, v in raw.items()}
    for n in wanted:
        v = by_norm.get(n)
        if v is not None and v != "":
            return v
    return None


def _parse_amount(val: Any) -> float:
    if val is None or val == "":
        return 0.0
    if isinstance(val, dict):
        inner = _ci_get(val, "amount", "value", "tutar")
        return _parse_amount(inner) if inner is not None else 0.0
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


_TX_HINT_KEYS = {
    "amount", "tutar", "transactionamount", "creditamount", "debitamount",
    "alacak", "borc", "borç", "islemtutari", "islemtutar",
    "transactiondate", "islemtarihi", "bookingdate", "valuedate", "tarih", "date",
    "accountingdate", "dekonttarihi",
    "aciklama", "description", "explanation", "accounttransactionexplanation",
    "fisno", "referansno", "referencenumber", "transactionreference", "businesskey",
}

_TX_LIST_KEYS = (
    "transactions", "items", "accountTransactions", "accountActivities",
    "statementLines", "lines",
    "hareketler", "accountStatement", "statement", "results", "content",
    "transactionList", "transactionTable", "accountStatementList",
    "hesapHareketleri", "ekstre", "ekstreHareketleri", "value", "data", "list",
)


def _row_tx_score(row: dict) -> int:
    keys = {str(k).lower().replace("_", "") for k in row}
    return sum(1 for h in _TX_HINT_KEYS if h in keys)


def _dig_list(raw: Any, keys: tuple = _TX_LIST_KEYS) -> Optional[list]:
    if isinstance(raw, list):
        return raw
    if not isinstance(raw, dict):
        return None
    for k in keys:
        v = _ci_get(raw, k)
        if isinstance(v, list):
            return v
        if isinstance(v, dict):
            nested = _dig_list(v, keys)
            if nested is not None:
                return nested
    return None


def _find_tx_rows(raw: Any, depth: int = 0) -> Optional[list]:
    """Find the list that looks like bank movements, including PascalCase QNB wrappers."""
    named = _dig_list(raw)
    if isinstance(named, list) and named and all(isinstance(x, dict) for x in named[:3]):
        if sum(_row_tx_score(x) for x in named[:8] if isinstance(x, dict)) >= max(1, min(3, len(named[:8]))):
            return named
        if named and _row_tx_score(named[0]) >= 1:
            return named
    best: Optional[list] = None
    best_score = 0

    def walk(node: Any, d: int) -> None:
        nonlocal best, best_score
        if d > 8:
            return
        if isinstance(node, list):
            dicts = [x for x in node if isinstance(x, dict)]
            if dicts:
                score = sum(_row_tx_score(x) for x in dicts[:8])
                if score >= len(dicts[:8]) and score > best_score:
                    best, best_score = dicts, score
            for x in node[:40]:
                walk(x, d + 1)
            return
        if isinstance(node, dict):
            for v in node.values():
                walk(v, d + 1)

    walk(raw, depth)
    return named if best is None else best


def _has_explicit_empty_tx_list(raw: Any, depth: int = 0) -> bool:
    if depth > 6:
        return False
    if isinstance(raw, list):
        return len(raw) == 0
    if not isinstance(raw, dict):
        return False
    for k in _TX_LIST_KEYS:
        v = _ci_get(raw, k)
        if isinstance(v, list) and len(v) == 0:
            return True
    for nest_name in ("data", "value", "result", "body", "return", "content"):
        nest = _ci_get(raw, nest_name)
        if nest is not None and _has_explicit_empty_tx_list(nest, depth + 1):
            return True
    return False


def _normalize_tx_rows(raw: Any) -> List[Dict[str, Any]]:
    rows = _find_tx_rows(raw)
    if rows is None:
        return []
    txs = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        # Ticket / durum satırlarını hareket sanma
        status = str(_ci_get(r, "status", "ticketStatus", "state") or "").lower()
        if status in ("pending", "processing", "queued", "waiting", "inprogress", "in_progress") and not (
            _ci_get(r, "amount", "tutar", "Amount", "transactionAmount")
        ):
            continue
        amount = _parse_amount(
            _ci_get(
                r, "amount", "Amount", "transactionAmount", "tutar", "Tutar",
                "islemtutari", "islemTutari", "creditAmount", "debitAmount",
            )
        )
        credit = _parse_amount(_ci_get(r, "creditAmount", "alacak", "Alacak", "credit", "alacakTutar"))
        debit = _parse_amount(_ci_get(r, "debitAmount", "borc", "Borc", "borç", "debit", "borcTutar"))
        if credit and not debit:
            amount, direction = credit, "credit"
        elif debit and not credit:
            amount, direction = debit, "debit"
        else:
            direction_hint = str(
                _ci_get(
                    r, "direction", "creditDebitIndicator", "type", "transactionType",
                    "islemYonu", "hareketTipi", "borcAlacak",
                ) or ""
            ).lower()
            if direction_hint in ("credit", "alacak", "a", "in", "inflow", "cr", "c", "+", "1"):
                direction = "credit"
            elif direction_hint in ("debit", "borc", "borç", "b", "out", "outflow", "dr", "d", "-", "2"):
                direction = "debit"
            else:
                direction = "credit" if amount >= 0 else "debit"
            amount = abs(amount)
        if amount == 0:
            continue
        date = _normalize_date(
            _ci_get(
                r, "transactionDate", "bookingDate", "date", "valueDate",
                "islemTarihi", "IslemTarihi", "valorTarihi", "tarih",
                "accountingDate", "dekontTarihi",
            )
        )
        txs.append({
            "external_id": str(
                _ci_get(
                    r, "transactionId", "id", "transactionReference", "businessKey",
                    "referenceNo", "bookingId",
                    "fisNo", "dekontNo", "referansNo", "refNo", "referenceNumber",
                    "seqNum",
                )
                or hashlib.sha256(str(r).encode()).hexdigest()[:16]
            ),
            "date": date,
            "amount": amount,
            "direction": direction,
            "description": (
                _ci_get(
                    r, "description", "explanation", "narrative", "aciklama",
                    "Aciklama", "islemAciklama", "accountTransactionExplanation",
                ) or "Banka Hareketi"
            ),
            "counterparty": (
                _ci_get(
                    r, "counterpartyName", "senderName", "counterparty",
                    "karsiHesapAdi", "gonderenAdi", "aliciAdi",
                ) or ""
            ),
            "currency": _ci_get(r, "currency", "currencyCode", "fxCode", "paraBirimi") or "TRY",
            "is_simulated": False,
        })
    return txs


def _extract_balance(raw: Any, prefer_iban: str = "") -> Optional[float]:
    prefer = (prefer_iban or "").replace(" ", "").upper()
    found_pref: Optional[float] = None
    found_hi: Optional[float] = None
    found_lo: Optional[float] = None
    hi = {"usablebalance", "availablebalance", "guncelbakiye", "hesapbakiyesi"}
    lo = {"currentbalance", "ledgerbalance", "accountbalance", "endbalance", "bakiye", "balance"}

    def _as_amount(v: Any) -> Optional[float]:
        if v is None or v == "":
            return None
        return _parse_amount(v)

    def consider(d: dict) -> None:
        nonlocal found_pref, found_hi, found_lo
        iban = str(_ci_get(d, "iban") or "").replace(" ", "").upper()
        for k, v in d.items():
            lk = str(k).lower().replace("_", "")
            if lk not in hi and lk not in lo:
                continue
            parsed = _as_amount(v)
            if parsed is None:
                continue
            matched = bool(prefer and iban and (iban == prefer or iban.endswith(prefer[-10:] if len(prefer) >= 10 else prefer)))
            if matched and found_pref is None:
                found_pref = parsed
            elif lk in hi and found_hi is None:
                found_hi = parsed
            elif lk in lo and found_lo is None:
                found_lo = parsed

    def walk(node: Any, depth: int) -> None:
        if depth > 10:
            return
        if isinstance(node, dict):
            consider(node)
            for v in node.values():
                walk(v, depth + 1)
        elif isinstance(node, list):
            for it in node[:80]:
                walk(it, depth + 1)

    walk(raw, 0)
    for x in (found_pref, found_hi, found_lo):
        if x is not None:
            return x
    return None


def _ticket_id_from(data: Any, depth: int = 0) -> Optional[str]:
    """Ticket no only — generic `id` is NOT a ticket (correlation / statement id)."""
    if depth > 8:
        return None
    if isinstance(data, list):
        for item in data[:30]:
            tid = _ticket_id_from(item, depth + 1)
            if tid:
                return tid
        return None
    if not isinstance(data, dict):
        return None
    for k, v in data.items():
        lk = str(k).lower().replace("_", "")
        if lk in ("ticketno", "ticketid", "ticket", "ticketnumber", "requestticket"):
            if v and not isinstance(v, (dict, list)):
                s = str(v).strip()
                if s and s.lower() not in ("null", "none", "0"):
                    return s
    for v in data.values():
        if isinstance(v, (dict, list)):
            tid = _ticket_id_from(v, depth + 1)
            if tid:
                return tid
    return None


def _ticket_ready(data: Any) -> Optional[bool]:
    """True=ekstre hazır, False=bekliyor, None=bilinmiyor.

    Enpara/QNB `status: SUCCESS` istek kabulüdür, boş ekstre değildir — ticket poll gerekir.
    """
    if not isinstance(data, dict):
        return None
    nested = _ci_get(data, "data", "result", "value")
    nested = nested if isinstance(nested, dict) else {}
    status = str(
        _ci_get(data, "status", "ticketStatus", "state")
        or _ci_get(nested, "status", "ticketStatus", "state")
        or ""
    ).lower()
    if status in (
        "completed", "complete", "ready", "done", "finished",
        "hazir", "tamamlandi", "tamamlandı", "processed",
    ):
        return True
    if status in (
        "pending", "processing", "queued", "waiting", "inprogress", "in_progress",
        "running", "created", "new", "accepted", "received",
    ):
        return False
    return None


def _enpara_body_hint(data: Any) -> str:
    if isinstance(data, dict):
        keys = ",".join(str(k) for k in list(data.keys())[:14])
        return f"anahtarlar={keys or '—'}"
    if isinstance(data, list):
        return f"liste({len(data)})"
    return type(data).__name__


def _enpara_response_hint(resp, data: Any = None) -> str:
    """Ham gövdeyi görünür kıl — 'çözümlenemedi' hatası ne geldiğini söylemeli."""
    text = (getattr(resp, "text", None) or "")
    ctype = ""
    try:
        ctype = (resp.headers or {}).get("content-type", "") or ""
    except Exception:
        ctype = ""
    body = " ".join(text.split())[:240]
    parts = [f"HTTP {getattr(resp, 'status_code', '?')}"]
    if ctype:
        parts.append(f"ct={ctype.split(';')[0]}")
    parts.append(f"len={len(text)}")
    if data is not None:
        parts.append(_enpara_body_hint(data))
    parts.append(f"gövde={body or '(boş)'}")
    return " ".join(parts)


_LOOSE_TICKET_KEYS = ("requestid", "jobid", "correlationid", "batchid", "id", "referenceno")


def _ticket_candidates(data: Any) -> List[str]:
    """Kesin ticket alanları önce; SUCCESS gövdesindeki diğer kimlikler yedek."""
    out: List[str] = []
    strict = _ticket_id_from(data)
    if strict:
        out.append(strict)

    def walk(node: Any, depth: int) -> None:
        if depth > 6 or len(out) >= 4:
            return
        if isinstance(node, list):
            for item in node[:20]:
                walk(item, depth + 1)
            return
        if not isinstance(node, dict):
            return
        for k, v in node.items():
            if isinstance(v, (dict, list)):
                continue
            lk = str(k).lower().replace("_", "")
            if lk in _LOOSE_TICKET_KEYS and v not in (None, "", 0, "0"):
                s = str(v).strip()
                if s and s not in out:
                    out.append(s)
        for v in node.values():
            if isinstance(v, (dict, list)):
                walk(v, depth + 1)

    walk(data, 0)
    return out[:4]


_OK_RESULT_CODES = {"", "0", "00", "000", "0000", "200", "success", "ok", "true"}


def _enpara_result_error(data: Any) -> str:
    """HTTP 200 gövdesinde resultCode ile gelen iş hatası (ör. tarih formatı)."""
    if not isinstance(data, dict):
        return ""
    code = _ci_get(data, "resultCode", "errorCode", "returnCode", "statusCode")
    if code is None:
        return ""
    if str(code).strip().lower() in _OK_RESULT_CODES:
        return ""
    desc = _stringify_err_msg(
        _ci_get(data, "resultDescription", "resultMessage", "errorMessage", "errorDescription", "message")
    )
    return f"resultCode={code} {desc}".strip()


def _ticket_from_headers(resp) -> Optional[str]:
    try:
        headers = resp.headers or {}
    except Exception:
        return None
    for k in getattr(headers, "keys", lambda: [])():
        lk = str(k).lower().replace("-", "").replace("_", "")
        if lk in ("ticketno", "ticketid", "xticketno", "xticketid"):
            v = str(headers.get(k) or "").strip()
            if v:
                return v
    return None


def _is_empty_body(resp) -> bool:
    return not (getattr(resp, "text", None) or "").strip()


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
    if _is_iban(raw) or raw.startswith("TR"):
        return ""
    return raw


_ENPARA_MISSING_ACCOUNT = (
    "Enpara hesap hareketi için IBAN veya hesap no zorunlu (resultCode 364737). "
    "Düzenle → Hesap No/IBAN alanına 26 haneli Enpara IBAN’ını girin "
    "(veya bağlı TamKobi hesabının IBAN’ını doldurun). "
    "Yalnızca tarih gönderilmez."
)


def _enpara_has_statement_account(account: str) -> bool:
    """Enpara 364737: iban (26) veya hesap no; yarım TR IBAN yetmez."""
    if _enpara_iban_26(account):
        return True
    raw = (account or "").strip().replace(" ", "").upper()
    if not raw or raw == "-" or raw.startswith("TR"):
        return False
    return bool(_enpara_account_no(raw))


def _enpara_is_missing_account_error(text: str) -> bool:
    blob = (text or "").lower()
    return (
        "364737" in blob
        or "hesap numarası yada iban" in blob
        or "iban bilgisinden en az biri" in blob
    )


def apply_linked_account_number(conn: dict, acc: Optional[dict] = None) -> dict:
    """Bağlantıda kullanılabilir IBAN/hesap yoksa bağlı TamKobi hesabından kopyala."""
    out = dict(conn or {})
    provider = (out.get("provider") or "").strip().lower()
    if provider == "kuveytturk":
        if _kuveyt_account_suffix_candidates(out):
            return out
        if not acc:
            return out
        for key in ("iban", "account_number"):
            linked = (acc.get(key) or "").strip().replace(" ", "")
            if not linked or linked == "-":
                continue
            trial = {**out, "bank_account_number": linked}
            if _kuveyt_account_suffix_candidates(trial):
                out["bank_account_number"] = linked
                return out
        return out
    if _enpara_has_statement_account(_enpara_account_ref(out)):
        return out
    if not acc:
        return out
    for key in ("iban", "account_number"):
        linked = (acc.get(key) or "").strip().replace(" ", "").upper()
        if _enpara_has_statement_account(linked):
            out["bank_account_number"] = linked
            return out
    return out


def _string_params(payload: Dict[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k, v in payload.items():
        if v is None or isinstance(v, (dict, list)):
            continue
        s = str(v).strip()
        if s:
            out[k] = s
    return out


def _tr_offset(dt: datetime) -> str:
    """Enpara: yyyy-MM-ddTHH:mm:ss+HH:mm — offset zorunlu, boşluklu format reddedilir."""
    off = dt.strftime("%z") or "+0300"
    return f"{off[:3]}:{off[3:5]}"


def _istanbul_tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("Europe/Istanbul")
    except Exception:
        return timezone(timedelta(hours=3))


def _enpara_day_windows(start: datetime, end: datetime, *, max_days: int = 31) -> List[tuple]:
    """Enpara tek istekte en fazla 24 saat veriyor (resultCode 364470)."""
    tz = _istanbul_tz()

    def _tr(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(tz)

    start, end = _tr(start), _tr(end)
    if end < start:
        start, end = end, start
    day = start.date()
    last = end.date()
    windows: List[tuple] = []
    while day <= last and len(windows) < max_days:
        midnight = datetime(day.year, day.month, day.day, tzinfo=tz)
        windows.append((midnight, midnight.replace(hour=23, minute=59, second=59)))
        day += timedelta(days=1)
    if not windows:
        midnight = datetime(start.year, start.month, start.day, tzinfo=tz)
        windows.append((midnight, midnight.replace(hour=23, minute=59, second=59)))
    return windows[-max_days:]


def _enpara_payload_variants(start: datetime, end: datetime, account: str, customer: str) -> List[Dict[str, Any]]:
    """QNB/Enpara Gravitee Account Statement + Account Transactions şeması.

    Zorunlu: startDateTime, endDateTime (yyyy-MM-ddTHH:mm:ss+HH:mm)
    ve iban (tam 26) veya accountNo. resultCode 364737: tarihler-only reddedilir.
    Nested object (accountInfo) JSON Schema'da yok — 400-1 'object' üretir.
    """
    del customer  # şemada yok; imza uyumu
    if not _enpara_has_statement_account(account):
        return []
    iban = _enpara_iban_26(account)
    acct_no = _enpara_account_no(account)
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Europe/Istanbul")
    except Exception:
        tz = timezone(timedelta(hours=3))

    def _tr(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(tz)

    start, end = _tr(start), _tr(end)
    start_d, end_d = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    start_off, end_off = _tr_offset(start), _tr_offset(end)
    # Servis yalnızca yyyy-MM-ddTHH:mm:ss+HH:mm kabul ediyor; milisaniye ve
    # offsetsiz biçimler "could not be parsed at index 19" ile reddediliyor.
    ranges = [
        (f"{start_d}T00:00:00{start_off}", f"{end_d}T23:59:59{end_off}"),
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
        if acct_no and not iban:
            add({**base, "accountNo": acct_no})

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

    POST https://api.enpara.com/v1/account-statement  JSON {startDateTime, endDateTime, iban|accountNo}
    GET  https://api.enpara.com/v1/account-statement/ticket?ticketNo=  (405 ise POST {ticketNo})
    POST https://api.enpara.com/v1/account-statement/list  JSON {} veya iban/tarih
    Abone olunmayan /v1/account-transactions/* çağrılmaz.
    """
    import asyncio

    stored_token = _plain_secret(conn, "access_token")
    account = _enpara_account_ref(conn)
    if not _enpara_has_statement_account(account):
        raise RuntimeError(_ENPARA_MISSING_ACCOUNT)
    token = await _enpara_access_token(conn)
    base = _base_url(conn) or "https://api.enpara.com"
    post_headers = _enpara_headers(token, conn, for_get=False)
    get_headers = _enpara_headers(token, conn, for_get=True)
    customer = (conn.get("customer_number") or "").strip()
    end = datetime.now(timezone.utc)
    if (end - since).days > 30:
        since = end - timedelta(days=30)
    windows = _enpara_day_windows(since, end)
    payloads = _enpara_payload_variants(windows[-1][0], windows[-1][1], account, customer)
    last_detail = ""
    got_ok_empty = False
    ticket_timeout = False
    unparsed_hint = ""
    list_hint = ""
    empty_body_200 = False
    result_errors: List[str] = []
    notice = ""
    balance: Optional[float] = None
    refreshed_token: Optional[str] = token if token and token != stored_token else None
    best_400 = ""

    def _pack(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "transactions": rows, "balance": balance, "access_token": refreshed_token,
            "notice": notice,
        }
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

        def _consume(data: Any, *, as_statement: bool = True, from_ticket: bool = False) -> Optional[Dict[str, Any]]:
            nonlocal balance, got_ok_empty
            bal = _extract_balance(data, prefer_iban=account)
            if bal is not None:
                balance = bal
            rows = _normalize_tx_rows(data)
            if rows:
                return _pack(rows)
            ready = _ticket_ready(data)
            if ready is False:
                return None
            if as_statement and _has_explicit_empty_tx_list(data):
                got_ok_empty = True
                return _pack([])
            if as_statement and from_ticket and ready is True:
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
            nonlocal got_ok_empty, last_detail, unparsed_hint, ticket_timeout, empty_body_200
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
            logger.info("enpara %s → %s", label, _enpara_response_hint(resp, data))
            out = _consume(data, as_statement=True)
            if out and out.get("transactions"):
                return out
            res_err = _enpara_result_error(data)
            if res_err and not (out and out.get("transactions")):
                result_error = f"{label} ({keys}): {res_err}"
                last_detail = result_error
                if result_error not in result_errors:
                    result_errors.append(result_error)
                if _enpara_is_missing_account_error(res_err):
                    raise RuntimeError(
                        "Enpara hesap hareketi alınamadı. Servis isteği reddetti: "
                        f"{result_error[:600]}"
                    )
                return None
            strict_tid = _ticket_id_from(data) or _ticket_from_headers(resp)
            candidates = _ticket_candidates(data)
            if strict_tid and strict_tid not in candidates:
                candidates.insert(0, strict_tid)
            for idx, tid in enumerate(candidates):
                strict = bool(strict_tid) and tid == strict_tid
                polled = await _poll_ticket(tid, attempts=16 if strict else 2)
                if polled:
                    return polled
                if strict:
                    ticket_timeout = True
                    last_detail = f"{label} ticket={tid} henüz hareket döndürmedi: {_enpara_response_hint(resp, data)}"
                    return None
                del idx
            if out is not None:
                return out
            unparsed_hint = f"{label} {_enpara_response_hint(resp, data)}"
            if _is_empty_body(resp):
                empty_body_200 = True
            last_detail = unparsed_hint
            return None

        async def _poll_ticket(ticket_id: str, *, attempts: int = 16) -> Optional[Dict[str, Any]]:
            nonlocal last_detail
            use_post = False
            ticket_body = {"ticketNo": ticket_id, "pageNo": "1", "pageSize": "100"}
            for attempt in range(attempts):
                if attempt:
                    await asyncio.sleep(2.0)
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
                        json_body=ticket_body,
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
                out = _consume(data, as_statement=True, from_ticket=True)
                if out is not None:
                    return out
            return None

        # 1) POST /v1/account-statement — gün gün (Enpara tek istekte 24 saat veriyor)
        collected: List[Dict[str, Any]] = []
        seen_ext: set = set()
        preferred_keys: Optional[tuple] = None

        def _collect(rows: List[Dict[str, Any]]) -> None:
            for row in rows or []:
                ext = row.get("external_id")
                if ext and ext in seen_ext:
                    continue
                if ext:
                    seen_ext.add(ext)
                collected.append(row)

        def _window_payloads(w_start: datetime, w_end: datetime) -> List[Dict[str, Any]]:
            variants = _enpara_payload_variants(w_start, w_end, account, customer)
            if preferred_keys:
                narrowed = [p for p in variants if tuple(sorted(p)) == preferred_keys]
                if narrowed:
                    return narrowed
            return variants

        statement_post_405 = False
        for w_start, w_end in windows:
            for payload in _window_payloads(w_start, w_end):
                resp = await _post("/v1/account-statement", json_body=payload)
                if _enpara_method_not_allowed(resp):
                    statement_post_405 = True
                    last_detail = f"POST /v1/account-statement HTTP {resp.status_code}: {_api_error_detail(resp)}"
                    break
                out = await _handle_statement(resp, payload, "POST /v1/account-statement")
                if out is not None:
                    preferred_keys = tuple(sorted(payload))
                    _collect(out.get("transactions") or [])
                    break
                if ticket_timeout:
                    break
            if statement_post_405 or ticket_timeout:
                break

        # Katalog GET iddiası: yalnızca POST 405 olursa query-string yedek
        if statement_post_405:
            for w_start, w_end in windows:
                for payload in _window_payloads(w_start, w_end):
                    qs = _string_params(payload)
                    resp = await _get("/v1/account-statement", params=qs)
                    out = await _handle_statement(resp, payload, "GET /v1/account-statement")
                    if out is not None:
                        preferred_keys = tuple(sorted(payload))
                        _collect(out.get("transactions") or [])
                        break
                    if ticket_timeout:
                        break
                if ticket_timeout:
                    break

        if collected:
            return _pack(collected)

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
            last_detail = f"POST /v1/account-statement/list {_enpara_response_hint(resp)}"
            if resp.status_code < 400:
                try:
                    data = resp.json()
                except Exception:
                    data = None
                if data is not None:
                    out = _consume(data, as_statement=False)
                    if out and out.get("transactions"):
                        return out
                    bal = _extract_balance(data, prefer_iban=account)
                    if bal is not None:
                        balance = bal
                list_hint = f"/list {_enpara_response_hint(resp, data)}"

    if got_ok_empty:
        notice = notice or " Enpara bu tarih aralığında hareket satırı döndürmedi."
        return _pack([])
    if balance is not None and not ticket_timeout and not result_errors:
        if unparsed_hint:
            notice = " Enpara hareket satırı çözümlenemedi; bakiye kayıtlı hesaptan alındı."
        return _pack([])
    if ticket_timeout:
        if balance is not None:
            notice = " Ekstre ticket'ı henüz hareket satırı vermedi; bakiye kayıtlı hesaptan alındı. Biraz sonra tekrar senkron deneyin."
            return _pack([])
        raise RuntimeError(
            "Enpara ekstre ticket'ı henüz hareket döndürmedi. Birkaç saniye sonra Senkron'u tekrar deneyin. "
            f"Son yanıt: {last_detail[:360]}"
        )
    if result_errors:
        detail = " || ".join(result_errors[:3])
        raise RuntimeError(
            "Enpara hesap hareketi alınamadı. Servis isteği reddetti: "
            f"{detail[:600]}"
        )
    if unparsed_hint:
        if empty_body_200:
            hint = (
                " Enpara HTTP 200 ama gövde boş döndü. Gateway isteği kabul ediyor, servis veri üretmiyor: "
                "Enpara portalında Hesap Hareketleri aboneliğinin bu IBAN’a tanımlı olduğunu "
                "ve Access Token’ın bu uygulamaya ait olduğunu doğrulayın."
            )
        else:
            hint = (
                " Enpara 200 döndü ama hareket satırı çözümlenemedi. "
                "status=SUCCESS boş ekstre değildir; ticket veya transactionTable beklenir."
            )
        detail = unparsed_hint + (f" | {list_hint}" if list_hint else "")
        raise RuntimeError(f"Enpara hesap hareketi alınamadı.{hint} Son yanıt: {detail[:600]}")

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
            "Production çıkış 85.95.240.136 / 85.95.240.184 whitelist hatırlatmasıdır, 405 nedeni değil."
        )
    elif any(x in last_detail.lower() for x in ("your ip", "ip is not", "whitelist", "ip filtering")):
        hint = " Sunucu IP’si Enpara portalında izinli değil (tamkobi.com çıkışı 85.95.240.136 ve 85.95.240.184)."
    raise RuntimeError(f"Enpara hesap hareketi alınamadı.{hint} Son yanıt: {last_detail[:360]}")


async def _fetch_kuveyt_transactions(conn: dict, since: datetime) -> Dict[str, Any]:
    """GET /v3/accounts/{ekNo}/transactions + RSA Signature (abonelikteki tek hareket ucu).

    Portal/Postman + resmi Hesap Hareketleriniz V3:
      POST identity|prep-identity /connect/token (client_credentials, scope=accounts)
      GET  gateway|prep-gateway /v3/accounts/{suffix}/transactions
           Authorization: Bearer …  Signature: RSA-SHA256(token[+?query])
           Opsiyonel query: beginDate, endDate, itemCount
           Yanıt: value.accountActivities (date, amount, description, transactionReference, fxCode, balance)
    v4/v1 ve hesap listesi bu uygulamada abone değildir.
    """
    pem = _kuveyt_private_key_pem(conn)
    if not pem:
        raise RuntimeError(
            "Kuveyt Türk hesap hareketi için RSA private key gerekli. "
            "openssl genrsa -out private.pem 2048 çıktısını (BEGIN/END dahil) Düzenle ekranına yapıştırın. "
            "public.pem / pubout değil."
        )
    # Ek no yoksa Identity’ye çıkma — test ve geçersiz kayıt canlı token almasın.
    ek_list = _kuveyt_account_suffix_candidates(conn)
    paths = _kuveyt_tx_paths(conn)
    if not paths:
        raise RuntimeError(
            "Kuveyt Türk hesap hareketi için ek no gerekli. "
            "Düzenle → Hesap No/IBAN alanına ek no (örn. 6) veya IBAN girin. "
            "Uç: GET /v3/accounts/{ekNo}/transactions."
        )
    token, token_kind = await _kuveyt_account_bearer(conn)
    bases = _kuveyt_gateway_urls(conn)
    account = (conn.get("bank_account_number") or "").strip().replace(" ", "")
    end = datetime.now(timezone.utc)
    balance: Optional[float] = None
    best_err = ""
    saw_auth = False
    saw_404 = False
    saw_ok_empty = False
    detail = ""
    tried_tx_scopes: List[str] = []
    used = conn.get("_kuveyt_token_scope")
    if used is not None:
        tried_tx_scopes.append(str(used))

    ranges = _kuveyt_tx_query_variants(since, end)

    async with httpx.AsyncClient(timeout=45) as client:
        client.cookies.clear()

        async def _get(gw: str, path: str, params: Optional[Dict[str, str]] = None):
            client.cookies.clear()
            qs_params = {k: v for k, v in (params or {}).items() if v not in (None, "")}
            headers = _kuveyt_headers(token, conn, params=qs_params or None)
            url = f"{gw}{path}" + _kuveyt_query_string(qs_params)
            return await client.get(url, headers=headers)

        for gw in bases:
            gw_auth = False
            for path in paths:
                for params in ranges:
                    resp = await _get(gw, path, params)
                    qs_label = ",".join(f"{k}={v}" for k, v in params.items()) or "no-query"
                    detail = (
                        f"GET {gw}{path} HTTP {resp.status_code} "
                        f"({qs_label}): {_api_error_detail(resp)}"
                    )
                    if (
                        token_kind == "cc"
                        and _kuveyt_is_invalid_scope(resp, detail)
                    ):
                        remaining = [
                            s
                            for s in _kuveyt_tx_scope_candidates(conn)
                            if s not in tried_tx_scopes
                        ]
                        recovered = False
                        for nxt in remaining:
                            tried_tx_scopes.append(nxt)
                            try:
                                token = await _kuveyt_access_token(conn, scopes=[nxt])
                            except RuntimeError:
                                continue
                            resp = await _get(gw, path, params)
                            detail = (
                                f"GET {gw}{path} HTTP {resp.status_code} "
                                f"({qs_label}): {_api_error_detail(resp)}"
                            )
                            if resp.status_code not in (401, 403):
                                recovered = True
                                break
                            if not _kuveyt_is_invalid_scope(resp, detail):
                                break
                        if not recovered:
                            saw_auth = True
                            gw_auth = True
                            best_err = detail
                            break
                    elif resp.status_code in (401, 403):
                        saw_auth = True
                        gw_auth = True
                        best_err = detail
                        break
                    if resp.status_code == 404:
                        saw_404 = True
                        if not best_err or "404" in best_err:
                            best_err = detail
                        continue
                    if resp.status_code >= 400:
                        best_err = detail
                        continue
                    try:
                        data = resp.json()
                    except Exception:
                        continue
                    biz = _kuveyt_business_error(data)
                    if biz:
                        best_err = f"{detail} {biz}"
                        continue
                    bal = _extract_balance(data, prefer_iban=account)
                    if bal is not None:
                        balance = bal
                    rows = _normalize_tx_rows(data)
                    if rows:
                        return {"transactions": rows, "balance": balance, "access_token": None}
                    saw_ok_empty = True
                    if not params:
                        continue
                if gw_auth:
                    break
            if gw_auth:
                break
            if saw_ok_empty or balance is not None:
                break
            if saw_auth:
                break

    if saw_ok_empty or balance is not None:
        return {"transactions": [], "balance": balance, "access_token": None}

    hint = " Client ID/Secret, openssl genrsa private.pem (min 2048-bit) ve hesap ek no/IBAN’ı kontrol edin."
    if saw_auth:
        asked = conn.get("_kuveyt_token_scope")
        asked_label = "accounts" if asked is None else (asked or "(scope yok)")
        jwt_sc = _jwt_scope_claim(token)
        hint = (
            " GET /v3/accounts/{ekNo}/transactions yetki hatası. "
            f"Token isteği grant_type=client_credentials&scope={asked_label}."
        )
        if jwt_sc:
            hint += f" JWT scope={jwt_sc}."
        hint += (
            " Hesap hareketi için Identity’ye scope=accounts gönderin; API Market’te "
            "Accounts ürününe abone olun ve canlı/prep onayını tamamlayın. RSA Signature’ı da kontrol edin."
        )
        if token_kind == "cc":
            hint += " (Şu an client_credentials token kullanıldı.)"
    elif saw_404:
        hint = (
            " Gateway 404: yalnızca GET /v3/accounts/{ekNo}/transactions abonedir; "
            "Hesap No’ya ek no (örn. 6) veya IBAN yazın — müşteri numarasını path’e koymayın. "
            "v4/v1 ve hesap listesi bu uygulamada yok."
        )
    elif not account and not ek_list:
        hint = " Düzenle → Hesap No/IBAN alanına Kuveyt ek no veya IBAN girin."
    raise RuntimeError(
        f"Kuveyt Türk hesap hareketi alınamadı.{hint} Son yanıt: {(best_err or detail)[:360]}"
    )


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
        "notice": live.get("notice") or "",
    }
