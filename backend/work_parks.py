"""İç görev parkurları (makina parkuru, atölye…)."""

from __future__ import annotations

import re
import uuid
from typing import Any, Optional


def _slug(name: str, used: set) -> str:
    raw = re.sub(r"[^a-z0-9]+", "_", name.lower().replace("ı", "i").replace("ş", "s").replace("ç", "c").replace("ğ", "g").replace("ü", "u").replace("ö", "o")).strip("_")
    key = raw or "park"
    n = 2
    out = key
    while out in used:
        out = f"{key}_{n}"
        n += 1
    used.add(out)
    return out


def normalize_work_parks(raw: Any) -> list:
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
        key = pid if pid and pid not in used else _slug(name, used)
        if pid:
            used.add(key)
        out.append({"id": key[:40], "name": name[:80]})
        if len(out) >= 40:
            break
    return out


def station_names_from_parks(raw: Any, fallback: Optional[list] = None) -> list:
    """Atölye istasyon filtresi: önce şirket parkur adları, yoksa iş emri istasyonları."""
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


def find_park(parks: list, park_id: Optional[str]) -> Optional[dict]:
    pid = str(park_id or "")
    for p in parks or []:
        if str(p.get("id") or "") == pid:
            return p
    return None


def office_task_row(emp: dict, park: dict, title: str = "", new_id: Optional[str] = None) -> dict:
    name = (title or "").strip() or park.get("name") or "İç görev"
    return {
        "id": new_id or f"ot_{uuid.uuid4().hex[:10]}",
        "kind": "office",
        "title": name,
        "park_id": park.get("id"),
        "park_name": park.get("name") or name,
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
    park_name = task.get("park_name") or ""
    return {
        "id": task.get("id"),
        "title": task.get("title") or park_name or "İç görev",
        "done": bool(task.get("done") or task.get("status") in ("done", "completed")),
        "kind": "office",
        "park_id": task.get("park_id"),
        "park_name": park_name,
        "project_name": park_name,
        "project_number": "",
        "duration_days": None,
        "due_date": task.get("due_date"),
    }
