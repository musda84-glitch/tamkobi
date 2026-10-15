"""Platform gelen kutusu: mail.tamkobi.com IMAP, salt okunur, veritabanına yazılmaz.

Kutu şifresi platform_mailboxes.password_enc üzerinden çözülür. Düz şifre API
yanıtına, denetime ve log satırına konmaz.
"""
from __future__ import annotations

import asyncio
import email
import imaplib
import logging
import re
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any, Dict, List, Optional, Tuple

import bleach
from fastapi import Depends, HTTPException, Query, Request

import comm_service
import platform_store
import saas
from client_ip import request_ip
from comm_service import _decode_body, _dh

log = logging.getLogger("platform_mail.inbox")

IMAP_HOST = "mail.tamkobi.com"
IMAP_PORT = 993
IMAP_TIMEOUT_SEC = 15
INBOX_PAGE_SIZE = 50
_MAX_RAW_BYTES = 8_000_000
_MAX_HTML_CHARS = 1_000_000

_RAW_TAGS = ("script", "iframe", "style", "noscript", "textarea", "title", "object", "embed", "applet", "svg", "math")
_ALLOWED_TAGS = frozenset({
    "a", "abbr", "b", "blockquote", "br", "caption", "center", "code", "col", "colgroup",
    "dd", "del", "div", "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "i", "img", "li", "ol", "p", "pre", "s", "small", "span", "strike", "strong",
    "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
})
_TAG_ATTRS = {
    "a": {"href", "title", "name"},
    "img": {"src", "alt", "title", "width", "height"},
    "td": {"colspan", "rowspan", "align", "valign"},
    "th": {"colspan", "rowspan", "align", "valign"},
    "tr": {"align", "valign"},
    "table": {"border", "cellpadding", "cellspacing", "align"},
    "font": {"color", "face", "size"},
    "p": {"align"},
    "div": {"align"},
}
_LIST_FIELDS = ("uid", "from", "subject", "date", "seen", "has_attachments")
_READ_FIELDS = _LIST_FIELDS + ("text", "html", "images_blocked")


class InboxNotFound(Exception):
    pass


class InboxImapError(Exception):
    pass


def _redact(text: str, secret: str) -> str:
    cleaned = text or ""
    if secret:
        cleaned = cleaned.replace(secret, "***")
    return cleaned[:400]


def _compact_uri(value: str) -> str:
    return re.sub(r"[\s\x00-\x1f\x7f]+", "", value or "")


def _is_remote_uri(value: str) -> bool:
    compact = _compact_uri(value).lower()
    return compact.startswith("http:") or compact.startswith("https:") or compact.startswith("//")


def _strip_raw_blocks(html: str) -> str:
    out = html or ""
    for tag in _RAW_TAGS:
        out = re.sub(rf"<\s*{tag}\b[^>]*>[\s\S]*?<\s*/\s*{tag}\s*>", "", out, flags=re.I)
        out = re.sub(rf"<\s*{tag}\b[^>]*>[\s\S]*$", "", out, flags=re.I)
        out = re.sub(rf"<\s*{tag}\b[^>]*\/?\s*>", "", out, flags=re.I)
    return out


def sanitize_mail_html(html: str, *, allow_remote_images: bool = False) -> Tuple[str, bool]:
    """Bleach ile temizle. script/iframe/form kalkar; dış resimler varsayılan kapalıdır."""
    blocked = [0]
    source = _strip_raw_blocks(html or "")
    if len(source) > _MAX_HTML_CHARS:
        source = source[:_MAX_HTML_CHARS]

    def _allow(tag: str, name: str, value: str) -> bool:
        lname = (name or "").lower()
        if lname.startswith("on") or lname in {"style", "srcset", "background", "formaction"}:
            if tag == "img" and lname == "srcset" and not allow_remote_images and _is_remote_uri(value):
                blocked[0] += 1
            return False
        if tag == "img" and lname == "src":
            if _is_remote_uri(value):
                if not allow_remote_images:
                    blocked[0] += 1
                    return False
            return True
        return lname in _TAG_ATTRS.get(tag, set())

    cleaned = bleach.clean(
        source,
        tags=_ALLOWED_TAGS,
        attributes=_allow,
        protocols=["http", "https", "mailto"],
        strip=True,
        strip_comments=True,
    )
    return cleaned, blocked[0] > 0


def _check_uid(uid: str) -> str:
    text = str(uid or "").strip()
    if not text.isdigit() or len(text) > 20:
        raise HTTPException(status_code=400, detail="Geçersiz ileti numarası.")
    return text


def _imap_user(box: dict) -> str:
    # IMAP girişi kutu adresidir. smtp_user SES gibi başka bir SMTP hesabı olabilir.
    email_addr = (box.get("email") or "").strip()
    if not email_addr:
        raise HTTPException(status_code=400, detail="Kutunun e-posta adresi yok.")
    return email_addr


def _imap_password(box: dict) -> str:
    enc = box.get("password_enc") or ""
    if not enc:
        raise HTTPException(status_code=400, detail="Bu kutunun şifresi tanımlı değil.")
    try:
        password = comm_service.decrypt(enc)
    except Exception:
        raise HTTPException(status_code=400, detail="Kutu şifresi okunamadı.")
    if not password:
        raise HTTPException(status_code=400, detail="Bu kutunun şifresi tanımlı değil.")
    return password


def _connect():
    return imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=IMAP_TIMEOUT_SEC)


def _logout(client) -> None:
    try:
        client.logout()
    except Exception:
        pass


def _login(client, user: str, password: str) -> None:
    try:
        client.login(user, password)
    except Exception as exc:
        raise InboxImapError(_redact(str(exc), password)) from None


def _guard(password: str, fn):
    try:
        return fn()
    except (InboxNotFound, InboxImapError):
        raise
    except Exception as exc:
        raise InboxImapError(_redact(str(exc), password)) from None


def _iter_fetch(data) -> List[Tuple[bytes, bytes]]:
    items: List[Tuple[bytes, bytes]] = []
    meta = b""
    payload = b""
    started = False

    def flush() -> None:
        nonlocal meta, payload, started
        if started:
            items.append((meta, payload))
        meta, payload, started = b"", b"", False

    for part in data or []:
        if part is None:
            continue
        if isinstance(part, tuple):
            flush()
            started = True
            meta = bytes(part[0]) if part and isinstance(part[0], (bytes, bytearray)) else b""
            payload = bytes(part[1]) if len(part) > 1 and isinstance(part[1], (bytes, bytearray)) else b""
        elif isinstance(part, (bytes, bytearray)):
            if not started:
                started = True
            meta += b" " + bytes(part)
    flush()
    return items


def _flags_seen(meta: bytes) -> bool:
    match = re.search(br"FLAGS \(([^)]*)\)", meta or b"")
    flags = match.group(1) if match else b""
    return b"\\Seen" in flags


def _uid_of(meta: bytes) -> str:
    match = re.search(br"\bUID (\d+)", meta or b"")
    return match.group(1).decode() if match else ""


def _header_message(payload: bytes):
    raw = payload or b""
    if not raw.endswith(b"\n"):
        raw += b"\r\n"
    return email.message_from_bytes(raw)


def _from_value(msg) -> str:
    decoded = _dh(msg.get("From"))
    name, addr = parseaddr(decoded or "")
    name = (name or "").strip()
    addr = (addr or "").strip()
    if name and addr:
        return f"{name} <{addr}>"
    return addr or name or decoded or ""


def _date_value(msg) -> Optional[str]:
    raw = msg.get("Date")
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
    except Exception:
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        from datetime import timezone
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _has_attachment_structure(meta: bytes) -> bool:
    low = (meta or b"").lower()
    return b"attachment" in low or b"filename" in low


def _message_has_attachment(msg) -> bool:
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        if part.get_filename():
            return True
        disp = (part.get("Content-Disposition") or "").lower()
        if disp.startswith("attachment"):
            return True
    return False


def _list_item(meta: bytes, payload: bytes) -> Optional[dict]:
    uid = _uid_of(meta)
    if not uid:
        return None
    msg = _header_message(payload)
    subject = _dh(msg.get("Subject")) or "(Konu yok)"
    return {
        "uid": uid,
        "from": _from_value(msg),
        "subject": subject,
        "date": _date_value(msg),
        "seen": _flags_seen(meta),
        "has_attachments": _has_attachment_structure(meta),
    }


def _only(row: dict, fields) -> dict:
    return {key: row[key] for key in fields}


def imap_list_inbox(user: str, password: str, page: int) -> dict:
    def run():
        client = _connect()
        try:
            _login(client, user, password)
            typ, _ = client.select("INBOX", readonly=True)
            if typ != "OK":
                raise InboxImapError("INBOX seçilemedi.")
            typ, data = client.uid("SEARCH", None, "ALL")
            if typ != "OK":
                raise InboxImapError("IMAP araması başarısız.")
            raw = b""
            if data and data[0] not in (None, b""):
                raw = data[0] if isinstance(data[0], (bytes, bytearray)) else str(data[0]).encode()
            uids = list(reversed([part for part in raw.split() if part]))
            start = (page - 1) * INBOX_PAGE_SIZE
            chunk = uids[start:start + INBOX_PAGE_SIZE]
            messages: List[dict] = []
            if chunk:
                typ, fetched = client.uid(
                    "FETCH",
                    b",".join(chunk),
                    "(UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODYSTRUCTURE)",
                )
                if typ != "OK":
                    raise InboxImapError("İleti listesi alınamadı.")
                by_uid = {}
                for meta, payload in _iter_fetch(fetched):
                    item = _list_item(meta, payload)
                    if item:
                        by_uid[item["uid"]] = item
                for uid in chunk:
                    key = uid.decode() if isinstance(uid, (bytes, bytearray)) else str(uid)
                    if key in by_uid:
                        messages.append(_only(by_uid[key], _LIST_FIELDS))
            return {
                "page": page,
                "page_size": INBOX_PAGE_SIZE,
                "total": len(uids),
                "messages": messages,
            }
        finally:
            _logout(client)

    return _guard(password, run)


def imap_read_inbox(user: str, password: str, uid: str, allow_remote_images: bool) -> dict:
    def run():
        client = _connect()
        try:
            _login(client, user, password)
            typ, _ = client.select("INBOX", readonly=True)
            if typ != "OK":
                raise InboxImapError("INBOX seçilemedi.")
            typ, data = client.uid("FETCH", uid.encode(), "(UID FLAGS BODY.PEEK[])")
            if typ != "OK" or not data or data == [None]:
                raise InboxNotFound()
            pair = _iter_fetch(data)
            if not pair or not pair[0][1]:
                raise InboxNotFound()
            meta, raw = pair[0]
            if len(raw) > _MAX_RAW_BYTES:
                raise InboxImapError("İleti boyutu sınırını aşıyor.")
            msg = email.message_from_bytes(raw)
            bodies = _decode_body(msg)
            html, images_blocked = sanitize_mail_html(bodies.get("html") or "", allow_remote_images=allow_remote_images)
            text = bodies.get("text") or ""
            item = {
                "uid": _uid_of(meta) or uid,
                "from": _from_value(msg),
                "subject": _dh(msg.get("Subject")) or "(Konu yok)",
                "date": _date_value(msg),
                "seen": _flags_seen(meta),
                "has_attachments": _message_has_attachment(msg),
                "text": text,
                "html": html,
                "images_blocked": images_blocked,
            }
            return _only(item, _READ_FIELDS)
        finally:
            _logout(client)

    return _guard(password, run)


def imap_set_seen(user: str, password: str, uid: str, seen: bool) -> dict:
    def run():
        client = _connect()
        try:
            _login(client, user, password)
            typ, _ = client.select("INBOX", readonly=False)
            if typ != "OK":
                raise InboxImapError("INBOX seçilemedi.")
            op = "+FLAGS" if seen else "-FLAGS"
            typ, _ = client.uid("STORE", uid.encode(), op, "(\\Seen)")
            if typ != "OK":
                raise InboxImapError("Okundu durumu güncellenemedi.")
            return {"uid": uid, "seen": bool(seen)}
        finally:
            _logout(client)

    return _guard(password, run)


async def _run_imap(fn, *args):
    try:
        return await asyncio.wait_for(asyncio.to_thread(fn, *args), timeout=IMAP_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="IMAP zaman aşımı (15 sn).")


def _raise_imap(box_id: str, exc: InboxImapError) -> None:
    log.warning("platform inbox imap mailbox=%s: %s", box_id, str(exc))
    raise HTTPException(status_code=502, detail="IMAP bağlantısı kurulamadı.")


async def _authorized_box(box_id: str, user: dict) -> dict:
    import platform_mail

    box = await platform_mail._box(box_id)
    if not platform_mail.mailbox_allows(box, user):
        raise HTTPException(status_code=403, detail="Bu kutuyu kullanma yetkiniz yok.")
    return box


async def _audit_open(user: dict, box: dict, uid: str, request: Request) -> None:
    if platform_store._db is None:
        import platform_mail
        if platform_mail._db is not None:
            platform_store.init(platform_mail._db)
    await platform_store.write_audit(
        actor_type="super_admin",
        actor_id=str(user.get("id") or user.get("_id") or ""),
        action="platform_mail.inbox.open",
        target_type="platform_mailbox",
        target_id=str(box.get("_id") or ""),
        details={
            "mailbox_id": str(box.get("_id") or ""),
            "uid": str(uid),
            "email": box.get("email") or "",
        },
        ip=request_ip(request) if request is not None else "",
    )


async def list_messages(
    box_id: str,
    page: int = Query(1, ge=1),
    user: dict = Depends(saas.require_super_admin),
):
    box = await _authorized_box(box_id, user)
    password = _imap_password(box)
    try:
        return await _run_imap(imap_list_inbox, _imap_user(box), password, page)
    except InboxImapError as exc:
        _raise_imap(box_id, exc)


async def read_message(
    box_id: str,
    uid: str,
    request: Request,
    images: bool = False,
    user: dict = Depends(saas.require_super_admin),
):
    uid = _check_uid(uid)
    box = await _authorized_box(box_id, user)
    password = _imap_password(box)
    try:
        body = await _run_imap(imap_read_inbox, _imap_user(box), password, uid, images)
    except InboxNotFound:
        raise HTTPException(status_code=404, detail="İleti bulunamadı.")
    except InboxImapError as exc:
        _raise_imap(box_id, exc)
    await _audit_open(user, box, uid, request)
    return body


async def mark_seen(
    box_id: str,
    uid: str,
    req: Dict[str, Any],
    user: dict = Depends(saas.require_super_admin),
):
    uid = _check_uid(uid)
    if not isinstance(req, dict) or not isinstance(req.get("seen"), bool):
        raise HTTPException(status_code=400, detail="seen true veya false olmalı.")
    box = await _authorized_box(box_id, user)
    password = _imap_password(box)
    try:
        return await _run_imap(imap_set_seen, _imap_user(box), password, uid, req["seen"])
    except InboxImapError as exc:
        _raise_imap(box_id, exc)


def register(router) -> None:
    router.get("/system/mail/mailboxes/{box_id}/messages")(list_messages)
    router.get("/system/mail/mailboxes/{box_id}/messages/{uid}")(read_message)
    router.post("/system/mail/mailboxes/{box_id}/messages/{uid}/seen")(mark_seen)
