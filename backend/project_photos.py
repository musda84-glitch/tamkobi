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


def photo_visibility(row: Any) -> str:
    """pending | show | hide — eski kayıtlarda alan yoksa müşteri görür."""
    rec = row if isinstance(row, dict) else {}
    if rec.get("customer_visible") is True or rec.get("approval") == "approved":
        return "show"
    if rec.get("approval") == "rejected":
        return "hide"
    if rec.get("source") == "employee" or rec.get("customer_visible") is False:
        return "pending"
    return "show"


def photo_visibility_label(state: str) -> str:
    return {"show": "Müşteri görür", "hide": "Müşteri görmez", "pending": "Onay bekliyor"}.get(state or "", "Onay bekliyor")


def customer_can_see_photo(row: Any) -> bool:
    return photo_visibility(row) == "show"


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
        vis = photo_visibility(row)
        out.append({
            "url": url,
            "stage": stage,
            "stage_label": str(row.get("stage_label") or "")[:60],
            "created_at": str(row.get("created_at") or "")[:40],
            "source": str(row.get("source") or "")[:20],
            "uploaded_by": str(row.get("uploaded_by") or "")[:40],
            "task_id": str(row.get("task_id") or "")[:40],
            "customer_visible": vis == "show",
            "approval": "approved" if vis == "show" else ("rejected" if vis == "hide" else "pending"),
            "visibility": vis,
            "visibility_label": photo_visibility_label(vis),
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
    hidden = set()
    for row in stage_photos or []:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "")
        if not is_photo_url(url):
            continue
        if not customer_can_see_photo(row):
            hidden.add(url)
            continue
        key = clean_stage_key(row.get("stage")) or "other"
        if row.get("stage_label") and key not in label_by:
            label_by[key] = str(row.get("stage_label"))[:60]
        add(key, url)
        tagged.add(url)
    for url in images or []:
        if is_photo_url(url) and url not in tagged and url not in hidden:
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


def employee_photo_row(url: str, *, stage: str, stage_label: str, created_at: str, uploaded_by: str, task_id: str) -> dict:
    return sanitize_stage_photos([{
        "url": url,
        "stage": stage,
        "stage_label": stage_label,
        "created_at": created_at,
        "source": "employee",
        "uploaded_by": uploaded_by,
        "task_id": task_id,
        "customer_visible": False,
        "approval": "pending",
    }])[0]


def apply_photo_visibility(raw: Any, url: str, visible: bool) -> List[dict]:
    target = str(url or "").strip()
    next_rows = []
    found = False
    for row in sanitize_stage_photos(raw):
        if row["url"] == target:
            found = True
            row["customer_visible"] = bool(visible)
            row["approval"] = "approved" if visible else "rejected"
            row["visibility"] = "show" if visible else "hide"
            row["visibility_label"] = photo_visibility_label(row["visibility"])
        next_rows.append(row)
    if not found and is_photo_url(target):
        next_rows.append(sanitize_stage_photos([{
            "url": target,
            "stage": "other",
            "source": "manager",
            "customer_visible": bool(visible),
            "approval": "approved" if visible else "rejected",
        }])[0])
    return next_rows


def assignment_photos(proj: Optional[dict] = None) -> List[dict]:
    return sanitize_stage_photos((proj or {}).get("stage_photos"))
