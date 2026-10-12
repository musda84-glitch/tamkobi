"""Merkezi giden e-posta: platform SES SMTP → .env sürücüsü (smtp|ses|console).

İnsan posta kutuları (info@, destek@) İxirHost'ta kalır; uygulama mailleri
Amazon SES (eu-central-1) üzerinden gider. Sunucudan doğrudan SMTP çıkışı yok.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("TamKobiERP")

router = APIRouter(prefix="/api/mail", tags=["mail"])
_db = None

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_ATTEMPTS = 2
SNS_CERT_HOST_RE = re.compile(r"^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$")
_sns_cert_cache: Dict[str, bytes] = {}


def init(db) -> None:
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def mail_from() -> str:
    return _env("MAIL_FROM", "bildirim@tamkobi.com") or "bildirim@tamkobi.com"


def mail_from_name() -> str:
    return _env("MAIL_FROM_NAME", "TamKobi") or "TamKobi"


def mail_reply_to_default() -> str:
    return _env("MAIL_REPLY_TO", "destek@tamkobi.com")


def mail_driver() -> str:
    return (_env("MAIL_DRIVER", "console") or "console").lower()


def mail_ses_region() -> str:
    return _env("MAIL_SES_REGION", "eu-central-1") or "eu-central-1"


def _norm_email(v: str) -> str:
    return (v or "").strip().lower()


def _as_list(to: Union[str, Sequence[str]]) -> List[str]:
    if isinstance(to, str):
        items = [to]
    else:
        items = list(to or [])
    out: List[str] = []
    seen = set()
    for raw in items:
        em = _norm_email(str(raw or ""))
        if not em or em in seen or not EMAIL_RE.match(em):
            continue
        seen.add(em)
        out.append(em)
    return out


def format_from_header(
    *,
    from_email: str,
    from_name: Optional[str] = None,
    company_id: Optional[str] = None,
) -> str:
    """Firma adına: 'Firma Adı via TamKobi' <bildirim@...>; aksi halde MAIL_FROM_NAME."""
    addr = from_email or mail_from()
    name = (from_name or "").strip()
    if company_id and name:
        if " via TamKobi" not in name:
            name = f"{name} via TamKobi"
    elif not name:
        name = mail_from_name()
    # RFC-friendly quoting when name has special chars
    if any(c in name for c in (',', ';', '<', '>', '"')):
        safe = name.replace('"', '\\"')
        return f'"{safe}" <{addr}>'
    return f"{name} <{addr}>"


async def is_suppressed(email: str) -> bool:
    if _db is None:
        return False
    em = _norm_email(email)
    if not em:
        return True
    row = await _db.mail_suppressions.find_one({"email": em, "active": {"$ne": False}})
    return bool(row)


async def filter_suppressed(emails: List[str]) -> tuple[List[str], List[str]]:
    allowed: List[str] = []
    blocked: List[str] = []
    for em in emails:
        if await is_suppressed(em):
            blocked.append(em)
        else:
            allowed.append(em)
    return allowed, blocked


async def _log_send(
    *,
    driver: str,
    purpose: str,
    company_id: Optional[str],
    to: List[str],
    subject: str,
    status: str,
    provider_message_id: Optional[str] = None,
    error: Optional[str] = None,
    from_email: Optional[str] = None,
) -> str:
    log_id = f"ml_{uuid.uuid4().hex[:12]}"
    if _db is None:
        return log_id
    doc = {
        "_id": log_id,
        "driver": driver,
        "purpose": purpose or "transactional",
        "company_id": company_id,
        "to": list(to),
        "subject": (subject or "")[:500],
        "status": status,
        "provider_message_id": provider_message_id,
        "error": (error or "")[:400] if error else None,
        "from_email": from_email,
        "created_at": _now(),
    }
    # Gövde / ek içeriği saklanmaz.
    await _db.mail_logs.insert_one(doc)
    return log_id


async def _resolve_platform_account(purpose: str) -> Optional[dict]:
    try:
        import platform_mail
        return await platform_mail.resolve_smtp_account(purpose or "transactional")
    except Exception as e:  # noqa: BLE001
        logger.debug("platform SMTP resolve failed: %s", e)
        return None


def _env_smtp_account() -> Optional[dict]:
    host = _env("MAIL_SMTP_HOST")
    user = _env("MAIL_SMTP_USER") or mail_from()
    password = _env("MAIL_SMTP_PASSWORD")
    if not host or not password:
        return None
    return {
        "email": mail_from(),
        "display_name": mail_from_name(),
        "smtp_host": host,
        "smtp_port": int(_env("MAIL_SMTP_PORT", "587") or "587"),
        "smtp_user": user,
        "password": password,
        "reply_to": mail_reply_to_default(),
    }


def _build_message(
    *,
    from_header: str,
    to: List[str],
    subject: str,
    text: str,
    html: Optional[str],
    reply_to: Optional[str],
    attachments: Optional[List[Dict[str, Any]]],
) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = from_header
    msg["To"] = ", ".join(to)
    if reply_to and EMAIL_RE.match(_norm_email(reply_to)):
        msg["Reply-To"] = _norm_email(reply_to)
    msg["Subject"] = subject or ""
    msg.set_content(text or "")
    if html:
        msg.add_alternative(html, subtype="html")
    for att in attachments or []:
        maintype, _, subtype = (att.get("content_type") or "application/octet-stream").partition("/")
        data = att.get("data") or b""
        if isinstance(data, str):
            data = data.encode("utf-8")
        msg.add_attachment(
            data,
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=Path(att.get("filename") or "dosya").name,
        )
    return msg


async def _send_via_smtp(account: dict, msg: EmailMessage) -> Optional[str]:
    import aiosmtplib
    import comm_service

    result = await aiosmtplib.send(msg, **comm_service._smtp_kwargs(account))
    # aiosmtplib may return (response, ...) or None
    if isinstance(result, tuple) and result:
        return str(result[0])[:200]
    return None


async def _send_via_ses_api(
    *,
    from_header: str,
    to: List[str],
    subject: str,
    text: str,
    html: Optional[str],
    reply_to: Optional[str],
    attachments: Optional[List[Dict[str, Any]]],
) -> Optional[str]:
    """Opsiyonel SES API (boto3 sesv2). Ek varsa raw MIME gönderir."""
    import boto3

    region = mail_ses_region()
    client = boto3.client("sesv2", region_name=region)
    from_email = mail_from()
    # Parse addr from header if needed
    m = re.search(r"<([^>]+)>", from_header)
    if m:
        from_email = m.group(1)

    if attachments:
        msg = _build_message(
            from_header=from_header,
            to=to,
            subject=subject,
            text=text,
            html=html,
            reply_to=reply_to,
            attachments=attachments,
        )
        raw = msg.as_bytes()
        resp = await asyncio.to_thread(
            client.send_email,
            FromEmailAddress=from_email,
            Destination={"ToAddresses": to},
            Content={"Raw": {"Data": raw}},
            **({"ReplyToAddresses": [_norm_email(reply_to)]} if reply_to else {}),
        )
    else:
        body: Dict[str, Any] = {"Text": {"Data": text or ""}}
        if html:
            body["Html"] = {"Data": html}
        kwargs: Dict[str, Any] = {
            "FromEmailAddress": from_header if "<" in from_header else from_email,
            "Destination": {"ToAddresses": to},
            "Content": {
                "Simple": {
                    "Subject": {"Data": subject or ""},
                    "Body": body,
                }
            },
        }
        if reply_to and EMAIL_RE.match(_norm_email(reply_to)):
            kwargs["ReplyToAddresses"] = [_norm_email(reply_to)]
        resp = await asyncio.to_thread(client.send_email, **kwargs)
    return (resp or {}).get("MessageId")


async def _send_via_console(
    *,
    from_header: str,
    to: List[str],
    subject: str,
    text: str,
) -> str:
    mid = f"console-{uuid.uuid4().hex[:12]}"
    logger.info(
        "MAIL console driver from=%s to=%s subject=%s mid=%s body_len=%s",
        from_header,
        to,
        (subject or "")[:120],
        mid,
        len(text or ""),
    )
    return mid


async def send_mail(
    to: Union[str, Sequence[str]],
    subject: str,
    text: str,
    html: Optional[str] = None,
    attachments: Optional[List[Dict[str, Any]]] = None,
    purpose: str = "transactional",
    company_id: Optional[str] = None,
    reply_to: Optional[str] = None,
    from_name: Optional[str] = None,
) -> dict:
    """Gönder; hata fırlatmaz. {"status":"sent"|"failed"|"skipped", ...}."""
    recipients = _as_list(to)
    if not recipients:
        return {"status": "failed", "error": "Alıcı yok.", "to": []}

    allowed, blocked = await filter_suppressed(recipients)
    if blocked and not allowed:
        await _log_send(
            driver="suppressed",
            purpose=purpose,
            company_id=company_id,
            to=blocked,
            subject=subject,
            status="failed",
            error="suppressed",
        )
        return {"status": "failed", "error": "suppressed", "to": blocked, "suppressed": blocked}
    if blocked:
        logger.info("mail suppress skip %s", blocked)

    effective_reply = (reply_to or "").strip() or mail_reply_to_default() or None
    platform_acc = await _resolve_platform_account(purpose)
    driver = "platform_smtp"
    account: Optional[dict] = platform_acc
    from_email = (platform_acc or {}).get("email") or mail_from()

    if not account:
        driver = mail_driver()
        if driver == "smtp":
            account = _env_smtp_account()
            if not account:
                await _log_send(
                    driver=driver,
                    purpose=purpose,
                    company_id=company_id,
                    to=allowed,
                    subject=subject,
                    status="failed",
                    error="MAIL_SMTP_* eksik",
                    from_email=mail_from(),
                )
                return {"status": "failed", "error": "MAIL_SMTP_* eksik", "to": allowed, "driver": driver}
            from_email = account.get("email") or mail_from()
        elif driver == "ses":
            from_email = mail_from()
        elif driver == "console":
            from_email = mail_from()
        else:
            await _log_send(
                driver=driver,
                purpose=purpose,
                company_id=company_id,
                to=allowed,
                subject=subject,
                status="failed",
                error=f"Bilinmeyen MAIL_DRIVER={driver}",
                from_email=mail_from(),
            )
            return {"status": "failed", "error": f"Bilinmeyen MAIL_DRIVER={driver}", "to": allowed, "driver": driver}

    # Platform kutusundaki reply_to, açık parametre yoksa kullanılabilir
    if not (reply_to or "").strip() and account and account.get("reply_to"):
        effective_reply = account.get("reply_to")

    from_header = format_from_header(
        from_email=from_email,
        from_name=from_name,
        company_id=company_id,
    )

    last_err = ""
    provider_id = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            if driver == "console":
                provider_id = await _send_via_console(
                    from_header=from_header, to=allowed, subject=subject, text=text,
                )
            elif driver == "ses":
                provider_id = await _send_via_ses_api(
                    from_header=from_header,
                    to=allowed,
                    subject=subject,
                    text=text,
                    html=html,
                    reply_to=effective_reply,
                    attachments=attachments,
                )
            else:
                # platform_smtp veya smtp
                msg = _build_message(
                    from_header=from_header,
                    to=allowed,
                    subject=subject,
                    text=text,
                    html=html,
                    reply_to=effective_reply,
                    attachments=attachments,
                )
                # display_name override for smtp_send compatibility path
                if account:
                    # Prefer our From header via EmailMessage; still need SMTP auth from account
                    provider_id = await _send_via_smtp(account, msg)
            log_id = await _log_send(
                driver=driver,
                purpose=purpose,
                company_id=company_id,
                to=allowed,
                subject=subject,
                status="sent",
                provider_message_id=provider_id,
                from_email=from_email,
            )
            return {
                "status": "sent",
                "to": allowed,
                "suppressed": blocked,
                "driver": driver,
                "provider_message_id": provider_id,
                "log_id": log_id,
                "from": from_header,
                "reply_to": effective_reply,
                "attempt": attempt,
            }
        except Exception as e:  # noqa: BLE001
            last_err = str(getattr(e, "detail", e))[:300]
            logger.warning("send_mail attempt %s/%s driver=%s: %s", attempt, MAX_ATTEMPTS, driver, last_err)
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep(0.15 * attempt)

    log_id = await _log_send(
        driver=driver,
        purpose=purpose,
        company_id=company_id,
        to=allowed,
        subject=subject,
        status="failed",
        error=last_err,
        from_email=from_email,
    )
    return {
        "status": "failed",
        "to": allowed,
        "suppressed": blocked,
        "driver": driver,
        "error": last_err,
        "log_id": log_id,
        "from": from_header,
        "reply_to": effective_reply,
    }


# ---------------- SES / SNS bounce & complaint webhook ----------------

def _sns_cert_url_ok(url: str) -> bool:
    try:
        p = urlparse(url)
    except Exception:
        return False
    if p.scheme != "https":
        return False
    host = (p.hostname or "").lower()
    if not SNS_CERT_HOST_RE.match(host):
        return False
    path = p.path or ""
    return path.endswith(".pem")


def _sns_skip_verify_allowed() -> bool:
    """MAIL_SNS_SKIP_VERIFY yalnızca TAMKOBI_ENV=test iken geçerli; prod'da yok sayılır."""
    return _env("MAIL_SNS_SKIP_VERIFY") == "1" and _env("TAMKOBI_ENV").lower() == "test"


async def _fetch_sns_cert(url: str) -> bytes:
    cached = _sns_cert_cache.get(url)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        pem = resp.content
    _sns_cert_cache[url] = pem
    return pem


async def verify_sns_signature(payload: dict) -> bool:
    """SNS mesaj imzasını doğrula (SigningCertURL + Signature; v1=SHA1, v2=SHA256)."""
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric.padding import PKCS1v15
    except Exception:
        logger.error("cryptography missing for SNS verify")
        return False

    cert_url = payload.get("SigningCertURL") or payload.get("SigningCertUrl") or ""
    if not _sns_cert_url_ok(cert_url):
        return False
    sig_b64 = payload.get("Signature") or ""
    if not sig_b64:
        return False
    msg_type = payload.get("Type") or ""
    if msg_type == "SubscriptionConfirmation":
        fields = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
    elif msg_type == "Notification":
        fields = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
    elif msg_type == "UnsubscribeConfirmation":
        fields = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
    else:
        return False
    parts = []
    for f in fields:
        if f in payload and payload[f] is not None:
            parts.append(f)
            parts.append(str(payload[f]))
    canonical = "\n".join(parts) + "\n"
    sig_ver = str(payload.get("SignatureVersion") or "1").strip()
    hash_alg = hashes.SHA256() if sig_ver == "2" else hashes.SHA1()
    try:
        cert_pem = await _fetch_sns_cert(cert_url)
        cert = x509.load_pem_x509_certificate(cert_pem)
        public_key = cert.public_key()
        signature = base64.b64decode(sig_b64)
        public_key.verify(signature, canonical.encode("utf-8"), PKCS1v15(), hash_alg)
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("SNS signature verify failed: %s", e)
        return False


async def upsert_suppression(email: str, *, reason: str, detail: Optional[str] = None, source: str = "ses") -> None:
    if _db is None:
        return
    em = _norm_email(email)
    if not em or not EMAIL_RE.match(em):
        return
    await _db.mail_suppressions.update_one(
        {"email": em},
        {
            "$set": {
                "email": em,
                "reason": reason,
                "detail": (detail or "")[:400] or None,
                "source": source,
                "active": True,
                "updated_at": _now(),
            },
            "$setOnInsert": {"_id": f"msup_{uuid.uuid4().hex[:10]}", "created_at": _now()},
        },
        upsert=True,
    )


def _extract_ses_event(message_body: str) -> List[Dict[str, str]]:
    """SES notification JSON → [{email, reason}]."""
    out: List[Dict[str, str]] = []
    try:
        data = json.loads(message_body) if isinstance(message_body, str) else message_body
    except Exception:
        return out
    if not isinstance(data, dict):
        return out
    ntype = (data.get("notificationType") or data.get("eventType") or "").lower()
    if ntype == "bounce" or "bounce" in ntype:
        bounce = data.get("bounce") or {}
        for r in bounce.get("bouncedRecipients") or []:
            em = r.get("emailAddress") or r.get("email")
            if em:
                out.append({"email": em, "reason": "bounce", "detail": r.get("diagnosticCode") or bounce.get("bounceType")})
    elif ntype == "complaint" or "complaint" in ntype:
        complaint = data.get("complaint") or {}
        for r in complaint.get("complainedRecipients") or []:
            em = r.get("emailAddress") or r.get("email")
            if em:
                out.append({"email": em, "reason": "complaint", "detail": complaint.get("complaintFeedbackType")})
    return out


@router.post("/webhooks/ses")
async def ses_sns_webhook(request: Request):
    """Amazon SNS → SES bounce/complaint. İmza doğrulanır; suppressions güncellenir."""
    raw = await request.body()
    try:
        payload = json.loads(raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Geçersiz JSON.")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Geçersiz gövde.")

    topic_expected = _env("MAIL_SNS_TOPIC_ARN")
    if not topic_expected:
        raise HTTPException(status_code=503, detail="MAIL_SNS_TOPIC_ARN yapılandırılmadı.")
    if (payload.get("TopicArn") or "") != topic_expected:
        raise HTTPException(status_code=403, detail="SNS TopicArn eşleşmiyor.")

    skip_verify = _sns_skip_verify_allowed()
    if not skip_verify and not await verify_sns_signature(payload):
        raise HTTPException(status_code=403, detail="SNS imza doğrulanamadı.")

    msg_type = payload.get("Type") or ""
    if msg_type == "SubscriptionConfirmation":
        url = payload.get("SubscribeURL") or payload.get("SubscribeUrl") or ""
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme == "https" and SNS_CERT_HOST_RE.match(host):
            try:
                async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
                    resp = await client.get(url)
                    resp.raise_for_status()
            except Exception as e:  # noqa: BLE001
                logger.warning("SNS subscribe confirm fetch failed: %s", e)
                raise HTTPException(status_code=502, detail="SubscribeURL alınamadı.")
        else:
            raise HTTPException(status_code=400, detail="Geçersiz SubscribeURL.")
        return {"ok": True, "type": "SubscriptionConfirmation"}

    if msg_type != "Notification":
        return {"ok": True, "type": msg_type or "ignored"}

    events = _extract_ses_event(payload.get("Message") or "{}")
    for ev in events:
        await upsert_suppression(ev["email"], reason=ev.get("reason") or "bounce", detail=ev.get("detail"), source="ses_sns")
    return {"ok": True, "suppressed": len(events)}
