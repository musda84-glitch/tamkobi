import os
import asyncio
import base64
import email
import imaplib
import re
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

import httpx
import aiosmtplib
from cryptography.fernet import Fernet


def _data_dirs() -> List[Path]:
    dirs: List[Path] = []
    for env in ("DATA_DIR", "APP_DATA_DIR", "TAMKOBI_DATA_DIR"):
        raw = (os.environ.get(env) or "").strip()
        if raw:
            dirs.append(Path(raw))
    dirs.append(Path("/data"))
    dirs.append(Path(__file__).resolve().parent)
    return dirs


def _key_file_candidates() -> List[Path]:
    return [d / ".credential_encryption_key" for d in _data_dirs()]


def _read_stored_key() -> Optional[str]:
    for path in _key_file_candidates():
        try:
            if path.is_file():
                raw = path.read_text(encoding="utf-8").strip()
                if raw:
                    return raw
        except OSError:
            continue
    return None


def _write_stored_key(key: str) -> Optional[Path]:
    for path in _key_file_candidates():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(key, encoding="utf-8")
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
            return path
        except OSError:
            continue
    return None


def _fernet_from_raw(raw: str) -> Optional[Fernet]:
    try:
        return Fernet(raw.encode() if isinstance(raw, str) else raw)
    except (ValueError, TypeError):
        return None


def _build_fernet() -> Fernet:
    raw = (os.environ.get("CREDENTIAL_ENCRYPTION_KEY") or "").strip()
    if raw:
        f = _fernet_from_raw(raw)
        if f:
            return f
    stored = _read_stored_key()
    if stored:
        f = _fernet_from_raw(stored)
        if f:
            os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", stored)
            return f
    # Persist a stable fallback so restarts / workers share the same key.
    key = Fernet.generate_key().decode()
    _write_stored_key(key)
    os.environ["CREDENTIAL_ENCRYPTION_KEY"] = key
    return Fernet(key.encode())


_fernet = _build_fernet()


def reset_fernet_for_tests() -> Fernet:
    """Rebuild module Fernet from current env/file (tests only)."""
    global _fernet
    _fernet = _build_fernet()
    return _fernet


def looks_like_fernet_token(value: str) -> bool:
    text = str(value or "")
    return len(text) >= 40 and text.startswith("gAAAA")


def encrypt(value: str) -> str:
    return _fernet.encrypt((value or "").encode()).decode()


def decrypt(value: str) -> str:
    text = "" if value is None else str(value)
    if not text:
        return ""
    try:
        return _fernet.decrypt(text.encode()).decode()
    except Exception:
        # Eski düz metin kayıtları (şifrelenmeden önce) okunabilsin.
        if not looks_like_fernet_token(text):
            return text
        raise


def try_decrypt(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    try:
        return decrypt(value)
    except Exception:
        return None

# ---------------- NETGSM ----------------
NETGSM_BASE = "https://api.netgsm.com.tr"
NETGSM_SEND_PATH = "/sms/rest/v2/send"
NETGSM_HEADERS_PATH = "/sms/rest/v2/msgheader"
NETGSM_BALANCE_PATH = "/balance"
NETGSM_ERRORS = {
    "20": "Mesaj metni hatalı veya çok uzun.",
    "30": "Kullanıcı adı/şifre hatalı veya API erişimi yok (IP kısıtı olabilir).",
    "40": "Gönderici başlığı (msgheader) onaylı değil.",
    "41": "Gönderici başlığı (msgheader) onaylı değil.",
    "50": "İYS kontrollü gönderim ayarları eksik.",
    "51": "İYS marka ayarları eksik.",
    "70": "Eksik/hatalı parametre.",
    "80": "Gönderim limiti aşıldı.",
    "85": "Aynı numaraya kısa sürede çok fazla gönderim.",
    "100": "Netgsm sistem hatası — kısa süre sonra tekrar deneyin.",
}

def normalize_phone(phone: str) -> Optional[str]:
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("0090"):
        digits = digits[4:]
    elif digits.startswith("90") and len(digits) >= 12:
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    return digits if re.fullmatch(r"5\d{9}", digits) else None


def sms_channel_result(send: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Map _send_sms_to / sms_send payload to approval-channel {status, detail}."""
    if not send:
        return {"status": "failed", "detail": "SMS gönderilemedi."}
    if send.get("simulated"):
        return {"status": "simulated", "detail": send.get("message") or "SMS operatör bilgisi girilmedi — simüle."}
    failed = send.get("status") == "failed" or (not send.get("sent") and send.get("failed"))
    if failed:
        return {"status": "failed", "detail": send.get("error") or send.get("message") or "SMS gönderilemedi."}
    return {"status": "sent", "detail": send.get("message") or "SMS gönderildi."}


def approval_dispatch_summary(results: Dict[str, Any]) -> Dict[str, str]:
    """Top-level send-approval status/message from per-channel results."""
    statuses = {k: (v or {}).get("status") for k, v in (results or {}).items()}
    any_sent = any(s == "sent" for s in statuses.values())
    any_sim = any(s == "simulated" for s in statuses.values())
    notes = []
    for key, label in (("sms", "SMS"), ("email", "E-posta")):
        st = statuses.get(key)
        detail = ((results or {}).get(key) or {}).get("detail") or f"{label} gönderilemedi."
        if st == "failed":
            notes.append(f"{label} başarısız: {detail}")
        elif st == "simulated":
            notes.append(detail)
    if any_sent:
        msg = "Onay linki gönderildi."
        if notes:
            msg = f"{msg} {' '.join(notes)}"
        return {"status": "success", "message": msg}
    if any_sim:
        return {"status": "success", "message": notes[0] if notes else "Onay linki oluşturuldu."}
    if notes:
        return {"status": "failed", "message": " ".join(notes)}
    return {"status": "failed", "message": "Hiçbir kanaldan gönderilemedi."}


def normalize_msgheader(header: str) -> str:
    """Netgsm msgheader: trim. Dokümana göre 3–11 karakter; iç boşluk korunur."""
    return (header or "").strip()

def validate_msgheader(header: str) -> Optional[str]:
    h = normalize_msgheader(header)
    if not h:
        return "Gönderici başlığı (msgheader) boş."
    if len(h) < 3 or len(h) > 11:
        return "Gönderici başlığı 3–11 karakter olmalı."
    return None

def phone_tr90(no: str) -> str:
    """5XXXXXXXXX → 905XXXXXXXXX (İleti Merkezi / Verimor)."""
    n = (no or "").strip()
    return n if n.startswith("90") else f"90{n}"

# BizimHesap tarzı SMS operatör kataloğu
SMS_PROVIDERS = {
    "netgsm": {
        "id": "netgsm",
        "name": "Netgsm",
        "user_label": "Kullanıcı Adı (usercode)",
        "user_placeholder": "850XXXXXXX",
        "pass_label": "API Şifresi",
        "header_hint": "Netgsm panelinde onaylı başlıkla birebir aynı olmalı (boşluk/büyük-küçük harf dahil, 3–11 karakter). Panel: SMS Hizmeti → Başlıklarım.",
        "help": "Netgsm panelinde API alt kullanıcısı oluşturup SMS API yetkisi verin. «BAĞLI» yalnızca Doğrula başarılıysa görünür.",
        "docs_url": "https://www.netgsm.com.tr/dokuman/#api-dokumani",
    },
    "iletimerkezi": {
        "id": "iletimerkezi",
        "name": "İleti Merkezi",
        "user_label": "API Anahtarı (key)",
        "user_placeholder": "API key",
        "pass_label": "API Hash",
        "header_hint": "İleti Merkezi’nde onaylı sender ile birebir aynı (3–11 karakter). Panel: get-sender / Başlıklar.",
        "help": "panel.iletimerkezi.com → Ayarlar → Güvenlik: API kullanımına izin verin; key + hash oluşturun.",
        "docs_url": "https://www.iletimerkezi.com/docs/api/send-sms",
    },
    "verimor": {
        "id": "verimor",
        "name": "Verimor",
        "user_label": "Kullanıcı Adı",
        "user_placeholder": "90850XXXXXXX",
        "pass_label": "API Şifresi",
        "header_hint": "Verimor’da onaylı source_addr / başlık (3–11 karakter).",
        "help": "sms.verimor.com.tr API kullanıcısı ve onaylı gönderici başlığı gerekir.",
        "docs_url": "https://developer.verimor.com.tr/smsapi",
    },
}
DEFAULT_SMS_PROVIDER = "netgsm"

def normalize_sms_provider(provider: Optional[str]) -> str:
    p = (provider or DEFAULT_SMS_PROVIDER).strip().lower()
    return p if p in SMS_PROVIDERS else DEFAULT_SMS_PROVIDER

def list_sms_providers() -> List[Dict[str, Any]]:
    return [dict(v) for v in SMS_PROVIDERS.values()]

def _netgsm_auth(creds: dict):
    return (creds["usercode"], creds["password"])

def _parse_netgsm_body(r: httpx.Response) -> Dict[str, Any]:
    try:
        data = r.json()
        return data if isinstance(data, dict) else {"raw": data}
    except Exception:
        return {"raw": (r.text or "")[:300]}

def _netgsm_clean_messages(messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Sadece msg/no; numara 5XXXXXXXXX; boş mesaj/numara elenir (aksi halde Netgsm 70)."""
    out: List[Dict[str, str]] = []
    for m in messages or []:
        no = normalize_phone(m.get("no") or "")
        msg = (m.get("msg") or "").strip()
        if not no or not msg:
            continue
        out.append({"msg": msg, "no": no})
    return out

def build_netgsm_send_payload(
    creds: dict,
    messages: List[Dict[str, str]],
    encoding: str = "TR",
) -> tuple:
    """Resmi SDK minimal gövde: msgheader + encoding + messages (iysfilter/appname yok)."""
    header = normalize_msgheader(creds.get("msgheader") or "")
    herr = validate_msgheader(header)
    if herr:
        return None, herr
    clean = _netgsm_clean_messages(messages)
    if not clean:
        return None, "Geçerli alıcı numarası veya mesaj yok."
    enc = (encoding or "TR").strip().upper()
    if enc not in ("TR", "ASCII"):
        enc = "TR"
    payload: Dict[str, Any] = {
        "msgheader": header,
        "encoding": enc,
        "messages": clean,
    }
    # İYS yalnızca açıkça istenirse (bilgilendirme SMS’te göndermeyin — bazı hesaplarda 70 üretir)
    iys = (creds.get("iysfilter") or "").strip()
    if iys in ("0", "11", "12"):
        payload["iysfilter"] = iys
    appname = (creds.get("appname") or "").strip()
    if appname:
        payload["appname"] = appname
    return payload, None

async def netgsm_send(creds: dict, messages: List[Dict[str, str]], encoding: str = "TR") -> Dict[str, Any]:
    payload, herr = build_netgsm_send_payload(creds, messages, encoding)
    if herr:
        return {"ok": False, "jobid": None, "code": "70", "error": herr, "raw": None}
    async with httpx.AsyncClient(base_url=NETGSM_BASE, timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        # Resmi REST v2: POST https://api.netgsm.com.tr/sms/rest/v2/send (Basic Auth)
        # Temel örnek: { msgheader, encoding, messages } — iysfilter/appname opsiyonel
        r = await client.post(NETGSM_SEND_PATH, auth=_netgsm_auth(creds), json=payload)
    data = _parse_netgsm_body(r)
    code = str(data.get("code", "") or "")
    # HTTP 200 + 00/01/02 = kuyruğa alındı; HTTP 406 = Netgsm hata kodu
    ok = r.status_code == 200 and code in ("00", "01", "02")
    err = None if ok else NETGSM_ERRORS.get(code) or data.get("description") or (data.get("raw") if isinstance(data.get("raw"), str) else None) or f"HTTP {r.status_code}"
    if not ok and code == "70":
        err = "Eksik/hatalı parametre — gönderici başlığı (3–11), numara (5XXXXXXXXX) ve mesajı kontrol edin."
        if data.get("description"):
            err = f"{err} ({data.get('description')})"
    return {"ok": ok, "jobid": data.get("jobid"), "code": code, "error": err, "raw": data, "payload_preview": {"msgheader": payload.get("msgheader"), "encoding": payload.get("encoding"), "count": len(payload.get("messages") or [])}}


def build_netgsm_balance_payload(creds: dict, stip: int = 3) -> dict:
    """Resmi SDK: bakiye sorgusu Basic Auth değil; usercode/password gövdede."""
    return {
        "usercode": (creds.get("usercode") or "").strip(),
        "password": creds.get("password") or "",
        "stip": int(stip),
    }


async def netgsm_balance(creds: dict) -> Dict[str, Any]:
    body = build_netgsm_balance_payload(creds, stip=3)
    async with httpx.AsyncClient(base_url=NETGSM_BASE, timeout=20) as client:
        # POST /balance — SDK body auth (usercode/password/stip); Authorization header yok
        r = await client.post(NETGSM_BALANCE_PATH, json=body)
    data = _parse_netgsm_body(r)
    code = str(data.get("code", "") or "")
    # stip=3 success often returns balance array without error code, or code 00
    ok = r.status_code < 400 and code in ("", "00") and "balance" in data
    if not ok and r.status_code < 400 and code in ("", "00") and data.get("raw") is None:
        ok = True
    err = None if ok else NETGSM_ERRORS.get(code) or data.get("description") or f"HTTP {r.status_code}"
    if not ok and code == "70":
        err = "Bakiye sorgusu parametre hatası — API kullanıcı adı/şifresini kontrol edin."
    return {"ok": ok, "code": code, "data": data, "error": err, "message": err}

async def netgsm_headers(creds: dict) -> Dict[str, Any]:
    """Onaylı gönderici başlıklarını listele."""
    async with httpx.AsyncClient(base_url=NETGSM_BASE, timeout=20) as client:
        r = await client.get(NETGSM_HEADERS_PATH, auth=_netgsm_auth(creds))
    data = _parse_netgsm_body(r)
    headers = data.get("msgheaders") or data.get("msgheader") or []
    if isinstance(headers, str):
        headers = [headers]
    code = str(data.get("code", "") or "")
    ok = r.status_code < 400 and isinstance(headers, list) and (code in ("", "00") or bool(headers))
    err = None if ok else NETGSM_ERRORS.get(code) or data.get("description") or f"HTTP {r.status_code}"
    return {"ok": ok, "headers": [str(h).strip() for h in headers if h], "code": code, "error": err, "raw": data}

async def netgsm_verify(creds: dict) -> Dict[str, Any]:
    """Kimlik bilgilerini bakiye + başlık sorgusu ile doğrula."""
    bal = await netgsm_balance(creds)
    if not bal.get("ok"):
        return {"ok": False, "message": bal.get("error") or bal.get("message") or "Netgsm bağlantısı başarısız.", "balance": bal, "headers": []}
    hdr = await netgsm_headers(creds)
    configured = normalize_msgheader(creds.get("msgheader") or "")
    approved = hdr.get("headers") or []
    header_ok = True
    warn = None
    if approved:
        exact = {h for h in approved}
        upper_map = {h.upper(): h for h in approved}
        header_ok = configured in exact or configured.upper() in upper_map
        if configured and not header_ok:
            compact = re.sub(r"\s+", "", configured).upper()
            space_hint = None
            for h in approved:
                if re.sub(r"\s+", "", h).upper() == compact:
                    space_hint = h
                    break
            if space_hint:
                warn = f"«{configured}» yerine paneldeki birebir başlığı kullanın: «{space_hint}»"
            else:
                warn = f"«{configured}» onaylı başlıklar arasında yok. Onaylı: {', '.join(approved[:8])}"
    elif not configured:
        warn = "Gönderici başlığı boş — SMS gönderilemez."
        header_ok = False
    return {
        "ok": True,
        "message": warn or "Netgsm bağlantısı doğrulandı.",
        "warning": warn,
        "balance": bal.get("data"),
        "headers": approved,
        "header_ok": bool(configured) and header_ok,
    }

# ---------------- İLETİ MERKEZİ ----------------
ILETIMERKEZI_BASE = "https://api.iletimerkezi.com"

def _im_auth(creds: dict) -> dict:
    return {"key": creds["usercode"], "hash": creds["password"]}

def _im_parse(r: httpx.Response) -> Dict[str, Any]:
    try:
        data = r.json()
        return data if isinstance(data, dict) else {"raw": data}
    except Exception:
        return {"raw": (r.text or "")[:300]}

def _im_status(data: dict) -> tuple:
    resp = data.get("response") if isinstance(data.get("response"), dict) else {}
    status = resp.get("status") if isinstance(resp.get("status"), dict) else {}
    code = status.get("code")
    try:
        code_i = int(code) if code is not None else 0
    except (TypeError, ValueError):
        code_i = 0
    msg = status.get("message") or ""
    return code_i, msg, resp

async def iletimerkezi_send(creds: dict, messages: List[Dict[str, str]], encoding: str = "TR") -> Dict[str, Any]:
    header = normalize_msgheader(creds.get("msgheader") or "")
    herr = validate_msgheader(header)
    if herr:
        return {"ok": False, "jobid": None, "code": "70", "error": herr, "raw": None}
    # Aynı metin → tek order; farklı metinler → sırayla gönder
    by_text: Dict[str, List[str]] = {}
    for m in messages:
        by_text.setdefault(m.get("msg") or "", []).append(phone_tr90(m["no"]))
    last: Dict[str, Any] = {"ok": False, "jobid": None, "code": "", "error": "Alıcı yok", "raw": None}
    async with httpx.AsyncClient(base_url=ILETIMERKEZI_BASE, timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        for text, numbers in by_text.items():
            payload = {
                "request": {
                    "authentication": _im_auth(creds),
                    "order": {
                        "sender": header,
                        "iys": "0",
                        "message": {"text": text, "receipents": {"number": numbers}},
                    },
                }
            }
            r = await client.post("/v1/send-sms/json", json=payload)
            data = _im_parse(r)
            code_i, msg, resp = _im_status(data)
            ok = r.status_code == 200 and code_i == 200
            order = resp.get("order") if isinstance(resp.get("order"), dict) else {}
            last = {
                "ok": ok,
                "jobid": str(order.get("id") or "") or None,
                "code": str(code_i),
                "error": None if ok else (msg or f"HTTP {r.status_code}"),
                "raw": data,
            }
            if not ok:
                return last
    return last

async def iletimerkezi_balance(creds: dict) -> Dict[str, Any]:
    payload = {"request": {"authentication": _im_auth(creds)}}
    async with httpx.AsyncClient(base_url=ILETIMERKEZI_BASE, timeout=20) as client:
        r = await client.post("/v1/get-balance/json", json=payload)
    data = _im_parse(r)
    code_i, msg, resp = _im_status(data)
    bal = resp.get("balance") if isinstance(resp.get("balance"), dict) else None
    ok = r.status_code == 200 and code_i == 200 and bal is not None
    err = None if ok else (msg or f"HTTP {r.status_code}")
    return {"ok": ok, "code": str(code_i), "data": bal or data, "error": err, "message": err}

async def iletimerkezi_headers(creds: dict) -> Dict[str, Any]:
    payload = {"request": {"authentication": _im_auth(creds)}}
    async with httpx.AsyncClient(base_url=ILETIMERKEZI_BASE, timeout=20) as client:
        r = await client.post("/v1/get-sender/json", json=payload)
    data = _im_parse(r)
    code_i, msg, resp = _im_status(data)
    senders = resp.get("senders") if isinstance(resp.get("senders"), dict) else {}
    headers = senders.get("sender") or []
    if isinstance(headers, str):
        headers = [headers]
    ok = r.status_code == 200 and code_i == 200 and isinstance(headers, list)
    err = None if ok else (msg or f"HTTP {r.status_code}")
    return {"ok": ok, "headers": [str(h).strip() for h in headers if h], "code": str(code_i), "error": err, "raw": data}

async def iletimerkezi_verify(creds: dict) -> Dict[str, Any]:
    bal = await iletimerkezi_balance(creds)
    if not bal.get("ok"):
        return {"ok": False, "message": bal.get("error") or "İleti Merkezi bağlantısı başarısız.", "balance": bal, "headers": []}
    hdr = await iletimerkezi_headers(creds)
    configured = normalize_msgheader(creds.get("msgheader") or "")
    approved = hdr.get("headers") or []
    header_ok = (not approved) or (configured in approved) or (configured.upper() in {h.upper() for h in approved})
    warn = None
    if approved and configured and not header_ok:
        warn = f"«{configured}» onaylı başlıklar arasında yok. Onaylı: {', '.join(approved[:8])}"
    elif not configured:
        warn = "Gönderici başlığı boş — SMS gönderilemez."
    return {
        "ok": True,
        "message": warn or "İleti Merkezi bağlantısı doğrulandı.",
        "warning": warn,
        "balance": bal.get("data"),
        "headers": approved,
        "header_ok": bool(configured) and (header_ok if approved else True),
    }

# ---------------- VERIMOR ----------------
VERIMOR_BASE = "https://sms.verimor.com.tr"

async def verimor_send(creds: dict, messages: List[Dict[str, str]], encoding: str = "TR") -> Dict[str, Any]:
    header = normalize_msgheader(creds.get("msgheader") or "")
    herr = validate_msgheader(header)
    if herr:
        return {"ok": False, "jobid": None, "code": "70", "error": herr, "raw": None}
    payload = {
        "username": creds["usercode"],
        "password": creds["password"],
        "source_addr": header,
        "datacoding": 1 if (encoding or "TR").upper() == "TR" else 0,
        "messages": [{"msg": m.get("msg") or "", "dest": phone_tr90(m["no"])} for m in messages],
    }
    async with httpx.AsyncClient(base_url=VERIMOR_BASE, timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        r = await client.post("/v2/send.json", json=payload)
    try:
        data = r.json()
    except Exception:
        data = {"raw": (r.text or "")[:300]}
    # Başarıda kampanya id (string/int); hatalarda JSON message
    if r.status_code == 200 and not isinstance(data, dict):
        return {"ok": True, "jobid": str(data), "code": "00", "error": None, "raw": data}
    if r.status_code == 200 and isinstance(data, (int, float, str)):
        return {"ok": True, "jobid": str(data), "code": "00", "error": None, "raw": data}
    if r.status_code == 200 and isinstance(data, dict) and data.get("campaign_id"):
        return {"ok": True, "jobid": str(data.get("campaign_id")), "code": "00", "error": None, "raw": data}
    # Bazı yanıtlarda düz metin kampanya id
    text = (r.text or "").strip()
    if r.status_code == 200 and text and text.isdigit():
        return {"ok": True, "jobid": text, "code": "00", "error": None, "raw": text}
    err = None
    if isinstance(data, dict):
        err = data.get("message") or data.get("error") or data.get("raw")
    err = err or text[:200] or f"HTTP {r.status_code}"
    return {"ok": False, "jobid": None, "code": str(r.status_code), "error": str(err), "raw": data}

async def verimor_balance(creds: dict) -> Dict[str, Any]:
    async with httpx.AsyncClient(base_url=VERIMOR_BASE, timeout=20) as client:
        r = await client.get("/v2/balance", params={"username": creds["usercode"], "password": creds["password"]})
    text = (r.text or "").strip()
    try:
        data = r.json()
    except Exception:
        data = text
    if r.status_code == 200:
        # düz sayı veya JSON
        if isinstance(data, (int, float)) or (isinstance(data, str) and data.replace(".", "", 1).isdigit()):
            return {"ok": True, "code": "00", "data": {"balance": data if not isinstance(data, str) else float(data) if "." in data else int(data)}, "error": None, "message": None}
        if isinstance(data, dict) and ("balance" in data or "credit" in data):
            return {"ok": True, "code": "00", "data": data, "error": None, "message": None}
        if text.isdigit():
            return {"ok": True, "code": "00", "data": {"balance": int(text)}, "error": None, "message": None}
    err = data.get("message") if isinstance(data, dict) else (text[:160] or f"HTTP {r.status_code}")
    return {"ok": False, "code": str(r.status_code), "data": data, "error": str(err), "message": str(err)}

async def verimor_headers(creds: dict) -> Dict[str, Any]:
    async with httpx.AsyncClient(base_url=VERIMOR_BASE, timeout=20) as client:
        r = await client.get("/v2/headers", params={"username": creds["usercode"], "password": creds["password"]}, headers={"accept": "application/json"})
    try:
        data = r.json()
    except Exception:
        data = {"raw": (r.text or "")[:300]}
    headers = data if isinstance(data, list) else (data.get("headers") if isinstance(data, dict) else [])
    if isinstance(headers, str):
        headers = [headers]
    ok = r.status_code == 200 and isinstance(headers, list)
    err = None if ok else (data.get("message") if isinstance(data, dict) else f"HTTP {r.status_code}")
    return {"ok": ok, "headers": [str(h).strip() for h in (headers or []) if h], "code": str(r.status_code), "error": err, "raw": data}

async def verimor_verify(creds: dict) -> Dict[str, Any]:
    bal = await verimor_balance(creds)
    if not bal.get("ok"):
        return {"ok": False, "message": bal.get("error") or "Verimor bağlantısı başarısız.", "balance": bal, "headers": []}
    hdr = await verimor_headers(creds)
    configured = normalize_msgheader(creds.get("msgheader") or "")
    approved = hdr.get("headers") or []
    header_ok = (not approved) or (configured in approved) or (configured.upper() in {h.upper() for h in approved})
    warn = None
    if approved and configured and not header_ok:
        warn = f"«{configured}» onaylı başlıklar arasında yok. Onaylı: {', '.join(approved[:8])}"
    elif not configured:
        warn = "Gönderici başlığı boş — SMS gönderilemez."
    return {
        "ok": True,
        "message": warn or "Verimor bağlantısı doğrulandı.",
        "warning": warn,
        "balance": bal.get("data"),
        "headers": approved,
        "header_ok": bool(configured) and (header_ok if approved else True),
    }

# ---------------- SMS DISPATCH ----------------
async def sms_send(creds: dict, messages: List[Dict[str, str]], encoding: str = "TR") -> Dict[str, Any]:
    provider = normalize_sms_provider(creds.get("provider"))
    if provider == "iletimerkezi":
        return await iletimerkezi_send(creds, messages, encoding)
    if provider == "verimor":
        return await verimor_send(creds, messages, encoding)
    return await netgsm_send(creds, messages, encoding)

async def sms_balance(creds: dict) -> Dict[str, Any]:
    provider = normalize_sms_provider(creds.get("provider"))
    if provider == "iletimerkezi":
        return await iletimerkezi_balance(creds)
    if provider == "verimor":
        return await verimor_balance(creds)
    return await netgsm_balance(creds)

async def sms_verify(creds: dict) -> Dict[str, Any]:
    provider = normalize_sms_provider(creds.get("provider"))
    if provider == "iletimerkezi":
        return await iletimerkezi_verify(creds)
    if provider == "verimor":
        return await verimor_verify(creds)
    return await netgsm_verify(creds)

def provider_display_name(provider: Optional[str]) -> str:
    return SMS_PROVIDERS.get(normalize_sms_provider(provider), SMS_PROVIDERS[DEFAULT_SMS_PROVIDER])["name"]

# ---------------- MAIL (IMAP / SMTP) ----------------
MAIL_PRESETS = {
    "outlook": {"name": "Outlook.com / Hotmail", "imap_host": "outlook.office365.com", "imap_port": 993, "smtp_host": "smtp-mail.outlook.com", "smtp_port": 587},
    "office365": {"name": "Microsoft 365 / Exchange Online", "imap_host": "outlook.office365.com", "imap_port": 993, "smtp_host": "smtp.office365.com", "smtp_port": 587},
    "gmail": {"name": "Gmail / Google Workspace", "imap_host": "imap.gmail.com", "imap_port": 993, "smtp_host": "smtp.gmail.com", "smtp_port": 587},
    "yandex": {"name": "Yandex Mail", "imap_host": "imap.yandex.com", "imap_port": 993, "smtp_host": "smtp.yandex.com", "smtp_port": 465},
    "custom": {"name": "Kurumsal / Özel Sunucu", "imap_host": "", "imap_port": 993, "smtp_host": "", "smtp_port": 587},
}

def _dh(value) -> str:
    try:
        return str(make_header(decode_header(value or "")))
    except Exception:
        return str(value or "")

def _imap_connect(a: dict):
    c = imaplib.IMAP4_SSL(a["imap_host"], int(a["imap_port"]))
    c.login(a["email"], a["password"])
    return c

def _decode_body(msg) -> Dict[str, str]:
    text, html = "", ""
    parts = msg.walk() if msg.is_multipart() else [msg]
    for p in parts:
        if p.get_filename():
            continue
        ctype = p.get_content_type()
        if ctype not in ("text/plain", "text/html"):
            continue
        payload = p.get_payload(decode=True) or b""
        decoded = payload.decode(p.get_content_charset() or "utf-8", "replace")
        if ctype == "text/plain" and not text:
            text = decoded
        elif ctype == "text/html" and not html:
            html = decoded
    return {"text": text, "html": html}

def _parse_headers(raw: bytes, uid: str, flags: bytes) -> Dict[str, Any]:
    msg = email.message_from_bytes(raw)
    date_iso = None
    try:
        date_iso = parsedate_to_datetime(msg.get("Date")).isoformat()
    except Exception:
        pass
    name, addr = parseaddr(msg.get("From", ""))
    return {"uid": uid, "message_id": msg.get("Message-ID"), "subject": _dh(msg.get("Subject")) or "(Konu yok)",
            "from_name": _dh(name) or addr, "from_email": addr, "to": _dh(msg.get("To")), "date": date_iso,
            "is_read": b"\\Seen" in flags, "has_attachments": b"mixed" in flags.lower()}

def imap_test(a: dict) -> Dict[str, Any]:
    c = _imap_connect(a)
    try:
        status, rows = c.list()
        return {"ok": status == "OK", "folders": len(rows or [])}
    finally:
        c.logout()

def _parse_folder_line(line: bytes) -> Dict[str, str]:
    s = line.decode(errors="replace")
    m = re.match(r'\((?P<flags>[^)]*)\)\s+"?(?P<delim>[^"\s]+)"?\s+(?P<name>.+)$', s)
    if not m:
        return {"name": s, "raw": s, "flags": ""}
    name = m.group("name").strip().strip('"')
    return {"name": name, "raw": name, "flags": m.group("flags")}

def imap_folders(a: dict) -> List[Dict[str, str]]:
    c = _imap_connect(a)
    try:
        status, rows = c.list()
        if status != "OK":
            raise RuntimeError("IMAP LIST başarısız")
        folders = [_parse_folder_line(r) for r in rows if r]
        return [f for f in folders if "\\Noselect" not in f["flags"]]
    finally:
        c.logout()

def imap_list(a: dict, folder: str, limit: int, unread_only: bool = False) -> Dict[str, Any]:
    c = _imap_connect(a)
    try:
        status, _ = c.select(f'"{folder}"', readonly=True)
        if status != "OK":
            raise RuntimeError(f"Klasör seçilemedi: {folder}")
        _, rows = c.uid("search", None, "UNSEEN" if unread_only else "ALL")
        all_uids = rows[0].split()
        uids = all_uids[-limit:][::-1]
        items = []
        for uid in uids:
            _, data = c.uid("fetch", uid, "(BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)] FLAGS BODYSTRUCTURE)")
            raw = b"".join(x[1] for x in data if isinstance(x, tuple))
            meta = b" ".join(x[0] for x in data if isinstance(x, tuple))
            item = _parse_headers(raw, uid.decode(), meta)
            item["has_attachments"] = b'"attachment"' in meta.lower() or b"attachment" in meta.lower()
            items.append(item)
        return {"total": len(all_uids), "messages": items}
    finally:
        c.logout()

def imap_fetch(a: dict, folder: str, uid: str) -> Dict[str, Any]:
    c = _imap_connect(a)
    try:
        if c.select(f'"{folder}"', readonly=True)[0] != "OK":
            raise RuntimeError("Klasör seçilemedi")
        status, data = c.uid("fetch", uid.encode(), "(RFC822 FLAGS)")
        if status != "OK" or not data or data[0] is None:
            raise KeyError(uid)
        raw = b"".join(x[1] for x in data if isinstance(x, tuple))
        meta = b" ".join(x[0] for x in data if isinstance(x, tuple))
        msg = email.message_from_bytes(raw)
        item = _parse_headers(raw, uid, meta)
        item.update(_decode_body(msg))
        item["cc"] = _dh(msg.get("Cc"))
        attachments = []
        for p in msg.walk():
            fn = p.get_filename()
            if fn:
                payload = p.get_payload(decode=True) or b""
                attachments.append({"filename": _dh(fn), "content_type": p.get_content_type(), "size": len(payload),
                                    "data_b64": base64.b64encode(payload).decode() if len(payload) <= 8 * 1024 * 1024 else None})
        item["attachments"] = attachments
        item["has_attachments"] = bool(attachments)
        return item
    finally:
        c.logout()

def imap_set_flag(a: dict, folder: str, uid: str, flag: str, add: bool = True):
    c = _imap_connect(a)
    try:
        c.select(f'"{folder}"')
        status, _ = c.uid("store", uid.encode(), "+FLAGS" if add else "-FLAGS", f"({flag})")
        if status != "OK":
            raise RuntimeError("IMAP STORE başarısız")
        if flag == "\\Deleted" and add:
            c.expunge()
    finally:
        c.logout()

def _smtp_kwargs(a: dict) -> dict:
    kwargs = dict(
        hostname=a["smtp_host"],
        port=int(a["smtp_port"]),
        username=a.get("smtp_user") or a["email"],
        password=a["password"],
        timeout=30,
    )
    if int(a["smtp_port"]) == 465:
        kwargs["use_tls"] = True
    else:
        kwargs["start_tls"] = True
    return kwargs


async def smtp_login_test(a: dict) -> Dict[str, Any]:
    """AUTH only — Exchange/Odoo tarzı sunucu bağlantı testi, mail göndermez."""
    kw = _smtp_kwargs(a)
    username, password = kw.pop("username"), kw.pop("password")
    smtp = aiosmtplib.SMTP(**kw)
    await smtp.connect()
    try:
        await smtp.login(username, password)
        return {"ok": True, "message": "SMTP girişi başarılı."}
    finally:
        try:
            await smtp.quit()
        except Exception:
            pass


async def smtp_send(a: dict, to: List[str], subject: str, body: str, html: Optional[str] = None,
                    cc: Optional[List[str]] = None, attachments: Optional[List[Dict[str, Any]]] = None) -> None:
    msg = EmailMessage()
    msg["From"] = f'{a.get("display_name") or a["email"]} <{a["email"]}>'
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    if a.get("reply_to"):
        msg["Reply-To"] = a["reply_to"]
    msg["Subject"] = subject
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")
    for att in attachments or []:
        maintype, _, subtype = (att.get("content_type") or "application/octet-stream").partition("/")
        msg.add_attachment(att["data"], maintype=maintype, subtype=subtype or "octet-stream", filename=Path(att.get("filename") or "dosya").name)
    await aiosmtplib.send(msg, **_smtp_kwargs(a))

async def run_blocking(fn, *args):
    return await asyncio.to_thread(fn, *args)
