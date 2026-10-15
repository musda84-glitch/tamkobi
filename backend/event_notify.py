"""Şirket olay bildirimleri: gelen e-fatura, yeni sipariş, kontör, vadesi geçmiş alacak.

Kanallar: uygulama içi (+ push), e-posta, isteğe bağlı SMS.
Tercihler: company_notify_prefs. Özet: notify_outbox + leased job.
"""
from __future__ import annotations

import asyncio
import html
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request

import mail_service
import notify
import public_url
import tenant_access

logger = logging.getLogger("TamKobiERP")

router = APIRouter(prefix="/api", tags=["event-notify"])
_db = None
_deps: Dict[str, Any] = {}
_current_user: Optional[Callable[..., Awaitable[dict]]] = None

EVENTS = (
    "einvoice_incoming",
    "order_new",
    "gib_credits_low",
    "receivable_overdue",
)
EVENT_LABELS = {
    "einvoice_incoming": "Gelen e-Fatura",
    "order_new": "Yeni sipariş",
    "gib_credits_low": "GİB kontör düşük",
    "receivable_overdue": "Vadesi geçmiş alacak",
}
DIGEST_MODES = ("instant", "hourly", "daily", "batch")
EMAIL_FROM_MODES = ("platform", "company")
DEFAULT_CHANNEL = {"inapp": True, "email": True, "sms": False, "digest": "instant"}
ORDER_BATCH_MINUTES = (0, 5, 10, 15, 30, 60)
DEFAULT_ORDER_BATCH_MINUTES = 10
ORDER_BATCH_DETAIL = "Gruplama süresi 0, 5, 10, 15, 30 veya 60 dakika olabilir."
BATCH_SUMMARY_THRESHOLD = 5
ORDER_MAIL_MAX_ORDERS = 20
ORDER_MAIL_MAX_LINES = 15
OUTBOX_MAX_ATTEMPTS = 5
OUTBOX_RETRY_DELAY = timedelta(seconds=90)
STALE_SENDING_AFTER = timedelta(minutes=15)
SMS_DAILY_MAX = 20
GIB_CREDITS_LOW_DEFAULT = 20
_CANCELLED_ORDER_STATUSES = {"cancelled", "canceled", "void", "deleted", "iptal", "rejected"}


def init(db, deps: Optional[dict] = None, get_current_user=None):
    global _db, _current_user
    _db = db
    if deps:
        _deps.update(deps)
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Bildirim auth bağlanmadı.")
    return await _current_user(request)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return date.today().isoformat()


def default_prefs(company_id: str) -> dict:
    events = {}
    for ev in EVENTS:
        ch = dict(DEFAULT_CHANNEL)
        if ev == "order_new":
            ch["digest"] = "batch"
        events[ev] = ch
    return {
        "_id": f"cnp_{company_id}",
        "company_id": company_id,
        "events": events,
        "extra_emails": [],
        "email_from": "platform",
        "gib_credits_threshold": GIB_CREDITS_LOW_DEFAULT,
        "updated_at": _now(),
    }


def _parse_batch_minutes(val, *, strict: bool) -> Optional[int]:
    if val is None or val == "":
        return None
    if isinstance(val, bool) or isinstance(val, (list, dict)):
        if strict:
            raise HTTPException(status_code=400, detail=ORDER_BATCH_DETAIL)
        return None
    if isinstance(val, float) and not float(val).is_integer():
        if strict:
            raise HTTPException(status_code=400, detail=ORDER_BATCH_DETAIL)
        return None
    try:
        n = int(val)
    except (TypeError, ValueError):
        if strict:
            raise HTTPException(status_code=400, detail=ORDER_BATCH_DETAIL)
        return None
    if n not in ORDER_BATCH_MINUTES:
        if strict:
            raise HTTPException(status_code=400, detail=ORDER_BATCH_DETAIL)
        return None
    return n


def _norm_event_prefs(raw: Optional[dict]) -> dict:
    out = {}
    src = raw if isinstance(raw, dict) else {}
    for ev in EVENTS:
        cur = src.get(ev) if isinstance(src.get(ev), dict) else {}
        default_digest = "batch" if ev == "order_new" else "instant"
        digest = str(cur.get("digest") or default_digest).strip().lower()
        if digest not in DIGEST_MODES:
            digest = default_digest
        item = {
            "inapp": bool(cur["inapp"]) if "inapp" in cur else True,
            "email": bool(cur["email"]) if "email" in cur else True,
            "sms": bool(cur["sms"]) if "sms" in cur else False,
            "digest": digest,
        }
        if ev == "order_new" and "batch_minutes" in cur and cur.get("batch_minutes") not in (None, ""):
            parsed = _parse_batch_minutes(cur.get("batch_minutes"), strict=True)
            if parsed is None:
                raise HTTPException(status_code=400, detail=ORDER_BATCH_DETAIL)
            item["batch_minutes"] = parsed
        out[ev] = item
    return out


def _norm_extra_emails(raw) -> List[str]:
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    seen = set()
    for item in raw:
        email = str(item or "").strip().lower()
        if not email or "@" not in email or email in seen:
            continue
        seen.add(email)
        out.append(email[:160])
    return out[:30]


def public_prefs(doc: dict) -> dict:
    d = dict(doc)
    d["id"] = d.pop("_id", d.get("id"))
    d["events"] = _norm_event_prefs(d.get("events"))
    d["extra_emails"] = _norm_extra_emails(d.get("extra_emails"))
    ef = str(d.get("email_from") or "platform").strip().lower()
    d["email_from"] = ef if ef in EMAIL_FROM_MODES else "platform"
    d["gib_credits_threshold"] = int(d.get("gib_credits_threshold") or GIB_CREDITS_LOW_DEFAULT)
    d["event_labels"] = dict(EVENT_LABELS)
    return d


async def get_prefs(company_id: str) -> dict:
    cid = str(company_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="Şirket seçilmedi.")
    row = await _db.company_notify_prefs.find_one({"company_id": cid})
    if not row:
        return default_prefs(cid)
    base = default_prefs(cid)
    base.update({k: row[k] for k in row if k != "_id"})
    base["_id"] = row.get("_id") or base["_id"]
    base["events"] = _norm_event_prefs(row.get("events"))
    base["extra_emails"] = _norm_extra_emails(row.get("extra_emails"))
    return base


async def save_prefs(company_id: str, body: dict) -> dict:
    cid = str(company_id or "").strip()
    cur = await get_prefs(cid)
    events = _norm_event_prefs(body.get("events") if isinstance(body.get("events"), dict) else cur.get("events"))
    extra = _norm_extra_emails(body["extra_emails"] if "extra_emails" in body else cur.get("extra_emails"))
    ef = str(body.get("email_from") if "email_from" in body else cur.get("email_from") or "platform").strip().lower()
    if ef not in EMAIL_FROM_MODES:
        ef = "platform"
    thr = int(body.get("gib_credits_threshold") if "gib_credits_threshold" in body else cur.get("gib_credits_threshold") or GIB_CREDITS_LOW_DEFAULT)
    thr = max(1, min(thr, 10_000))
    doc = {
        "_id": cur.get("_id") or f"cnp_{cid}",
        "company_id": cid,
        "events": events,
        "extra_emails": extra,
        "email_from": ef,
        "gib_credits_threshold": thr,
        "updated_at": _now(),
    }
    await _db.company_notify_prefs.update_one(
        {"company_id": cid},
        {"$set": doc, "$setOnInsert": {"created_at": _now()}},
        upsert=True,
    )
    return await present_prefs(doc)


async def _platform_batch_default() -> int:
    try:
        coll = getattr(_db, "platform_settings", None)
        find_one = getattr(coll, "find_one", None) if coll is not None else None
        if find_one is None:
            return DEFAULT_ORDER_BATCH_MINUTES
        row = await find_one({"_id": "platform"})
    except Exception:
        return DEFAULT_ORDER_BATCH_MINUTES
    if not isinstance(row, dict) or "notify_order_batch_minutes_default" not in row:
        return DEFAULT_ORDER_BATCH_MINUTES
    if row.get("notify_order_batch_minutes_default") in (None, ""):
        return DEFAULT_ORDER_BATCH_MINUTES
    parsed = _parse_batch_minutes(row.get("notify_order_batch_minutes_default"), strict=False)
    return parsed if parsed is not None else DEFAULT_ORDER_BATCH_MINUTES


async def resolve_order_batch_minutes(company_id: str, prefs: Optional[dict] = None) -> int:
    """Firma ayarı, yoksa platform varsayılanı, yoksa 10."""
    events = None
    if prefs is not None:
        events = prefs.get("events") or {}
    else:
        try:
            row = await _db.company_notify_prefs.find_one({"company_id": company_id}) if company_id else None
        except Exception:
            row = None
        events = (row or {}).get("events") or {}
    raw = events.get("order_new") if isinstance(events, dict) else None
    if isinstance(raw, dict) and "batch_minutes" in raw and raw.get("batch_minutes") not in (None, ""):
        parsed = _parse_batch_minutes(raw.get("batch_minutes"), strict=False)
        if parsed is not None:
            return parsed
    return await _platform_batch_default()


async def present_prefs(doc: dict) -> dict:
    out = public_prefs(doc)
    cid = str(doc.get("company_id") or "")
    events = out.get("events") or {}
    order = dict(events.get("order_new") or {})
    order["batch_minutes"] = await resolve_order_batch_minutes(cid, prefs=doc)
    events["order_new"] = order
    out["events"] = events
    return out


async def app_link(path: str = "") -> str:
    """Uygulama (app.tamkobi.com) mutlak link — asla localhost üretmez."""
    base = await public_url.public_base_url_for(_db, "app")
    p = str(path or "").strip()
    if not p:
        return base
    if not p.startswith("/"):
        p = "/" + p
    return f"{base}{p}"


def _safe_link(absolute: str) -> str:
    if public_url.is_invalid_public_base(absolute):
        return ""
    return absolute


async def _dedupe_seen(company_id: str, dedupe_key: Optional[str]) -> bool:
    key = str(dedupe_key or "").strip()
    if not key:
        return False
    _id = f"{company_id}:{key}"
    existing = await _db.notify_event_dedupe.find_one({"_id": _id})
    if existing:
        return True
    try:
        await _db.notify_event_dedupe.insert_one({
            "_id": _id,
            "company_id": company_id,
            "dedupe_key": key,
            "created_at": _now(),
        })
    except Exception:
        # Yarış: başka worker yazdıysa tekrar gönderilmesin.
        return bool(await _db.notify_event_dedupe.find_one({"_id": _id}))
    return False


async def _company_name(company_id: str) -> str:
    c = await _db.companies.find_one({"_id": company_id}, {"name": 1}) or {}
    return str(c.get("name") or "Firma").strip() or "Firma"


async def _recipient_users(company_id: str, event: str) -> List[dict]:
    roles = notify.roles_for_type(event)
    return await notify.users_with_roles(_db, company_id, roles)


async def _recipient_emails(company_id: str, event: str, prefs: dict) -> List[str]:
    users = await _recipient_users(company_id, event)
    emails: List[str] = []
    seen = set()
    for u in users:
        em = str(u.get("email") or "").strip().lower()
        if em and "@" in em and em not in seen:
            seen.add(em)
            emails.append(em)
    for em in _norm_extra_emails(prefs.get("extra_emails")):
        if em not in seen:
            seen.add(em)
            emails.append(em)
    return emails


async def _recipient_phones(company_id: str, event: str) -> List[str]:
    users = await _recipient_users(company_id, event)
    phones: List[str] = []
    seen = set()
    for u in users:
        ph = str(u.get("phone") or "").strip()
        if ph and ph not in seen:
            seen.add(ph)
            phones.append(ph)
    return phones


async def _company_reply_to(company_id: str, prefs: dict) -> Optional[str]:
    """email_from=company ise Reply-To şirket adresi; gönderim yine SES/platform SMTP."""
    if str(prefs.get("email_from") or "platform") != "company":
        return None
    load = _deps.get("mail_account")
    if load:
        try:
            acc = await load(company_id)
            em = str((acc or {}).get("email") or (acc or {}).get("reply_to") or "").strip()
            if em and "@" in em:
                return em
        except HTTPException as e:
            if getattr(e, "status_code", None) == 409:
                logger.warning("mail needs_reauth company=%s context=event_notify: %s", company_id, e.detail)
            else:
                logger.info("company reply-to unavailable for %s: %s", company_id, e.detail)
        except Exception as e:
            logger.info("company reply-to unavailable for %s: %s", company_id, e)
    c = await _db.companies.find_one({"_id": company_id}, {"email": 1}) or {}
    em = str(c.get("email") or "").strip()
    return em if em and "@" in em else None


async def _sms_sent_today(company_id: str) -> int:
    day = _today()
    row = await _db.notify_sms_daily.find_one({"_id": f"{company_id}:{day}"})
    return int((row or {}).get("count") or 0)


async def _inc_sms_daily(company_id: str, n: int = 1) -> None:
    day = _today()
    await _db.notify_sms_daily.update_one(
        {"_id": f"{company_id}:{day}"},
        {"$inc": {"count": n}, "$set": {"company_id": company_id, "day": day, "updated_at": _now()}},
        upsert=True,
    )


def _esc(val) -> str:
    return html.escape("" if val is None else str(val), quote=True)


def _email_html(company_name: str, title: str, message: str, link: str) -> str:
    btn = ""
    if link:
        btn = (
            f"<p style='margin-top:16px'><a href='{_esc(link)}' "
            f"style='background:#059669;color:#fff;padding:10px 18px;border-radius:10px;"
            f"font-weight:bold;text-decoration:none'>Uygulamada aç →</a></p>"
        )
    msg = _esc(message).replace("\n", "<br>")
    return (
        f"<div style='font-family:Arial,sans-serif;max-width:600px'>"
        f"<p style='color:#64748b;font-size:12px;margin:0 0 8px'>{_esc(company_name)}</p>"
        f"<h2 style='color:#0f172a;margin:0 0 12px'>{_esc(title)}</h2>"
        f"<p style='color:#334155;line-height:1.5'>{msg}</p>{btn}</div>"
    )


def _due_for_digest(digest: str, now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    if digest == "hourly":
        return (now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).isoformat()
    nxt = (now + timedelta(days=1)).replace(hour=7, minute=0, second=0, microsecond=0)
    return nxt.isoformat()


async def _queue_outbox(
    company_id: str,
    event: str,
    *,
    title: str,
    message: str,
    link: str,
    ref_type: Optional[str],
    ref_id: Optional[str],
    channels: dict,
    digest: str,
) -> None:
    await _db.notify_outbox.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "event": event,
        "title": title,
        "message": message,
        "link": link,
        "ref_type": ref_type,
        "ref_id": ref_id,
        "channels": {"email": bool(channels.get("email")), "sms": bool(channels.get("sms"))},
        "digest": digest,
        "due_at": _due_for_digest(digest),
        "status": "pending",
        "attempts": 0,
        "created_at": _now(),
    })


async def _enqueue_order_outbox(
    company_id: str,
    order_id: str,
    *,
    channels: dict,
    digest: str,
) -> bool:
    """order_new e-posta/SMS kuyruğu. due_at batch modunda yazılmaz."""
    oid = str(order_id or "").strip()
    if not oid:
        return False
    key = f"order:{oid}"
    mode = str(digest or "batch").strip().lower()
    if mode not in DIGEST_MODES:
        mode = "batch"
    if mode not in ("hourly", "daily", "instant"):
        mode = "batch"
    doc = {
        "_id": f"out:{company_id}:{key}",
        "company_id": company_id,
        "event": "order_new",
        "ref_type": "order",
        "ref_id": oid,
        "dedupe_key": key,
        "created_at": _now(),
        "status": "pending",
        "attempts": 0,
        "channels": {"email": bool(channels.get("email")), "sms": bool(channels.get("sms"))},
        "digest": mode,
    }
    if mode in ("hourly", "daily"):
        doc["due_at"] = _due_for_digest(mode)
    try:
        await _db.notify_outbox.insert_one(doc)
    except Exception:
        existing = await _db.notify_outbox.find_one({"_id": doc["_id"]})
        return bool(existing)
    return True


async def _send_email_now(company_id: str, prefs: dict, emails: List[str], title: str, message: str, link: str) -> dict:
    if not emails:
        return {"status": "skipped", "reason": "no_recipients"}
    company_name = await _company_name(company_id)
    subject = f"[TamKobi] {company_name}: {title}"
    html = _email_html(company_name, title, message, link)
    body = f"{company_name}\n\n{title}\n\n{message}" + (f"\n\n{link}" if link else "")
    reply_to = await _company_reply_to(company_id, prefs)
    result = await mail_service.send_mail(
        emails,
        subject,
        body,
        html=html,
        purpose="transactional",
        company_id=company_id,
        reply_to=reply_to,
        from_name=company_name,
    )
    status = result.get("status") or "failed"
    via = result.get("driver") or "platform"
    if status == "sent":
        return {"status": "sent", "to": result.get("to") or emails, "via": via}
    return {
        "status": "failed",
        "detail": str(result.get("error") or "Gönderilemedi.")[:160],
        "via": via,
    }


async def _send_sms_now(company_id: str, phones: List[str], title: str, message: str) -> dict:
    if not phones:
        return {"status": "skipped", "reason": "no_phones"}
    used = await _sms_sent_today(company_id)
    remaining = max(0, SMS_DAILY_MAX - used)
    if remaining <= 0:
        return {"status": "skipped", "reason": "daily_limit"}
    try:
        import platform_sms
    except Exception as e:
        return {"status": "skipped", "detail": str(e)[:80]}
    text = f"{title}: {message}"[:300]
    sent = 0
    failed = 0
    for ph in phones[:remaining]:
        try:
            res = await platform_sms.send_platform_sms(
                phone=ph, message=text, context="event_notify", company_id=company_id,
            )
            if res.get("ok"):
                sent += 1
            else:
                failed += 1
        except Exception:
            failed += 1
    if sent:
        await _inc_sms_daily(company_id, sent)
    return {"status": "sent" if sent else "failed", "sent": sent, "failed": failed}


async def notify_event(
    company_id: str,
    event: str,
    title: str,
    message: str,
    link: str = "",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    dedupe_key: Optional[str] = None,
    queue_mail: bool = True,
) -> dict:
    """Olay bildirimi: in-app/push + e-posta + isteğe bağlı SMS (tercihlere göre).

    order_new e-posta/SMS istek içinde SMTP ile gitmez; notify_outbox'a yazılır.
    """
    cid = str(company_id or "").strip()
    ev = str(event or "").strip()
    if not cid or ev not in EVENTS:
        return {"status": "skipped", "reason": "bad_args"}
    if ev == "order_new" and ref_id and queue_mail and ref_type != "order_batch":
        dedupe_key = f"order:{ref_id}"
    if await _dedupe_seen(cid, dedupe_key):
        return {"status": "duplicate", "dedupe_key": dedupe_key}

    prefs = await get_prefs(cid)
    ch = (prefs.get("events") or {}).get(ev) or dict(DEFAULT_CHANNEL)
    abs_link = _safe_link(await app_link(link) if link and not str(link).startswith("http") else str(link or ""))
    # Relative path for in-app notification (mobile/web router)
    inapp_link = link if link and not str(link).startswith("http") else (link or "")
    if abs_link and public_url.is_invalid_public_base(abs_link):
        abs_link = ""

    result: Dict[str, Any] = {"status": "ok", "event": ev, "inapp": False, "email": None, "sms": None, "queued": False}

    if ch.get("inapp", True):
        try:
            await notify.insert_notification(_db, notify.notification_doc(
                cid, ev, title, message,
                link=inapp_link or None,
                ref_type=ref_type,
                ref_id=ref_id,
            ))
            result["inapp"] = True
        except Exception:
            logger.exception("event_notify inapp failed event=%s company=%s", ev, cid)

    digest = str(ch.get("digest") or ("batch" if ev == "order_new" else "instant"))
    need_email = bool(ch.get("email"))
    need_sms = bool(ch.get("sms"))
    if ev == "order_new":
        # E-posta kapalıysa kuyruk yazılmaz. SMS yalnız e-posta açıksa aynı kayda girer.
        if queue_mail and need_email and ref_id:
            await _enqueue_order_outbox(
                cid, str(ref_id),
                channels={"email": True, "sms": need_sms},
                digest=digest,
            )
            result["queued"] = True
        return result

    if digest in ("hourly", "daily") and (need_email or need_sms):
        await _queue_outbox(
            cid, ev, title=title, message=message, link=abs_link or inapp_link,
            ref_type=ref_type, ref_id=ref_id,
            channels={"email": need_email, "sms": need_sms}, digest=digest,
        )
        result["queued"] = True
        return result

    if need_email:
        emails = await _recipient_emails(cid, ev, prefs)
        result["email"] = await _send_email_now(cid, prefs, emails, title, message, abs_link)
    if need_sms:
        phones = await _recipient_phones(cid, ev)
        result["sms"] = await _send_sms_now(cid, phones, title, message)
    return result


def _fmt_amount(val) -> str:
    try:
        return f"{float(val or 0):,.2f} ₺".replace(",", "X").replace(".", ",").replace("X", ".")
    except (TypeError, ValueError):
        return "0,00 ₺"


async def notify_einvoice_batch(company_id: str, docs: List[dict]) -> dict:
    """Yeni gelen e-belgeler; >5 ise tek özet."""
    items = [d for d in (docs or []) if d]
    if not items:
        return {"status": "skipped", "count": 0}
    if len(items) > BATCH_SUMMARY_THRESHOLD:
        total = sum(float(d.get("grand_total") or 0) for d in items)
        title = f"{len(items)} yeni gelen e-belge"
        message = f"Toplam {_fmt_amount(total)}. Gelen kutusundan inceleyin."
        return await notify_event(
            company_id, "einvoice_incoming", title, message,
            link="/edoc-inbox", ref_type="edoc_batch",
            ref_id=str(items[0].get("id") or items[0].get("_id") or ""),
            dedupe_key=f"einv-batch:{_today()}:{len(items)}:{items[0].get('uuid') or items[0].get('id')}",
        )
    last = None
    for d in items:
        sup = d.get("supplier") or {}
        name = sup.get("name") or "Tedarikçi"
        vkn = sup.get("tax_id") or ""
        ettn = (d.get("uuid") or d.get("ettn") or "").strip()
        amount = _fmt_amount(d.get("grand_total"))
        title = f"Gelen e-belge: {name}"
        parts = [amount]
        if vkn:
            parts.append(f"VKN {vkn}")
        if ettn:
            parts.append(f"ETTN {ettn[:13]}…") if len(ettn) > 14 else parts.append(f"ETTN {ettn}")
        message = " · ".join(parts)
        doc_id = str(d.get("id") or d.get("_id") or "")
        from urllib.parse import urlencode
        q = {}
        if ettn:
            q["ettn"] = ettn
        if doc_id:
            q["id"] = doc_id
        link = "/edoc-inbox" + (("?" + urlencode(q)) if q else "")
        last = await notify_event(
            company_id, "einvoice_incoming", title, message,
            link=link,
            ref_type="edoc",
            ref_id=doc_id,
            dedupe_key=f"einv:{ettn}" if ettn else f"einv:id:{d.get('id') or d.get('_id')}",
        )
    return {"status": "ok", "count": len(items), "last": last}


async def _enqueue_order_mail(company_id: str, order: dict, prefs: dict) -> bool:
    """Tek siparişi e-posta kuyruğuna yazar. E-posta kapalıysa kayıt yok."""
    ch = (prefs.get("events") or {}).get("order_new") or {}
    if not ch.get("email", True):
        return False
    oid = str((order or {}).get("_id") or "").strip()
    if not oid:
        return False
    key = f"order:{oid}"
    if await _dedupe_seen(company_id, key):
        return False
    digest = str(ch.get("digest") or "batch")
    return await _enqueue_order_outbox(
        company_id, oid,
        channels={"email": True, "sms": bool(ch.get("sms"))},
        digest=digest,
    )


async def notify_orders_batch(company_id: str, orders: List[dict]) -> dict:
    """Yeni pazaryeri/web siparişleri.

    Uygulama içi + push hemen (5'ten fazlaysa tek özet). E-posta/SMS her sipariş
    için notify_outbox'a yazılır; SMTP istek içinde çalışmaz.
    """
    items = [o for o in (orders or []) if o]
    if not items:
        return {"status": "skipped", "count": 0}
    prefs = await get_prefs(company_id)
    if len(items) > BATCH_SUMMARY_THRESHOLD:
        total = sum(float(o.get("grand_total") or o.get("total_amount") or 0) for o in items)
        chans = sorted({str(o.get("channel") or "?") for o in items})
        title = f"{len(items)} yeni sipariş"
        message = f"{', '.join(chans)} · toplam {_fmt_amount(total)}"
        inapp = await notify_event(
            company_id, "order_new", title, message,
            link="/orders", ref_type="order_batch",
            ref_id=str(items[0].get("_id") or ""),
            dedupe_key=f"order-batch:{_today()}:{len(items)}:{items[0].get('order_number')}",
            queue_mail=False,
        )
        queued = 0
        for o in items:
            if await _enqueue_order_mail(company_id, o, prefs):
                queued += 1
        return {"status": "ok", "count": len(items), "last": inapp, "queued": queued}
    last = None
    for o in items:
        channel = str(o.get("channel") or "sipariş")
        no = str(o.get("order_number") or o.get("_id") or "")
        amount = _fmt_amount(o.get("grand_total") or o.get("total_amount"))
        title = f"Yeni sipariş {no}"
        message = f"{channel} · {amount}"
        if o.get("customer_name"):
            message += f" · {o['customer_name']}"
        oid = str(o.get("_id") or "")
        last = await notify_event(
            company_id, "order_new", title, message,
            link="/orders",
            ref_type="order",
            ref_id=oid,
            dedupe_key=f"order:{oid}" if oid else None,
        )
    return {"status": "ok", "count": len(items), "last": last}


async def maybe_gib_credits_low(company_id: str, balance: int, threshold: Optional[int] = None) -> dict:
    """Kontör eşiğin altındaysa günde bir kez uyar."""
    prefs = await get_prefs(company_id)
    thr = int(threshold if threshold is not None else prefs.get("gib_credits_threshold") or GIB_CREDITS_LOW_DEFAULT)
    bal = int(balance)
    if bal > thr:
        return {"status": "skipped", "reason": "above_threshold", "balance": bal, "threshold": thr}
    return await notify_event(
        company_id, "gib_credits_low",
        f"GİB kontör düşük ({bal})",
        f"Kalan kontör: {bal}. Eşik: {thr}. Yeni paket yükleyin veya platformdan kontör isteyin.",
        link="/account",
        ref_type="gib_credits",
        ref_id=str(company_id),
        dedupe_key=f"gib_credits_low:{_today()}",
    )


async def run_receivable_overdue() -> dict:
    """Vadesi geçmiş satış faturaları özeti — admin/accountant (TYPE_ROLES)."""
    today = _today()
    sent = []
    async for company in _db.companies.find({}, {"_id": 1, "name": 1}):
        cid = company["_id"]
        rows = await _db.invoices.find({
            "company_id": cid,
            "invoice_type": "sales",
            "payment_status": {"$ne": "paid"},
            "status": {"$nin": ["cancelled", "canceled", "void", "draft"]},
            "due_date": {"$lt": today},
        }, {"grand_total": 1, "paid_amount": 1, "invoice_number": 1, "due_date": 1}).to_list(500)
        if not rows:
            continue
        total = sum(max(0.0, float(r.get("grand_total") or 0) - float(r.get("paid_amount") or 0)) for r in rows)
        title = f"{len(rows)} vadesi geçmiş alacak"
        message = f"Toplam {_fmt_amount(total)}. Tahsilatları kontrol edin."
        res = await notify_event(
            cid, "receivable_overdue", title, message,
            link="/invoices",
            ref_type="receivable",
            ref_id=cid,
            dedupe_key=f"receivable_overdue:{today}",
        )
        if res.get("status") not in ("skipped",):
            sent.append({"company_id": cid, **res})
    return {"sent": len(sent), "items": sent, "checked_at": _now()}


def _fmt_number(val, digits: int = 2) -> str:
    try:
        n = float(val or 0)
    except (TypeError, ValueError):
        n = 0.0
    sign = "-" if n < 0 else ""
    n = abs(n)
    if digits <= 0:
        whole = str(int(round(n)))
        frac = ""
    else:
        whole, frac = f"{n:.{digits}f}".split(".")
    groups: List[str] = []
    while whole:
        groups.append(whole[-3:])
        whole = whole[:-3]
    body = ".".join(reversed(groups)) or "0"
    if frac:
        return f"{sign}{body},{frac}"
    return f"{sign}{body}"


def _fmt_rate(val) -> str:
    text = _fmt_number(val, 4)
    if "," not in text:
        return text
    whole, frac = text.split(",", 1)
    frac = frac.rstrip("0") or "00"
    if len(frac) < 2:
        frac = frac.ljust(2, "0")
    return f"{whole},{frac}"


def _fmt_money(val, currency: str = "TRY") -> str:
    cur = str(currency or "TRY").upper()
    amount = _fmt_number(val, 2)
    if cur in ("TRY", "TL", "TRL"):
        return f"{amount} ₺"
    return f"{amount} {cur}"


def _fmt_qty(val) -> str:
    try:
        n = float(val)
    except (TypeError, ValueError):
        return str(val or "")
    if abs(n - round(n)) < 1e-9:
        return _fmt_number(round(n), 0)
    return _fmt_number(n, 2)


def _order_gross(order: dict):
    if order.get("grand_total") not in (None, ""):
        return order.get("grand_total")
    return order.get("total_amount") or 0


def format_order_total(order: dict) -> str:
    """KDV dahil tutar; döviz ve kur korunur. tr-TR."""
    cur = str(order.get("currency") or "TRY").upper()
    gross = _order_gross(order)
    text = _fmt_money(gross, cur)
    if cur in ("TRY", "TL", "TRL"):
        return text
    rate = order.get("fx_rate")
    if rate not in (None, "", 0):
        text += f" (kur {_fmt_rate(rate)})"
    local = order.get("local_total")
    if local not in (None, ""):
        text += f" · {_fmt_money(local, 'TRY')}"
    elif rate not in (None, "", 0):
        try:
            text += f" · {_fmt_money(float(gross or 0) * float(rate), 'TRY')}"
        except (TypeError, ValueError):
            pass
    return text


def _line_prices(line: dict) -> Tuple[Any, Any]:
    unit = line.get("unit_price_incl")
    if unit in (None, "") or (unit in (0, 0.0) and line.get("unit_price") not in (None, "", 0, 0.0)):
        unit = line.get("unit_price")
    total = line.get("total_incl")
    if total in (None, "") or (total in (0, 0.0) and line.get("total") not in (None, "", 0, 0.0)):
        total = line.get("total")
    return unit or 0, total or 0


def _files_url(base: str, path: str) -> str:
    if not base or public_url.is_invalid_public_base(base):
        return ""
    clean = str(path or "").split("?")[0].lstrip("/")
    if not clean:
        return ""
    return f"{base}/api/files/{clean}?w=128&fmt=jpg"


def _placeholder_url(base: str) -> str:
    if not base or public_url.is_invalid_public_base(base):
        return ""
    return f"{base}/brand/tamkobi-icon-192.png"


def order_image_url(raw, base: str) -> str:
    """Mutlak, herkese açık görsel. Dosyalar JPEG küçültme ile; gömme yok."""
    s = str(raw or "").strip()
    if not s:
        return _placeholder_url(base)
    low = s.lower()
    if low.startswith("javascript:") or low.startswith("data:") or low.startswith("cid:"):
        return _placeholder_url(base)
    if "/api/files/" in s:
        path = s.split("/api/files/", 1)[1]
        built = _files_url(base, path)
        return built or _placeholder_url(base)
    if low.startswith("http://") or low.startswith("https://"):
        if public_url.is_invalid_public_base(s):
            return _placeholder_url(base)
        return s
    if s.startswith("/") and base and not public_url.is_invalid_public_base(base):
        return f"{base}{s}"
    return _files_url(base, s) or _placeholder_url(base)


def _batch_subject(orders: List[dict]) -> str:
    if len(orders) == 1:
        o = orders[0]
        no = str(o.get("order_number") or o.get("_id") or "")
        if str(o.get("channel") or "").lower() == "b2b":
            return f"Yeni B2B siparişi {no}"
        return f"Yeni sipariş {no}"
    return f"{len(orders)} yeni sipariş"


def _lines_html(order: dict, base: str) -> str:
    items = [it for it in (order.get("items") or []) if isinstance(it, dict)]
    shown = items[:ORDER_MAIL_MAX_LINES]
    extra = len(items) - len(shown)
    cur = str(order.get("currency") or "TRY")
    rows = ["<table style='width:100%;border-collapse:collapse;font-size:13px'>"]
    for it in shown:
        name = it.get("product_name") or it.get("name") or ""
        img = order_image_url(it.get("image_url") or it.get("image") or "", base)
        img_html = (
            f"<img src='{_esc(img)}' width='64' height='64' alt='' "
            f"style='width:64px;height:64px;object-fit:cover;border-radius:8px'>"
        ) if img else ""
        unit, line_total = _line_prices(it)
        rows.append(
            "<tr>"
            f"<td style='padding:4px;width:64px;vertical-align:top'>{img_html}</td>"
            f"<td style='padding:4px'>{_esc(name)}</td>"
            f"<td style='padding:4px;text-align:right'>{_esc(_fmt_qty(it.get('quantity')))}</td>"
            f"<td style='padding:4px;text-align:right'>{_esc(_fmt_money(unit, cur))}</td>"
            f"<td style='padding:4px;text-align:right'>{_esc(_fmt_money(line_total, cur))}</td>"
            "</tr>"
        )
    if extra > 0:
        rows.append(
            f"<tr><td colspan='5' style='padding:4px;color:#64748b'>{_esc(f've {extra} kalem daha')}</td></tr>"
        )
    rows.append("</table>")
    return "".join(rows)


def _order_batch_html(company_name: str, orders: List[dict], links: Dict[str, str], base: str) -> str:
    shown = orders[:ORDER_MAIL_MAX_ORDERS]
    extra_orders = len(orders) - len(shown)
    parts = [
        "<div style='font-family:Arial,sans-serif;max-width:640px'>",
        f"<p style='color:#64748b;font-size:12px;margin:0 0 8px'>{_esc(company_name)}</p>",
        f"<h2 style='color:#0f172a;margin:0 0 12px'>{_esc(_batch_subject(orders))}</h2>",
    ]
    for o in shown:
        oid = str(o.get("_id") or "")
        link = links.get(oid) or ""
        no = str(o.get("order_number") or oid)
        head = (
            f"<a href='{_esc(link)}' style='color:#059669;font-weight:bold'>{_esc(no)}</a>"
            if link else f"<b>{_esc(no)}</b>"
        )
        parts.append(
            "<div style='margin:0 0 16px;padding:12px;border:1px solid #e2e8f0;border-radius:12px'>"
            f"<p style='margin:0 0 8px'>{head} · {_esc(o.get('channel') or '')} · "
            f"{_esc(o.get('customer_name') or '')} · {_esc(format_order_total(o))}</p>"
            f"{_lines_html(o, base)}</div>"
        )
    if extra_orders:
        parts.append(f"<p style='color:#334155'>{_esc(f've {extra_orders} sipariş daha')}</p>")
    parts.append("</div>")
    return "".join(parts)


def _order_batch_text(company_name: str, orders: List[dict], links: Dict[str, str]) -> str:
    shown = orders[:ORDER_MAIL_MAX_ORDERS]
    extra_orders = len(orders) - len(shown)
    lines = [company_name, "", _batch_subject(orders), ""]
    for o in shown:
        oid = str(o.get("_id") or "")
        no = str(o.get("order_number") or oid)
        lines.append(
            f"{no} · {o.get('channel') or ''} · {o.get('customer_name') or ''} · {format_order_total(o)}"
        )
        if links.get(oid):
            lines.append(links[oid])
        items = [it for it in (o.get("items") or []) if isinstance(it, dict)]
        cur = str(o.get("currency") or "TRY")
        for it in items[:ORDER_MAIL_MAX_LINES]:
            unit, line_total = _line_prices(it)
            name = it.get("product_name") or it.get("name") or ""
            lines.append(
                f"- {name} · {_fmt_qty(it.get('quantity'))} · {_fmt_money(unit, cur)} · {_fmt_money(line_total, cur)}"
            )
        extra = len(items) - ORDER_MAIL_MAX_LINES
        if extra > 0:
            lines.append(f"ve {extra} kalem daha")
        lines.append("")
    if extra_orders:
        lines.append(f"ve {extra_orders} sipariş daha")
    return "\n".join(lines).strip()


def _sms_order_summary(orders: List[dict]) -> str:
    n = len(orders)
    currencies = {str(o.get("currency") or "TRY").upper() for o in orders}
    if len(currencies) == 1:
        cur = next(iter(currencies))
        total = sum(float(_order_gross(o) or 0) for o in orders)
        return f"{n} yeni sipariş · {_fmt_money(total, cur)}"[:300]
    return f"{n} yeni sipariş"[:300]


def _order_visible(order) -> bool:
    if not isinstance(order, dict):
        return False
    if order.get("is_deleted") or order.get("deleted_at"):
        return False
    st = str(order.get("order_status") or order.get("status") or "").strip().lower()
    return st not in _CANCELLED_ORDER_STATUSES


def _parse_ts(raw: str) -> datetime:
    text = str(raw or "").replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _window_open(rows: List[dict], minutes: int, now: datetime) -> bool:
    created = []
    for row in rows:
        if not row.get("created_at"):
            continue
        try:
            created.append(_parse_ts(row["created_at"]))
        except (TypeError, ValueError):
            continue
    if not created:
        return True
    return now >= min(created) + timedelta(minutes=int(minutes))


def _is_windowed_batch(event: str, digest: str) -> bool:
    return event == "order_new" and digest not in ("hourly", "daily")


async def _to_list(cursor, limit: int = 500) -> List[dict]:
    if cursor is None:
        return []
    if hasattr(cursor, "to_list"):
        rows = await cursor.to_list(limit)
        return list(rows or [])
    return []


async def _release_stale_sending() -> None:
    cutoff = (datetime.now(timezone.utc) - STALE_SENDING_AFTER).isoformat()
    try:
        rows = await _to_list(_db.notify_outbox.find({"status": "sending"}), 500)
    except Exception:
        logger.exception("notify stale scan failed")
        return
    for row in rows:
        claimed = str(row.get("claimed_at") or "")
        if claimed and claimed >= cutoff:
            continue
        try:
            await _db.notify_outbox.update_one(
                {"_id": row["_id"], "status": "sending"},
                {"$set": {"status": "pending", "claim_id": None, "claimed_at": None}},
            )
        except Exception:
            logger.exception("notify stale release failed")


async def _claim_pending(candidates: List[dict]) -> str:
    """pending → sending. İki işleyici aynı satırı alamaz; sonra yalnız claim_id okunur."""
    claim_id = str(uuid.uuid4())
    now = _now()
    patch = {"$set": {"status": "sending", "claim_id": claim_id, "claimed_at": now}}
    coll = _db.notify_outbox
    atomic = getattr(coll, "update_one_atomic", None)
    if not candidates:
        return claim_id
    if atomic:
        for row in candidates:
            try:
                await atomic(
                    {
                        "_id": row["_id"],
                        "company_id": row.get("company_id"),
                        "event": row.get("event"),
                        "status": "pending",
                    },
                    patch,
                )
            except Exception:
                logger.exception("notify outbox claim")
        return claim_id
    ids = [r["_id"] for r in candidates if r.get("_id")]
    first = candidates[0]
    await coll.update_many(
        {
            "company_id": first.get("company_id"),
            "event": first.get("event"),
            "status": "pending",
            "_id": {"$in": ids},
        },
        patch,
    )
    return claim_id


async def _load_claimed(claim_id: str) -> List[dict]:
    return await _to_list(
        _db.notify_outbox.find({"claim_id": claim_id, "status": "sending"}),
        500,
    )


async def _update_claimed(rows: List[dict], claim_id: str, fields: dict) -> None:
    for row in rows:
        try:
            await _db.notify_outbox.update_one(
                {"_id": row["_id"], "claim_id": claim_id},
                {"$set": fields},
            )
        except Exception:
            logger.exception("notify outbox status")


async def _mark_rows(rows: List[dict], claim_id: str, status: str, extra: Optional[dict] = None) -> None:
    fields = {"status": status, **(extra or {})}
    if status == "sent":
        fields["sent_at"] = _now()
    if status in ("skipped", "failed", "sent"):
        fields["claim_id"] = claim_id
    await _update_claimed(rows, claim_id, fields)


async def _retry_rows(rows: List[dict], claim_id: str, extra: Optional[dict] = None) -> None:
    for row in rows:
        attempts = int(row.get("attempts") or 0) + 1
        fields = dict(extra or {})
        fields["attempts"] = attempts
        if attempts >= OUTBOX_MAX_ATTEMPTS:
            fields["status"] = "failed"
            fields["failed_at"] = _now()
        else:
            fields["status"] = "pending"
            fields["claim_id"] = None
            fields["claimed_at"] = None
            fields["next_try_at"] = (datetime.now(timezone.utc) + OUTBOX_RETRY_DELAY).isoformat()
        try:
            await _db.notify_outbox.update_one(
                {"_id": row["_id"], "claim_id": claim_id},
                {"$set": fields},
            )
        except Exception:
            logger.exception("notify outbox retry")


async def _order_links(orders: List[dict]) -> Dict[str, str]:
    links: Dict[str, str] = {}
    for o in orders:
        oid = str(o.get("_id") or "")
        if not oid:
            continue
        links[oid] = _safe_link(await app_link(f"/orders?open={quote(oid)}"))
    return links


async def _send_order_emails(company_id: str, prefs: dict, emails: List[str], orders: List[dict], already: set) -> Tuple[List[str], List[str]]:
    base = _safe_link(await app_link(""))
    links = await _order_links(orders)
    subject = _batch_subject(orders)
    html_body = _order_batch_html(await _company_name(company_id), orders, links, base)
    text_body = _order_batch_text(await _company_name(company_id), orders, links)
    reply_to = await _company_reply_to(company_id, prefs)
    company_name = await _company_name(company_id)
    sent: List[str] = []
    failed: List[str] = []
    for em in emails:
        if em in already:
            sent.append(em)
            continue
        result = await mail_service.send_mail(
            [em],
            subject,
            text_body,
            html=html_body,
            purpose="transactional",
            company_id=company_id,
            reply_to=reply_to,
            from_name=company_name,
        )
        if (result or {}).get("status") == "sent":
            sent.append(em)
        else:
            failed.append(em)
    return sent, failed


async def _deliver_order_batch(company_id: str, rows: List[dict], claim_id: str) -> int:
    prefs = await get_prefs(company_id)
    ch = (prefs.get("events") or {}).get("order_new") or {}
    email_on = bool(ch.get("email"))
    sms_on = bool(ch.get("sms"))
    if not email_on:
        await _mark_rows(rows, claim_id, "skipped")
        return len(rows)

    visible: List[dict] = []
    hidden: List[dict] = []
    for row in rows:
        oid = str(row.get("ref_id") or "")
        try:
            order = await _db.orders.find_one({"_id": oid, "company_id": company_id}) if oid else None
        except Exception:
            logger.exception("order load failed company=%s ref=%s", company_id, oid)
            await _retry_rows(rows, claim_id)
            return 0
        if not _order_visible(order):
            hidden.append(row)
            continue
        visible.append(order)
    if hidden:
        await _mark_rows(hidden, claim_id, "skipped")
    active = [r for r in rows if r not in hidden]
    if not active or not visible:
        return len(hidden)

    want_email = email_on and any((r.get("channels") or {}).get("email") for r in active)
    want_sms = sms_on and any((r.get("channels") or {}).get("sms") and not r.get("sms_sent") for r in active)
    if not want_email and not want_sms and not any(r.get("email_sent") for r in active):
        await _mark_rows(active, claim_id, "skipped")
        return len(rows)

    if want_email and not all(r.get("email_sent") for r in active):
        emails = await _recipient_emails(company_id, "order_new", prefs)
        if not emails:
            if not want_sms:
                await _mark_rows(active, claim_id, "skipped")
                return len(rows)
        else:
            already = set()
            for r in active:
                already.update(r.get("sent_to") or [])
            sent, failed = await _send_order_emails(company_id, prefs, emails, visible, already)
            if sent:
                await _update_claimed(active, claim_id, {"sent_to": sorted(set(sent) | already), "email_sent": not failed})
                for r in active:
                    r["sent_to"] = sorted(set(sent) | already)
                    r["email_sent"] = not failed
            if failed:
                await _retry_rows(active, claim_id, {"sent_to": sorted(set(sent) | already)})
                return len(hidden)
            await _update_claimed(active, claim_id, {"email_sent": True, "sent_to": sorted(set(emails) | already)})

    if want_sms:
        phones = await _recipient_phones(company_id, "order_new")
        if phones:
            res = await _send_sms_now(company_id, phones, "Yeni sipariş", _sms_order_summary(visible))
            if res.get("status") == "failed":
                await _retry_rows(active, claim_id, {"email_sent": True})
                return len(hidden)
    await _mark_rows(active, claim_id, "sent")
    return len(rows)


async def _deliver_generic(company_id: str, event: str, rows: List[dict], claim_id: str) -> int:
    prefs = await get_prefs(company_id)
    first = rows[0]
    titles = [str(i.get("title") or "") for i in rows]
    if len(rows) == 1:
        title = titles[0]
        message = str(first.get("message") or "")
        link = str(first.get("link") or "")
    else:
        title = f"{EVENT_LABELS.get(event, event)}: {len(rows)} bildirim"
        message = " · ".join(t for t in titles if t)[:500]
        link = str(first.get("link") or "")
    want_email = any((i.get("channels") or {}).get("email") for i in rows) and not all(i.get("email_sent") for i in rows)
    want_sms = any((i.get("channels") or {}).get("sms") for i in rows) and not all(i.get("sms_sent") for i in rows)
    try:
        if want_email:
            emails = await _recipient_emails(company_id, event, prefs)
            if not emails:
                if not want_sms:
                    await _mark_rows(rows, claim_id, "skipped")
                    return len(rows)
            else:
                res = await _send_email_now(company_id, prefs, emails, title, message, link)
                if res.get("status") == "failed":
                    await _retry_rows(rows, claim_id)
                    return 0
                await _update_claimed(rows, claim_id, {"email_sent": True})
        if want_sms:
            phones = await _recipient_phones(company_id, event)
            if phones:
                res = await _send_sms_now(company_id, phones, title, message)
                if res.get("status") == "failed":
                    await _retry_rows(rows, claim_id, {"email_sent": True})
                    return 0
        await _mark_rows(rows, claim_id, "sent")
        return len(rows)
    except Exception:
        logger.exception("notify generic deliver company=%s event=%s", company_id, event)
        await _retry_rows(rows, claim_id)
        return 0


async def flush_notify_outbox(*, force: bool = False) -> dict:
    """Saatlik/günlük özet ve order_new gruplamasını claim ile işler."""
    await _release_stale_sending()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    try:
        pending = await _to_list(_db.notify_outbox.find({"status": "pending"}), 500)
    except Exception:
        logger.exception("notify outbox scan failed")
        return {"flushed": 0, "at": _now()}
    eligible = []
    for row in pending:
        nxt = row.get("next_try_at")
        if nxt and str(nxt) > now_iso and not force:
            continue
        eligible.append(row)
    groups: Dict[Tuple[str, str, str], List[dict]] = {}
    for row in eligible:
        key = (str(row.get("company_id") or ""), str(row.get("event") or ""), str(row.get("digest") or ""))
        groups.setdefault(key, []).append(row)

    flushed = 0
    for (cid, ev, digest), items in groups.items():
        if not cid or not ev:
            continue
        if _is_windowed_batch(ev, digest):
            minutes = 0 if digest == "instant" else await resolve_order_batch_minutes(cid)
            if not force and not _window_open(items, minutes, now):
                continue
        elif not force and not any(str(i.get("due_at") or "") <= now_iso for i in items):
            continue
        if not _is_windowed_batch(ev, digest) and not force:
            items = [i for i in items if str(i.get("due_at") or "") <= now_iso]
            if not items:
                continue
        claim_id = await _claim_pending(items)
        claimed = await _load_claimed(claim_id)
        if not claimed:
            continue
        if ev == "order_new":
            flushed += await _deliver_order_batch(cid, claimed, claim_id)
        else:
            flushed += await _deliver_generic(cid, ev, claimed, claim_id)
    return {"flushed": flushed, "at": _now()}


async def digest_loop(interval_s: int = 60):
    await asyncio.sleep(45)
    while True:
        try:
            await flush_notify_outbox()
        except Exception as e:
            logger.warning("notify digest flush: %s", e)
        await asyncio.sleep(interval_s)


async def overdue_loop(interval_s: int = 3600):
    await asyncio.sleep(90)
    while True:
        try:
            await run_receivable_overdue()
        except Exception as e:
            logger.warning("receivable overdue job: %s", e)
        await asyncio.sleep(interval_s)


@router.get("/notify/prefs")
async def get_notify_prefs_route(
    request: Request,
    company_id: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    cid = tenant_access.resolve_company_id(
        user, company_id or request.query_params.get("company_id"),
    )
    return await present_prefs(await get_prefs(cid))


@router.put("/notify/prefs")
async def put_notify_prefs_route(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, (req or {}).get("company_id"))
    await tenant_access.require_company_admin(user, cid)
    return await save_prefs(cid, req or {})
