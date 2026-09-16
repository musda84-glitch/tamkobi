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


def _build_fernet() -> Fernet:
    raw = (os.environ.get("CREDENTIAL_ENCRYPTION_KEY") or "").strip()
    if raw:
        try:
            return Fernet(raw.encode())
        except (ValueError, TypeError):
            pass
    # Local/Docker fallback so the API can start without a pre-set key.
    key = Fernet.generate_key()
    os.environ["CREDENTIAL_ENCRYPTION_KEY"] = key.decode()
    return Fernet(key)


_fernet = _build_fernet()

def encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()

def decrypt(value: str) -> str:
    return _fernet.decrypt(value.encode()).decode()

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
    if digits.startswith("90") and len(digits) == 12:
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    return digits if re.fullmatch(r"5\d{9}", digits) else None

def normalize_msgheader(header: str) -> str:
    """Netgsm msgheader: trim. Dokümana göre 3–11 karakter; iç boşluk korunur."""
    return (header or "").strip()

def validate_msgheader(header: str) -> Optional[str]:
    h = normalize_msgheader(header)
    if not h:
        return "Gönderici başlığı (msgheader) boş."
    if len(h) < 3 or len(h) > 11:
        return "Gönderici başlığı 3–11 karakter olmalı (Netgsm dokümanı)."
    return None

def _netgsm_auth(creds: dict):
    return (creds["usercode"], creds["password"])

def _parse_netgsm_body(r: httpx.Response) -> Dict[str, Any]:
    try:
        data = r.json()
        return data if isinstance(data, dict) else {"raw": data}
    except Exception:
        return {"raw": (r.text or "")[:300]}

async def netgsm_send(creds: dict, messages: List[Dict[str, str]], encoding: str = "TR") -> Dict[str, Any]:
    header = normalize_msgheader(creds.get("msgheader") or "")
    herr = validate_msgheader(header)
    if herr:
        return {"ok": False, "jobid": None, "code": "70", "error": herr, "raw": None}
    payload = {"msgheader": header, "encoding": encoding or "TR", "iysfilter": "0", "appname": "TamKobi", "messages": messages}
    async with httpx.AsyncClient(base_url=NETGSM_BASE, timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        # Resmi REST v2: POST https://api.netgsm.com.tr/sms/rest/v2/send (Basic Auth)
        r = await client.post(NETGSM_SEND_PATH, auth=_netgsm_auth(creds), json=payload)
    data = _parse_netgsm_body(r)
    code = str(data.get("code", "") or "")
    # HTTP 200 + 00/01/02 = kuyruğa alındı; HTTP 406 = Netgsm hata kodu
    ok = r.status_code == 200 and code in ("00", "01", "02")
    err = None if ok else NETGSM_ERRORS.get(code) or data.get("description") or (data.get("raw") if isinstance(data.get("raw"), str) else None) or f"HTTP {r.status_code}"
    return {"ok": ok, "jobid": data.get("jobid"), "code": code, "error": err, "raw": data}

async def netgsm_balance(creds: dict) -> Dict[str, Any]:
    async with httpx.AsyncClient(base_url=NETGSM_BASE, timeout=20) as client:
        r = await client.post(NETGSM_BALANCE_PATH, auth=_netgsm_auth(creds), json={"stip": 3})
    data = _parse_netgsm_body(r)
    code = str(data.get("code", "") or "")
    # stip=3 success often returns balance array without error code, or code 00
    ok = r.status_code < 400 and code in ("", "00") and "balance" in data
    if not ok and r.status_code < 400 and code in ("", "00") and data.get("raw") is None:
        ok = True
    err = None if ok else NETGSM_ERRORS.get(code) or data.get("description") or f"HTTP {r.status_code}"
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
    header_ok = (not approved) or (configured.upper() in {h.upper() for h in approved}) or (configured in approved)
    warn = None
    if approved and configured and not header_ok:
        warn = f"«{configured}» onaylı başlıklar arasında yok. Onaylı: {', '.join(approved[:8])}"
    elif not configured:
        warn = "Gönderici başlığı boş — SMS gönderilemez."
    return {
        "ok": True,
        "message": warn or "Netgsm bağlantısı doğrulandı.",
        "warning": warn,
        "balance": bal.get("data"),
        "headers": approved,
        "header_ok": bool(configured) and (header_ok if approved else True),
    }

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
