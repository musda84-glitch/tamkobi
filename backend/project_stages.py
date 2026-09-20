"""Firma bazlı proje aşamaları (kart durumu seçici)."""
from __future__ import annotations

import re
import unicodedata
from typing import Any, List

DEFAULT_PROJECT_STAGES = [
    {"key": "planning", "label": "Planlama", "tone": "slate"},
    {"key": "active", "label": "Devam Ediyor", "tone": "blue"},
    {"key": "on_hold", "label": "Beklemede", "tone": "amber"},
    {"key": "completed", "label": "Tamamlandı", "tone": "emerald", "is_final": True},
]

ALLOWED_TONES = {"slate", "blue", "amber", "emerald", "rose", "violet", "indigo"}


def _slug(label: str, used: set) -> str:
    raw = unicodedata.normalize("NFKD", str(label or "asama"))
    raw = "".join(c for c in raw if not unicodedata.combining(c))
    base = re.sub(r"[^a-z0-9]+", "_", raw.lower()).strip("_")[:24] or "asama"
    key = base
    i = 2
    while key in used:
        key = f"{base}_{i}"
        i += 1
    return key


def normalize_project_stages(raw: Any) -> List[dict]:
    rows = raw if isinstance(raw, list) else []
    used: set = set()
    out: List[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or "").strip()
        if not label:
            continue
        key = str(row.get("key") or "").strip()
        if not key:
            key = _slug(label, used)
        if key in used:
            continue
        used.add(key)
        tone = row.get("tone") if row.get("tone") in ALLOWED_TONES else "slate"
        out.append({
            "key": key,
            "label": label[:60],
            "tone": tone,
            "is_final": bool(row.get("is_final")),
        })
    if len(out) < 2:
        return [dict(s) for s in DEFAULT_PROJECT_STAGES]
    if not any(s.get("is_final") for s in out):
        out[-1]["is_final"] = True
        out[-1]["tone"] = out[-1].get("tone") or "emerald"
    saw = False
    cleaned = []
    for s in out:
        if s.get("is_final"):
            if saw:
                s = {**s, "is_final": False}
            else:
                saw = True
        cleaned.append(s)
    return cleaned


def final_stage_key(stages: Any) -> str:
    stages = normalize_project_stages(stages)
    for s in stages:
        if s.get("is_final"):
            return s["key"]
    return stages[-1]["key"]
