
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
    for k in ("ticketId", "ticket", "id", "requestId", "jobId"):
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
        v = (conn.get(key) or "").strip().replace(" ", "")
        if v:
            return v
    return ""


def _enpara_headers(token: str, conn: dict) -> Dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    cid = (conn.get("client_id") or "").strip()
    if cid:
        headers["x-apikey"] = cid
        headers["X-Client-Id"] = cid
        headers["client_id"] = cid
    return headers


def _enpara_date_payloads(start: datetime, end: datetime, account: str, customer: str) -> List[Dict[str, Any]]:
    start_iso, end_iso = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    start_tr, end_tr = start.strftime("%d.%m.%Y"), end.strftime("%d.%m.%Y")
    start_dt, end_dt = f"{start_iso}T00:00:00", f"{end_iso}T23:59:59"
    bases = [
        {"startDate": start_iso, "endDate": end_iso},
        {"beginDate": start_iso, "endDate": end_iso},
        {"fromDate": start_iso, "toDate": end_iso},
        {"baslangicTarihi": start_tr, "bitisTarihi": end_tr},
        {"startDate": start_dt, "endDate": end_dt},
    ]
    out = []
    for b in bases:
        p = dict(b)
        if account:
            p.update({"accountNumber": account, "iban": account, "hesapNo": account, "accountNo": account})
        if customer:
            p.update({"customerNumber": customer, "musteriNo": customer})
        out.append(p)
    return out


async def _fetch_enpara_statement(conn: dict, since: datetime) -> Dict[str, Any]:
    """Hareket + opsiyonel bakiye. Boş hareket listesi başarıdır (dönemde işlem yok)."""
    import asyncio

    token = await _enpara_access_token(conn)
    base = _base_url(conn) or "https://api.enpara.com"
    headers = _enpara_headers(token, conn)
    account = _enpara_account_ref(conn)
    customer = (conn.get("customer_number") or "").strip()
    end = datetime.now(timezone.utc)
    payloads = _enpara_date_payloads(since, end, account, customer)
    last_detail = ""
    got_ok_empty = False
    balance: Optional[float] = None
    refreshed_token: Optional[str] = None

    async with httpx.AsyncClient(timeout=45) as client:
        async def _maybe_refresh(resp):
            nonlocal token, headers, refreshed_token
            if resp.status_code not in (401, 403):
                return resp
            if not ((conn.get("refresh_token") or conn.get("client_secret")) and (conn.get("client_id") or conn.get("access_token"))):
                raise RuntimeError(f"Enpara yetkilendirme hatası (HTTP {resp.status_code}). Access Token'ı yenileyin.")
            token = await _enpara_refresh_access_token(conn)
            refreshed_token = token
            headers = _enpara_headers(token, conn)
            return None  # caller retries

        # 1) Ticket oluştur — birkaç payload şekli dene
        ticket_id = None
        for payload in payloads:
            tr = await client.post(f"{base}/v1/account-statement/ticket", headers=headers, json=payload)
            retried = await _maybe_refresh(tr)
            if retried is None:
                tr = await client.post(f"{base}/v1/account-statement/ticket", headers=headers, json=payload)
            if tr.status_code in (401, 403):
                raise RuntimeError(f"Enpara yetkilendirme hatası (HTTP {tr.status_code}). Access Token'ı yenileyin.")
            last_detail = f"ticket HTTP {tr.status_code}: {(tr.text or '')[:160]}"
            if tr.status_code >= 400:
                continue
            try:
                td = tr.json()
            except Exception:
                td = {}
            ticket_id = _ticket_id_from(td)
            bal = _extract_balance(td)
            if bal is not None:
                balance = bal
            if ticket_id:
                break
            # Ticket gerekmeden doğrudan hareket dönmüş olabilir
            rows = _normalize_tx_rows(td)
            if rows:
                return {"transactions": rows, "balance": balance, "access_token": refreshed_token}
            if isinstance(td, (dict, list)):
                got_ok_empty = True

        # 2) Liste / ekstre — ticket varsa poll et
        attempts = 8 if ticket_id else 1
        for attempt in range(attempts):
            if attempt and ticket_id:
                await asyncio.sleep(1.5)
            for path, method in (
                ("/v1/account-statement/list", "GET"),
                ("/v1/account-statement", "GET"),
                ("/v1/account-statement", "POST"),
            ):
                params: Dict[str, Any] = {
                    "startDate": since.strftime("%Y-%m-%d"),
                    "endDate": end.strftime("%Y-%m-%d"),
                }
                if ticket_id:
                    params["ticketId"] = ticket_id
                if account:
                    params["accountNumber"] = account
                    params["iban"] = account
                body = {**payloads[0]}
                if ticket_id:
                    body["ticketId"] = ticket_id

                if method == "GET":
                    resp = await client.get(f"{base}{path}", headers=headers, params=params)
                else:
                    resp = await client.post(f"{base}{path}", headers=headers, json=body)
                retried = await _maybe_refresh(resp)
                if retried is None:
                    if method == "GET":
                        resp = await client.get(f"{base}{path}", headers=headers, params=params)
                    else:
                        resp = await client.post(f"{base}{path}", headers=headers, json=body)
                if resp.status_code in (401, 403):
                    raise RuntimeError(f"Enpara yetkilendirme hatası (HTTP {resp.status_code}). Access Token'ı yenileyin.")
                last_detail = f"{method} {path} HTTP {resp.status_code}: {(resp.text or '')[:160]}"
                if resp.status_code >= 400:
                    continue
                try:
                    data = resp.json()
                except Exception:
                    continue
                bal = _extract_balance(data)
                if bal is not None:
                    balance = bal
                ready = _ticket_ready(data)
                rows = _normalize_tx_rows(data)
                if rows:
                    return {"transactions": rows, "balance": balance, "access_token": refreshed_token}
                if ready is False:
                    got_ok_empty = False
                    continue
                # 200 + parse edilebilir ama boş → dönem boş olabilir
                got_ok_empty = True
                if ready is True:
                    return {"transactions": [], "balance": balance, "access_token": refreshed_token}

        # 3) Bakiye uçları (hareket boş olsa bile)
        if balance is None and account:
            for path in ("/v1/accounts/balance", "/v1/account/balance", "/v1/accounts", "/v1/balance"):
                resp = await client.get(
                    f"{base}{path}",
                    headers=headers,
                    params={"accountNumber": account, "iban": account},
                )
                if resp.status_code >= 400:
                    continue
                try:
                    bal = _extract_balance(resp.json())
                except Exception:
                    bal = None
                if bal is not None:
                    balance = bal
                    break

    if got_ok_empty or balance is not None:
        return {"transactions": [], "balance": balance, "access_token": refreshed_token}

    hint = " Access Token, IBAN/hesap no ve account-statement yetkisini kontrol edin."
    if not account:
        hint = " Bağlı TamKobi hesabına IBAN/hesap no girin veya Düzenle → Banka Hesap No/IBAN alanını doldurun."
    raise RuntimeError(f"Enpara hesap hareketi alınamadı.{hint} Son yanıt: {last_detail[:180]}")


async def _fetch_live_transactions(conn: dict, since: datetime) -> Dict[str, Any]:
    if conn.get("provider") == "enpara":
        return await _fetch_enpara_statement(conn, since)
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
    }
