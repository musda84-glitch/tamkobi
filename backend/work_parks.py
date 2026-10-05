"""Parkurlar (atölye istasyonları) ve iç görev türleri (personel atama)."""

from __future__ import annotations

import re
import uuid
from typing import Any, Dict, Optional


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


def normalize_workshop_zones(raw: Any) -> list:
    """Atölye bölgeleri — reçete adım adı (bölüm) seçenekleri."""
    return normalize_named_list(raw, prefix="zone")


def zone_names_from_list(raw: Any, fallback: Optional[list] = None) -> list:
    """Reçete adım adı select: şirket atölye bölgeleri, yoksa fallback."""
    names: list = []
    seen: set = set()
    for z in normalize_workshop_zones(raw):
        name = str(z.get("name") or "").strip()
        key = name.casefold()
        if not name or key in seen:
            continue
        seen.add(key)
        names.append(name)
    if names:
        return names
    for s in fallback or []:
        name = str(s or "").strip()
        key = name.casefold()
        if not name or key in seen:
            continue
        seen.add(key)
        names.append(name)
    return names


def find_workshop_zone(zones: list, zone_id: Optional[str]) -> Optional[dict]:
    return find_named(zones, zone_id)


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


def resolve_step_station(step: Optional[dict] = None, parks: Any = None, *, fallback: str = "Genel") -> str:
    """Reçete adımı → iş emri istasyonu: seçili parkur, ada eşleşen parkur, yoksa ilk parkur.

    Firma Ayarları → Parkurlar listesi kaynak alınır. Boş / «Genel» ise parkur kataloğundan çözülür.
    """
    names = station_names_from_parks(parks)
    by_cf = {n.casefold(): n for n in names}
    st = step or {}
    chosen = str(st.get("station") or "").strip()
    if chosen and chosen.casefold() != "genel":
        return by_cf.get(chosen.casefold(), chosen)
    step_name = str(st.get("name") or "").strip()
    if step_name and step_name.casefold() in by_cf:
        return by_cf[step_name.casefold()]
    if names:
        return names[0]
    return chosen or fallback


def resolve_work_order_station(
    step: Optional[dict] = None,
    parks: Any = None,
    *,
    override: Optional[str] = None,
    fallback: str = "Genel",
) -> str:
    """Sipariş→üretim emri: override varsa onu kullan; yoksa resolve_step_station."""
    forced = str(override or "").strip()
    if forced:
        return forced
    return resolve_step_station(step, parks, fallback=fallback)


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


def remove_office_task(tasks: Any, task_id: str) -> tuple[list, Optional[dict]]:
    """Tamamlanan iç görevi listeden çıkar (çöp kutusuna taşırken)."""
    tid = str(task_id or "")
    out: list = []
    found: Optional[dict] = None
    for t in tasks or []:
        if not isinstance(t, dict):
            continue
        if tid and str(t.get("id") or "") == tid:
            found = t
            continue
        out.append(t)
    return out, found


def remove_project_task(tasks: Any, task_id: str, emp_id: str) -> tuple[list, Optional[dict]]:
    """Personelin tamamlanan proje görev satırını çıkar."""
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
            found = t
            continue
        out.append(t)
    return out, found


def task_patch_fields(req: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Personel görev düzenleme: title / due_date / duration_days / done."""
    raw = req or {}
    out: Dict[str, Any] = {}
    if "title" in raw:
        title = str(raw.get("title") or "").strip()
        if title:
            out["title"] = title[:200]
    if "due_date" in raw:
        due = str(raw.get("due_date") or "").strip()[:10]
        out["due_date"] = due or None
    if "duration_days" in raw:
        try:
            days = int(raw.get("duration_days") or 0)
        except (TypeError, ValueError):
            days = 0
        out["duration_days"] = days if days > 0 else None
    if "done" in raw:
        done = bool(raw.get("done"))
        out["done"] = done
        out["status"] = "completed" if done else None
    return out


def patch_office_task(tasks: Any, task_id: str, fields: Optional[Dict[str, Any]] = None) -> tuple[list, Optional[dict]]:
    tid = str(task_id or "")
    patch = {k: v for k, v in (task_patch_fields(fields) or {}).items()}
    out: list = []
    found: Optional[dict] = None
    for t in tasks or []:
        if not isinstance(t, dict):
            continue
        if tid and str(t.get("id") or "") == tid:
            found = {**t, **patch}
            out.append(found)
        else:
            out.append(t)
    return out, found


def patch_project_task(
    tasks: Any,
    task_id: str,
    emp_id: str,
    fields: Optional[Dict[str, Any]] = None,
) -> tuple[list, Optional[dict]]:
    tid = str(task_id or "")
    eid = str(emp_id or "")
    patch = {k: v for k, v in (task_patch_fields(fields) or {}).items()}
    out: list = []
    found: Optional[dict] = None
    for t in tasks or []:
        if not isinstance(t, dict):
            continue
        same = tid and str(t.get("id") or t.get("_id") or "") == tid
        mine = not eid or str(t.get("assignee_id") or "") == eid
        if same and mine:
            found = {**t, **patch}
            out.append(found)
        else:
            out.append(t)
    return out, found


def assigned_task_trash_label(emp: Optional[dict], task: Optional[dict]) -> str:
    name = (emp or {}).get("full_name") or (emp or {}).get("name") or "Personel"
    title = (task or {}).get("title") or (task or {}).get("task_type_name") or (task or {}).get("park_name") or "Görev"
    return f"{name} · {title}"


def assigned_task_trash_doc(
    emp: dict,
    task: dict,
    *,
    source: str,
    project: Optional[dict] = None,
) -> dict:
    """Çöp kutusu belgesi — geri getirince personel/proje görevine yazılır."""
    tid = str(task.get("id") or task.get("_id") or "") or f"at_{uuid.uuid4().hex[:10]}"
    emp_id = emp.get("_id") or emp.get("id")
    row = {k: v for k, v in (task or {}).items() if k != "_id"}
    row["id"] = tid
    doc: dict = {
        "_id": tid,
        "company_id": emp.get("company_id") or (project or {}).get("company_id"),
        "employee_id": emp_id,
        "employee_name": emp.get("full_name") or emp.get("name") or "",
        "source": source if source in ("office", "project") else "office",
        "title": row.get("title") or row.get("task_type_name") or row.get("park_name") or "Görev",
        "task": row,
        "done": True,
        "status": row.get("status") or "completed",
    }
    if project:
        doc["project_id"] = project.get("_id") or project.get("id")
        doc["project_number"] = project.get("project_number")
        doc["project_name"] = project.get("name")
    return doc


def preserve_other_assignees(previous: Any, incoming: Any) -> list:
    """Aynı iş ikinci kişiye verilince ilk personelin satırı durur; yeni kişiye kopya açılır."""
    prev_by_id: dict = {}
    for t in previous or []:
        if not isinstance(t, dict):
            continue
        tid = str(t.get("id") or t.get("_id") or "")
        if tid:
            prev_by_id[tid] = t
    out: list = []
    for t in incoming or []:
        if not isinstance(t, dict):
            continue
        tid = str(t.get("id") or t.get("_id") or "")
        old = prev_by_id.get(tid) if tid else None
        old_aid = str((old or {}).get("assignee_id") or "")
        new_aid = str(t.get("assignee_id") or "")
        if old and old_aid and new_aid and old_aid != new_aid:
            out.append(old)
            out.append({**t, "id": f"t_{uuid.uuid4().hex[:10]}"})
        else:
            out.append(t)
    return out


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
