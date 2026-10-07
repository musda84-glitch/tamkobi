"""Müşteri proje takip (public) görünüm yardımcıları."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


PROJECT_STATUS_LABELS = {
    "planning": "Planlama",
    "active": "Devam Ediyor",
    "on_hold": "Beklemede",
    "completed": "Tamamlandı",
}


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


def public_production_stations(steps: Optional[List[Any]] = None) -> List[Dict[str, Any]]:
    """Müşteri takip: yalnızca istasyonlar (malzeme / not / adım adı yok)."""
    out: List[Dict[str, Any]] = []
    for s in steps or []:
        if not isinstance(s, dict):
            continue
        station = str(s.get("station") or "").strip()
        if not station:
            continue
        out.append({"no": int(s.get("no") or len(out) + 1), "station": station})
    return out
