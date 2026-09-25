"""Parkurlar (atölye istasyonları) ve iç görev türleri (personel atama)."""

from __future__ import annotations

import re
import uuid
from typing import Any, Optional


def _slug(name: str, used: set, prefix: str = "item") -> str:
    raw = re.sub(
        r"[^a-z0-9]+",
        "_",
        name.lower()
        .replace("ı", "i")
        .replace("ş", "s")
        .replace("ç", "c")
        .replace("ğ", "g")
        .replace("ü", "u")
        .replace("ö", "o"),
    ).strip("_")
    key = raw or prefix
    n = 2
    out = key
    while out in used:
        out = f"{key}_{n}"
        n += 1
    used.add(out)
    return out


def normalize_named_list(raw: Any, *, limit: int = 40, prefix: str = "item") -> list:
    """[{id, name}, ...] — parkur veya iç görev kataloğu."""
    rows = raw if isinstance(raw, list) else []
    used: set = set()
    out = []
    for i, row in enumerate(rows):
        if isinstance(row, str):
            name = row.strip()
            pid = None
        elif isinstance(row, dict):
            name = str(row.get("name") or row.get("label") or "").strip()
            pid = str(row.get("id") or row.get("key") or "").strip() or None
        else:
            continue
        if not name:
            continue
        key = pid if pid and pid not in used else _slug(name, used, prefix=prefix)
        if pid:
            used.add(key)
        out.append({"id": key[:40], "name": name[:80]})
        if len(out) >= limit:
            break
    return out


def normalize_work_parks(raw: Any) -> list:
    return normalize_named_list(raw, prefix="park")


def normalize_office_task_types(raw: Any) -> list:
    return normalize_named_list(raw, prefix="ot")


def office_task_types_for_company(company: Optional[dict] = None) -> list:
    """İç görev listesi; yoksa eski tek listeden (work_parks) türet."""
    company = company or {}
    types = normalize_office_task_types(company.get("office_task_types"))
    if types:
        return types
    return normalize_work_parks(company.get("work_parks"))


def station_names_from_parks(raw: Any, fallback: Optional[list] = None) -> list:
    """Atölye istasyon filtresi: şirket parkur adları, yoksa iş emri istasyonları."""
    names: list = []
    seen: set = set()
    for p in normalize_work_parks(raw):
        name = str(p.get("name") or "").strip()
        key = name.casefold()
        if not name or key in seen:
            continue
        seen.add(key)
        names.append(name)
    if names:
        return names
    extra: list = []
    for s in fallback or []:
        name = str(s or "").strip()
        key = name.casefold()
        if not name or key in seen:
            continue
        seen.add(key)
        extra.append(name)
    return extra


def find_named(items: list, item_id: Optional[str]) -> Optional[dict]:
    pid = str(item_id or "")
    for p in items or []:
        if str(p.get("id") or "") == pid:
            return p
    return None


def find_park(parks: list, park_id: Optional[str]) -> Optional[dict]:
    return find_named(parks, park_id)


def find_office_task_type(types: list, type_id: Optional[str]) -> Optional[dict]:
    return find_named(types, type_id)


def office_task_row(
    emp: dict,
    task_type: dict,
    title: str = "",
    new_id: Optional[str] = None,
    park: Optional[dict] = None,
) -> dict:
    """İç görev satırı. task_type zorunlu; park isteğe bağlı (atölye bağlantısı)."""
    type_name = (task_type or {}).get("name") or "İç görev"
    name = (title or "").strip() or type_name
    park = park or {}
    type_id = (task_type or {}).get("id")
    return {
        "id": new_id or f"ot_{uuid.uuid4().hex[:10]}",
        "kind": "office",
        "title": name,
        "task_type_id": type_id,
        "task_type_name": type_name,
        # Eski istemciler / puantaj: park_* alanları tip bilgisini de taşır
        "park_id": park.get("id") or type_id,
        "park_name": park.get("name") or type_name,
        "done": False,
        "assignee_id": emp.get("_id") or emp.get("id"),
        "assignee_name": emp.get("full_name") or "Personel",
    }


def is_assignment_done(task: Optional[dict]) -> bool:
    if not isinstance(task, dict):
        return False
    return bool(task.get("done") or task.get("status") in ("done", "completed", "tamamlandi"))


def mark_office_task_done(tasks: Any, task_id: str) -> tuple[list, Optional[dict]]:
    tid = str(task_id or "")
    out: list = []
    found: Optional[dict] = None
    for t in tasks or []:
        if not isinstance(t, dict):
            continue
        if tid and str(t.get("id") or "") == tid:
            found = {**t, "done": True, "status": "completed"}
            out.append(found)
        else:
            out.append(t)
    return out, found


def mark_project_task_done(tasks: Any, task_id: str, emp_id: str) -> tuple[list, Optional[dict]]:
    tid = str(task_id or "")
    eid = str(emp_id or "")
    out: list = []
    found: Optional[dict] = None
    for t in tasks or []:
        if not isinstance(t, dict):
            continue
        same = tid and str(t.get("id") or t.get("_id") or "") == tid
        mine = not eid or str(t.get("assignee_id") or "") == eid
        if same and mine:
            found = {**t, "done": True, "status": "completed"}
            out.append(found)
        else:
            out.append(t)
    return out, found


def clear_duty_if_task(duty: Any, task_id: str) -> Any:
    if isinstance(duty, dict) and str(duty.get("task_id") or "") == str(task_id or ""):
        return None
    return duty


def office_assignment_view(task: dict) -> dict:
    type_name = task.get("task_type_name") or task.get("park_name") or ""
    photos = [p for p in (task.get("photos") or []) if isinstance(p, dict) and p.get("url")]
    return {
        "id": task.get("id"),
        "title": task.get("title") or type_name or "İç görev",
        "done": bool(task.get("done") or task.get("status") in ("done", "completed")),
        "kind": "office",
        "task_type_id": task.get("task_type_id") or task.get("park_id"),
        "task_type_name": type_name,
        "park_id": task.get("park_id"),
        "park_name": task.get("park_name") or type_name,
        "project_name": type_name,
        "project_number": "",
        "duration_days": None,
        "due_date": task.get("due_date"),
        "workflow": [],
        "photos": photos,
    }


def find_office_task(tasks: Any, task_id: str) -> Optional[dict]:
    tid = str(task_id or "")
    if not tid:
        return None
    for t in tasks or []:
        if isinstance(t, dict) and str(t.get("id") or "") == tid:
            return t
    return None


def append_office_task_photo(tasks: Any, task_id: str, photo: dict) -> tuple[list, Optional[dict]]:
    tid = str(task_id or "")
    out: list = []
    found: Optional[dict] = None
    for t in tasks or []:
        if not isinstance(t, dict):
            continue
        if tid and str(t.get("id") or "") == tid:
            photos = [p for p in (t.get("photos") or []) if isinstance(p, dict)]
            photos.append(photo)
            found = {**t, "photos": photos}
            out.append(found)
        else:
            out.append(t)
    return out, found
