"""Şirket olay bildirimleri: gelen e-fatura, yeni sipariş, kontör, vadesi geçmiş alacak.

Kanallar: uygulama içi (+ push), e-posta, isteğe bağlı SMS.
Platform tercihleri: company_notify_prefs. Firma aç/kapa: company_notify_tenant.
Etkin uygulama/e-posta = platform AND firma. Özet: notify_outbox + leased job.

Banka, kasa, POS, üretime gönderme ve personel (mesai, izin, avans, fazla mesai)
e-postası yalnız notify_outbox üzerinden gider. Bu olaylar da firma aç/kapa
kapsamındadır (FIRM_EVENTS). Platformun kapattığı kanal firma tarafından açılamaz.
Onay olaylarının uygulama içi bildirimi kapatılamaz.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, Tuple
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request

import company_audit
import mail_service
import notify
import notify_email_layout
import public_url
import saas
import tenant_access

logger = logging.getLogger("TamKobiERP")

router = APIRouter(prefix="/api", tags=["event-notify"])
_db = None
_deps: Dict[str, Any] = {}
_current_user: Optional[Callable[..., Awaitable[dict]]] = None

TENANT_EVENTS = (
    "einvoice_incoming",
    "order_new",
    "gib_credits_low",
    "receivable_overdue",
)
NEW_EVENTS = (
    "bank_sync",
    "cash_approval",
    "pos_approval",
    "pos_daily_summary",
    "order_pick_production",
    "attendance_alert",
    "leave_request",
    "advance_request",
    "overtime_request",
    "morning_summary",
)
FIRM_EVENTS = TENANT_EVENTS + NEW_EVENTS
EVENTS = FIRM_EVENTS
APPROVAL_EVENTS = (
    "cash_approval",
    "pos_approval",
    "leave_request",
    "advance_request",
    "overtime_request",
)
EVENT_GROUPS = {
    "einvoice_incoming": "sales_invoice",
    "order_new": "sales_invoice",
    "gib_credits_low": "sales_invoice",
    "receivable_overdue": "sales_invoice",
    "morning_summary": "sales_invoice",
    "bank_sync": "bank_cash_pos",
    "cash_approval": "bank_cash_pos",
    "pos_approval": "bank_cash_pos",
    "pos_daily_summary": "bank_cash_pos",
    "order_pick_production": "production_warehouse",
    "attendance_alert": "personnel",
    "leave_request": "personnel",
    "advance_request": "personnel",
    "overtime_request": "personnel",
}
EVENT_LABELS = {
    "einvoice_incoming": "Gelen e-Fatura",
    "order_new": "Yeni sipariş",
    "gib_credits_low": "GİB kontör düşük",
    "receivable_overdue": "Vadesi geçmiş alacak",
    "morning_summary": "Sabah özeti",
    "bank_sync": "Banka hareketi (senkron)",
    "cash_approval": "Kasa/banka onayı",
    "pos_approval": "POS onayı",
    "pos_daily_summary": "Günlük POS özeti",
    "order_pick_production": "Üretime gönderildi (sipariş hazırlama)",
    "attendance_alert": "Mesai uyarısı (geç/eksik giriş, konum)",
    "leave_request": "İzin talebi",
    "advance_request": "Avans talebi",
    "overtime_request": "Fazla mesai / yevmiye onayı",
}
DIGEST_MODES = ("instant", "hourly", "daily", "batch")
# B2B müşteri postası: alıcı satırdaki to listesi, firma tercihleri değil. SMTP flush'ta.
_B2B_DIRECT_EVENTS = frozenset({"b2b_link_notice", "b2b_verify_email", "b2b_password_reset"})
EMAIL_FROM_MODES = ("platform", "company")
DEFAULT_CHANNEL = {"inapp": True, "email": True, "sms": False, "digest": "instant"}
_NEW_EVENT_CHANNEL = {"inapp": True, "email": False, "sms": False, "digest": "instant"}
EVENT_DEFAULT_CHANNEL = {
    **{ev: dict(DEFAULT_CHANNEL) for ev in TENANT_EVENTS},
    **{ev: dict(_NEW_EVENT_CHANNEL) for ev in NEW_EVENTS},
}
ORDER_BATCH_MINUTES = (0, 5, 10, 15, 30, 60)
DEFAULT_ORDER_BATCH_MINUTES = 10
ORDER_BATCH_DETAIL = "Gruplama süresi 0, 5, 10, 15, 30 veya 60 dakika olabilir."
DAILY_EMAIL_CAP_DETAIL = "Günlük e-posta limiti boş (limitsiz) veya 0 ve üzeri tam sayı olmalıdır."
COMPANY_NOTIFY_FORBIDDEN = "Bildirim ayarları Platform Yönetimi'nden yapılır."
PLATFORM_ONLY_DETAIL = "Bu ayar Platform Yönetimi'nden yapılır."
PLATFORM_CLOSED_DETAIL = "Bu kanal Platform Yönetimi'nden kapatıldı."
APPROVAL_INAPP_DETAIL = "Onay bildirimleri uygulama içinde kapatılamaz."
TENANT_BOOL_DETAIL = "Bildirim anahtarı true veya false olmalıdır."
TENANT_CHANNELS = ("inapp", "email")
QUIET_HOURS_DETAIL = "Sessiz saatler HH:MM biçiminde olmalıdır (ör. 22:00)."
DEFAULT_QUIET_HOURS = {"enabled": False, "start": "22:00", "end": "08:00"}
NOTIFY_MAIL_LOG_LIMIT_MAX = 200
_PENDING_ORDER_STATUSES = {"pending"}
_APPROVED_ORDER_STATUSES = {"approved", "preparing"}
IST = ZoneInfo("Europe/Istanbul")
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
    return _now_utc().isoformat()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _default_quiet_hours() -> dict:
    return dict(DEFAULT_QUIET_HOURS)


def _today() -> str:
    return date.today().isoformat()


def _event_channel_default(ev: str) -> dict:
    """Olayın kod varsayılanı. Eski dört olay DEFAULT_CHANNEL ile aynıdır."""
    base = EVENT_DEFAULT_CHANNEL.get(ev)
    return dict(base) if base else dict(DEFAULT_CHANNEL)


def default_prefs(company_id: str) -> dict:
    events = {}
    for ev in EVENTS:
        ch = _event_channel_default(ev)
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


def _parse_daily_email_cap(val, *, strict: bool) -> Optional[int]:
    """Boş = inherit/limitsiz. 0 geçerli (e-posta yok)."""
    if val is None or val == "":
        return None
    if isinstance(val, bool) or isinstance(val, (list, dict)):
        if strict:
            raise HTTPException(status_code=400, detail=DAILY_EMAIL_CAP_DETAIL)
        return None
    if isinstance(val, float) and not float(val).is_integer():
        if strict:
            raise HTTPException(status_code=400, detail=DAILY_EMAIL_CAP_DETAIL)
        return None
    try:
        n = int(val)
    except (TypeError, ValueError):
        if strict:
            raise HTTPException(status_code=400, detail=DAILY_EMAIL_CAP_DETAIL)
        return None
    if n < 0 or n > 1_000_000:
        if strict:
            raise HTTPException(status_code=400, detail=DAILY_EMAIL_CAP_DETAIL)
        return None
    return n


def _parse_hhmm(val, *, strict: bool) -> Optional[Tuple[int, int]]:
    text = str(val if val is not None else "").strip()
    m = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)", text)
    if not m:
        if strict:
            raise HTTPException(status_code=400, detail=QUIET_HOURS_DETAIL)
        return None
    return int(m.group(1)), int(m.group(2))


def _norm_quiet_hours(raw, *, strict: bool) -> Optional[dict]:
    """{enabled, start, end}. Yoksa None (kayıt kayıpsız); geçersiz HH:MM → 400."""
    if raw is None or raw == "":
        return None if not strict else _default_quiet_hours()
    if not isinstance(raw, dict):
        if strict:
            raise HTTPException(status_code=400, detail=QUIET_HOURS_DETAIL)
        return None
    start_raw = raw["start"] if "start" in raw and raw.get("start") not in (None, "") else DEFAULT_QUIET_HOURS["start"]
    end_raw = raw["end"] if "end" in raw and raw.get("end") not in (None, "") else DEFAULT_QUIET_HOURS["end"]
    start = _parse_hhmm(start_raw, strict=strict)
    end = _parse_hhmm(end_raw, strict=strict)
    if start is None or end is None:
        if strict:
            raise HTTPException(status_code=400, detail=QUIET_HOURS_DETAIL)
        return None
    sh, sm = start
    eh, em = end
    return {
        "enabled": bool(raw["enabled"]) if "enabled" in raw else False,
        "start": f"{sh:02d}:{sm:02d}",
        "end": f"{eh:02d}:{em:02d}",
    }


def _quiet_hours_of(prefs: Optional[Mapping]) -> dict:
    events = (prefs or {}).get("events") if isinstance(prefs, Mapping) else None
    raw = events.get("order_new") if isinstance(events, dict) else None
    qh = raw.get("quiet_hours") if isinstance(raw, dict) else None
    return _norm_quiet_hours(qh, strict=False) or _default_quiet_hours()


def _quiet_hours_until(qh: Optional[Mapping], now: Optional[datetime] = None) -> Optional[datetime]:
    """Sessiz aralıktaysa aralık sonunu UTC olarak döner (gece yarısı aşımı dahil)."""
    if not isinstance(qh, Mapping) or not qh.get("enabled"):
        return None
    start = _parse_hhmm(qh.get("start") or DEFAULT_QUIET_HOURS["start"], strict=False)
    end = _parse_hhmm(qh.get("end") or DEFAULT_QUIET_HOURS["end"], strict=False)
    if start is None or end is None:
        return None
    sh, sm = start
    eh, em = end
    start_sec = sh * 3600 + sm * 60
    end_sec = eh * 3600 + em * 60
    if start_sec == end_sec:
        return None
    local = (now or _now_utc()).astimezone(IST)
    now_sec = local.hour * 3600 + local.minute * 60 + local.second
    overnight = start_sec > end_sec
    if overnight:
        in_window = now_sec >= start_sec or now_sec < end_sec
    else:
        in_window = start_sec <= now_sec < end_sec
    if not in_window:
        return None
    end_dt = local.replace(hour=eh, minute=em, second=0, microsecond=0)
    if overnight and now_sec >= start_sec:
        end_dt = end_dt + timedelta(days=1)
    return end_dt.astimezone(timezone.utc)


def _norm_event_prefs(raw: Optional[dict]) -> dict:
    out = {}
    src = raw if isinstance(raw, dict) else {}
    for ev in EVENTS:
        cur = src.get(ev) if isinstance(src.get(ev), dict) else {}
        defaults = _event_channel_default(ev)
        default_digest = "batch" if ev == "order_new" else str(defaults.get("digest") or "instant")
        digest = str(cur.get("digest") or default_digest).strip().lower()
        if digest not in DIGEST_MODES:
            digest = default_digest
        item = {
            "inapp": bool(cur["inapp"]) if "inapp" in cur else bool(defaults.get("inapp", True)),
            "email": bool(cur["email"]) if "email" in cur else bool(defaults.get("email", True)),
            "sms": bool(cur["sms"]) if "sms" in cur else bool(defaults.get("sms", False)),
            "digest": digest,
        }
        if ev == "order_new" and "batch_minutes" in cur and cur.get("batch_minutes") not in (None, ""):
            parsed = _parse_batch_minutes(cur.get("batch_minutes"), strict=True)
            if parsed is None:
                raise HTTPException(status_code=400, detail=ORDER_BATCH_DETAIL)
            item["batch_minutes"] = parsed
        if ev == "order_new" and "quiet_hours" in cur:
            parsed_qh = _norm_quiet_hours(cur.get("quiet_hours"), strict=True)
            if parsed_qh is None:
                raise HTTPException(status_code=400, detail=QUIET_HOURS_DETAIL)
            item["quiet_hours"] = parsed_qh
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
    d["daily_email_cap"] = _parse_daily_email_cap(d.get("daily_email_cap"), strict=False)
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
    order_ev = events.get("order_new") if isinstance(events.get("order_new"), dict) else None
    if order_ev is not None and "quiet_hours" not in order_ev:
        prev_qh = ((cur.get("events") or {}).get("order_new") or {}).get("quiet_hours")
        if prev_qh is not None:
            kept = _norm_quiet_hours(prev_qh, strict=False)
            if kept:
                order_ev["quiet_hours"] = kept
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
    unset: Dict[str, str] = {}
    if "daily_email_cap" in body:
        cap = _parse_daily_email_cap(body.get("daily_email_cap"), strict=True)
        if cap is None:
            unset["daily_email_cap"] = ""
        else:
            doc["daily_email_cap"] = cap
    upd: Dict[str, Any] = {"$set": doc, "$setOnInsert": {"created_at": _now()}}
    if unset:
        upd["$unset"] = unset
    await _db.company_notify_prefs.update_one(
        {"company_id": cid},
        upd,
        upsert=True,
    )
    return await present_prefs(await get_prefs(cid))


def default_tenant(company_id: str) -> dict:
    """Kayıt yokken firma kanalları açık — platform ne diyorsa o. Tüm firma olayları."""
    return {
        "_id": f"cnt_{company_id}",
        "company_id": company_id,
        "events": {ev: {"inapp": True, "email": True} for ev in FIRM_EVENTS},
        "updated_at": None,
        "updated_by": None,
    }


def _tenant_flag(cur: Any, key: str) -> bool:
    if not isinstance(cur, dict) or key not in cur:
        return True
    val = cur.get(key)
    if type(val) is bool:
        return val
    return True


def _tenant_flags(tenant: Optional[dict], ev: str) -> Tuple[bool, bool]:
    events = tenant.get("events") if isinstance(tenant, dict) else None
    cur = events.get(ev) if isinstance(events, dict) else None
    return _tenant_flag(cur, "inapp"), _tenant_flag(cur, "email")


async def get_tenant_prefs(company_id: str) -> dict:
    """Firma aç/kapa. Kayıt yoksa varsayılan (hepsi açık); company_notify_prefs okunmaz."""
    cid = str(company_id or "").strip()
    base = default_tenant(cid)
    if not cid or _db is None:
        return base
    try:
        row = await _db.company_notify_tenant.find_one({"_id": f"cnt_{cid}"})
    except Exception:
        logger.exception("tenant notify prefs read company=%s", cid)
        return base
    if not isinstance(row, dict):
        return base
    events = {ev: {"inapp": True, "email": True} for ev in FIRM_EVENTS}
    stored = row.get("events") if isinstance(row.get("events"), dict) else {}
    for ev in FIRM_EVENTS:
        cur = stored.get(ev) if isinstance(stored.get(ev), dict) else {}
        events[ev] = {"inapp": _tenant_flag(cur, "inapp"), "email": _tenant_flag(cur, "email")}
    base["events"] = events
    base["updated_at"] = row.get("updated_at")
    base["updated_by"] = row.get("updated_by")
    base["_id"] = row.get("_id") or base["_id"]
    return base


def effective_channel(prefs: Optional[dict], tenant: Optional[dict], ev: str) -> dict:
    """Platform kanalının kopyası. inapp/email = platform AND firma. sms/digest/quiet_hours aynı kalır.

    Firma kaydı veya olay anahtarı yoksa firma bayrağı True (platform ne diyorsa o).
    Kayıtlı olay anahtarı yoksa EVENT_DEFAULT_CHANNEL (eski dört olayda DEFAULT_CHANNEL).
    """
    events = prefs.get("events") if isinstance(prefs, dict) else None
    raw = events.get(ev) if isinstance(events, dict) else None
    defaults = _event_channel_default(ev)
    if isinstance(raw, dict) and raw:
        ch = dict(raw)
        if "inapp" not in ch:
            ch["inapp"] = defaults.get("inapp", True)
        if "email" not in ch:
            ch["email"] = defaults.get("email", True)
    else:
        ch = defaults
    t_inapp, t_email = _tenant_flags(tenant, ev)
    ch["inapp"] = bool(ch.get("inapp", True)) and t_inapp
    ch["email"] = bool(ch.get("email", True)) and t_email
    return ch


async def inapp_enabled(company_id: str, event: str) -> bool:
    """Uygulama içi kapı. Hata olursa True — bildirim kaybolmasın."""
    try:
        cid = str(company_id or "").strip()
        ev = str(event or "").strip()
        if not cid or not ev:
            return True
        prefs = await get_prefs(cid)
        tenant = await get_tenant_prefs(cid)
        return bool(effective_channel(prefs, tenant, ev).get("inapp"))
    except Exception:
        logger.exception("inapp_enabled failed company=%s event=%s", company_id, event)
        return True


def parse_tenant_update(body: Any) -> dict:
    """Yalnız events.<firma olayı>.<inapp|email> boolean. company_id yönlendirmedir."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail=TENANT_BOOL_DETAIL)
    for key in body:
        if key not in ("events", "company_id"):
            raise HTTPException(status_code=422, detail=PLATFORM_ONLY_DETAIL)
    if "events" not in body:
        return {}
    events = body.get("events")
    if not isinstance(events, dict):
        raise HTTPException(status_code=422, detail=PLATFORM_ONLY_DETAIL)
    out: Dict[str, dict] = {}
    for ev, ch in events.items():
        if ev not in FIRM_EVENTS:
            raise HTTPException(status_code=422, detail=PLATFORM_ONLY_DETAIL)
        if not isinstance(ch, dict):
            raise HTTPException(status_code=422, detail=PLATFORM_ONLY_DETAIL)
        item: Dict[str, bool] = {}
        for field, val in ch.items():
            if field not in TENANT_CHANNELS:
                raise HTTPException(status_code=422, detail=PLATFORM_ONLY_DETAIL)
            if type(val) is not bool:
                raise HTTPException(status_code=422, detail=TENANT_BOOL_DETAIL)
            if field == "inapp" and ev in APPROVAL_EVENTS and val is False:
                raise HTTPException(status_code=422, detail=APPROVAL_INAPP_DETAIL)
            item[field] = val
        out[ev] = item
    return out


async def save_tenant_prefs(company_id: str, patch: dict, user: Optional[dict] = None) -> dict:
    """Firma aç/kapa yazar. company_notify_prefs belgesine dokunmaz."""
    cid = str(company_id or "").strip()
    cur = await get_tenant_prefs(cid)
    events = {
        ev: dict((cur.get("events") or {}).get(ev) or {"inapp": True, "email": True})
        for ev in FIRM_EVENTS
    }
    for ev, ch in (patch or {}).items():
        if ev not in events or not isinstance(ch, dict):
            continue
        for field in TENANT_CHANNELS:
            if field in ch and type(ch[field]) is bool:
                events[ev][field] = ch[field]
    uid = ""
    if isinstance(user, dict):
        uid = str(user.get("id") or user.get("_id") or "")
    doc = {
        "_id": f"cnt_{cid}",
        "company_id": cid,
        "events": events,
        "updated_at": _now(),
        "updated_by": uid,
    }
    await _db.company_notify_tenant.update_one(
        {"_id": doc["_id"]},
        {"$set": doc, "$setOnInsert": {"created_at": _now()}},
        upsert=True,
    )
    return await get_tenant_prefs(cid)


def _channel_view(ev: str, field: str, platform_on: bool, tenant_on: bool) -> dict:
    """Firma ekranı kanalı. Eski alanlar (platform/tenant/effective) aynı kalır."""
    if not platform_on:
        locked, reason = True, "platform"
    elif field == "inapp" and ev in APPROVAL_EVENTS:
        locked, reason = True, "approval"
    else:
        locked, reason = False, None
    return {
        "platform": bool(platform_on),
        "tenant": bool(tenant_on),
        "effective": bool(platform_on) and bool(tenant_on),
        "locked": locked,
        "lock_reason": reason,
    }


def _platform_flag(plat: Any, field: str, ev: str) -> bool:
    defaults = _event_channel_default(ev)
    if isinstance(plat, dict) and field in plat:
        return bool(plat[field])
    return bool(defaults.get(field, True))


async def tenant_prefs_view(company_id: str) -> dict:
    prefs = await get_prefs(company_id)
    tenant = await get_tenant_prefs(company_id)
    events: Dict[str, dict] = {}
    for ev in FIRM_EVENTS:
        plat = ((prefs.get("events") or {}).get(ev) or {})
        ten = ((tenant.get("events") or {}).get(ev) or {})
        p_inapp = _platform_flag(plat, "inapp", ev)
        p_email = _platform_flag(plat, "email", ev)
        t_inapp = _tenant_flag(ten, "inapp")
        t_email = _tenant_flag(ten, "email")
        events[ev] = {
            "inapp": _channel_view(ev, "inapp", p_inapp, t_inapp),
            "email": _channel_view(ev, "email", p_email, t_email),
            "group": EVENT_GROUPS[ev],
        }
    labels = {ev: EVENT_LABELS[ev] for ev in FIRM_EVENTS}
    return {"events": events, "labels": labels}


async def _reject_closed_platform_channel(company_id: str, patch: dict) -> None:
    """Platform kapalıyken firma true yazamaz. false (kapatmak) her zaman serbest."""
    if not patch:
        return
    prefs = await get_prefs(company_id)
    stored = prefs.get("events") if isinstance(prefs, dict) else None
    for ev, ch in patch.items():
        if not isinstance(ch, dict):
            continue
        plat = stored.get(ev) if isinstance(stored, dict) and isinstance(stored.get(ev), dict) else {}
        for field, val in ch.items():
            if val is not True:
                continue
            if not _platform_flag(plat, field, ev):
                raise HTTPException(status_code=422, detail=PLATFORM_CLOSED_DETAIL)


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


async def _platform_daily_email_cap() -> Optional[int]:
    try:
        coll = getattr(_db, "platform_settings", None)
        find_one = getattr(coll, "find_one", None) if coll is not None else None
        if find_one is None:
            return None
        row = await find_one({"_id": "platform"})
    except Exception:
        return None
    if not isinstance(row, dict) or "notify_daily_email_cap_default" not in row:
        return None
    return _parse_daily_email_cap(row.get("notify_daily_email_cap_default"), strict=False)


async def resolve_daily_email_cap(company_id: str, prefs: Optional[dict] = None) -> Optional[int]:
    """Firma limiti, yoksa platform varsayılanı, yoksa limitsiz (None)."""
    raw = None
    if prefs is not None:
        raw = prefs.get("daily_email_cap")
    else:
        try:
            row = await _db.company_notify_prefs.find_one({"company_id": company_id}) if company_id else None
        except Exception:
            row = None
        raw = (row or {}).get("daily_email_cap")
    parsed = _parse_daily_email_cap(raw, strict=False)
    if parsed is not None:
        return parsed
    return await _platform_daily_email_cap()


def _istanbul_day_start(now: Optional[datetime] = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(IST)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def _next_istanbul_midnight(now: Optional[datetime] = None) -> datetime:
    return _istanbul_day_start(now) + timedelta(days=1)


def _row_ts(row: dict, *keys: str) -> str:
    for key in keys:
        val = row.get(key)
        if val:
            return str(val)
    return ""


async def _count_sent_since(company_id: str, since_iso: str) -> int:
    """Gönderim kaydı (mail_logs context=event_notify), yoksa outbox sent."""
    try:
        logs = await _to_list(
            _db.mail_logs.find({
                "company_id": company_id,
                "status": "sent",
                "context": "event_notify",
                "created_at": {"$gte": since_iso},
            }),
            20000,
        )
    except Exception:
        logs = []
    if logs:
        return len(logs)
    try:
        rows = await _to_list(
            _db.notify_outbox.find({
                "company_id": company_id,
                "status": "sent",
                "sent_at": {"$gte": since_iso},
            }),
            20000,
        )
    except Exception:
        rows = []
    return len(rows)


async def notify_email_usage(company_id: str) -> dict:
    """Tek seferde 24s / 30g gönderilen + ertelenen sayıları (N+1 yok)."""
    now = datetime.now(timezone.utc)
    h24 = (now - timedelta(hours=24)).isoformat()
    d30 = (now - timedelta(days=30)).isoformat()
    try:
        sent = await _to_list(
            _db.mail_logs.find({
                "company_id": company_id,
                "status": "sent",
                "context": "event_notify",
                "created_at": {"$gte": d30},
            }),
            20000,
        )
    except Exception:
        sent = []
    if not sent:
        try:
            sent = [
                {**r, "created_at": r.get("sent_at") or r.get("created_at")}
                for r in await _to_list(
                    _db.notify_outbox.find({
                        "company_id": company_id,
                        "status": "sent",
                        "sent_at": {"$gte": d30},
                    }),
                    20000,
                )
            ]
        except Exception:
            sent = []
    try:
        deferred = await _to_list(
            _db.notify_outbox.find({
                "company_id": company_id,
                "status": "deferred",
            }),
            5000,
        )
    except Exception:
        deferred = []
    return {
        "sent_24h": sum(1 for r in sent if _row_ts(r, "created_at") >= h24),
        "sent_30d": len(sent),
        "deferred_24h": sum(1 for r in deferred if _row_ts(r, "deferred_at", "created_at") >= h24),
        "deferred_30d": sum(1 for r in deferred if _row_ts(r, "deferred_at", "created_at") >= d30),
        "deferred": len(deferred),
    }


async def _email_over_cap(company_id: str, prefs: Optional[dict] = None) -> Tuple[bool, Optional[str]]:
    cap = await resolve_daily_email_cap(company_id, prefs)
    if cap is None:
        return False, None
    used = await _count_sent_since(company_id, _istanbul_day_start().isoformat())
    if used >= cap:
        return True, _next_istanbul_midnight().isoformat()
    return False, None


async def _record_notify_mail(company_id: str, to: List[str], subject: str) -> None:
    try:
        await _db.mail_logs.insert_one({
            "_id": f"nl_{uuid.uuid4().hex[:12]}",
            "company_id": company_id,
            "to": list(to or []),
            "subject": (subject or "")[:500],
            "status": "sent",
            "context": "event_notify",
            "purpose": "transactional",
            "created_at": _now(),
        })
    except Exception:
        logger.exception("notify mail log company=%s", company_id)


async def present_prefs(doc: dict, *, with_usage: bool = False) -> dict:
    out = public_prefs(doc)
    cid = str(doc.get("company_id") or "")
    events = out.get("events") or {}
    order = dict(events.get("order_new") or {})
    order["batch_minutes"] = await resolve_order_batch_minutes(cid, prefs=doc)
    order["quiet_hours"] = _norm_quiet_hours(order.get("quiet_hours"), strict=False) or _default_quiet_hours()
    events["order_new"] = order
    out["events"] = events
    plat = await _platform_daily_email_cap()
    out["notify_daily_email_cap_default"] = plat
    out["daily_email_cap_resolved"] = await resolve_daily_email_cap(cid, prefs=doc)
    if with_usage:
        out["email_usage"] = await notify_email_usage(cid)
    return out


async def app_link(path: str = "") -> str:
    """Uygulama (app.tamkobi.com) mutlak link — asla localhost üretmez."""
    return await public_url.public_link(_db, path or "", "app")


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


def _email_html(
    company_name: str,
    title: str,
    message: str,
    link: str,
    *,
    summary: str = "",
    logo_url_abs: str = "",
    lines: Optional[List[str]] = None,
) -> str:
    if lines:
        body_html = notify_email_layout.items_body_html(lines)
    else:
        body_html = notify_email_layout.message_body_html(message)
    return notify_email_layout.render_layout(
        company_name=company_name,
        logo_url_abs=logo_url_abs,
        title=title,
        summary=summary,
        body_html=body_html,
        button_link=link,
    )


def _email_text(
    company_name: str,
    title: str,
    message: str,
    link: str,
    *,
    summary: str = "",
    lines: Optional[List[str]] = None,
) -> str:
    if lines:
        text_lines = []
        for line in lines:
            raw = str(line or "").strip("\n")
            if not raw:
                continue
            text_lines.append("- " + raw.replace("\n", "\n  "))
    else:
        text_lines = [message] if message else []
    return notify_email_layout.render_layout_text(
        company_name=company_name,
        title=title,
        summary=summary,
        lines=text_lines,
        link=link,
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
    status: str = "pending",
    next_try_at: Optional[str] = None,
) -> None:
    now = _now()
    doc = {
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
        "due_at": next_try_at or _due_for_digest(digest),
        "status": status if status in ("pending", "deferred") else "pending",
        "attempts": 0,
        "created_at": now,
    }
    if next_try_at:
        doc["next_try_at"] = next_try_at
    if doc["status"] == "deferred":
        doc["deferred_at"] = now
    await _db.notify_outbox.insert_one(doc)


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


async def enqueue_morning_summary_email(
    company_id: str,
    *,
    emails,
    subject: str,
    html: str,
    text: str,
    day: str,
    manual: bool = False,
) -> str:
    """Sabah özeti e-postasını notify_outbox'a yazar. SMTP çağırmaz.

    Platform ve firma e-posta kapısı kapalıysa satır yazılmaz ("disabled").
    Zamanlanmış gönderim aynı gün tek satırdır (duplicate key → "exists").
    Manuel gönderim her çağrıda yeni satır açar.
    Dönüş: "queued" | "exists" | "disabled" | "failed".
    """
    cid = str(company_id or "").strip()
    prefs = await get_prefs(cid)
    tenant = await get_tenant_prefs(cid)
    if not effective_channel(prefs, tenant, "morning_summary")["email"]:
        return "disabled"
    day_key = str(day or "").strip()
    suffix = "m" if manual else "s"
    out_id = f"out:{cid}:morning_summary:{day_key}:{suffix}"
    if manual:
        out_id = f"{out_id}:{uuid.uuid4().hex}"
    if isinstance(emails, str):
        to = [emails] if emails.strip() else []
    else:
        to = [str(item) for item in (emails or []) if str(item or "").strip()]
    doc = {
        "_id": out_id,
        "company_id": cid,
        "event": "morning_summary",
        "channels": {"email": True, "sms": False},
        "digest": "instant",
        "status": "pending",
        "attempts": 0,
        "to": to,
        "subject": str(subject or ""),
        "html": str(html or ""),
        "text": str(text or ""),
        "created_at": _now(),
    }
    try:
        await _db.notify_outbox.insert_one(doc)
    except Exception:
        existing = await _db.notify_outbox.find_one({"_id": doc["_id"]})
        return "exists" if existing else "failed"
    return "queued"


async def _company_logo_abs(logo_url: str) -> str:
    raw = str(logo_url or "").strip()
    if not raw:
        return ""
    base = _safe_link(await app_link(""))
    return order_image_url(raw, base, thumb=False)


async def _send_email_now(
    company_id: str,
    prefs: dict,
    emails: List[str],
    title: str,
    message: str,
    link: str,
    event: Optional[str] = None,
    *,
    summary: Optional[str] = None,
    lines: Optional[List[str]] = None,
) -> dict:
    if not emails:
        return {"status": "skipped", "reason": "no_recipients"}
    company = await _db.companies.find_one({"_id": company_id}, {"name": 1, "logo_url": 1}) or {}
    company_name = str(company.get("name") or "Firma").strip() or "Firma"
    logo = await _company_logo_abs(str(company.get("logo_url") or ""))
    if summary is None:
        summary = EVENT_LABELS.get(event, "") if event else ""
    subject = f"[TamKobi] {company_name}: {title}"
    html_body = _email_html(
        company_name, title, message, link,
        summary=summary, logo_url_abs=logo, lines=lines,
    )
    body = _email_text(
        company_name, title, message, link,
        summary=summary, lines=lines,
    )
    reply_to = await _company_reply_to(company_id, prefs)
    result = await mail_service.send_mail(
        emails,
        subject,
        body,
        html=html_body,
        purpose="transactional",
        company_id=company_id,
        reply_to=reply_to,
        from_name=company_name,
    )
    status = result.get("status") or "failed"
    via = result.get("driver") or "platform"
    if status == "sent":
        await _record_notify_mail(company_id, result.get("to") or emails, subject)
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


async def queue_event_email(
    company_id: str,
    event: str,
    title: str,
    message: str,
    link: str = "",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    dedupe_key: Optional[str] = None,
) -> dict:
    """Yeni olay e-postası/SMS: in-app yazmaz, SMTP çağırmaz, her zaman notify_outbox.

    Anında özet due_at=şimdi; saatlik/günlük mevcut _due_for_digest. Hata yutulur.
    """
    cid = str(company_id or "").strip()
    ev = str(event or "").strip()
    try:
        if not cid or ev not in NEW_EVENTS:
            return {"status": "skipped", "reason": "bad_args"}
        if await _dedupe_seen(cid, dedupe_key):
            return {"status": "duplicate", "dedupe_key": dedupe_key}
        prefs = await get_prefs(cid)
        tenant = await get_tenant_prefs(cid)
        ch = effective_channel(prefs, tenant, ev)
        need_email = bool(ch.get("email"))
        need_sms = bool(ch.get("sms"))
        if not need_email and not need_sms:
            return {"status": "skipped"}
        digest = str(ch.get("digest") or "instant").strip().lower()
        if digest not in DIGEST_MODES:
            digest = "instant"
        abs_link = _safe_link(
            await app_link(link) if link and not str(link).startswith("http") else str(link or "")
        )
        inapp_link = link if link and not str(link).startswith("http") else (link or "")
        if abs_link and public_url.is_invalid_public_base(abs_link):
            abs_link = ""
        await _queue_outbox(
            cid, ev, title=title, message=message, link=abs_link or inapp_link,
            ref_type=ref_type, ref_id=None if ref_id is None else str(ref_id),
            channels={"email": need_email, "sms": need_sms},
            digest=digest,
            next_try_at=_now() if digest == "instant" else None,
        )
        return {"status": "queued", "event": ev}
    except Exception:
        logger.exception("queue_event_email failed event=%s company=%s", ev, cid)
        return {"status": "error"}


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
    tenant: Optional[dict] = None,
) -> dict:
    """Olay bildirimi: in-app/push + e-posta + isteğe bağlı SMS (tercihlere göre).

    order_new e-posta/SMS istek içinde SMTP ile gitmez; notify_outbox'a yazılır.
    tenant verilirse firma kaydı yeniden okunmaz (toplu siparişte tek okuma).
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
    if tenant is None:
        tenant = await get_tenant_prefs(cid)
    ch = effective_channel(prefs, tenant, ev)
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
        blocked, nxt = await _email_over_cap(cid, prefs)
        if blocked:
            await _queue_outbox(
                cid, ev, title=title, message=message, link=abs_link or inapp_link,
                ref_type=ref_type, ref_id=ref_id,
                channels={"email": True, "sms": False}, digest="instant",
                status="deferred", next_try_at=nxt,
            )
            result["email"] = {"status": "deferred", "next_try_at": nxt}
            result["queued"] = True
        else:
            result["email"] = await _send_email_now(cid, prefs, emails, title, message, abs_link, ev)
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
    tenant = await get_tenant_prefs(company_id)
    if len(items) > BATCH_SUMMARY_THRESHOLD:
        total = sum(float(d.get("grand_total") or 0) for d in items)
        title = f"{len(items)} yeni gelen e-belge"
        message = f"Toplam {_fmt_amount(total)}. Gelen kutusundan inceleyin."
        return await notify_event(
            company_id, "einvoice_incoming", title, message,
            link="/edoc-inbox", ref_type="edoc_batch",
            ref_id=str(items[0].get("id") or items[0].get("_id") or ""),
            dedupe_key=f"einv-batch:{_today()}:{len(items)}:{items[0].get('uuid') or items[0].get('id')}",
            tenant=tenant,
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
            tenant=tenant,
        )
    return {"status": "ok", "count": len(items), "last": last}


async def _enqueue_order_mail(
    company_id: str, order: dict, prefs: dict, tenant: Optional[dict] = None,
) -> bool:
    """Tek siparişi e-posta kuyruğuna yazar. Etkin e-posta kapalıysa kayıt yok."""
    if tenant is None:
        tenant = await get_tenant_prefs(company_id)
    ch = effective_channel(prefs, tenant, "order_new")
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
    tenant = await get_tenant_prefs(company_id)
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
            tenant=tenant,
        )
        queued = 0
        for o in items:
            if await _enqueue_order_mail(company_id, o, prefs, tenant):
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
            link=f"/orders?open={quote(oid)}" if oid else "/orders",
            ref_type="order",
            ref_id=oid,
            dedupe_key=f"order:{oid}" if oid else None,
            tenant=tenant,
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
        link="/hesap",
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
        inv_id = str(rows[0].get("_id") or "") if len(rows) == 1 else ""
        res = await notify_event(
            cid, "receivable_overdue", title, message,
            link=f"/invoices?open={quote(inv_id)}" if inv_id else "/invoices",
            ref_type="invoice" if inv_id else "receivable",
            ref_id=inv_id or cid,
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


_MEDIA_KEYS = ("url", "image_url", "thumbnail_url", "src", "path", "file")
_IST = None
_CHANNEL_LABELS = {
    "b2b": "B2B Portal",
    "pos": "Kasa",
    "kasa": "Kasa",
    "manual": "Manuel",
    "manuel": "Manuel",
    "saha": "Saha",
    "trendyol": "Trendyol",
    "hepsiburada": "Hepsiburada",
    "n11": "n11",
    "amazon": "Amazon",
    "shopify": "Shopify",
    "woocommerce": "WooCommerce",
    "ciceksepeti": "Çiçeksepeti",
    "pazarama": "Pazarama",
    "shopphp": "ShopPHP",
    "pttavm": "PttAVM",
    "etsy": "Etsy",
    "ikas": "ikas",
    "ideasoft": "İdeasoft",
    "ticimax": "Ticimax",
    "wix": "Wix",
    "opencart": "OpenCart",
    "tsoft": "T-Soft",
    "prestashop": "PrestaShop",
    "shopier": "Shopier",
    "aliexpress": "AliExpress",
    "trendyol_market": "Trendyol Go Market",
    "trendyol_yemek": "Trendyol Go Yemek",
    "akakce": "Akakçe",
    "flo": "FLO",
    "beymen": "Beymen",
    "teknosa": "Teknosa",
    "idefix": "idefix",
    "getir_carsi": "Getir Çarşı",
    "boyner": "Boyner",
}
_ORDER_CARD_CHANNELS = {"", "manual", "manuel", "b2b", "pos", "kasa", "saha"}


def stores_order_line_image(channel: str) -> bool:
    """B2B, kasa ve manuel sipariş yeni kaleme ürün kartı görseli yazabilir."""
    return str(channel or "manual").strip().lower() in _ORDER_CARD_CHANNELS


def media_ref(value) -> str:
    """String veya {url,image_url,...} galeri öğesini URL'ye çevir. productImages.js mediaRef."""
    if value is None or value == "":
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, Mapping):
        for key in _MEDIA_KEYS:
            raw = value.get(key)
            if raw not in (None, ""):
                return str(raw).strip()
        return ""
    return str(value).strip()


def _first_gallery_image(images) -> str:
    if not isinstance(images, list) or not images:
        return ""
    return media_ref(images[0])


def _match_variant(item: Mapping, product: Mapping) -> Optional[dict]:
    variants = [v for v in (product.get("variants") or []) if isinstance(v, dict)]
    if not variants:
        return None
    vid = str(item.get("variant_id") or "").strip()
    if vid:
        for variant in variants:
            if str(variant.get("variant_id") or "") == vid:
                return variant
    sku = str(item.get("sku") or "").strip()
    parent = str(product.get("sku") or "").strip()
    if sku and sku != parent:
        for variant in variants:
            if str(variant.get("sku") or "").strip() == sku:
                return variant
    return None


def _variant_image(variant: Optional[Mapping]) -> str:
    if not isinstance(variant, Mapping):
        return ""
    return (
        media_ref(variant.get("image_url"))
        or media_ref(variant.get("thumbnail_url"))
        or media_ref(variant.get("image"))
    )


def resolve_line_image(item: Optional[Mapping], product: Optional[Mapping]) -> str:
    """Pazaryeri satırı → varyant → küçük resim → kapak → galeri ilk kare."""
    row = item if isinstance(item, Mapping) else {}
    direct = media_ref(row.get("image_url")) or media_ref(row.get("image"))
    if direct:
        return direct
    card = product if isinstance(product, Mapping) else {}
    variant_img = _variant_image(_match_variant(row, card))
    if variant_img:
        return variant_img
    return (
        media_ref(card.get("thumbnail_url"))
        or media_ref(card.get("image_url"))
        or _first_gallery_image(card.get("images"))
    )


def order_line_card_image(item: Optional[Mapping], product: Optional[Mapping]) -> str:
    """Yeni B2B/manuel kalem. Katalog kartı `image_url` döner; kapak varsa o yazılır.

    Varyant eşleşirse varyant görseli önce gelir. Kapak yoksa küçük resim, o da
    yoksa galerinin ilk karesi. Dolu pazaryeri görseli burada üretilmez.
    """
    row = item if isinstance(item, Mapping) else {}
    card = product if isinstance(product, Mapping) else {}
    variant_img = _variant_image(_match_variant(row, card))
    if variant_img:
        return variant_img
    return (
        media_ref(card.get("image_url"))
        or media_ref(card.get("thumbnail_url"))
        or _first_gallery_image(card.get("images"))
    )


def _files_url(base: str, path: str, *, thumb: bool = True) -> str:
    if not base or public_url.is_invalid_public_base(base):
        return ""
    clean = str(path or "").split("?")[0].lstrip("/")
    if not clean:
        return ""
    url = f"{base}/api/files/{clean}"
    if thumb:
        url += "?w=128&fmt=jpg"
    return _sign_file_url(url, clean)


def _file_get_is_public(storage_path: str) -> bool:
    rel = str(storage_path or "").split("?")[0].lstrip("/")
    if not rel:
        return False
    try:
        import rbac
        return bool(rbac.is_public_api_path(f"/api/files/{rel}", "GET"))
    except Exception:
        return True


def _sign_file_url(url: str, storage_path: str) -> str:
    """Herkese açık dosya olduğu gibi kalır. Değilse imzalı paylaşım adresi."""
    if not url or _file_get_is_public(storage_path):
        return url
    try:
        import signed_links
        token = signed_links.make_doc_share_token(storage_path, "files")
    except Exception:
        logger.warning("order mail file share token failed")
        return ""
    if not token:
        return ""
    joiner = "&" if "?" in url else "?"
    return f"{url}{joiner}t={quote(token, safe='')}"


def order_image_url(raw, base: str, *, thumb: bool = True) -> str:
    """Mutlak görsel adresi. data/cid gömme yok; geçersiz tabanda boş."""
    s = str(raw or "").strip()
    if not s:
        return ""
    low = s.lower()
    if low.startswith("javascript:") or low.startswith("data:") or low.startswith("cid:"):
        return ""
    if "/api/files/" in s:
        path = s.split("/api/files/", 1)[1]
        return _files_url(base, path, thumb=thumb)
    if low.startswith("http://") or low.startswith("https://"):
        if public_url.is_invalid_public_base(s):
            return ""
        return s
    if s.startswith("/") and base and not public_url.is_invalid_public_base(base):
        return f"{base}{s}"
    return _files_url(base, s, thumb=thumb)


def _batch_subject(orders: List[dict]) -> str:
    if len(orders) == 1:
        o = orders[0]
        no = str(o.get("order_number") or o.get("_id") or "")
        if str(o.get("channel") or "").lower() == "b2b":
            return f"Yeni B2B siparişi {no}"
        return f"Yeni sipariş {no}"
    return f"{len(orders)} yeni sipariş"


def channel_label(raw) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    return _CHANNEL_LABELS.get(text.lower(), text)


def _istanbul():
    global _IST
    if _IST is None:
        try:
            _IST = ZoneInfo("Europe/Istanbul")
        except Exception:
            _IST = timezone(timedelta(hours=3))
    return _IST


def _order_local_dt(order: Mapping) -> Optional[datetime]:
    for key in ("order_date", "created_at"):
        raw = order.get(key)
        if not raw:
            continue
        try:
            return _parse_ts(str(raw)).astimezone(_istanbul())
        except (TypeError, ValueError):
            continue
    return None


def _fmt_tr_dt(dt: datetime) -> str:
    return dt.strftime("%d.%m.%Y %H:%M")


def _clock_span(orders: List[dict]) -> str:
    stamps = [dt for dt in (_order_local_dt(o) for o in orders) if dt]
    if not stamps:
        return ""
    start, end = min(stamps), max(stamps)
    a, b = start.strftime("%H:%M"), end.strftime("%H:%M")
    return a if a == b else f"{a}–{b}"


def _currency_totals(orders: List[dict]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for order in orders:
        cur = str(order.get("currency") or "TRY").upper()
        if cur in ("TL", "TRL"):
            cur = "TRY"
        try:
            amount = float(_order_gross(order) or 0)
        except (TypeError, ValueError):
            amount = 0.0
        out[cur] = out.get(cur, 0.0) + amount
    return out


def _order_status_key(order: Mapping) -> str:
    return str(order.get("order_status") or order.get("status") or "").strip().lower()


def _order_status_label(order: Mapping) -> str:
    st = _order_status_key(order)
    if st in _PENDING_ORDER_STATUSES:
        return "Onay bekliyor"
    if st in _APPROVED_ORDER_STATUSES:
        return "Onaylı"
    return ""


def _pending_approval_count(orders: List[dict]) -> int:
    return sum(1 for o in orders if _order_status_key(o) in _PENDING_ORDER_STATUSES)


def _stock_number(obj: Optional[Mapping], *keys: str) -> Optional[float]:
    if not isinstance(obj, Mapping):
        return None
    for key in keys:
        if key not in obj:
            continue
        val = obj.get(key)
        if val in (None, ""):
            continue
        try:
            return float(val)
        except (TypeError, ValueError):
            return None
    return None


def _line_available_stock(item: Mapping, product: Mapping, variant: Optional[Mapping]) -> Optional[float]:
    if variant:
        vs = _stock_number(variant, "stock", "stock_quantity")
        if vs is not None:
            return vs
    return _stock_number(product, "stock_quantity", "stock")


def _line_stock_warning(item: Mapping, product: Mapping, variant: Optional[Mapping]) -> str:
    stock = _line_available_stock(item, product, variant)
    if stock is None:
        return ""
    try:
        qty = float(item.get("quantity") or 0)
    except (TypeError, ValueError):
        return ""
    if qty > stock:
        return f"Stok yetersiz (mevcut {_fmt_qty(stock)})"
    return ""


def _stock_shortage_count(orders: List[dict], products: Optional[Mapping] = None) -> int:
    products = products or {}
    n = 0
    for order in orders:
        for it in order.get("items") or []:
            if not isinstance(it, dict):
                continue
            product = _product_of(it, products)
            variant = _match_variant(it, product)
            if _line_stock_warning(it, product, variant):
                n += 1
    return n


def _status_badge_html(order: Mapping) -> str:
    label = _order_status_label(order)
    if not label:
        return ""
    if label == "Onay bekliyor":
        bg, fg = "#fef3c7", "#92400e"
    else:
        bg, fg = "#d1fae5", "#065f46"
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td bgcolor="{bg}" style="background-color:{bg};padding:2px 8px;'
        f'font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;'
        f'font-weight:bold;color:{fg};">{_esc(label)}</td>'
        "</tr></table>"
    )


def _summary_line(orders: List[dict], products: Optional[Mapping] = None) -> str:
    parts = [f"{len(orders)} sipariş"]
    totals = _currency_totals(orders)
    for cur, amount in totals.items():
        parts.append(f"Toplam {_fmt_money(amount, cur)}")
    clock = _clock_span(orders)
    if clock:
        parts.append(clock)
    pending = _pending_approval_count(orders)
    if pending:
        parts.append(f"{pending} onay bekliyor")
    short = _stock_shortage_count(orders, products)
    if short:
        parts.append(f"{short} kalemde stok yetersiz")
    return " · ".join(parts)


def _amount_parts(order: Mapping) -> Tuple[Any, Any]:
    gross = _order_gross(order)
    vat = order.get("vat_total")
    sub = order.get("subtotal")
    if vat in (None, ""):
        vat = 0
    if sub in (None, ""):
        try:
            sub = float(gross or 0) - float(vat or 0)
        except (TypeError, ValueError):
            sub = gross or 0
    return sub, vat


def _line_name(item: Mapping, product: Optional[Mapping]) -> str:
    return str(
        item.get("product_name")
        or item.get("name")
        or (product or {}).get("name")
        or "Ürün"
    ).strip() or "Ürün"


def _line_meta(item: Mapping, product: Optional[Mapping], variant: Optional[Mapping]) -> str:
    bits = []
    sku = str(item.get("sku") or "").strip()
    if sku:
        bits.append(sku)
    vname = str(item.get("variant_name") or (variant or {}).get("name") or "").strip()
    name = _line_name(item, product)
    if vname and vname.casefold() not in name.casefold():
        bits.append(vname)
    return " · ".join(bits)


def _initials(name: str) -> str:
    words = [w for w in re.split(r"\s+", str(name or "").strip()) if w]
    chars: List[str] = []
    if len(words) >= 2:
        for word in words:
            for ch in word:
                if ch.isalnum():
                    chars.append(ch)
                    break
            if len(chars) >= 2:
                break
    elif words:
        for ch in words[0]:
            if ch.isalnum():
                chars.append(ch)
            if len(chars) >= 2:
                break
    if not chars:
        return "·"
    return "".join(chars[:2]).upper()


def _product_of(item: Mapping, products: Mapping) -> dict:
    pid = str(item.get("product_id") or "").strip()
    product = products.get(pid) if pid else None
    return product if isinstance(product, dict) else {}


def _mail_button(href: str, label: str) -> str:
    if not href:
        return ""
    safe = _esc(href)
    text = _esc(label)
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">'
        "<tr><td align=\"center\" style=\"padding:16px 0 0;\">"
        "<!--[if mso]>"
        f'<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{safe}" '
        'style="height:48px;v-text-anchor:middle;width:240px;" arcsize="8%" stroke="f" fillcolor="#059669">'
        "<w:anchorlock/>"
        f'<center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">{text}</center>'
        "</v:roundrect>"
        "<![endif]-->"
        "<!--[if !mso]><!-- -->"
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;">'
        '<tr><td align="center" bgcolor="#059669" style="background-color:#059669;border-radius:6px;">'
        f'<a href="{safe}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;'
        f'font-size:16px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;">{text}</a>'
        "</td></tr></table>"
        "<!--<![endif]-->"
        "</td></tr></table>"
    )


def _kv_row(label: str, value: str) -> str:
    return (
        '<tr>'
        f'<td class="tk-stack tk-muted" width="120" valign="top" style="padding:4px 12px 4px 0;width:120px;'
        f'font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#64748b;">{_esc(label)}</td>'
        f'<td class="tk-stack tk-text" valign="top" style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;'
        f'font-size:14px;line-height:20px;color:#0f172a;">{value}</td>'
        "</tr>"
    )


def _visual_cell(url: str, name: str) -> str:
    if url:
        return (
            '<td class="tk-stack" width="64" valign="middle" style="width:64px;padding:8px 10px 8px 0;">'
            f'<img src="{_esc(url)}" width="64" height="64" alt="{_esc(name)}" '
            'style="display:block;width:64px;height:64px;border:0;">'
            "</td>"
        )
    return (
        '<td class="tk-stack" width="64" height="64" align="center" valign="middle" bgcolor="#e2e8f0" '
        'style="width:64px;height:64px;background-color:#e2e8f0;text-align:center;vertical-align:middle;'
        'font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:64px;font-weight:bold;color:#475569;">'
        f"{_esc(_initials(name))}</td>"
    )


def _lines_html(order: dict, base: str, products: Optional[Mapping] = None) -> str:
    products = products or {}
    items = [it for it in (order.get("items") or []) if isinstance(it, dict)]
    shown = items[:ORDER_MAIL_MAX_LINES]
    extra = len(items) - len(shown)
    cur = str(order.get("currency") or "TRY")
    head = (
        '<tr>'
        '<td class="tk-muted" width="64" bgcolor="#f8fafc" style="width:64px;padding:8px 10px 8px 0;background-color:#f8fafc;'
        'font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;font-weight:bold;color:#64748b;">Görsel</td>'
        '<td class="tk-muted" bgcolor="#f8fafc" style="padding:8px 8px 8px 0;background-color:#f8fafc;'
        'font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;font-weight:bold;color:#64748b;">Ürün</td>'
        '<td class="tk-stack tk-muted" align="right" bgcolor="#f8fafc" style="padding:8px 8px 8px 0;background-color:#f8fafc;'
        'font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;font-weight:bold;color:#64748b;">Adet</td>'
        '<td class="tk-stack tk-muted" align="right" bgcolor="#f8fafc" style="padding:8px 8px 8px 0;background-color:#f8fafc;'
        'font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;font-weight:bold;color:#64748b;">Birim</td>'
        '<td class="tk-stack tk-muted" align="right" bgcolor="#f8fafc" style="padding:8px 0;background-color:#f8fafc;'
        'font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;font-weight:bold;color:#64748b;">Tutar</td>'
        "</tr>"
    )
    rows = [
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="width:100%;border-collapse:collapse;">',
        head,
    ]
    for it in shown:
        product = _product_of(it, products)
        variant = _match_variant(it, product)
        name = _line_name(it, product)
        meta = _line_meta(it, product, variant)
        url = order_image_url(resolve_line_image(it, product), base, thumb=True)
        if not url and (media_ref(it.get("image_url")) or media_ref(it.get("image"))):
            bare = {k: v for k, v in it.items() if k not in ("image_url", "image", "thumbnail_url")}
            url = order_image_url(resolve_line_image(bare, product), base, thumb=True)
        unit, line_total = _line_prices(it)
        meta_html = ""
        if meta:
            meta_html = (
                f'<br><span class="tk-muted" style="font-size:12px;line-height:16px;color:#64748b;">{_esc(meta)}</span>'
            )
        warn = _line_stock_warning(it, product, variant)
        if warn:
            meta_html += (
                f'<br><span style="font-size:11px;line-height:14px;color:#b91c1c;">{_esc(warn)}</span>'
            )
        rows.append(
            "<tr>"
            f"{_visual_cell(url, name)}"
            '<td class="tk-text" valign="middle" style="padding:8px 8px 8px 0;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:14px;line-height:18px;color:#0f172a;">{_esc(name)}{meta_html}</td>'
            '<td class="tk-stack tk-text" align="right" valign="middle" style="padding:8px 8px 8px 0;'
            'font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#0f172a;">'
            f"{_esc(_fmt_qty(it.get('quantity')))}</td>"
            '<td class="tk-stack tk-text" align="right" valign="middle" style="padding:8px 8px 8px 0;'
            'font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#0f172a;">'
            f"{_esc(_fmt_money(unit, cur))}</td>"
            '<td class="tk-stack tk-text" align="right" valign="middle" style="padding:8px 0;'
            'font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#0f172a;font-weight:bold;">'
            f"{_esc(_fmt_money(line_total, cur))}</td>"
            "</tr>"
        )
    if extra > 0:
        rows.append(
            '<tr><td colspan="5" class="tk-muted" style="padding:8px 0 0;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:12px;line-height:16px;color:#64748b;">{_esc(f"ve {extra} kalem daha")}</td></tr>'
        )
    sub, vat = _amount_parts(order)
    total_label = _esc(format_order_total(order))
    for label, value, strong in (
        ("Ara toplam", _esc(_fmt_money(sub, cur)), False),
        ("KDV", _esc(_fmt_money(vat, cur)), False),
        ("Genel toplam", total_label, True),
    ):
        weight = "font-weight:bold;" if strong else ""
        rows.append(
            "<tr>"
            f'<td colspan="4" align="right" class="tk-muted" style="padding:6px 8px 0 0;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:13px;line-height:18px;color:#64748b;{weight}">{_esc(label)}</td>'
            f'<td align="right" class="tk-text" style="padding:6px 0 0;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:13px;line-height:18px;color:#0f172a;{weight}">{value}</td>'
            "</tr>"
        )
    rows.append("</table>")
    return "".join(rows)


def _order_card_html(order: dict, link: str, base: str, products: Mapping) -> str:
    oid = str(order.get("_id") or "")
    no = str(order.get("order_number") or oid)
    when = _order_local_dt(order)
    note = str(order.get("notes") or order.get("note") or "").strip()
    rows = [
        _kv_row("Sipariş No", f'<span style="font-weight:bold;">{_esc(no)}</span>'),
        _kv_row("Kanal", _esc(channel_label(order.get("channel")))),
        _kv_row("Müşteri", _esc(order.get("customer_name") or "")),
    ]
    badge = _status_badge_html(order)
    if badge:
        rows.append(_kv_row("Durum", badge))
    if when:
        rows.append(_kv_row("Tarih/saat", _esc(_fmt_tr_dt(when))))
    if note:
        rows.append(_kv_row("Not", _esc(note)))
    meta = (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">'
        + "".join(rows)
        + "</table>"
    )
    return (
        '<table role="presentation" class="tk-card tk-line" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'bgcolor="#ffffff" style="width:100%;background-color:#ffffff;border:1px solid #e2e8f0;">'
        '<tr><td style="padding:16px;">'
        f"{meta}"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>'
        '<td style="padding:12px 0 0;border-top:1px solid #e2e8f0;font-size:0;line-height:0;">&nbsp;</td>'
        "</tr></table>"
        f"{_lines_html(order, base, products)}"
        f"{_mail_button(link, 'Siparişi aç')}"
        "</td></tr></table>"
    )


def _order_batch_html(
    company_name: str,
    orders: List[dict],
    links: Dict[str, str],
    base: str,
    products: Optional[Mapping] = None,
    *,
    logo_url: str = "",
    settings_link: str = "",
) -> str:
    products = products or {}
    shown = orders[:ORDER_MAIL_MAX_ORDERS]
    extra_orders = len(orders) - len(shown)
    subject = _batch_subject(orders)
    summary = _summary_line(orders, products)
    logo = order_image_url(logo_url, base, thumb=False) if logo_url else ""
    cards = []
    for order in shown:
        oid = str(order.get("_id") or "")
        cards.append(
            '<tr><td style="padding:0 0 16px;">'
            f"{_order_card_html(order, links.get(oid) or '', base, products)}"
            "</td></tr>"
        )
    extra_html = ""
    if extra_orders:
        extra_html = (
            '<tr><td class="tk-text" style="padding:0 0 16px;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:14px;line-height:20px;color:#334155;">{_esc(f"ve {extra_orders} sipariş daha")}</td></tr>'
        )
    return notify_email_layout.render_layout(
        company_name=company_name,
        logo_url_abs=logo,
        title=subject,
        summary=summary,
        body_html="".join(cards) + extra_html,
        footer_extra=" · Yeni siparişler tek e-postada toplanır.",
    )


def _order_batch_text(
    company_name: str,
    orders: List[dict],
    links: Dict[str, str],
    products: Optional[Mapping] = None,
    *,
    settings_link: str = "",
) -> str:
    products = products or {}
    shown = orders[:ORDER_MAIL_MAX_ORDERS]
    extra_orders = len(orders) - len(shown)
    lines = [company_name, "", _batch_subject(orders), _summary_line(orders, products), ""]
    for order in shown:
        oid = str(order.get("_id") or "")
        no = str(order.get("order_number") or oid)
        cur = str(order.get("currency") or "TRY")
        lines.append(f"Sipariş No: {no}")
        st_label = _order_status_label(order)
        if st_label:
            lines.append(f"Durum: {st_label}")
        lines.append(f"Kanal: {channel_label(order.get('channel'))}")
        lines.append(f"Müşteri: {order.get('customer_name') or ''}")
        when = _order_local_dt(order)
        if when:
            lines.append(f"Tarih/saat: {_fmt_tr_dt(when)}")
        note = str(order.get("notes") or order.get("note") or "").strip()
        if note:
            lines.append(f"Not: {note}")
        items = [it for it in (order.get("items") or []) if isinstance(it, dict)]
        for it in items[:ORDER_MAIL_MAX_LINES]:
            product = _product_of(it, products)
            variant = _match_variant(it, product)
            unit, line_total = _line_prices(it)
            name = _line_name(it, product)
            meta = _line_meta(it, product, variant)
            label = f"{name} ({meta})" if meta else name
            warn = _line_stock_warning(it, product, variant)
            line = (
                f"- {label} · {_fmt_qty(it.get('quantity'))} · {_fmt_money(unit, cur)} · {_fmt_money(line_total, cur)}"
            )
            if warn:
                line += f" · {warn}"
            lines.append(line)
        extra = len(items) - ORDER_MAIL_MAX_LINES
        if extra > 0:
            lines.append(f"ve {extra} kalem daha")
        sub, vat = _amount_parts(order)
        lines.append(f"Ara toplam: {_fmt_money(sub, cur)}")
        lines.append(f"KDV: {_fmt_money(vat, cur)}")
        lines.append(f"Genel toplam: {format_order_total(order)}")
        if links.get(oid):
            lines.append(links[oid])
        lines.append("")
    if extra_orders:
        lines.append(f"ve {extra_orders} sipariş daha")
    lines.append("")
    lines.append("Ayarlar Platform Yönetimi'nden yapılır")
    lines.append("Yeni siparişler tek e-postada toplanır.")
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
    """pending/deferred → sending. İki işleyici aynı satırı alamaz; sonra yalnız claim_id okunur."""
    claim_id = str(uuid.uuid4())
    now = _now()
    patch = {"$set": {"status": "sending", "claim_id": claim_id, "claimed_at": now}}
    coll = _db.notify_outbox
    atomic = getattr(coll, "update_one_atomic", None)
    claim_status = {"$in": ["pending", "deferred"]}
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
                        "status": claim_status,
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
            "status": claim_status,
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


async def _defer_rows(rows: List[dict], claim_id: str, next_try_at: Optional[str]) -> None:
    """Limit doldu: satır silinmez, ertesi İstanbul gününe ertelenir."""
    nxt = next_try_at or _next_istanbul_midnight().isoformat()
    now = _now()
    for row in rows:
        try:
            await _db.notify_outbox.update_one(
                {"_id": row["_id"], "claim_id": claim_id},
                {"$set": {
                    "status": "deferred",
                    "deferred_at": now,
                    "next_try_at": nxt,
                    "due_at": nxt,
                    "claim_id": None,
                    "claimed_at": None,
                }},
            )
        except Exception:
            logger.exception("notify outbox defer")


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


async def _products_for_orders(company_id: str, orders: List[dict]) -> Dict[str, dict]:
    """Tüm kalemlerin ürün kartlarını tek sorguda yükle."""
    ids: List[str] = []
    seen = set()
    for order in orders:
        for it in order.get("items") or []:
            if not isinstance(it, dict):
                continue
            pid = str(it.get("product_id") or "").strip()
            if pid and pid not in seen:
                seen.add(pid)
                ids.append(pid)
    if not ids:
        return {}
    try:
        cursor = _db.products.find(
            {"company_id": company_id, "_id": {"$in": ids}},
            {
                "name": 1, "sku": 1, "thumbnail_url": 1, "image_url": 1,
                "images": 1, "variants": 1, "stock_quantity": 1, "stock": 1,
                "company_id": 1,
            },
        )
        rows = await _to_list(cursor, max(len(ids), 1) + 5)
    except Exception:
        logger.exception("order mail product images company=%s", company_id)
        return {}
    out: Dict[str, dict] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("company_id") or "") not in ("", str(company_id)):
            continue
        pid = str(row.get("_id") or "")
        if pid:
            out[pid] = row
    return out


async def _order_links(orders: List[dict]) -> Dict[str, str]:
    links: Dict[str, str] = {}
    for o in orders:
        oid = str(o.get("_id") or "")
        if not oid:
            continue
        links[oid] = _safe_link(await app_link(f"/orders?open={quote(oid)}"))
    return links


async def _send_order_emails(
    company_id: str,
    prefs: dict,
    emails: List[str],
    orders: List[dict],
    already: set,
    products: Optional[Dict[str, dict]] = None,
) -> Tuple[List[str], List[str]]:
    base = _safe_link(await app_link(""))
    links = await _order_links(orders)
    company = await _db.companies.find_one({"_id": company_id}, {"name": 1, "logo_url": 1}) or {}
    company_name = str(company.get("name") or "Firma").strip() or "Firma"
    subject = _batch_subject(orders)
    cards = products or {}
    html_body = _order_batch_html(
        company_name, orders, links, base, cards,
        logo_url=str(company.get("logo_url") or ""),
    )
    text_body = _order_batch_text(company_name, orders, links, cards)
    reply_to = await _company_reply_to(company_id, prefs)
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
    if sent:
        await _record_notify_mail(company_id, sent, subject)
    return sent, failed


async def _deliver_order_batch(company_id: str, rows: List[dict], claim_id: str) -> int:
    prefs = await get_prefs(company_id)
    tenant = await get_tenant_prefs(company_id)
    ch = effective_channel(prefs, tenant, "order_new")
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

    qh_until = _quiet_hours_until(_quiet_hours_of(prefs))
    if qh_until is not None and (want_email or want_sms):
        await _defer_rows(active, claim_id, qh_until.isoformat())
        return len(rows)

    if want_email and not all(r.get("email_sent") for r in active):
        blocked, nxt = await _email_over_cap(company_id, prefs)
        if blocked:
            if want_sms:
                phones = await _recipient_phones(company_id, "order_new")
                if phones:
                    res = await _send_sms_now(company_id, phones, "Yeni sipariş", _sms_order_summary(visible))
                    if res.get("status") != "failed":
                        await _update_claimed(active, claim_id, {"sms_sent": True})
            await _defer_rows(active, claim_id, nxt)
            return len(rows)
        emails = await _recipient_emails(company_id, "order_new", prefs)
        if not emails:
            if not want_sms:
                await _mark_rows(active, claim_id, "skipped")
                return len(rows)
        else:
            already = set()
            for r in active:
                already.update(r.get("sent_to") or [])
            products = await _products_for_orders(company_id, visible)
            sent, failed = await _send_order_emails(company_id, prefs, emails, visible, already, products)
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


def _digest_lines(rows: List[dict]) -> List[str]:
    """Özet e-postasında her satırın başlığı ve mesajı (SMS metnine dokunmaz)."""
    lines: List[str] = []
    for row in rows:
        title = str(row.get("title") or "").strip()
        message = str(row.get("message") or "").strip()
        if title and message and message != title:
            lines.append(f"{title}\n{message}")
        elif title or message:
            lines.append(title or message)
    return lines


async def _deliver_generic(company_id: str, event: str, rows: List[dict], claim_id: str) -> int:
    prefs = await get_prefs(company_id)
    first = rows[0]
    titles = [str(i.get("title") or "") for i in rows]
    email_summary: Optional[str] = None
    email_lines: Optional[List[str]] = None
    if len(rows) == 1:
        title = titles[0]
        message = str(first.get("message") or "")
        link = str(first.get("link") or "")
    else:
        title = f"{EVENT_LABELS.get(event, event)}: {len(rows)} bildirim"
        message = " · ".join(t for t in titles if t)[:500]
        link = str(first.get("link") or "")
        email_summary = f"{len(rows)} bildirim"
        email_lines = _digest_lines(rows)
    want_email = any((i.get("channels") or {}).get("email") for i in rows) and not all(i.get("email_sent") for i in rows)
    want_sms = any((i.get("channels") or {}).get("sms") for i in rows) and not all(i.get("sms_sent") for i in rows)
    try:
        if want_email:
            blocked, nxt = await _email_over_cap(company_id, prefs)
            if blocked:
                if want_sms:
                    phones = await _recipient_phones(company_id, event)
                    if phones:
                        res = await _send_sms_now(company_id, phones, title, message)
                        if res.get("status") != "failed":
                            await _update_claimed(rows, claim_id, {"sms_sent": True})
                await _defer_rows(rows, claim_id, nxt)
                return len(rows)
            emails = await _recipient_emails(company_id, event, prefs)
            if not emails:
                if not want_sms:
                    await _mark_rows(rows, claim_id, "skipped")
                    return len(rows)
            else:
                res = await _send_email_now(
                    company_id, prefs, emails, title, message, link, event,
                    summary=email_summary, lines=email_lines,
                )
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


def _morning_summary_recipients(row: dict) -> List[str]:
    raw = row.get("to")
    if isinstance(raw, str):
        raw = [raw]
    out: List[str] = []
    seen = set()
    for item in raw or []:
        email = str(item or "").strip()
        if not email or "@" not in email or email in seen:
            continue
        seen.add(email)
        out.append(email)
    return out


async def _deliver_morning_summary(company_id: str, rows: List[dict], claim_id: str) -> int:
    """Kuyruktaki hazır HTML/metin. Alıcı satırdaki to listesidir, prefs değil."""
    prefs = await get_prefs(company_id)
    tenant = await get_tenant_prefs(company_id)
    try:
        if not effective_channel(prefs, tenant, "morning_summary")["email"]:
            await _mark_rows(rows, claim_id, "skipped")
            return len(rows)
        pending = [
            row for row in rows
            if (row.get("channels") or {}).get("email") and not row.get("email_sent")
        ]
        if not pending:
            await _mark_rows(rows, claim_id, "skipped")
            return len(rows)
        blocked, nxt = await _email_over_cap(company_id, prefs)
        if blocked:
            await _defer_rows(rows, claim_id, nxt)
            return len(rows)
        company = await _db.companies.find_one({"_id": company_id}, {"name": 1}) or {}
        company_name = str(company.get("name") or "Firma").strip() or "Firma"
        reply_to = await _company_reply_to(company_id, prefs)
        delivered = 0
        for row in pending:
            to = _morning_summary_recipients(row)
            if not to:
                await _mark_rows([row], claim_id, "skipped")
                delivered += 1
                continue
            result = await mail_service.send_mail(
                to,
                str(row.get("subject") or ""),
                str(row.get("text") or ""),
                html=str(row.get("html") or ""),
                purpose="transactional",
                company_id=company_id,
                reply_to=reply_to,
                from_name=company_name,
            )
            if (result or {}).get("status") != "sent":
                await _retry_rows([row], claim_id)
                continue
            sent_to = result.get("to") or to
            await _record_notify_mail(company_id, list(sent_to), str(row.get("subject") or ""))
            await _mark_rows([row], claim_id, "sent", {"email_sent": True})
            delivered += 1
        return delivered
    except Exception:
        logger.exception("notify morning summary company=%s", company_id)
        await _retry_rows(rows, claim_id)
        return 0


async def _deliver_direct_customer_mail(company_id: str, rows: List[dict], claim_id: str) -> int:
    """B2B onay, doğrulama ve şifre sıfırlama. Alıcı satırdaki to; istek içinde SMTP yok."""
    try:
        pending = [row for row in rows if (row.get("channels") or {}).get("email") and not row.get("email_sent")]
        if not pending:
            await _mark_rows(rows, claim_id, "skipped")
            return len(rows)
        company = await _db.companies.find_one({"_id": company_id}, {"name": 1}) or {}
        company_name = str(company.get("name") or "TamKobi").strip() or "TamKobi"
        delivered = 0
        for row in pending:
            to = _morning_summary_recipients(row)
            if not to:
                await _mark_rows([row], claim_id, "skipped")
                delivered += 1
                continue
            result = await mail_service.send_mail(
                to,
                str(row.get("subject") or ""),
                str(row.get("text") or ""),
                html=str(row.get("html") or ""),
                purpose="transactional",
                company_id=company_id,
                reply_to=await _company_reply_to(company_id, {}),
                from_name=company_name,
            )
            if (result or {}).get("status") != "sent":
                await _retry_rows([row], claim_id)
                continue
            sent_to = result.get("to") or to
            await _record_notify_mail(company_id, list(sent_to), str(row.get("subject") or ""))
            await _mark_rows([row], claim_id, "sent", {"email_sent": True})
            delivered += 1
        return delivered
    except Exception:
        logger.exception("notify direct customer mail company=%s", company_id)
        await _retry_rows(rows, claim_id)
        return 0


async def flush_notify_outbox(*, force: bool = False) -> dict:
    """Saatlik/günlük özet ve order_new gruplamasını claim ile işler."""
    await _release_stale_sending()
    now = _now_utc()
    now_iso = now.isoformat()
    try:
        pending = await _to_list(
            _db.notify_outbox.find({"status": {"$in": ["pending", "deferred"]}}),
            500,
        )
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
        elif ev == "morning_summary":
            flushed += await _deliver_morning_summary(cid, claimed, claim_id)
        elif ev in _B2B_DIRECT_EVENTS:
            flushed += await _deliver_direct_customer_mail(cid, claimed, claim_id)
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
        try:
            if _db is not None:
                await notify.check_push_receipts(_db)
        except Exception as e:
            logger.warning("push receipt check: %s", e)
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
    if not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail=COMPANY_NOTIFY_FORBIDDEN)
    before = await get_prefs(cid)
    saved = await save_prefs(cid, req or {})
    await _audit_prefs_put(cid, user, before, saved, "/api/notify/prefs")
    return saved


def _requested_company_id(body: Any, request: Request) -> Optional[str]:
    if isinstance(body, dict) and body.get("company_id"):
        return body.get("company_id")
    return request.query_params.get("company_id")


@router.get("/notify/tenant-prefs")
async def get_notify_tenant_prefs_route(
    request: Request,
    company_id: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    cid = tenant_access.resolve_company_id(
        user, company_id or request.query_params.get("company_id"),
    )
    cid = await _require_existing_company(cid)
    return await tenant_prefs_view(cid)


@router.put("/notify/tenant-prefs")
async def put_notify_tenant_prefs_route(
    req: Dict[str, Any],
    request: Request,
    user: dict = Depends(_user_dep),
):
    body = req or {}
    cid = tenant_access.resolve_company_id(user, _requested_company_id(body, request))
    await tenant_access.require_company_admin(user, cid)
    cid = await _require_existing_company(cid)
    patch = parse_tenant_update(body)
    await _reject_closed_platform_channel(cid, patch)
    before = await get_tenant_prefs(cid)
    saved = await save_tenant_prefs(cid, patch, user)
    await _audit_tenant_put(cid, user, before, saved)
    return await tenant_prefs_view(cid)


def _tenant_events_summary(before: dict, after: dict) -> str:
    """Değişen firma olaylarını ada göre yazar (yeni olaylar dahil)."""
    old = (before or {}).get("events") if isinstance(before, dict) else None
    new = (after or {}).get("events") if isinstance(after, dict) else None
    old = old if isinstance(old, dict) else {}
    new = new if isinstance(new, dict) else {}
    parts = []
    for ev in FIRM_EVENTS:
        a = old.get(ev) if isinstance(old.get(ev), dict) else {}
        b = new.get(ev) if isinstance(new.get(ev), dict) else {}
        bits = []
        for field, label in (("inapp", "uygulama"), ("email", "e-posta")):
            before_on = _tenant_flag(a, field)
            after_on = _tenant_flag(b, field)
            if before_on == after_on:
                continue
            bits.append(f"{label} {'açık' if after_on else 'kapalı'}")
        if bits:
            parts.append(f"{EVENT_LABELS.get(ev, ev)}: {', '.join(bits)}")
    return "; ".join(parts)


async def _audit_tenant_put(company_id: str, user: dict, before: dict, after: dict) -> None:
    try:
        named = _tenant_events_summary(before, after)
        summary = named or company_audit.diff_summary(
            {"events": (before or {}).get("events") or {}},
            {"events": (after or {}).get("events") or {}},
        ) or "Firma bildirim tercihleri güncellendi"
        await company_audit.write(
            _db,
            company_id=company_id,
            user=user,
            module="/settings",
            action="update",
            record_id=f"cnt_{company_id}",
            record_label="Firma bildirim tercihleri",
            summary=summary,
            path="/api/notify/tenant-prefs",
        )
    except Exception:
        logger.exception("tenant notify prefs audit company=%s", company_id)


async def _require_existing_company(company_id: str) -> str:
    cid = str(company_id or "").strip()
    if not cid:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    row = await _db.companies.find_one({"_id": cid})
    if not row:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    return cid


async def _audit_prefs_put(company_id: str, user: dict, before: dict, after: dict, path: str) -> None:
    try:
        summary = company_audit.diff_summary(public_prefs(before), after) or "Bildirim tercihleri güncellendi"
        await company_audit.write(
            _db,
            company_id=company_id,
            user=user,
            module="/settings",
            action="update",
            record_id=str(before.get("_id") or after.get("id") or f"cnp_{company_id}"),
            record_label="Bildirim tercihleri",
            summary=summary,
            path=path,
        )
    except Exception:
        logger.exception("notify prefs audit company=%s", company_id)


@router.get("/saas/companies/{company_id}/notify-prefs")
async def get_saas_notify_prefs(
    company_id: str,
    _: dict = Depends(saas.require_super_admin),
):
    cid = await _require_existing_company(company_id)
    return await present_prefs(await get_prefs(cid), with_usage=True)


@router.put("/saas/companies/{company_id}/notify-prefs")
async def put_saas_notify_prefs(
    company_id: str,
    req: Dict[str, Any],
    admin: dict = Depends(saas.require_super_admin),
):
    cid = await _require_existing_company(company_id)
    before = await get_prefs(cid)
    saved = await save_prefs(cid, req or {})
    await _audit_prefs_put(cid, admin, before, saved, f"/api/saas/companies/{cid}/notify-prefs")
    return await present_prefs(await get_prefs(cid), with_usage=True)


def _iso_tr(raw) -> str:
    if not raw:
        return ""
    try:
        return _fmt_tr_dt(_parse_ts(str(raw)).astimezone(IST))
    except (TypeError, ValueError):
        return str(raw)


def _recipients_text(raw) -> str:
    if isinstance(raw, list):
        return ", ".join(str(x).strip() for x in raw if str(x or "").strip())
    return str(raw or "").strip()


def _clamp_mail_log_limit(limit) -> int:
    try:
        lim = int(limit)
    except (TypeError, ValueError):
        lim = 50
    return min(max(lim, 1), NOTIFY_MAIL_LOG_LIMIT_MAX)


@router.get("/saas/companies/{company_id}/notify-mail-log")
async def get_saas_notify_mail_log(
    company_id: str,
    limit: int = 50,
    _: dict = Depends(saas.require_super_admin),
):
    cid = await _require_existing_company(company_id)
    lim = _clamp_mail_log_limit(limit)
    try:
        logs = await _to_list(
            _db.mail_logs.find({"company_id": cid, "context": "event_notify"}),
            20000,
        )
    except Exception:
        logger.exception("notify mail log company=%s", cid)
        logs = []
    logs.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    sent = []
    for row in logs[:lim]:
        to_raw = row.get("to") if "to" in row else row.get("recipients")
        sent.append({
            "id": str(row.get("_id") or row.get("id") or ""),
            "created_at": str(row.get("created_at") or ""),
            "date_tr": _iso_tr(row.get("created_at")),
            "to": list(to_raw) if isinstance(to_raw, list) else ([to_raw] if to_raw else []),
            "recipients": _recipients_text(to_raw),
            "subject": str(row.get("subject") or "")[:500],
            "status": str(row.get("status") or ""),
        })
    try:
        deferred_rows = await _to_list(
            _db.notify_outbox.find({"company_id": cid, "status": "deferred"}),
            5000,
        )
    except Exception:
        logger.exception("notify deferred log company=%s", cid)
        deferred_rows = []
    deferred_rows.sort(key=lambda r: str(r.get("next_try_at") or r.get("created_at") or ""), reverse=True)
    deferred = []
    for row in deferred_rows[:lim]:
        title = str(row.get("title") or row.get("subject") or "").strip()
        ev = str(row.get("event") or "")
        if not title:
            title = EVENT_LABELS.get(ev, ev)
        deferred.append({
            "id": str(row.get("_id") or ""),
            "created_at": str(row.get("created_at") or ""),
            "date_tr": _iso_tr(row.get("created_at")),
            "next_try_at": str(row.get("next_try_at") or ""),
            "next_try_at_tr": _iso_tr(row.get("next_try_at")),
            "status": "deferred",
            "event": ev,
            "subject": title[:500],
            "recipients": "",
        })
    return {"sent": sent, "deferred": deferred}
