
"""Banka açık bankacılık sağlayıcıları.

Enpara (api.enpara.com) QNB'den ayrı bir bankadır; QNB Open Banking ayrı kayıttır.
"""
from __future__ import annotations

import base64
import hashlib
import random
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx

PROVIDERS = {
    "kuveytturk": {
        "name": "Kuveyt Türk API Market",
        "sandbox_url": "https://sandbox-api.kuveytturk.com.tr",
        "live_url": "https://api.kuveytturk.com.tr",
        "token_path": "/oauth/token",
        "docs": "https://developer.kuveytturk.com.tr/",
        "fields": ["client_id", "client_secret"],
    },
    "enpara": {
        "name": "Enpara Şirketim API",
        "sandbox_url": "https://api.enpara.com",
        "live_url": "https://api.enpara.com",
        "token_path": "/oauth2/token",
        "docs": "https://developer.qnb.com.tr/",  # portal Enpara ürününü de listeler; API host api.enpara.com
        "fields": ["client_id", "client_secret", "access_token", "refresh_token", "customer_number"],
        "hint": "Enpara QNB'den ayrıdır. Hesap hareketleri api.enpara.com üzerinden çekilir. Developer portalındaki Access Token / Refresh Token değerlerini yapıştırın.",
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
            (conn.get("access_token") or "").strip()
            or ((conn.get("client_id") or "").strip() and (conn.get("client_secret") or "").strip())
            or (conn.get("refresh_token") or "").strip()
        )
    return bool(conn.get("client_id") and conn.get("client_secret"))


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
            "client_id": conn.get("client_id"),
            "client_secret": conn.get("client_secret"),
            "scope": conn.get("scope") or "accounts transactions",
        })
        resp.raise_for_status()
        data = resp.json()
        token = data.get("access_token") or data.get("accessToken")
        if not token:
            raise RuntimeError("Token yanıtında access_token yok.")
        return token


async def _enpara_refresh_access_token(conn: dict) -> str:
    """Refresh / client_credentials ile Enpara access token al. Token URL portalda değişebilir."""
    client_id = (conn.get("client_id") or "").strip()
    client_secret = (conn.get("client_secret") or "").strip()
    refresh = (conn.get("refresh_token") or "").strip()
    if not client_id or not client_secret:
        raise RuntimeError("Enpara Client ID / Client Secret gerekli (token yenileme için).")

    base = _base_url(conn) or "https://api.enpara.com"
    candidates = []
    if conn.get("token_url"):
        candidates.append(conn["token_url"].rstrip("/"))
    # Bilinen / denenecek yollar (Apigee / portal varyasyonları)
    for path in ("/oauth2/token", "/oauth/token", "/v1/oauth2/token", "/oauth2/accesstoken"):
        candidates.append(base + path)

    last_err = "Token uç noktası yanıt vermedi."
    async with httpx.AsyncClient(timeout=20) as client:
        for url in candidates:
            forms = []
            if refresh:
                forms.append({"grant_type": "refresh_token", "refresh_token": refresh})
            forms.append({"grant_type": "client_credentials"})
            for form in forms:
                try:
                    headers = {
                        "Authorization": _basic_auth_header(client_id, client_secret),
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                    }
                    resp = await client.post(url, data={**form, "client_id": client_id, "client_secret": client_secret}, headers=headers)
                    if resp.status_code >= 400:
                        # body ile tekrar dene (Basic olmadan)
                        resp = await client.post(url, data={**form, "client_id": client_id, "client_secret": client_secret}, headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
                    if resp.status_code >= 400:
                        last_err = f"{url} → HTTP {resp.status_code}: {(resp.text or '')[:120]}"
                        continue
                    data = resp.json() if resp.content else {}
                    token = data.get("access_token") or data.get("accessToken")
                    if token:
                        return token
                    last_err = f"{url} → access_token yok"
                except Exception as e:
                    last_err = f"{url} → {_err_text(e)}"
                    continue
    raise RuntimeError(
        "Enpara token alınamadı. Developer portalından Access Token yapıştırın "
        f"veya token URL'sini base_url ile belirtin. ({last_err[:160]})"
    )


async def _enpara_access_token(conn: dict) -> str:
    stored = (conn.get("access_token") or "").strip()
    if stored:
        return stored
    return await _enpara_refresh_access_token(conn)


def _is_simulated(conn: dict) -> bool:
    return conn.get("mode") == "simulation" or not has_credentials(conn)


async def _enpara_probe(conn: dict) -> Dict[str, Any]:
    token = await _enpara_access_token(conn)
    base = _base_url(conn) or "https://api.enpara.com"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{base}/v1/account-statement/list", headers=headers)
        # 200/204/404 (boş liste) = auth OK; 401/403 = token geçersiz
        if resp.status_code in (401, 403):
            detail = (resp.text or "")[:160]
            # Access token süresi dolmuş olabilir → refresh dene
            if (conn.get("refresh_token") or conn.get("client_secret")) and conn.get("access_token"):
                token = await _enpara_refresh_access_token(conn)
                headers["Authorization"] = f"Bearer {token}"
                resp = await client.get(f"{base}/v1/account-statement/list", headers=headers)
                if resp.status_code in (401, 403):
                    raise RuntimeError(f"Enpara Access Token geçersiz (HTTP {resp.status_code}). Portalden yeni token alın. {detail}")
            else:
                raise RuntimeError(f"Enpara Access Token geçersiz (HTTP {resp.status_code}). Portalden Access Token yapıştırın. {detail}")
        if resp.status_code >= 500:
            raise RuntimeError(f"Enpara API sunucu hatası: HTTP {resp.status_code}")
    return {"ok": True, "simulated": False, "message": "Enpara api.enpara.com doğrulandı (account-statement).", "token_preview": token[:6] + "…"}


async def test_connection(conn: dict) -> Dict[str, Any]:
    if _is_simulated(conn):
        return {"ok": True, "simulated": True, "message": "API kimlik bilgisi girilmedi. Bağlantı SİMÜLE modda çalışıyor."}
    try:
        if conn.get("provider") == "enpara":
            return await _enpara_probe(conn)
        token = await _oauth_token(conn)
        return {"ok": True, "simulated": False, "message": "OAuth2 token alındı. Banka bağlantısı doğrulandı.", "token_preview": token[:6] + "…"}
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


def _normalize_tx_rows(raw: Any) -> List[Dict[str, Any]]:
    if isinstance(raw, dict):
        raw = (
            raw.get("value")
            or raw.get("data")
            or raw.get("transactions")
            or raw.get("items")
            or raw.get("accountTransactions")
            or raw.get("statementLines")
            or raw.get("lines")
            or []
        )
    if not isinstance(raw, list):
        return []
    txs = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        amount = float(r.get("amount") or r.get("Amount") or r.get("transactionAmount") or 0)
        direction_hint = str(r.get("direction") or r.get("creditDebitIndicator") or r.get("type") or "").lower()
        if direction_hint in ("credit", "alacak", "in", "inflow", "cr"):
            direction = "credit"
        elif direction_hint in ("debit", "borc", "borç", "out", "outflow", "dr"):
            direction = "debit"
        else:
            direction = "credit" if amount >= 0 else "debit"
        txs.append({
            "external_id": str(
                r.get("transactionId")
                or r.get("id")
                or r.get("referenceNo")
                or r.get("bookingId")
                or hashlib.sha256(str(r).encode()).hexdigest()[:16]
            ),
            "date": str(r.get("transactionDate") or r.get("bookingDate") or r.get("date") or r.get("valueDate") or "")[:10],
            "amount": abs(amount),
            "direction": direction,
            "description": r.get("description") or r.get("explanation") or r.get("narrative") or "Banka Hareketi",
            "counterparty": r.get("counterpartyName") or r.get("senderName") or r.get("counterparty") or "",
            "currency": r.get("currency") or r.get("currencyCode") or "TRY",
            "is_simulated": False,
        })
    return txs


async def _fetch_enpara_transactions(conn: dict, since: datetime) -> List[Dict[str, Any]]:
    token = await _enpara_access_token(conn)
    base = _base_url(conn) or "https://api.enpara.com"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    start = since.strftime("%Y-%m-%d")
    end = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    payload: Dict[str, Any] = {"startDate": start, "endDate": end, "beginDate": start, "fromDate": start, "toDate": end}
    if conn.get("bank_account_number"):
        payload["accountNumber"] = conn["bank_account_number"]
        payload["iban"] = conn["bank_account_number"]
    if conn.get("customer_number"):
        payload["customerNumber"] = conn["customer_number"]

    async with httpx.AsyncClient(timeout=45) as client:
        # 1) Ticket oluştur (asenkron ekstre)
        ticket_id = None
        tr = await client.post(f"{base}/v1/account-statement/ticket", headers=headers, json=payload)
        if tr.status_code in (401, 403) and (conn.get("refresh_token") or conn.get("client_secret")):
            token = await _enpara_refresh_access_token(conn)
            headers["Authorization"] = f"Bearer {token}"
            tr = await client.post(f"{base}/v1/account-statement/ticket", headers=headers, json=payload)
        if tr.status_code < 400:
            try:
                td = tr.json()
            except Exception:
                td = {}
            if isinstance(td, dict):
                ticket_id = td.get("ticketId") or td.get("ticket") or td.get("id") or (td.get("data") or {}).get("ticketId")

        # 2) Liste / doğrudan ekstre
        for path, method in (
            ("/v1/account-statement/list", "GET"),
            ("/v1/account-statement", "GET"),
            ("/v1/account-statement", "POST"),
        ):
            params = {"startDate": start, "endDate": end}
            if ticket_id:
                params["ticketId"] = ticket_id
            if conn.get("bank_account_number"):
                params["accountNumber"] = conn["bank_account_number"]
            if method == "GET":
                resp = await client.get(f"{base}{path}", headers=headers, params=params)
            else:
                body = {**payload}
                if ticket_id:
                    body["ticketId"] = ticket_id
                resp = await client.post(f"{base}{path}", headers=headers, json=body)
            if resp.status_code in (401, 403):
                raise RuntimeError(f"Enpara yetkilendirme hatası (HTTP {resp.status_code}). Access Token'ı yenileyin.")
            if resp.status_code >= 400:
                continue
            try:
                data = resp.json()
            except Exception:
                continue
            rows = _normalize_tx_rows(data)
            if rows:
                return rows
            # ticket henüz hazır değilse kısa bekle + list tekrar
            if ticket_id and path.endswith("/list"):
                import asyncio
                await asyncio.sleep(1.2)
                resp2 = await client.get(f"{base}/v1/account-statement/list", headers=headers, params=params)
                if resp2.status_code < 400:
                    try:
                        rows = _normalize_tx_rows(resp2.json())
                    except Exception:
                        rows = []
                    if rows:
                        return rows

    raise RuntimeError(
        "Enpara hesap hareketi alınamadı. Access Token, hesap no/IBAN ve portal API yetkilerini (account-statement) kontrol edin."
    )


async def _fetch_live_transactions(conn: dict, since: datetime) -> List[Dict[str, Any]]:
    if conn.get("provider") == "enpara":
        return await _fetch_enpara_transactions(conn, since)
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
    return _normalize_tx_rows(payload)


async def fetch_transactions(conn: dict, since: datetime) -> Dict[str, Any]:
    if _is_simulated(conn):
        return {"simulated": True, "transactions": _simulate_transactions(conn, since)}
    txs = await _fetch_live_transactions(conn, since)
    return {"simulated": False, "transactions": txs}
