"""Müşteri proje takip (public) görünüm yardımcıları."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

PROJECT_STATUS_LABELS = {
    "planning": "Planlama",
    "active": "Devam Ediyor",
    "on_hold": "Beklemede",
    "completed": "Tamamlandı",
}

# Müşteriye gösterilen kaba durum (operatör / malzeme sızdırılmaz).
_PUBLIC_STATUS = {
    "done": ("done", "Tamamladı"),
    "in_progress": ("in_progress", "İşlemde"),
    "paused": ("in_progress", "İşlemde"),
    "ready": ("waiting", "Başlamayı bekliyor"),
    "waiting": ("waiting", "Başlamayı bekliyor"),
}

_TR_TZ = ZoneInfo("Europe/Istanbul")


def has_production_slip(project: Optional[Dict[str, Any]]) -> bool:
    """Projeye bağlı üretim peçetesi / emri var mı?"""
    p = project or {}
    return bool(
        p.get("production_order_id")
        or p.get("production_order_code")
        or (p.get("production_steps") or [])
        or p.get("recipe_id")
    )


def work_step_label(status: str, project: Optional[Dict[str, Any]] = None) -> str:
    if status == "on_hold":
        return "Beklemede"
    if has_production_slip(project):
        return "Üretimde"
    return "Uygulama"


def public_step_status(raw: Optional[str] = None) -> Tuple[str, str]:
    """İş emri status → (public_key, Türkçe etiket)."""
    key = str(raw or "waiting").strip().lower()
    return _PUBLIC_STATUS.get(key, ("waiting", "Başlamayı bekliyor"))


def format_public_dt(value: Optional[str] = None) -> Optional[str]:
    """ISO tarih → müşteri için DD.MM.YYYY HH:MM (İstanbul)."""
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_TR_TZ).strftime("%d.%m.%Y %H:%M")


def _pick_current_work_order(work_orders: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    cur = next((w for w in work_orders if w.get("status") in ("in_progress", "paused")), None)
    if cur:
        return cur
    return next((w for w in work_orders if w.get("status") == "ready"), None)


def _match_work_order(
    step_no: int,
    station: str,
    by_no: Dict[int, Dict[str, Any]],
    by_station: Dict[str, Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    if step_no and step_no in by_no:
        return by_no[step_no]
    key = station.casefold()
    return by_station.get(key) if key else None


def public_production_stations(
    steps: Optional[List[Any]] = None,
    work_orders: Optional[List[Any]] = None,
) -> List[Dict[str, Any]]:
    """Müşteri takip: istasyon + durum / sıradaki / tarih-saat (malzeme-not yok)."""
    wos = [w for w in (work_orders or []) if isinstance(w, dict)]
    by_no: Dict[int, Dict[str, Any]] = {}
    by_station: Dict[str, Dict[str, Any]] = {}
    for w in wos:
        no = int(w.get("step_no") or w.get("original_step_no") or 0)
        if no and no not in by_no:
            by_no[no] = w
        st_key = str(w.get("station") or "").strip().casefold()
        if st_key and st_key not in by_station:
            by_station[st_key] = w
    current = _pick_current_work_order(wos)
    current_no = int((current or {}).get("step_no") or (current or {}).get("original_step_no") or 0)
    current_station = str((current or {}).get("station") or "").strip().casefold()

    out: List[Dict[str, Any]] = []
    for s in steps or []:
        if not isinstance(s, dict):
            continue
        station = str(s.get("station") or "").strip()
        if not station:
            continue
        no = int(s.get("no") or len(out) + 1)
        wo = _match_work_order(no, station, by_no, by_station)
        raw_status = (wo or {}).get("status") if wo else (s.get("status") if s.get("status") else "waiting")
        status_key, status_label = public_step_status(raw_status)
        is_current = False
        if current and wo is current:
            is_current = True
        elif current and not wo:
            is_current = (current_no and no == current_no) or (
                current_station and station.casefold() == current_station
            )
        elif not wos and status_key == "waiting" and not out:
            # Canlı iş emri yoksa ilk adımı sıradaki say.
            is_current = True

        started = format_public_dt((wo or {}).get("started_at") or s.get("started_at"))
        finished = format_public_dt((wo or {}).get("finished_at") or s.get("finished_at"))
        at = finished if status_key == "done" else (started if status_key == "in_progress" else None)

        row: Dict[str, Any] = {
            "no": no,
            "station": station,
            "status": status_key,
            "status_label": status_label,
            "current": is_current,
        }
        if started:
            row["started_at"] = started
        if finished:
            row["finished_at"] = finished
        if at:
            row["at"] = at
        out.append(row)

    # Birden fazla current olmasın; yoksa ilk waiting'i sıradaki yap.
    if out and not any(r.get("current") for r in out):
        for r in out:
            if r.get("status") != "done":
                r["current"] = True
                break
    else:
        seen = False
        for r in out:
            if r.get("current"):
                if seen:
                    r["current"] = False
                else:
                    seen = True
    return out
