
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
        "token_path": "/securedomain/oauth/token",
        "docs": "https://developer.qnb.com.tr/",  # portal Enpara ürününü de listeler; API host api.enpara.com
        "fields": ["client_id", "client_secret", "access_token", "refresh_token", "customer_number"],
        "hint": "Enpara QNB'den ayrıdır. Access Token yapıştırın (veya Client ID/Secret → /securedomain/oauth/token). IBAN 26 hane. Production IP portalda izinli olmalı.",
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


def _enpara_dead_route(resp) -> bool:
    text = getattr(resp, "text", None) or ""
    code = getattr(resp, "status_code", 0) or 0
    return "404-EPG96" in text or "404-QPG97" in text or code == 404


def _enpara_ip_blocked(resp) -> bool:
    if getattr(resp, "status_code", 0) not in (401, 403):
        return False
    blob = f"{getattr(resp, 'text', '') or ''} {_api_error_detail(resp)}".lower()
    return any(x in blob for x in ("ip", "not allowed", "whitelist", "not permitted", "proxy"))


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
    """Refresh / client_credentials: Gravitee AM /securedomain/oauth/token."""
    client_id = (conn.get("client_id") or "").strip()
    client_secret = (conn.get("client_secret") or "").strip()
    refresh = (conn.get("refresh_token") or "").strip()
    if not client_id or not client_secret:
        raise RuntimeError("Enpara Client ID / Client Secret gerekli (token yenileme için). Portalden Access Token yapıştırın.")

    last_err = "Token uç noktası yanıt vermedi."
    async with httpx.AsyncClient(timeout=20) as client:
        for url in _enpara_token_urls(conn):
            forms = []
            if refresh:
                forms.append({"grant_type": "refresh_token", "refresh_token": refresh})
            forms.append({"grant_type": "client_credentials"})
            hit_real_am = False
            for form in forms:
                try:
                    headers = {
                        "Authorization": _basic_auth_header(client_id, client_secret),
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                    }
                    body = {**form, "client_id": client_id, "client_secret": client_secret}
                    resp = await client.post(url, data=body, headers=headers)
                    if _enpara_dead_route(resp):
                        last_err = f"{url} → yok (404-EPG96)"
                        break
                    if resp.status_code >= 400:
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
                            return token
                        last_err = f"{url} → access_token yok"
                        continue
                    last_err = _oauth_error_text(resp, url)
                except Exception as e:
                    last_err = f"{url} → {_err_text(e)}"
                    continue
            if hit_real_am:
                break
    raise RuntimeError(
        "Enpara token alınamadı. Developer portalından Access Token yapıştırın "
        f"(token URL: /securedomain/oauth/token). ({last_err[:180]})"
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
            if _enpara_ip_blocked(resp):
                raise RuntimeError(
                    "Enpara API IP kısıtı: production sunucu IP’nizi developer portalına ekleyin. "
                    f"({detail})"
                )
            # Access token süresi dolmuş olabilir → refresh dene
            if (conn.get("refresh_token") or conn.get("client_secret")) and conn.get("client_id"):
                token = await _enpara_refresh_access_token(conn)
                headers["Authorization"] = f"Bearer {token}"
                resp = await client.get(f"{base}/v1/account-statement/list", headers=headers)
                if _enpara_ip_blocked(resp):
                    raise RuntimeError(
                        "Enpara API IP kısıtı: production sunucu IP’nizi developer portalına ekleyin. "
                        f"({(resp.text or '')[:160]})"
                    )
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
    # Bearer yeterli; GET'e Content-Type koymamak Gravitee JSON Validation'ı bozmaz
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
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


async def _fetch_enpara_statement(conn: dict, since: datetime) -> Dict[str, Any]:
    """QNB/Enpara Gravitee Account Statement şeması.

    GET /v1/account-statement?startDateTime&endDateTime  (POST kök/ticket 405)
    POST /v1/account-transactions/realtime | /async-ticket  (aynı JSON: startDateTime, endDateTime, iban)
    GET  /v1/account-statement/ticket?ticketNo=...
    """
    import asyncio

    token = await _enpara_access_token(conn)
    base = _base_url(conn) or "https://api.enpara.com"
    get_headers = _enpara_headers(token, conn, for_get=True)
    post_headers = _enpara_headers(token, conn, for_get=False)
    account = _enpara_account_ref(conn)
    customer = (conn.get("customer_number") or "").strip()
    end = datetime.now(timezone.utc)
    if (end - since).days > 30:
        since = end - timedelta(days=30)
    payloads = _enpara_payload_variants(since, end, account, customer)
    last_detail = ""
    got_ok_empty = False
    balance: Optional[float] = None
    refreshed_token: Optional[str] = None
    best_400 = ""

    async with httpx.AsyncClient(timeout=45) as client:
        async def _maybe_refresh(resp):
            nonlocal token, get_headers, post_headers, refreshed_token
            if _enpara_ip_blocked(resp):
                return resp
            if resp.status_code not in (401, 403):
                return resp
            if not ((conn.get("client_id") or "").strip() and (conn.get("client_secret") or "").strip()):
                raise RuntimeError(
                    f"Enpara yetkilendirme hatası (HTTP {resp.status_code}). Access Token'ı yenileyin. {_api_error_detail(resp)}"
                )
            token = await _enpara_refresh_access_token(conn)
            refreshed_token = token
            get_headers = _enpara_headers(token, conn, for_get=True)
            post_headers = _enpara_headers(token, conn, for_get=False)
            return None

        def _raise_auth(resp):
            detail = _api_error_detail(resp)
            if "IP" in detail or "not allowed" in detail.lower() or "proxy" in detail.lower():
                raise RuntimeError(
                    "Enpara API IP kısıtı: sunucu IP’niz portalda izinli değil. "
                    f"Enpara developer portalına production sunucu IP’nizi ekleyin. ({detail[:160]})"
                )
            raise RuntimeError(f"Enpara yetkilendirme hatası (HTTP {resp.status_code}). {detail}")

        async def _send(method: str, path: str, *, params=None, json_body=None):
            url = f"{base}{path}"
            if method == "GET":
                resp = await client.get(url, headers=get_headers, params=params or {})
            else:
                resp = await client.post(url, headers=post_headers, json=json_body or {})
            retried = await _maybe_refresh(resp)
            if retried is None:
                if method == "GET":
                    resp = await client.get(url, headers=get_headers, params=params or {})
                else:
                    resp = await client.post(url, headers=post_headers, json=json_body or {})
            return resp

        def _consume(data: Any, *, as_statement: bool = True) -> Optional[Dict[str, Any]]:
            nonlocal balance, got_ok_empty
            bal = _extract_balance(data)
            if bal is not None:
                balance = bal
            rows = _normalize_tx_rows(data)
            if rows:
                return {"transactions": rows, "balance": balance, "access_token": refreshed_token}
            ready = _ticket_ready(data)
            if ready is False:
                return None
            if as_statement and ready is True:
                got_ok_empty = True
                return {"transactions": [], "balance": balance, "access_token": refreshed_token}
            return None

        def _note_400(label: str, resp, payload: Optional[dict] = None):
            nonlocal last_detail, best_400
            keys = ",".join((payload or {}).keys())
            last_detail = f"{label} HTTP {resp.status_code} ({keys}): {_api_error_detail(resp)}"
            if resp.status_code == 400:
                if (not best_400) or ("object" in best_400 and "object" not in last_detail) or len(last_detail) > len(best_400):
                    best_400 = last_detail

        async def _poll_ticket(ticket_id: str) -> Optional[Dict[str, Any]]:
            nonlocal last_detail
            for attempt in range(10):
                if attempt:
                    await asyncio.sleep(1.5)
                pending = False
                for method, path, params in (
                    ("GET", f"/v1/account-transactions/async-ticket/{ticket_id}", {}),
                    ("GET", "/v1/account-statement/ticket", {"ticketNo": ticket_id}),
                    ("GET", "/v1/account-statement", {"ticketNo": ticket_id}),
                ):
                    resp = await _send(method, path, params=params)
                    last_detail = f"{method} {path} HTTP {resp.status_code}: {_api_error_detail(resp)}"
                    if resp.status_code in (401, 403):
                        _raise_auth(resp)
                    if resp.status_code >= 400:
                        continue
                    try:
                        data = resp.json()
                    except Exception:
                        continue
                    if _ticket_ready(data) is False:
                        pending = True
                        break
                    out = _consume(data, as_statement=True)
                    if out is not None:
                        return out
                if pending:
                    continue
            return None

        # 1) Resmi Account Statement: GET + startDateTime/endDateTime (POST kök/ticket 405)
        for payload in payloads:
            qs = _string_params(payload)
            resp = await _send("GET", "/v1/account-statement", params=qs)
            if resp.status_code in (401, 403):
                _raise_auth(resp)
            last_detail = f"GET /v1/account-statement HTTP {resp.status_code} ({','.join(qs)}): {_api_error_detail(resp)}"
            if resp.status_code >= 400:
                _note_400("GET /v1/account-statement", resp, payload)
                continue
            try:
                data = resp.json()
            except Exception:
                continue
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

        # 2) Account Transactions realtime (aynı JSON şema)
        for payload in payloads[:4]:
            resp = await _send("POST", "/v1/account-transactions/realtime", json_body=payload)
            if resp.status_code in (401, 403):
                _raise_auth(resp)
            last_detail = f"POST /v1/account-transactions/realtime HTTP {resp.status_code}: {_api_error_detail(resp)}"
            if resp.status_code >= 400:
                _note_400("POST realtime", resp, payload)
                continue
            try:
                data = resp.json()
            except Exception:
                continue
            out = _consume(data, as_statement=True)
            if out and (out.get("transactions") or _ticket_ready(data) is True):
                return out

        # 3) Async ticket: POST /async-ticket → GET .../{ticketNo}
        for payload in payloads[:4]:
            resp = await _send("POST", "/v1/account-transactions/async-ticket", json_body=payload)
            if resp.status_code in (401, 403):
                _raise_auth(resp)
            last_detail = f"POST /v1/account-transactions/async-ticket HTTP {resp.status_code}: {_api_error_detail(resp)}"
            if resp.status_code >= 400:
                _note_400("POST async-ticket", resp, payload)
                continue
            try:
                data = resp.json()
            except Exception:
                data = {}
            out = _consume(data, as_statement=True)
            if out and out.get("transactions"):
                return out
            tid = _ticket_id_from(data)
            if tid:
                polled = await _poll_ticket(tid)
                if polled:
                    return polled

        # 4) Kayıtlı hesaplar (getRegisteredAccounts) — IBAN/bakiye; hareket değil
        resp = await _send("GET", "/v1/account-statement/list", params={})
        last_detail = f"GET /v1/account-statement/list HTTP {resp.status_code}: {_api_error_detail(resp)}"
        if resp.status_code in (401, 403):
            _raise_auth(resp)
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

        if balance is None and account:
            iban26 = _enpara_iban_26(account)
            bal_params_list = []
            if iban26:
                bal_params_list.append({"iban": iban26})
            acct_no = _enpara_account_no(account)
            if acct_no:
                bal_params_list.append({"accountNo": acct_no})
            for path in ("/v1/accounts/balance", "/v1/account/balance", "/v1/accounts", "/v1/balance"):
                for bal_params in bal_params_list:
                    resp = await _send("GET", path, params=bal_params)
                    if resp.status_code >= 400:
                        continue
                    try:
                        bal = _extract_balance(resp.json())
                    except Exception:
                        bal = None
                    if bal is not None:
                        balance = bal
                        break
                if balance is not None:
                    break

    if got_ok_empty or balance is not None:
        return {"transactions": [], "balance": balance, "access_token": refreshed_token}

    if best_400:
        last_detail = best_400
    hint = " Access Token, 26 haneli IBAN ve account-statement yetkisini kontrol edin."
    if not account:
        hint = " Düzenle → Hesap No/IBAN alanına Enpara IBAN’ınızı girin (tam 26 karakter, boşluksuz)."
    elif "400" in last_detail:
        hint = (
            " İstek reddedildi (400). Gravitee şeması startDateTime/endDateTime string ister; "
            "IBAN tam 26 karakter olmalı. POST /ticket kullanılmaz."
        )
    elif "IP" in last_detail or "not allowed" in last_detail.lower():
        hint = " Sunucu IP’si Enpara portalında izinli değil."
    raise RuntimeError(f"Enpara hesap hareketi alınamadı.{hint} Son yanıt: {last_detail[:360]}")


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
