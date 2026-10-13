"""Sipariş anı: veritabanında UTC, API'de offset'li ISO 8601, ekranda firma saat dilimi.

Varsayılan gösterim Europe/Istanbul. İleride firma kaydındaki `timezone`
veya `settings.timezone` aynı yardımcıdan okunur.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

DEFAULT_ORDER_TIMEZONE = "Europe/Istanbul"
ORDER_DATE_TZ_UTC = "utc"
# Yerel duvar saati UTC sanılarak yazılmış pazaryeri kanalları.
MARKETPLACE_LOCAL_CHANNELS = frozenset({"trendyol", "shopphp"})

_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TR_DATE = re.compile(
    r"^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$"
)
_HAS_CLOCK = re.compile(r"\d{2}:\d{2}")
_NAIVE_DT = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")


def order_timezone_name(company: Any = None) -> str:
    """Gösterim / yerel yorum saat dilimi. Bilinmeyen değer Europe/Istanbul'a düşer."""
    if isinstance(company, str) and company.strip():
        name = company.strip()
    elif isinstance(company, dict):
        settings = company.get("settings") if isinstance(company.get("settings"), dict) else {}
        name = str(company.get("timezone") or settings.get("timezone") or "").strip()
    else:
        name = ""
    if not name:
        return DEFAULT_ORDER_TIMEZONE
    try:
        ZoneInfo(name)
    except Exception:
        return DEFAULT_ORDER_TIMEZONE
    return name


def order_zone(company: Any = None) -> ZoneInfo:
    return ZoneInfo(order_timezone_name(company))


def utc_iso(moment: datetime) -> str:
    """Timezone-aware UTC, ISO 8601 ve sayısal offset (+00:00)."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    moment = moment.astimezone(timezone.utc)
    if moment.microsecond:
        return moment.isoformat()
    return moment.isoformat(timespec="seconds")


def ensure_utc_iso(value: Any) -> str:
    """API yanıtı: an varsa offset'li UTC. Yalnızca gün (YYYY-MM-DD) olduğu gibi kalır.

    Offset'siz datetime UTC kabul edilir; duvar saati kaydırılmaz. Kaymış
    pazaryeri kayıtlarını `relabel_utc_wall_as_local` düzeltir.
    """
    if isinstance(value, datetime):
        return utc_iso(value)
    text = str(value or "").strip()
    if not text or _DATE_ONLY.fullmatch(text):
        return text
    if text.endswith("Z"):
        return text[:-1].replace(" ", "T", 1) + "+00:00"
    if text.endswith("+00:00") or text.endswith("-00:00"):
        return text.replace(" ", "T", 1)
    if re.search(r"[+-]\d{2}:\d{2}$", text):
        parsed = _parse_iso(text)
        return utc_iso(parsed) if parsed is not None else text
    if _NAIVE_DT.match(text):
        return text.replace(" ", "T", 1) + "+00:00"
    return text


def _parse_iso(text: str) -> Optional[datetime]:
    raw = str(text or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    if "T" not in raw and " " in raw:
        raw = raw.replace(" ", "T", 1)
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def parse_marketplace_local(raw: Any, company: Any = None) -> Optional[datetime]:
    """Pazaryeri metin tarihi → gerçek UTC.

    Saat dilimi yoksa firma dilimi (varsayılan Europe/Istanbul). Offset varsa
    o offset'e uyulur; UTC etiketi yapıştırılmaz.
    """
    text = str(raw or "").strip()
    if not text:
        return None
    match = _TR_DATE.match(text)
    if match:
        day, month, year, hour, minute, second = match.groups()
        naive = datetime(int(year), int(month), int(day), int(hour or 0), int(minute or 0), int(second or 0))
        return naive.replace(tzinfo=order_zone(company)).astimezone(timezone.utc)
    parsed = _parse_iso(text)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=order_zone(company))
    return parsed.astimezone(timezone.utc)


def trendyol_order_ms_to_utc(value: Any, company: Any = None) -> Optional[datetime]:
    """Trendyol orderDate milisaniyesi → gerçek UTC.

    Doküman: orderDate timestamp GMT+3'tür; createdDate GMT'dir. Epoch'un
    UTC duvar saati Türkiye yerel saatidir, gerçek Unix anı değildir.
    """
    try:
        ms = int(value)
    except (TypeError, ValueError):
        return None
    seconds, millis = divmod(ms, 1000)
    try:
        wall = datetime.fromtimestamp(seconds, tz=timezone.utc).replace(tzinfo=None, microsecond=millis * 1000)
    except (OSError, OverflowError, ValueError):
        return None
    return wall.replace(tzinfo=order_zone(company)).astimezone(timezone.utc)


def trendyol_window_ms(days: int, *, now: Optional[datetime] = None, company: Any = None) -> tuple:
    """Gerçek UTC aralığını Trendyol start/end milisaniyesine çevirir."""
    end_dt = now or datetime.now(timezone.utc)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=timezone.utc)
    start_dt = end_dt - timedelta(days=max(1, int(days)))
    return trendyol_query_ms(start_dt, company), trendyol_query_ms(end_dt, company)


def trendyol_query_ms(moment: datetime, company: Any = None) -> int:
    """Gerçek UTC anı → Trendyol startDate/endDate (GMT+3 duvar saati olarak epoch ms)."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    local = moment.astimezone(order_zone(company))
    encoded = local.replace(tzinfo=timezone.utc)
    seconds = int(encoded.timestamp())
    return seconds * 1000 + encoded.microsecond // 1000


def order_local_day(value: Any, company: Any = None) -> str:
    """Sipariş anının firma saat dilimindeki takvim günü (YYYY-MM-DD)."""
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    else:
        text = str(value or "").strip()
        if not text:
            return ""
        if _DATE_ONLY.fullmatch(text):
            return text
        moment = _parse_iso(ensure_utc_iso(text))
        if moment is None:
            return ""
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(order_zone(company)).date().isoformat()


def relabel_utc_wall_as_local(value: Any, company: Any = None) -> Optional[str]:
    """UTC sanılmış yerel duvar saatini gerçek UTC ISO'ya çevirir.

    Saat içermeyen gün değerlerine dokunulmaz.
    """
    text = str(value or "").strip()
    if not text or not _HAS_CLOCK.search(text):
        return None
    parsed = _parse_iso(text)
    if parsed is None:
        return None
    if parsed.tzinfo is not None:
        wall = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    else:
        wall = parsed
    local = wall.replace(tzinfo=order_zone(company))
    return utc_iso(local.astimezone(timezone.utc))


def plan_order_date_fix(doc: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """Hatalı pazaryeri kaydı için `$set` yaması. Etkilenmeyecekse None."""
    if not isinstance(doc, dict):
        return None
    channel = str(doc.get("channel") or "").strip().lower()
    if channel not in MARKETPLACE_LOCAL_CHANNELS:
        return None
    if doc.get("is_simulated"):
        return None
    if str(doc.get("order_date_tz") or "").strip().lower() == ORDER_DATE_TZ_UTC:
        return None
    if str(doc.get("source") or "") != "marketplace_sync":
        return None
    fixed = relabel_utc_wall_as_local(doc.get("order_date"))
    if not fixed:
        return None
    before = ensure_utc_iso(doc.get("order_date"))
    if fixed == before:
        return None
    return {
        "order_date": fixed,
        "order_date_tz": ORDER_DATE_TZ_UTC,
        "order_date_before_tz_fix": before,
    }


async def collect_order_date_fixes(
    db,
    *,
    company_id: Optional[str] = None,
    apply: bool = False,
    sample_limit: int = 8,
) -> Dict[str, Any]:
    """Etkilenen siparişleri sayar. apply=False iken yazmaz."""
    query: Dict[str, Any] = {"source": "marketplace_sync"}
    if company_id:
        query["company_id"] = company_id
    projection = {
        "order_date": 1,
        "order_date_tz": 1,
        "channel": 1,
        "order_number": 1,
        "source": 1,
        "is_simulated": 1,
        "company_id": 1,
    }
    docs = await db.orders.find(query, projection).to_list(None)
    scanned = 0
    affected = 0
    updated = 0
    by_channel: Dict[str, int] = {}
    samples = []
    for doc in docs or []:
        if company_id and str(doc.get("company_id") or "") != company_id:
            continue
        scanned += 1
        patch = plan_order_date_fix(doc)
        if not patch:
            continue
        affected += 1
        channel = str(doc.get("channel") or "").strip().lower()
        by_channel[channel] = by_channel.get(channel, 0) + 1
        if len(samples) < sample_limit:
            samples.append({
                "id": str(doc.get("_id") or doc.get("id") or ""),
                "company_id": doc.get("company_id"),
                "channel": channel,
                "order_number": doc.get("order_number"),
                "before": patch["order_date_before_tz_fix"],
                "after": patch["order_date"],
            })
        if apply:
            oid = doc.get("_id") or doc.get("id")
            if oid:
                await db.orders.update_one({"_id": oid}, {"$set": patch})
                updated += 1
    return {
        "dry_run": not apply,
        "company_id": company_id or None,
        "scanned": scanned,
        "affected": affected,
        "updated": updated,
        "by_channel": by_channel,
        "samples": samples,
    }
