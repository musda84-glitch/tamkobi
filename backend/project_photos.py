"""Proje aşama fotoğrafları: kayıt temizliği ve müşteri sayfası grupları."""
from __future__ import annotations

import re
from typing import Any, List

_STAGE = re.compile(r"[^a-zA-Z0-9_\-]")


def clean_stage_key(value: Any) -> str:
    return _STAGE.sub("", str(value or ""))[:40]


def is_photo_url(value: Any) -> bool:
    """Müşteri sayfasında gösterilebilir dosya yolu. Hata sayfası metni değil."""
    url = str(value or "").strip()
    if not url or len(url) > 500:
        return False
    lowered = url.lower()
    if "<" in url or "request entity too large" in lowered or "<!doctype" in lowered or "<html" in lowered:
        return False
    return url.startswith("/api/files/")


def sanitize_stage_photos(raw: Any) -> List[dict]:
    if not isinstance(raw, list):
        return []
    out: List[dict] = []
    for row in raw[:80]:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        if not is_photo_url(url):
            continue
        stage = clean_stage_key(row.get("stage")) or "other"
        out.append({
            "url": url,
            "stage": stage,
            "stage_label": str(row.get("stage_label") or "")[:60],
            "created_at": str(row.get("created_at") or "")[:40],
        })
    return out


def group_stage_photos(stage_photos: Any, images: Any, stages: Any) -> List[dict]:
    """Aşama sırasına göre fotoğraf grupları. Eşlenmemiş görseller 'Keşif fotoğrafı' altında."""
    label_by = {}
    order = []
    for stage in stages or []:
        if not isinstance(stage, dict):
            continue
        key = str(stage.get("key") or "")
        if not key or key in label_by:
            continue
        label_by[key] = stage.get("label") or key
        order.append(key)
    groups: dict = {}
    seen_order: List[str] = []

    def add(key: str, url: str) -> None:
        if key not in groups:
            groups[key] = []
            seen_order.append(key)
        if url not in groups[key]:
            groups[key].append(url)

    tagged = set()
    for row in stage_photos or []:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "")
        if not is_photo_url(url):
            continue
        key = clean_stage_key(row.get("stage")) or "other"
        if row.get("stage_label") and key not in label_by:
            label_by[key] = str(row.get("stage_label"))[:60]
        add(key, url)
        tagged.add(url)
    for url in images or []:
        if is_photo_url(url) and url not in tagged:
            add("other", str(url))
    if not groups:
        return []
    rank = {key: i for i, key in enumerate(order)}
    rank["other"] = 10_000

    def sort_key(key: str) -> tuple:
        return (rank.get(key, 9_000), seen_order.index(key))

    out = []
    for key in sorted(seen_order, key=sort_key):
        out.append({
            "stage": key,
            "label": "Keşif fotoğrafı" if key == "other" else (label_by.get(key) or key),
            "images": groups[key],
        })
    return out
