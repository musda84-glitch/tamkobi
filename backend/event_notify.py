"""Şirket olay bildirimleri: gelen e-fatura, yeni sipariş, kontör, vadesi geçmiş alacak.

Kanallar: uygulama içi (+ push), e-posta, isteğe bağlı SMS.
Tercihler: company_notify_prefs. Özet: notify_outbox + leased job.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

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
DIGEST_MODES = ("instant", "hourly", "daily")
EMAIL_FROM_MODES = ("platform", "company")
DEFAULT_CHANNEL = {"inapp": True, "email": True, "sms": False, "digest": "instant"}
BATCH_SUMMARY_THRESHOLD = 5
SMS_DAILY_MAX = 20
GIB_CREDITS_LOW_DEFAULT = 20


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
    return {
        "_id": f"cnp_{company_id}",
        "company_id": company_id,
        "events": {ev: dict(DEFAULT_CHANNEL) for ev in EVENTS},
        "extra_emails": [],
        "email_from": "platform",
        "gib_credits_threshold": GIB_CREDITS_LOW_DEFAULT,
        "updated_at": _now(),
    }


def _norm_event_prefs(raw: Optional[dict]) -> dict:
    out = {}
    src = raw if isinstance(raw, dict) else {}
    for ev in EVENTS:
        cur = src.get(ev) if isinstance(src.get(ev), dict) else {}
        digest = str(cur.get("digest") or "instant").strip().lower()
        if digest not in DIGEST_MODES:
            digest = "instant"
        out[ev] = {
            "inapp": bool(cur["inapp"]) if "inapp" in cur else True,
            "email": bool(cur["email"]) if "email" in cur else True,
            "sms": bool(cur["sms"]) if "sms" in cur else False,
            "digest": digest,
        }
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
    return public_prefs(doc)


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


def _email_html(company_name: str, title: str, message: str, link: str) -> str:
    btn = ""
    if link:
        btn = (
            f"<p style='margin-top:16px'><a href='{link}' "
            f"style='background:#059669;color:#fff;padding:10px 18px;border-radius:10px;"
            f"font-weight:bold;text-decoration:none'>Uygulamada aç →</a></p>"
        )
    return (
        f"<div style='font-family:Arial,sans-serif;max-width:600px'>"
        f"<p style='color:#64748b;font-size:12px;margin:0 0 8px'>{company_name}</p>"
        f"<h2 style='color:#0f172a;margin:0 0 12px'>{title}</h2>"
        f"<p style='color:#334155;line-height:1.5'>{message}</p>{btn}</div>"
    )


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
    now = datetime.now(timezone.utc)
    if digest == "hourly":
        due = (now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).isoformat()
    else:
        # daily — ertesi gün 07:00 UTC
        nxt = (now + timedelta(days=1)).replace(hour=7, minute=0, second=0, microsecond=0)
        due = nxt.isoformat()
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
        "due_at": due,
        "status": "pending",
        "created_at": _now(),
    })


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
) -> dict:
    """Olay bildirimi: in-app/push + e-posta + isteğe bağlı SMS (tercihlere göre)."""
    cid = str(company_id or "").strip()
    ev = str(event or "").strip()
    if not cid or ev not in EVENTS:
        return {"status": "skipped", "reason": "bad_args"}
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

    digest = str(ch.get("digest") or "instant")
    need_email = bool(ch.get("email"))
    need_sms = bool(ch.get("sms"))
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
        last = await notify_event(
            company_id, "einvoice_incoming", title, message,
            link="/edoc-inbox",
            ref_type="edoc",
            ref_id=str(d.get("id") or d.get("_id") or ""),
            dedupe_key=f"einv:{ettn}" if ettn else f"einv:id:{d.get('id') or d.get('_id')}",
        )
    return {"status": "ok", "count": len(items), "last": last}


async def notify_orders_batch(company_id: str, orders: List[dict]) -> dict:
    """Yeni pazaryeri/web/B2B siparişleri; >5 ise tek özet."""
    items = [o for o in (orders or []) if o]
    if not items:
        return {"status": "skipped", "count": 0}
    if len(items) > BATCH_SUMMARY_THRESHOLD:
        total = sum(float(o.get("grand_total") or o.get("total_amount") or 0) for o in items)
        chans = sorted({str(o.get("channel") or "?") for o in items})
        title = f"{len(items)} yeni sipariş"
        message = f"{', '.join(chans)} · toplam {_fmt_amount(total)}"
        return await notify_event(
            company_id, "order_new", title, message,
            link="/orders", ref_type="order_batch",
            ref_id=str(items[0].get("_id") or ""),
            dedupe_key=f"order-batch:{_today()}:{len(items)}:{items[0].get('order_number')}",
        )
    last = None
    for o in items:
        channel = str(o.get("channel") or "sipariş")
        no = str(o.get("order_number") or o.get("_id") or "")
        amount = _fmt_amount(o.get("grand_total") or o.get("total_amount"))
        title = f"Yeni sipariş {no}"
        message = f"{channel} · {amount}"
        if o.get("customer_name"):
            message += f" · {o['customer_name']}"
        last = await notify_event(
            company_id, "order_new", title, message,
            link="/orders",
            ref_type="order",
            ref_id=str(o.get("_id") or ""),
            dedupe_key=f"order:{channel}:{no}",
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


async def flush_notify_outbox(*, force: bool = False) -> dict:
    """Digest kuyruğunu (hourly/daily) işler."""
    now = _now()
    q: Dict[str, Any] = {"status": "pending"}
    if not force:
        q["due_at"] = {"$lte": now}
    rows = await _db.notify_outbox.find(q).sort("due_at", 1).to_list(200)
    # Şirket+event bazında birleştir
    groups: Dict[str, List[dict]] = {}
    for r in rows:
        key = f"{r.get('company_id')}|{r.get('event')}|{r.get('digest')}"
        groups.setdefault(key, []).append(r)

    flushed = 0
    for _key, items in groups.items():
        first = items[0]
        cid = first["company_id"]
        ev = first["event"]
        prefs = await get_prefs(cid)
        titles = [str(i.get("title") or "") for i in items]
        if len(items) == 1:
            title = titles[0]
            message = str(first.get("message") or "")
            link = str(first.get("link") or "")
        else:
            title = f"{EVENT_LABELS.get(ev, ev)}: {len(items)} bildirim"
            message = " · ".join(t for t in titles if t)[:500]
            link = str(first.get("link") or "")
        want_email = any((i.get("channels") or {}).get("email") for i in items)
        want_sms = any((i.get("channels") or {}).get("sms") for i in items)
        if want_email:
            emails = await _recipient_emails(cid, ev, prefs)
            await _send_email_now(cid, prefs, emails, title, message, link)
        if want_sms:
            phones = await _recipient_phones(cid, ev)
            await _send_sms_now(cid, phones, title, message)
        ids = [i["_id"] for i in items]
        await _db.notify_outbox.update_many(
            {"_id": {"$in": ids}},
            {"$set": {"status": "sent", "sent_at": _now()}},
        )
        flushed += len(ids)
    return {"flushed": flushed, "at": _now()}


async def digest_loop(interval_s: int = 300):
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
    return public_prefs(await get_prefs(cid))


@router.put("/notify/prefs")
async def put_notify_prefs_route(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, (req or {}).get("company_id"))
    await tenant_access.require_company_admin(user, cid)
    return await save_prefs(cid, req or {})
