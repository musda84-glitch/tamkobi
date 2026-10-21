"""Atölye iş ekranı ayarları.

Değerler şirket belgesinde opsiyonel alanlardır. Kayıt yoksa varsayılan
kodun içindedir. GET/POST /production/work-orders/shopfloor-settings
bu alanları mevcut group_same_station yanıtına ekler.
"""
from __future__ import annotations

import inspect
import re
from typing import Any, Dict, Optional, Tuple

IDLE_DEFAULT = 30
IDLE_MIN = 5
IDLE_MAX = 720
UNDO_DEFAULT = 5
UNDO_MIN = 1
UNDO_MAX = 240
NOTE_MAX = 200
TAKEOVER_MODES = frozenset({"device", "always", "off"})
_CODE_RE = re.compile(r"^[a-z0-9_]{1,32}$")

DEFAULT_SCRAP_REASONS = (
    {"code": "cut_error", "label": "Kesim hatası", "active": True},
    {"code": "material", "label": "Malzeme", "active": True},
    {"code": "machine", "label": "Makine", "active": True},
    {"code": "other", "label": "Diğer", "active": True},
)

_COMPANY_FIELDS = {
    "shopfloor_group_same_station": 1,
    "shopfloor_idle_lock_minutes": 1,
    "shopfloor_undo_finish_minutes": 1,
    "shopfloor_scrap_reasons": 1,
    "shopfloor_scrap_reason_required": 1,
    "shopfloor_takeover_confirm": 1,
}


def _copy_reasons(rows) -> list:
    return [dict(item) for item in rows]


def clamp_int(value: Any, default: int, low: int, high: int, *, strict: bool = False) -> int:
    if value is None or value == "":
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        if strict:
            raise ValueError(f"Süre {low} ile {high} dakika arasında olmalı.")
        return default
    if number < low or number > high:
        if strict:
            raise ValueError(f"Süre {low} ile {high} dakika arasında olmalı.")
        return min(high, max(low, number))
    return number


def idle_minutes(company: Optional[dict], *, strict: bool = False) -> int:
    raw = None if not isinstance(company, dict) else company.get("shopfloor_idle_lock_minutes")
    if strict:
        return clamp_int(raw, IDLE_DEFAULT, IDLE_MIN, IDLE_MAX, strict=True)
    if not isinstance(company, dict) or company.get("shopfloor_idle_lock_minutes") in (None, ""):
        return IDLE_DEFAULT
    return clamp_int(raw, IDLE_DEFAULT, IDLE_MIN, IDLE_MAX, strict=False)


def undo_minutes(company: Optional[dict]) -> int:
    if not isinstance(company, dict) or company.get("shopfloor_undo_finish_minutes") in (None, ""):
        return UNDO_DEFAULT
    return clamp_int(
        company.get("shopfloor_undo_finish_minutes"),
        UNDO_DEFAULT,
        UNDO_MIN,
        UNDO_MAX,
        strict=False,
    )


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return bool(value)
    return str(value or "").strip().lower() in ("1", "true", "yes", "evet", "on")


def takeover_mode(company: Optional[dict]) -> str:
    raw = ""
    if isinstance(company, dict):
        raw = str(company.get("shopfloor_takeover_confirm") or "").strip().lower()
    if raw in TAKEOVER_MODES:
        return raw
    return "device"


def scrap_reasons(company: Optional[dict]) -> list:
    raw = company.get("shopfloor_scrap_reasons") if isinstance(company, dict) else None
    try:
        return normalize_reasons(raw, strict=False)
    except ValueError:
        return _copy_reasons(DEFAULT_SCRAP_REASONS)


def scrap_reason_required(company: Optional[dict]) -> bool:
    if not isinstance(company, dict):
        return False
    if "shopfloor_scrap_reason_required" not in company:
        return False
    return as_bool(company.get("shopfloor_scrap_reason_required"))


def normalize_reasons(raw: Any, *, strict: bool = False) -> list:
    if raw is None:
        return _copy_reasons(DEFAULT_SCRAP_REASONS)
    if not isinstance(raw, list):
        if strict:
            raise ValueError("Fire nedenleri liste olmalı.")
        return _copy_reasons(DEFAULT_SCRAP_REASONS)
    out = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            if strict:
                raise ValueError("Fire nedeni kod ve etiket içermeli.")
            continue
        code = str(item.get("code") or "").strip().lower()
        label = str(item.get("label") or "").strip()
        if _CODE_RE.fullmatch(code) is None or not label or len(label) > 40:
            if strict:
                raise ValueError("Fire nedeni kodu ve etiketi geçersiz.")
            continue
        if code in seen:
            if strict:
                raise ValueError("Fire nedeni kodu tekrar edemez.")
            continue
        seen.add(code)
        active = True if item.get("active") is None else as_bool(item.get("active"))
        out.append({"code": code, "label": label, "active": active})
    if not out:
        if strict:
            raise ValueError("En az bir fire nedeni gerekli.")
        return _copy_reasons(DEFAULT_SCRAP_REASONS)
    return out


def public_from_company(company: Optional[dict]) -> Dict[str, Any]:
    company = company or {}
    return {
        "group_same_station": bool(company.get("shopfloor_group_same_station")),
        "idle_lock_minutes": idle_minutes(company),
        "undo_finish_minutes": undo_minutes(company),
        "scrap_reasons": scrap_reasons(company),
        "scrap_reason_required": scrap_reason_required(company),
        "takeover_confirm": takeover_mode(company),
    }


def parse_updates(req: Optional[dict]) -> Dict[str, Any]:
    """İstekte olan yeni alanları şirket belgesine yazılacak hale getirir."""
    body = req or {}
    sets: Dict[str, Any] = {}
    if "idle_lock_minutes" in body:
        sets["shopfloor_idle_lock_minutes"] = clamp_int(
            body.get("idle_lock_minutes"), IDLE_DEFAULT, IDLE_MIN, IDLE_MAX, strict=True,
        )
    if "undo_finish_minutes" in body:
        sets["shopfloor_undo_finish_minutes"] = clamp_int(
            body.get("undo_finish_minutes"), UNDO_DEFAULT, UNDO_MIN, UNDO_MAX, strict=True,
        )
    if "scrap_reasons" in body:
        sets["shopfloor_scrap_reasons"] = normalize_reasons(body.get("scrap_reasons"), strict=True)
    if "scrap_reason_required" in body:
        sets["shopfloor_scrap_reason_required"] = as_bool(body.get("scrap_reason_required"))
    if "takeover_confirm" in body:
        mode = str(body.get("takeover_confirm") or "").strip().lower()
        if mode not in TAKEOVER_MODES:
            raise ValueError("takeover_confirm device, always veya off olmalı.")
        sets["shopfloor_takeover_confirm"] = mode
    return sets


async def load_company(db, company_id: str) -> dict:
    cid = str(company_id or "").strip()
    if not cid or db is None:
        return {}
    companies = getattr(db, "companies", None)
    find_one = getattr(companies, "find_one", None)
    if not callable(find_one):
        return {}
    try:
        found = find_one({"_id": cid}, dict(_COMPANY_FIELDS))
    except Exception:
        return {}
    if inspect.isawaitable(found):
        try:
            found = await found
        except Exception:
            return {}
    return found if isinstance(found, dict) else {}
