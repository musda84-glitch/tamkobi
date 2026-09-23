"""Mesai saatleri, personel self-servis puantaj (giriş/çıkış/onay) ve otomatik fazla mesai hesabı."""
import math
import uuid
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request

import personnel_wage

router = APIRouter(prefix="/api")
_db = None
_current_user = None

DEFAULT_SCHEDULE = {"start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4], "days": {}, "late_tolerance_minutes": 10, "overtime_tolerance_minutes": 15, "count_early_as_overtime": False, "require_geo": True, "timezone": "Europe/Istanbul",
                    "overtime_method": "legal", "overtime_multiplier": 1.5, "holiday_multiplier": 2.0, "monthly_hours_divisor": 225, "notify_missing_checkin": True, "notify_late_checkin": True}
# Personel kartı: konum izleme (iş yeri + dış görev ayrı).
DEFAULT_LOCATION_MODE = {"enabled": True, "continuous": False, "interval_minutes": 15, "exit_tolerance_hours": 0}
DEFAULT_LOCATION_TRACKING = {**DEFAULT_LOCATION_MODE, "field": dict(DEFAULT_LOCATION_MODE)}
OVERTIME_METHODS = {"legal": "Yasal (brüt/225 × katsayı)", "fixed": "Sabit saatlik mesai ücreti"}
DAY_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"]


def init(db, current_user_dep):
    global _db, _current_user
    _db, _current_user = db, current_user_dep


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tz(schedule: Optional[dict] = None):
    try:
        return ZoneInfo((schedule or {}).get("timezone") or DEFAULT_SCHEDULE["timezone"])
    except Exception:
        return ZoneInfo(DEFAULT_SCHEDULE["timezone"])


def local_now(schedule: Optional[dict] = None) -> datetime:
    return datetime.now(timezone.utc).astimezone(_tz(schedule))


def _today(schedule: Optional[dict] = None) -> str:
    return local_now(schedule).strftime("%Y-%m-%d")


def now_hm(schedule: Optional[dict] = None) -> str:
    return local_now(schedule).strftime("%H:%M")


def _hm(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def _clean(d: dict) -> dict:
    d = dict(d)
    d["id"] = d.pop("_id")
    return d


def _normalize_location_mode(raw: Optional[dict] = None, fallback: Optional[dict] = None) -> dict:
    """Tek bir konum modu: enabled / continuous / interval_minutes (0 = sürekli)."""
    base = dict(fallback or DEFAULT_LOCATION_MODE)
    if not isinstance(raw, dict):
        return base
    if "enabled" in raw:
        base["enabled"] = bool(raw.get("enabled"))
    if "continuous" in raw:
        base["continuous"] = bool(raw.get("continuous"))
    if raw.get("interval_minutes") not in (None, ""):
        try:
            mins = int(raw["interval_minutes"])
        except (TypeError, ValueError):
            mins = base["interval_minutes"]
        base["interval_minutes"] = max(0, min(120, mins))
    if raw.get("exit_tolerance_hours") not in (None, ""):
        try:
            hours = int(raw["exit_tolerance_hours"])
        except (TypeError, ValueError):
            hours = int(base.get("exit_tolerance_hours") or 0)
        base["exit_tolerance_hours"] = max(0, min(12, hours))
    elif "exit_tolerance_hours" not in base:
        base["exit_tolerance_hours"] = 0
    if not base["enabled"]:
        base["continuous"] = False
        return base
    if base["interval_minutes"] == 0:
        base["continuous"] = True
    elif base["continuous"]:
        base["interval_minutes"] = 0
    return base


def normalize_location_tracking(raw: Optional[dict] = None) -> dict:
    """İş yeri + dış görev konum tercihleri. Eski düz alanlar iş yeri ayarıdır."""
    company = _normalize_location_mode(raw if isinstance(raw, dict) else None)
    field_raw = (raw or {}).get("field") if isinstance(raw, dict) else None
    # Eski kayıtlarda field yoksa iş yeri ayarından türet.
    field = _normalize_location_mode(field_raw if isinstance(field_raw, dict) else None, fallback=company)
    return {**company, "field": field}


def checkout_distance_blocks() -> bool:
    """Çıkış butonla her yerden; uzaklık veya otomatik algı çıkışı durdurmaz."""
    return False


def location_ping_checks_out() -> bool:
    """Sürekli takip yalnızca konum dışı bildirir; Giriş/Çıkış basılmaz."""
    return False


def location_mode_for(lt: Optional[dict], workplace: Optional[dict] = None) -> dict:
    """Etkin iş yerine göre kullanılacak konum modu (iş yeri veya dış görev)."""
    full = normalize_location_tracking(lt)
    if workplace and workplace.get("kind") == "task":
        return dict(full.get("field") or DEFAULT_LOCATION_MODE)
    return {
        "enabled": full["enabled"],
        "continuous": full["continuous"],
        "interval_minutes": full["interval_minutes"],
        "exit_tolerance_hours": full.get("exit_tolerance_hours", 0),
    }


def _parse_iso(raw: Optional[str]) -> Optional[datetime]:
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def location_exit_should_notify(
    *,
    outside: bool,
    first_left_at: Optional[str] = None,
    now: Optional[str] = None,
    tolerance_hours: int = 0,
    existing: Optional[dict] = None,
) -> bool:
    """Tolerans dolduktan sonra yöneticiye konum-dışı talebi açılsın mı?"""
    if not outside:
        return False
    status = str((existing or {}).get("status") or "")
    if status in ("pending", "acked", "approved", "rejected"):
        return False
    hours = max(0, int(tolerance_hours or 0))
    if hours <= 0:
        return True
    start = _parse_iso(first_left_at)
    end = _parse_iso(now) or datetime.now(timezone.utc)
    if not start:
        return False
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return (end - start).total_seconds() >= hours * 3600


def build_location_exit_request(
    *,
    distance_m: float,
    radius_m: float,
    tolerance_hours: int,
    workplace: Optional[dict],
    now: Optional[str] = None,
) -> dict:
    stamp = now or _now()
    return {
        "status": "pending",
        "left_at": stamp,
        "distance_m": int(round(distance_m)),
        "radius_m": int(round(radius_m)),
        "tolerance_hours": max(0, int(tolerance_hours or 0)),
        "place": workplace_place_label(workplace),
        "wage_deduction": None,
        "deduction_amount": 0,
        "requested_at": stamp,
        "decided_at": None,
        "decided_by": None,
        "decision": "",
    }


def _truthy_flag(value: Any) -> bool:
    return value in (True, 1, "1", "true", "True", "yes", "evet", "on")


def parse_location_exit_decision(req: Optional[dict] = None) -> dict:
    """Karar + ücret kesintisi: ack / approve / reject ve wage_deduction evet-hayır."""
    raw = req if isinstance(req, dict) else {}
    decision = str(raw.get("decision") or "").strip().lower()
    aliases = {
        "ack": "ack",
        "acknowledged": "ack",
        "haberim": "ack",
        "approve": "approve",
        "approved": "approve",
        "reject": "reject",
        "rejected": "reject",
        "deduct": "approve",
        "kesinti": "approve",
    }
    if decision not in aliases:
        raise ValueError("decision: ack, approve, reject veya deduct olmalı.")
    status = aliases[decision]
    deduct_raw = raw.get("wage_deduction", raw.get("deduct", raw.get("kesinti")))
    if deduct_raw is None:
        deduct = decision in ("deduct", "kesinti")
    else:
        deduct = _truthy_flag(deduct_raw)
    return {"decision": status, "wage_deduction": bool(deduct)}


def location_exit_decision_message(decision: str, wage_deduction: bool = False, amount: float = 0) -> str:
    if decision == "ack":
        return "Konum dışı çıkış: haberim var." + (" Kesinti yok." if not wage_deduction else "")
    if decision == "reject":
        return "Konum dışı çıkış reddedildi." + (" Kesinti yok." if not wage_deduction else "")
    if wage_deduction:
        amt = float(amount or 0)
        if amt > 0:
            return f"Konum dışı çıkış: ücretten {amt:g} ₺ kesinti uygulandı."
        return "Konum dışı çıkış: ücretten kesinti uygulandı."
    return "Konum dışı çıkış onaylandı (kesinti yok)."


def merge_schedule(company: dict, employee: Optional[dict] = None) -> dict:
    s = {**DEFAULT_SCHEDULE, **((company or {}).get("work_schedule") or {})}
    s["days"] = dict(s.get("days") or {})
    if employee and employee.get("work_schedule"):
        ov = employee["work_schedule"]
        s = {**s, **{k: v for k, v in ov.items() if k != "days" and v not in (None, "", [])}}
        if ov.get("days"):
            s["days"] = {**s["days"], **{k: v for k, v in ov["days"].items() if v}}
    if employee is not None:
        lt = normalize_location_tracking(employee.get("location_tracking"))
        s["location_tracking"] = lt
        # İş yeri (firma) konum kapalıysa schedule.require_geo kapanır; dış görev ayrı alan.
        if not lt["enabled"]:
            s["require_geo"] = False
    return s


def day_window(schedule: dict, weekday: int) -> dict:
    """Haftanın günü için etkin başlangıç/bitiş/mola (gün bazlı override varsa onu kullanır)."""
    d = (schedule.get("days") or {}).get(str(weekday)) or {}
    return {"start": d.get("start") or schedule["start"], "end": d.get("end") or schedule["end"],
            "break_minutes": int(d.get("break_minutes") if d.get("break_minutes") is not None else schedule.get("break_minutes") or 0)}


def _as_float(v, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return float(default)
        return float(v)
    except Exception:
        return float(default)


def _add_minutes(hm: str, minutes: int) -> str:
    total = (_hm(hm) + int(minutes)) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def hours_from_time_range(start, end) -> Optional[float]:
    """HH:MM–HH:MM aralığını saate çevirir; geceye sarkan aralık desteklenir."""
    start = (start or "").strip()
    end = (end or "").strip()
    if not start or not end:
        return None
    try:
        sm, em = _hm(start[:5]), _hm(end[:5])
    except Exception:
        return None
    mins = em - sm
    if mins < 0:
        mins += 24 * 60
    return round(mins / 60.0, 2)


def assigned_overtime_hours(rec: Optional[dict]) -> float:
    """Yönetici tarafından personele atanan fazla mesai (saat)."""
    if not isinstance(rec, dict):
        return 0.0
    return max(0.0, _as_float(rec.get("assigned_overtime_hours"), 0.0))


def approved_intraday_gap_minutes(rec: Optional[dict]) -> int:
    """Onaylı gün içi izin (çıkış–dönüş) dakikası; check_in/out penceresine sıkıştırılır."""
    if not isinstance(rec, dict):
        return 0
    req = rec.get("intraday_leave_request") or {}
    if not (rec.get("intraday_leave_approved") or req.get("status") == "approved"):
        return 0
    out_t = (req.get("out_time") or "").strip()[:5]
    ret_t = (req.get("return_time") or "").strip()[:5]
    if not out_t or not ret_t:
        return 0
    try:
        a, b = _hm(out_t), _hm(ret_t)
    except Exception:
        return 0
    if b <= a:
        return 0
    ci, co = rec.get("check_in"), rec.get("check_out")
    if ci and co:
        try:
            cia, cob = _hm(str(ci)[:5]), _hm(str(co)[:5])
            if cob < cia:
                cob += 24 * 60
            start = max(cia, a)
            end = min(cob, b)
            return max(0, end - start)
        except Exception:
            return max(0, b - a)
    return max(0, b - a)


def compute_day(rec: dict, schedule: dict, plan: Optional[dict] = None) -> dict:
    """check_in/check_out (HH:MM) → hours, normal_hours, overtime_hours, late_minutes, early_leave_minutes, is_off_day.
    Atanan fazla mesai beklenen çıkışı (expected_end) uzatır; erken çıkış buna göre, fazla mesai mesai bitişine göre hesaplanır.
    Onaylı gün içi izin (çıkış–dönüş) çalışılan dakikadan düşülür.
    """
    out = {"hours": 0.0, "normal_hours": 0.0, "overtime_hours": 0.0, "late_minutes": 0, "early_leave_minutes": 0, "is_off_day": False,
           "assigned_overtime_hours": 0.0, "expected_end": None, "intraday_leave_minutes": 0}
    try:
        wd = datetime.strptime(rec.get("date"), "%Y-%m-%d").weekday()
    except Exception:
        wd = 0
    out["is_off_day"] = wd not in (schedule.get("work_days") or DEFAULT_SCHEDULE["work_days"])
    ci, co = rec.get("check_in"), rec.get("check_out")
    win = day_window(schedule, wd)
    if plan:
        out["is_off_day"] = bool(plan.get("off"))
        out["shift_label"] = "İzin/Tatil" if plan.get("off") else f"{plan.get('start')}–{plan.get('end')}"
        if not plan.get("off"):
            win = {"start": plan.get("start") or win["start"], "end": plan.get("end") or win["end"], "break_minutes": int(plan.get("break_minutes") if plan.get("break_minutes") is not None else win["break_minutes"])}
    start_m, end_m = _hm(win["start"]), _hm(win["end"])
    assigned_ot = assigned_overtime_hours(rec)
    out["assigned_overtime_hours"] = round(assigned_ot, 2)
    expected_end_hm = win["end"]
    expected_end_m = end_m
    if assigned_ot > 0 and not out["is_off_day"]:
        add_m = int(round(assigned_ot * 60))
        expected_end_m = end_m + add_m
        expected_end_hm = _add_minutes(win["end"], add_m)
    out["expected_end"] = expected_end_hm
    leave_m = approved_intraday_gap_minutes(rec)
    out["intraday_leave_minutes"] = leave_m
    if ci and not out["is_off_day"]:
        out["late_minutes"] = max(0, _hm(ci) - start_m - int(schedule.get("late_tolerance_minutes") or 0))
    if not (ci and co):
        return out
    a, b = _hm(ci), _hm(co)
    if b < a:
        b += 24 * 60
    worked = max(0, b - a - win["break_minutes"] - leave_m)
    if out["is_off_day"]:
        ot = worked
    else:
        tol = int(schedule.get("overtime_tolerance_minutes") or 0)
        # Fazla mesai: kayıtlı mesai bitişine göre
        ot = (b - end_m) if b - end_m > tol else 0
        if schedule.get("count_early_as_overtime") and a < start_m:
            ot += start_m - a
        # Erken çıkış: atanan fazla mesai dahil beklenen çıkışa göre
        out["early_leave_minutes"] = max(0, expected_end_m - b)
        ot = min(ot, worked)
    out["hours"] = round(worked / 60, 2)
    out["overtime_hours"] = round(ot / 60, 2)
    out["normal_hours"] = round(max(0, worked - ot) / 60, 2)
    out["holiday_overtime_hours"] = out["overtime_hours"] if out["is_off_day"] else 0.0
    return out


def _num(v, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def overtime_rate(schedule: dict, employee: dict) -> dict:
    """Personelin saatlik fazla mesai ücreti (yasal: brüt/225 × katsayı ya da sabit)."""
    method = employee.get("overtime_method") or schedule.get("overtime_method") or "legal"
    mult = _num(schedule.get("overtime_multiplier"), 1.5) or 1.5
    hmult = _num(schedule.get("holiday_multiplier"), 2.0) or 2.0
    if method == "fixed":
        base = _num(employee.get("overtime_hourly_rate"))
        return {"method": "fixed", "hourly_base": base, "weekday_rate": base, "holiday_rate": round(base * hmult / mult, 2) if mult else base, "multiplier": 1.0, "holiday_multiplier": round(hmult / mult, 2) if mult else 1.0}
    gross = _num(employee.get("payroll_salary")) or _num(employee.get("salary")) * 1.4
    divisor = _num(schedule.get("monthly_hours_divisor"), 225) or 225
    base = round(gross / divisor, 2) if divisor else 0.0
    return {"method": "legal", "hourly_base": base, "weekday_rate": round(base * mult, 2), "holiday_rate": round(base * hmult, 2), "multiplier": mult, "holiday_multiplier": hmult}


async def overtime_pay_for_period(company: dict, employee: dict, period: str) -> dict:
    schedule = merge_schedule(company, employee)
    rows = await _db.attendance.find({"employee_id": employee["_id"], "date": {"$regex": f"^{period}"}, "status": "present"}).to_list(100)
    weekday_h = round(sum(r.get("overtime_hours", 0) for r in rows if not r.get("is_off_day")), 2)
    holiday_h = round(sum(r.get("overtime_hours", 0) for r in rows if r.get("is_off_day")), 2)
    rate = overtime_rate(schedule, employee)
    amount = round(weekday_h * rate["weekday_rate"] + holiday_h * rate["holiday_rate"], 2)
    return {"period": period, "overtime_hours": round(weekday_h + holiday_h, 2), "weekday_hours": weekday_h, "holiday_hours": holiday_h, "amount": amount, **rate}


def _valid_time(v: str) -> str:
    v = (v or "").strip()
    try:
        _hm(v)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Geçersiz saat: {v}")
    return v


def clean_days(days: Any) -> dict:
    out = {}
    if not isinstance(days, dict):
        return out
    for k, v in days.items():
        if not isinstance(v, dict) or str(k) not in {"0", "1", "2", "3", "4", "5", "6"}:
            continue
        d = {}
        if v.get("start"):
            d["start"] = _valid_time(v["start"])
        if v.get("end"):
            d["end"] = _valid_time(v["end"])
        if v.get("break_minutes") not in (None, ""):
            d["break_minutes"] = max(0, int(v["break_minutes"]))
        if d.get("start") and d.get("end") and _hm(d["end"]) <= _hm(d["start"]):
            raise HTTPException(status_code=400, detail=f"{DAY_LABELS[int(k)]}: bitiş başlangıçtan sonra olmalı.")
        if d:
            out[str(k)] = d
    return out


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _coords_of(row: Optional[dict]) -> Optional[tuple]:
    if not isinstance(row, dict):
        return None
    try:
        lat, lng = float(row.get("latitude")), float(row.get("longitude"))
    except (TypeError, ValueError):
        return None
    if lat == 0 and lng == 0:
        return None
    return lat, lng


def task_is_open(task: Optional[dict]) -> bool:
    if not isinstance(task, dict):
        return False
    if task.get("done"):
        return False
    return (task.get("status") or "") not in ("done", "completed", "tamamlandi")


def task_kind_of(task: Optional[dict]) -> str:
    """İç görev = office, dış görev = field. Eski kayıtlarda kind yoksa dış görev."""
    if not isinstance(task, dict):
        return "field"
    raw = str(task.get("kind") or task.get("task_kind") or "").strip()
    norm = (
        raw.replace("İ", "i").replace("I", "i").lower()
        .replace("ı", "i").replace("ç", "c").replace("ş", "s")
    )
    if norm in ("office", "ic", "internal", "iceride"):
        return "office"
    return "field"


def task_is_field(task: Optional[dict]) -> bool:
    return task_kind_of(task) == "field"


def pick_field_assignment(rows: list, today: str) -> Optional[dict]:
    """Açık proje görevi (dış görev). Bugün bitişli > tarihsiz > ileriki > geçmiş."""
    today = (today or "")[:10]
    open_rows = [
        a for a in (rows or [])
        if task_is_open(a) and task_is_field(a) and (a.get("project_status") or "") != "completed"
    ]
    if not open_rows:
        return None

    def _score(a: dict):
        due = str(a.get("due_date") or "")[:10]
        has_coords = 0 if _coords_of(a) else 1
        if due == today:
            due_rank = 0
        elif not due:
            due_rank = 1
        elif due >= today:
            due_rank = 2
        else:
            due_rank = 3
        return (due_rank, has_coords, due or "9999", a.get("title") or "")

    return min(open_rows, key=_score)


def workplace_payload(company_loc: Optional[dict], assignment: Optional[dict] = None, radius_default: int = 300) -> Optional[dict]:
    """Etkin iş yeri: açık dış görev varsa proje konumu (+ proje yarıçapı), yoksa firma."""
    if assignment:
        try:
            task_radius = int(float(assignment.get("radius_m") or 0))
        except (TypeError, ValueError):
            task_radius = 0
        if task_radius < 25:
            task_radius = int((company_loc or {}).get("radius_m") or radius_default)
        radius = max(25, min(5000, task_radius))
        title = assignment.get("title") or assignment.get("task_title") or "Görev"
        project_name = assignment.get("project_name") or ""
        coords = _coords_of(assignment)
        return {
            "kind": "task",
            "label": project_name or title or "Dış görev",
            "latitude": coords[0] if coords else None,
            "longitude": coords[1] if coords else None,
            "radius_m": radius,
            "has_coords": bool(coords),
            "address": assignment.get("address") or "",
            "location_url": assignment.get("location_url") or "",
            "task_id": assignment.get("id") or assignment.get("task_id"),
            "task_title": title,
            "project_id": assignment.get("project_id"),
            "project_name": project_name,
            "project_number": assignment.get("project_number") or "",
            "due_date": assignment.get("due_date"),
            "duration_days": _duration_days_of(assignment),
        }
    coords = _coords_of(company_loc)
    if not coords:
        return None
    return {
        "kind": "company",
        "label": (company_loc or {}).get("label") or "Firma",
        "latitude": coords[0],
        "longitude": coords[1],
        "radius_m": int((company_loc or {}).get("radius_m") or radius_default),
        "has_coords": True,
        "address": (company_loc or {}).get("address") or "",
        "location_url": (company_loc or {}).get("location_url") or "",
    }


def geo_target(workplace: Optional[dict]) -> Optional[dict]:
    """Giriş mesafesi için koordinatı olan iş yeri; dış görevde konum yoksa firma zorunlu değil."""
    if workplace and workplace.get("has_coords") and workplace.get("latitude") is not None:
        return workplace
    return None


def workplace_place_label(loc: Optional[dict]) -> str:
    if not loc:
        return "iş yeri"
    if loc.get("kind") == "task":
        return loc.get("project_name") or loc.get("task_title") or "görev yeri"
    return loc.get("label") or "firma"


def _duration_days_of(task: Optional[dict]) -> Optional[int]:
    if not isinstance(task, dict):
        return None
    try:
        n = int(float(task.get("duration_days")))
    except (TypeError, ValueError):
        n = 0
    return n if n > 0 else None


def assignment_from_project(proj: dict, task: dict) -> dict:
    return {
        "id": task.get("id") or task.get("_id"),
        "title": task.get("title") or task.get("name") or "Görev",
        "done": bool(task.get("done") or task.get("status") in ("done", "completed", "tamamlandi")),
        "status": task.get("status"),
        "due_date": task.get("due_date"),
        "duration_days": _duration_days_of(task),
        "kind": task_kind_of(task),
        "project_id": proj.get("_id") or proj.get("id"),
        "project_name": proj.get("name"),
        "project_number": proj.get("project_number"),
        "project_status": proj.get("status"),
        "latitude": proj.get("latitude"),
        "longitude": proj.get("longitude"),
        "address": proj.get("address"),
        "location_url": proj.get("location_url"),
        "radius_m": proj.get("radius_m"),
    }


async def field_assignments_for(emp: dict) -> list:
    emp_id = str(emp.get("_id") or emp.get("id") or "")
    company_id = emp.get("company_id")
    if not emp_id or not company_id or _db is None:
        return []
    out = []
    async for proj in _db.projects.find(
        {"company_id": company_id, "tasks.assignee_id": emp_id},
        {"name": 1, "project_number": 1, "status": 1, "tasks": 1,
         "latitude": 1, "longitude": 1, "address": 1, "location_url": 1, "radius_m": 1},
    ):
        for t in (proj.get("tasks") or []):
            if str(t.get("assignee_id") or "") != emp_id:
                continue
            out.append(assignment_from_project(proj, t))
    return out


def active_duty_of(emp: Optional[dict]) -> dict:
    """Son atanan iç/dış görev; iş yeri ve çıkış referansı buna göre seçilir."""
    if not isinstance(emp, dict):
        return {}
    duty = emp.get("active_duty")
    return duty if isinstance(duty, dict) else {}


def build_active_duty(kind: str, *, task_id: Optional[str] = None, title: str = "",
                      park_id: Optional[str] = None, park_name: str = "",
                      project_id: Optional[str] = None, project_name: str = "",
                      project_number: str = "") -> dict:
    k = task_kind_of({"kind": kind})
    return {
        "kind": k,
        "task_id": task_id,
        "title": (title or "").strip() or ("İç görev" if k == "office" else "Dış görev"),
        "park_id": park_id,
        "park_name": park_name or "",
        "project_id": project_id,
        "project_name": project_name or "",
        "project_number": project_number or "",
        "at": _now(),
    }


def resolve_workplace(company_loc: Optional[dict], assignments: list, today: str,
                      duty: Optional[dict] = None) -> Optional[dict]:
    """İç görev aktifse firma (ücret kesilmez); dış görevde görev yeri; aksi halde açık dış görev."""
    duty = duty if isinstance(duty, dict) else {}
    if task_kind_of(duty) == "office":
        return workplace_payload(company_loc, None)
    rows = list(assignments or [])
    if task_kind_of(duty) == "field" and duty.get("task_id"):
        tid = str(duty.get("task_id"))
        match = next((a for a in rows if str(a.get("id") or "") == tid and task_is_open(a) and task_is_field(a)), None)
        if match:
            return workplace_payload(company_loc, match)
    picked = pick_field_assignment(rows, today)
    return workplace_payload(company_loc, picked)


async def workplace_for_employee(emp: dict, company: Optional[dict] = None, today: Optional[str] = None) -> Optional[dict]:
    company = company if company is not None else (await _db.companies.find_one({"_id": emp["company_id"]}) or {})
    schedule = merge_schedule(company, emp)
    today = today or _today(schedule)
    return resolve_workplace(
        company.get("location"),
        await field_assignments_for(emp),
        today,
        active_duty_of(emp),
    )


async def workplaces_by_employee(company_id: str, emp_ids: list, today: str, company_loc: Optional[dict] = None) -> dict:
    idset = {str(x) for x in (emp_ids or []) if x}
    by_emp = {eid: [] for eid in idset}
    duty_by = {eid: {} for eid in idset}
    if idset and _db is not None:
        async for emp in _db.employees.find({"_id": {"$in": list(idset)}}, {"active_duty": 1}):
            duty_by[str(emp.get("_id"))] = active_duty_of(emp)
        async for proj in _db.projects.find(
            {"company_id": company_id, "tasks.assignee_id": {"$in": list(idset)}},
            {"name": 1, "project_number": 1, "status": 1, "tasks": 1,
             "latitude": 1, "longitude": 1, "address": 1, "location_url": 1, "radius_m": 1},
        ):
            for t in (proj.get("tasks") or []):
                aid = str(t.get("assignee_id") or "")
                if aid not in by_emp:
                    continue
                by_emp[aid].append(assignment_from_project(proj, t))
    return {
        eid: resolve_workplace(company_loc, rows, today, duty_by.get(eid))
        for eid, rows in by_emp.items()
    }


async def employee_for_user(user: dict):
    uid = str(user.get("_id", user.get("id")))
    return await _db.employees.find_one({"$or": [{"_id": user.get("employee_id") or "-"}, {"user_id": uid}]})


async def apply_day(employee: dict, date: str, patch: Dict[str, Any], source: str = "manual", confirmed: Optional[bool] = None) -> dict:
    company = await _db.companies.find_one({"_id": employee["company_id"]}) or {}
    schedule = merge_schedule(company, employee)
    existing = await _db.attendance.find_one({"employee_id": employee["_id"], "date": date}) or {}
    if "assigned_overtime_hours" in patch:
        assigned_ot = max(0.0, _as_float(patch.get("assigned_overtime_hours"), 0.0))
    else:
        assigned_ot = assigned_overtime_hours(existing)
    rec = {"company_id": employee["company_id"], "employee_id": employee["_id"], "employee_name": employee["full_name"], "date": date,
           "status": patch.get("status") or ("present" if (patch.get("check_in") or patch.get("check_out")) else existing.get("status")) or "present",
           "check_in": patch.get("check_in", existing.get("check_in")), "check_out": patch.get("check_out", existing.get("check_out")),
           "note": patch.get("note", existing.get("note", "")), "source": source,
           "assigned_overtime_hours": assigned_ot}
    if rec["status"] in ("absent", "leave"):
        rec.update({"check_in": None, "check_out": None})
    for k in ("early_leave_request", "early_leave_approved", "intraday_leave_request", "intraday_leave_approved"):
        if k in patch:
            rec[k] = patch[k]
        elif existing.get(k) is not None:
            rec[k] = existing[k]
    plan = await _db.shift_plans.find_one({"employee_id": employee["_id"], "date": date})
    rec.update(compute_day(rec, schedule, plan))
    try:
        _wd = datetime.strptime(date, "%Y-%m-%d").weekday()
    except Exception:
        _wd = 0
    _win = day_window(schedule, _wd) if not plan or plan.get("off") else {"start": plan.get("start"), "end": plan.get("end"), "break_minutes": plan.get("break_minutes")}
    rec["schedule_snapshot"] = {
        "start": _win["start"], "end": _win["end"], "break_minutes": _win["break_minutes"], "from_shift_plan": bool(plan),
        "expected_end": rec.get("expected_end") or _win["end"], "assigned_overtime_hours": assigned_ot,
    }
    if confirmed is not None:
        rec["employee_confirmed"] = confirmed
        rec["employee_confirmed_at"] = _now() if confirmed else None
    elif "employee_confirmed" not in existing:
        rec["employee_confirmed"] = False
    # Preserve assignment metadata
    for k in ("assigned_overtime_by", "assigned_overtime_at", "assigned_overtime_note", "assigned_overtime_start", "assigned_overtime_end"):
        if k in patch:
            rec[k] = patch[k]
        elif existing.get(k) is not None:
            rec[k] = existing[k]
    rec["updated_at"] = _now()
    await _db.attendance.update_one({"employee_id": employee["_id"], "date": date}, {"$set": rec, "$setOnInsert": {"_id": str(uuid.uuid4()), "created_at": _now()}}, upsert=True)
    return _clean(await _db.attendance.find_one({"employee_id": employee["_id"], "date": date}))


def summarize(rows: list) -> dict:
    present = [r for r in rows if r.get("status") == "present"]
    return {"days_present": len(present), "days_absent": sum(1 for r in rows if r.get("status") == "absent"), "days_leave": sum(1 for r in rows if r.get("status") == "leave"),
            "total_hours": round(sum(r.get("hours", 0) for r in present), 2), "normal_hours": round(sum(r.get("normal_hours", r.get("hours", 0) - r.get("overtime_hours", 0)) for r in present), 2),
            "overtime_hours": round(sum(r.get("overtime_hours", 0) for r in present), 2), "late_count": sum(1 for r in present if r.get("late_minutes", 0) > 0),
            "late_minutes": sum(r.get("late_minutes", 0) for r in present), "off_day_count": sum(1 for r in present if r.get("is_off_day")),
            "unconfirmed": sum(1 for r in rows if not r.get("employee_confirmed"))}


def _ymd(v) -> Optional[str]:
    s = str(v or "").strip()[:10]
    if len(s) != 10:
        return None
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None
    return s


def _pct(num: float, den: float) -> int:
    if den <= 0:
        return 100
    return max(0, min(100, int(round(100.0 * float(num) / float(den)))))


def month_bounds(month: str):
    y, m = int(month[:4]), int(month[5:7])
    start = datetime(y, m, 1).date()
    if m == 12:
        end = datetime(y + 1, 1, 1).date()
    else:
        end = datetime(y, m + 1, 1).date()
    return start, end - timedelta(days=1)


def expected_work_dates(month: str, work_days=None, hire_date=None, end_date=None, today=None) -> list:
    """Ay içindeki beklenen iş günleri (işe giriş–ayrılış ve bugün ile kırpılır)."""
    work_days = set(int(d) for d in (work_days if work_days is not None else DEFAULT_SCHEDULE["work_days"]))
    start, last = month_bounds(month)
    today_s = _ymd(today) or local_now().strftime("%Y-%m-%d")
    today_d = datetime.strptime(today_s, "%Y-%m-%d").date()
    end = min(last, today_d)
    hire_s = _ymd(hire_date)
    if hire_s:
        start = max(start, datetime.strptime(hire_s, "%Y-%m-%d").date())
    term_s = _ymd(end_date)
    if term_s:
        end = min(end, datetime.strptime(term_s, "%Y-%m-%d").date())
    if end < start:
        return []
    out = []
    d = start
    while d <= end:
        if d.weekday() in work_days:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def expand_leave_dates(leaves: list, start: str, end: str) -> set:
    """Onaylı izin günlerini [start, end] aralığında küme olarak döner."""
    a, b = _ymd(start), _ymd(end)
    if not a or not b:
        return set()
    ad = datetime.strptime(a, "%Y-%m-%d").date()
    bd = datetime.strptime(b, "%Y-%m-%d").date()
    days = set()
    for lv in leaves or []:
        if lv.get("status") != "approved":
            continue
        ls, le = _ymd(lv.get("start_date")), _ymd(lv.get("end_date") or lv.get("start_date"))
        if not ls:
            continue
        if not le:
            le = ls
        d = max(datetime.strptime(ls, "%Y-%m-%d").date(), ad)
        last = min(datetime.strptime(le, "%Y-%m-%d").date(), bd)
        while d <= last:
            days.add(d.isoformat())
            d += timedelta(days=1)
    return days


def performance_scores(att_rows: list, leaves: list, tasks: list, work_orders: list,
                       expected: list, month: str) -> dict:
    """Giriş / çıkış / izin / görev işlemlerinin yüzde performansı."""
    by_date = {r.get("date"): r for r in (att_rows or []) if r.get("date")}
    leave_days = expand_leave_dates(leaves, expected[0] if expected else f"{month}-01",
                                    expected[-1] if expected else f"{month}-28")
    checkin_ok = checkout_ok = tracked = 0
    absent = 0
    covered_leave = 0
    for d in expected or []:
        rec = by_date.get(d) or {}
        on_leave = d in leave_days or rec.get("status") == "leave"
        if on_leave:
            covered_leave += 1
            continue
        tracked += 1
        if rec.get("check_in"):
            checkin_ok += 1
        if rec.get("check_out"):
            checkout_ok += 1
        missing = not rec.get("check_in") and not rec.get("check_out")
        if rec.get("status") == "absent" or missing:
            absent += 1
    task_done = sum(1 for t in (tasks or []) if t.get("done") or t.get("status") in ("done", "completed", "tamamlandi"))
    task_total = len(tasks or [])
    wo_done_st = {"done", "completed", "tamamlandi"}
    wo_done = sum(1 for w in (work_orders or []) if (w.get("status") or "") in wo_done_st)
    wo_total = len(work_orders or [])
    work_done, work_total = task_done + wo_done, task_total + wo_total
    check_in = {"pct": _pct(checkin_ok, tracked), "ok": checkin_ok, "expected": tracked}
    check_out = {"pct": _pct(checkout_ok, tracked), "ok": checkout_ok, "expected": tracked}
    leave = {"pct": _pct(covered_leave, covered_leave + absent), "approved_days": covered_leave, "absent_days": absent}
    task = {"pct": _pct(work_done, work_total) if work_total else 100, "done": work_done, "total": work_total}
    overall = int(round((check_in["pct"] + check_out["pct"] + leave["pct"] + task["pct"]) / 4.0))
    return {"check_in": check_in, "check_out": check_out, "leave": leave, "task": task, "overall": overall, "month": month}


# ---------- Çalışma saatleri ----------
@router.get("/companies/{company_id}/work-schedule")
async def get_work_schedule(company_id: str):
    company = await _db.companies.find_one({"_id": company_id}) or {}
    return {"schedule": merge_schedule(company), "day_labels": DAY_LABELS, "defaults": DEFAULT_SCHEDULE, "overtime_methods": OVERTIME_METHODS}


@router.put("/companies/{company_id}/work-schedule")
async def put_work_schedule(company_id: str, req: Dict[str, Any]):
    company = await _db.companies.find_one({"_id": company_id}) or {}
    s = merge_schedule(company)
    for k in ("start", "end"):
        v = (req.get(k) or s[k]).strip()
        try:
            _hm(v)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Geçersiz saat: {v}")
        s[k] = v
    if _hm(s["end"]) <= _hm(s["start"]):
        raise HTTPException(status_code=400, detail="Mesai bitişi başlangıçtan sonra olmalı.")
    for k in ("break_minutes", "late_tolerance_minutes", "overtime_tolerance_minutes"):
        s[k] = max(0, int(req.get(k) if req.get(k) is not None else s[k]))
    wd = req.get("work_days")
    if isinstance(wd, list) and wd:
        s["work_days"] = sorted({int(d) for d in wd if 0 <= int(d) <= 6})
    s["count_early_as_overtime"] = bool(req.get("count_early_as_overtime", s["count_early_as_overtime"]))
    s["require_geo"] = bool(req.get("require_geo", s["require_geo"]))
    if "days" in req:
        s["days"] = clean_days(req.get("days"))
    if req.get("overtime_method") in OVERTIME_METHODS:
        s["overtime_method"] = req["overtime_method"]
    for k in ("overtime_multiplier", "holiday_multiplier", "monthly_hours_divisor"):
        if req.get(k) not in (None, ""):
            v = float(req[k])
            if v <= 0:
                raise HTTPException(status_code=400, detail=f"{k} sıfırdan büyük olmalı.")
            s[k] = v
    for k in ("notify_missing_checkin", "notify_late_checkin"):
        if k in req:
            s[k] = bool(req[k])
    tz = (req.get("timezone") or s["timezone"]).strip()
    try:
        ZoneInfo(tz)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Geçersiz saat dilimi: {tz}")
    s["timezone"] = tz
    s["updated_at"] = _now()
    await _db.companies.update_one({"_id": company_id}, {"$set": {"work_schedule": s}})
    return {"status": "success", "schedule": s}


# ---------- Personel self-servis ----------
@router.get("/personnel/attendance/me")
async def my_attendance(request: Request, company_id: Optional[str] = None, month: Optional[str] = None):
    user = await _current_user(request)
    emp = await employee_for_user(user)
    if not emp:
        return {"employee": None, "records": [], "summary": summarize([]), "today": None, "schedule": None, "location": None, "workplace": None, "company_location": None}
    company = await _db.companies.find_one({"_id": emp["company_id"]}) or {}
    schedule = merge_schedule(company, emp)
    month = month or _today(schedule)[:7]
    today_s = _today(schedule)
    rows = await _db.attendance.find({"employee_id": emp["_id"], "date": {"$regex": f"^{month}"}}).sort("date", -1).to_list(100)
    today = await _db.attendance.find_one({"employee_id": emp["_id"], "date": today_s})
    workplace = await workplace_for_employee(emp, company, today_s)
    loc = geo_target(workplace)
    lt = normalize_location_tracking(emp.get("location_tracking"))
    active_lt = location_mode_for(lt, workplace)
    # /me: etkin iş yerine göre require_geo (dış görevde field.enabled).
    if workplace and workplace.get("kind") == "task":
        schedule = {**schedule, "require_geo": bool(active_lt.get("enabled"))}
    elif not active_lt.get("enabled"):
        schedule = {**schedule, "require_geo": False}
    return {"employee": {"id": emp["_id"], "full_name": emp["full_name"], "department": emp.get("department"), "position": emp.get("position")},
            "month": month, "records": [_clean(r) for r in rows], "summary": summarize(rows), "today": _clean(today) if today else None,
            "schedule": schedule, "day_labels": DAY_LABELS, "location": loc, "workplace": workplace,
            "company_location": company.get("location"), "location_tracking": lt,
            "active_location_tracking": active_lt,
            "now": now_hm(schedule), "today_date": today_s}


@router.post("/personnel/attendance/self")
async def self_attendance(req: Dict[str, Any], request: Request):
    user = await _current_user(request)
    action = req.get("action")
    if action not in ("check_in", "check_out"):
        raise HTTPException(status_code=400, detail="action check_in veya check_out olmalı.")
    emp = await employee_for_user(user)
    if not emp:
        raise HTTPException(status_code=403, detail="Kullanıcınız bir personel kartına bağlı değil (Personel Kartı → Sistem Kullanıcısı).")
    company = await _db.companies.find_one({"_id": emp["company_id"]}) or {}
    schedule = merge_schedule(company, emp)
    workplace = await workplace_for_employee(emp, company)
    loc = geo_target(workplace)
    lt = normalize_location_tracking(emp.get("location_tracking"))
    active_lt = location_mode_for(lt, workplace)
    # Dış görevde field.enabled; iş yerinde şirket require_geo ∧ personel iş yeri enabled.
    if workplace and workplace.get("kind") == "task":
        enforce_geo = bool(active_lt.get("enabled"))
    else:
        enforce_geo = bool(schedule.get("require_geo", True)) and bool(active_lt.get("enabled"))
    geo = None
    # Konum zorunluluğu yalnızca girişte; açık dış görev / etkin dış görev varsa görev yeri iş yeri sayılır.
    # Çıkış: konum zorunlu değil ama referans her zaman etkin iş yeri (dış görevde görev yeri;
    # iş yerinde dış görev atanmışsa çıkış da dış görev yerini referans alır).
    if action == "check_in" and loc and enforce_geo:
        try:
            lat, lng = float(req["latitude"]), float(req["longitude"])
        except (KeyError, TypeError, ValueError):
            place = workplace_place_label(loc)
            if loc.get("kind") == "task":
                raise HTTPException(status_code=400, detail=f"Konum gerekli: telefon konum iznini açın. Dış görev atandığı için giriş yalnızca görev yeri ({place}) yakınından yapılabilir.")
            raise HTTPException(status_code=400, detail="Konum gerekli: telefon konum iznini açın. Firma konumu tanımlı olduğundan giriş yalnızca firma yakınından yapılabilir.")
        dist = haversine_m(lat, lng, loc["latitude"], loc["longitude"])
        radius = float(loc.get("radius_m") or 300)
        if dist > radius:
            place = workplace_place_label(loc)
            if loc.get("kind") == "task":
                raise HTTPException(status_code=400, detail=f"Görev yerine ({place}) {int(dist)} m uzaktasınız (izin verilen {int(radius)} m). Dış görev girişi görev konumundan yapılmalıdır.")
            raise HTTPException(status_code=400, detail=f"Firma konumuna {int(dist)} m uzaktasınız (izin verilen {int(radius)} m). Giriş yapılamadı.")
        geo = {"latitude": lat, "longitude": lng, "distance_m": round(dist), "accuracy_m": float(req.get("accuracy_m") or 0), "at": _now(), "enforced": True, "workplace_kind": loc.get("kind")}
    elif action == "check_out" and not checkout_distance_blocks():
        # Çıkış yalnız butonla, her yerden. Konum açıksa GPS kayda eklenir; mesafe asla reddetmez. Otomatik giriş-çıkış yok.
        ref = workplace if workplace and workplace.get("kind") == "task" else (loc or workplace)
        try:
            lat, lng = float(req["latitude"]), float(req["longitude"])
        except (KeyError, TypeError, ValueError):
            lat = lng = None
        if lat is not None and lng is not None:
            if ref and ref.get("has_coords") and ref.get("latitude") is not None:
                dist = haversine_m(lat, lng, ref["latitude"], ref["longitude"])
                geo = {"latitude": lat, "longitude": lng, "distance_m": round(dist), "accuracy_m": float(req.get("accuracy_m") or 0), "at": _now(), "enforced": False, "workplace_kind": ref.get("kind"), "reference": "field" if ref.get("kind") == "task" else "company"}
            else:
                geo = {"latitude": lat, "longitude": lng, "distance_m": None, "accuracy_m": float(req.get("accuracy_m") or 0), "at": _now(), "enforced": False}
    today = _today(schedule)
    existing = await _db.attendance.find_one({"employee_id": emp["_id"], "date": today}) or {}
    if action == "check_in" and existing.get("check_in"):
        raise HTTPException(status_code=400, detail=f"Bugün {existing['check_in']} saatinde giriş yapılmış.")
    if action == "check_out" and not existing.get("check_in"):
        raise HTTPException(status_code=400, detail="Önce giriş yapmalısınız.")
    if action == "check_out" and existing.get("check_out"):
        raise HTTPException(status_code=400, detail=f"Bugün {existing['check_out']} saatinde çıkış yapılmış.")
    now_s = now_hm(schedule)
    patch = {"status": "present", action: now_s}
    rec = await apply_day(emp, today, patch, source="self", confirmed=True)
    extra = {}
    if workplace:
        extra["workplace"] = workplace
        rec["workplace"] = workplace
        if workplace.get("kind") == "task":
            extra["duty_kind"] = "field"
            rec["duty_kind"] = "field"
        else:
            extra["duty_kind"] = "office" if task_kind_of(active_duty_of(emp)) == "office" else "company"
            rec["duty_kind"] = extra["duty_kind"]
    if geo:
        extra[f"geo_{action}"] = geo
        rec[f"geo_{action}"] = geo
    if extra:
        await _db.attendance.update_one({"_id": rec["id"]}, {"$set": extra})
    msg = f"{'Giriş' if action == 'check_in' else 'Çıkış'} {now_s} olarak kaydedildi."
    if action == "check_in" and rec.get("late_minutes"):
        msg += f" Mesai başlangıcına göre {rec['late_minutes']} dk geç."
        if schedule.get("notify_late_checkin", True):
            await notify_managers(emp["company_id"], "attendance_late", f"Geç giriş: {emp['full_name']}",
                                  f"{emp['full_name']} bugün {now_s} saatinde giriş yaptı — mesai başlangıcına göre {rec['late_minutes']} dk geç.", dedupe_key=f"late:{emp['_id']}:{today}")
    if action == "check_out":
        if rec.get("assigned_overtime_hours"):
            msg += f" Atanan fazla mesai {rec['assigned_overtime_hours']} sa (beklenen çıkış {rec.get('expected_end') or schedule.get('end')})."
        if rec.get("overtime_hours"):
            msg += f" Bugün {rec['hours']} sa çalışıldı, {rec['overtime_hours']} sa fazla mesai yazıldı."
        elif rec.get("early_leave_minutes"):
            end_label = rec.get("expected_end") or schedule.get("end")
            if rec.get("early_leave_approved") or (rec.get("early_leave_request") or {}).get("status") == "approved":
                await _db.attendance.update_one({"_id": rec["id"]}, {"$set": {"early_leave_approved": True}})
                rec["early_leave_approved"] = True
                msg += f" Onaylı erken çıkış: beklenen ({end_label}) saatinden {rec['early_leave_minutes']} dk önce."
            else:
                msg += f" Beklenen çıkış ({end_label}) saatinden {rec['early_leave_minutes']} dk erken çıkış."
        else:
            msg += f" Bugün {rec['hours']} sa çalışıldı."
    if geo and geo.get("distance_m") is not None:
        place = workplace_place_label(workplace if workplace and workplace.get("kind") == "task" else (loc or workplace))
        kind = (workplace or loc or {}).get("kind")
        if kind == "task":
            msg += f" (dış görev yeri {place} · {geo['distance_m']} m)"
        else:
            msg += f" (firma konumuna {geo['distance_m']} m)"
    elif workplace and workplace.get("kind") == "task":
        msg += f" (dış görev: {workplace_place_label(workplace)})"
    yev = None
    try:
        if action == "check_in":
            yev = await accrue_task_yevmiye(emp, rec, workplace, schedule)
            if yev:
                rec["yevmiye_bonus_id"] = yev.get("_id") or yev.get("id")
                rec["yevmiye_full_amount"] = yev.get("amount")
                msg += f" Yevmiye eklendi: {yev.get('amount')} ₺ (kart ücreti)."
            if rec.get("yevmiye_bonus_id") and personnel_wage.yevmiye_adjustment_needed(rec.get("late_minutes") or 0, 0):
                yev = await sync_yevmiye_adjustment(emp, rec, schedule) or yev
        elif action == "check_out":
            yev = await sync_yevmiye_adjustment(emp, rec, schedule)
        adj = (rec.get("yevmiye_adjustment_request") or {})
        if adj.get("status") == "pending":
            msg += f" Geç/erken için yevmiye {adj.get('proposed_amount')} ₺ önerildi — yönetici onayı bekleniyor."
    except Exception:
        yev = None
    if action == "check_out" and geo and geo.get("latitude") is not None and workplace and workplace.get("kind") == "task":
        try:
            opened = await maybe_open_location_exit(
                emp, rec, workplace, loc or workplace, active_lt,
                float(geo["latitude"]), float(geo["longitude"]),
            )
            if opened:
                rec["location_exit_request"] = opened
                msg += " Konum dışı çıkış yöneticiye iletildi."
        except Exception:
            pass
    return {"status": "success", "record": rec, "message": msg, "workplace": workplace, "yevmiye": yev}


async def maybe_open_location_exit(
    emp: dict,
    rec: dict,
    workplace: Optional[dict],
    target: Optional[dict],
    mode: dict,
    lat: float,
    lng: float,
) -> Optional[dict]:
    """Dış görevde konum dışında tolerans dolunca yönetici talebi aç."""
    if not rec or not mode.get("enabled"):
        return None
    if (workplace or {}).get("kind") != "task":
        return None
    loc = geo_target(target or workplace)
    if not loc:
        return None
    att_id = rec.get("id") or rec.get("_id")
    if not att_id:
        return None
    dist = haversine_m(lat, lng, loc["latitude"], loc["longitude"])
    radius = float(loc.get("radius_m") or 300)
    outside = dist > radius
    now = _now()
    existing = rec.get("location_exit_request")
    first_left = rec.get("location_left_at") or (existing or {}).get("left_at")
    if outside and not first_left:
        first_left = now
        await _db.attendance.update_one({"_id": att_id}, {"$set": {"location_left_at": first_left, "updated_at": now}})
        rec["location_left_at"] = first_left
    if not outside:
        if rec.get("location_left_at"):
            await _db.attendance.update_one({"_id": att_id}, {"$unset": {"location_left_at": ""}})
            rec.pop("location_left_at", None)
        return None
    if not location_exit_should_notify(
        outside=True,
        first_left_at=first_left,
        now=now,
        tolerance_hours=int(mode.get("exit_tolerance_hours") or 0),
        existing=existing,
    ):
        return None
    req = build_location_exit_request(
        distance_m=dist,
        radius_m=radius,
        tolerance_hours=int(mode.get("exit_tolerance_hours") or 0),
        workplace=workplace or loc,
        now=now,
    )
    await _db.attendance.update_one({"_id": att_id}, {"$set": {"location_exit_request": req, "updated_at": now}})
    rec["location_exit_request"] = req
    await notify_managers(
        emp["company_id"],
        "location_exit",
        f"Konum dışı: {emp.get('full_name')}",
        f"{emp.get('full_name')} dış görev yerinden {int(dist)} m uzakta (izin {int(radius)} m"
        + (f", tolerans {int(mode.get('exit_tolerance_hours') or 0)} sa" if mode.get("exit_tolerance_hours") else "")
        + "). Haberim var / onayla / reddet · kesinti olsun / olmasın.",
        link="/personnel?tab=attendance",
        dedupe_key=f"locexit:{emp.get('_id')}:{rec.get('date')}",
    )
    return req


@router.post("/personnel/attendance/self/location")
async def self_location_ping(req: Dict[str, Any], request: Request):
    """Sürekli/aralıklı takip: konum ping. Çıkış basılmaz; tolerans dolunca yönetici talebi açar."""
    user = await _current_user(request)
    emp = await employee_for_user(user)
    if not emp:
        raise HTTPException(status_code=403, detail="Kullanıcınız bir personel kartına bağlı değil (Personel Kartı → Sistem Kullanıcısı).")
    try:
        lat, lng = float(req["latitude"]), float(req["longitude"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Konum gerekli.")
    company = await _db.companies.find_one({"_id": emp["company_id"]}) or {}
    schedule = merge_schedule(company, emp)
    workplace = await workplace_for_employee(emp, company)
    loc = geo_target(workplace)
    lt = normalize_location_tracking(emp.get("location_tracking"))
    active_lt = location_mode_for(lt, workplace)
    today = _today(schedule)
    rec = await _db.attendance.find_one({"employee_id": emp["_id"], "date": today}) or {}
    if rec:
        rec["id"] = rec.get("_id") or rec.get("id")
    opened = None
    if rec.get("check_in") and not rec.get("check_out") and loc and active_lt.get("enabled"):
        opened = await maybe_open_location_exit(emp, rec, workplace, loc, active_lt, lat, lng)
    dist = None
    outside = False
    if loc:
        dist = round(haversine_m(lat, lng, loc["latitude"], loc["longitude"]))
        outside = dist > float(loc.get("radius_m") or 300)
    return {
        "status": "success",
        "outside": outside,
        "distance_m": dist,
        "opened": bool(opened),
        "request": opened,
        "workplace": workplace,
        "active_location_tracking": active_lt,
    }


async def apply_location_exit_wage_deduction(emp: dict, rec: dict, ler: dict) -> dict:
    """Kesinti evet ise günlük ücret kadar borç (borc) yazar."""
    amount = round(float(personnel_wage.reference_daily_wage(emp) or 0), 2)
    ler["deduction_amount"] = amount
    if amount <= 0:
        return ler
    att_id = rec.get("id") or rec.get("_id")
    existing_id = ler.get("deduction_bonus_id")
    if existing_id:
        existing = await _db.bonus_payments.find_one({"_id": existing_id})
        if existing:
            return ler
    date = rec.get("date") or _today()
    period = date[:7] if date else datetime.now(timezone.utc).strftime("%Y-%m")
    bonus_id = str(uuid.uuid4())
    doc = {
        "_id": bonus_id,
        "company_id": emp["company_id"],
        "employee_id": emp["_id"],
        "employee_name": emp.get("full_name") or rec.get("employee_name"),
        "type": "borc",
        "type_label": "Borç",
        "period": period,
        "date": date,
        "amount": amount,
        "note": f"Konum dışı çıkış kesintisi · {personnel_wage.wage_line(1, amount)}",
        "status": "pending",
        "source": "location_exit",
        "attendance_id": att_id,
        "is_official": False,
        "created_at": _now(),
    }
    await _db.bonus_payments.insert_one(doc)
    ler["deduction_bonus_id"] = bonus_id
    return ler


@router.post("/personnel/attendance/{att_id}/location-exit-decision")
async def decide_location_exit(att_id: str, req: Dict[str, Any], request: Request):
    user = await _current_user(request)
    if user.get("role") not in ("admin", "manager", "accountant"):
        raise HTTPException(status_code=403, detail="Konum dışı çıkışı yanıtlamak için yönetici yetkisi gerekir.")
    rec = await _db.attendance.find_one({"_id": att_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Puantaj kaydı bulunamadı.")
    ler = rec.get("location_exit_request") or {}
    if ler.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Bekleyen konum dışı çıkış yok.")
    try:
        parsed = parse_location_exit_decision(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    decision = parsed["decision"]
    deduct = bool(parsed["wage_deduction"])
    if decision == "ack":
        status = "acked"
        label = "haberim var"
    elif decision == "approve":
        status = "approved"
        label = "onaylandı"
    else:
        status = "rejected"
        label = "reddedildi"
    ler = {
        **ler,
        "status": status,
        "decision": status,
        "wage_deduction": deduct,
        "decided_at": _now(),
        "decided_by": str(user.get("_id") or user.get("id") or ""),
        "decision_note": (req.get("note") or "")[:300],
    }
    emp = await _db.employees.find_one({"_id": rec.get("employee_id")}) or {}
    if deduct:
        ler = await apply_location_exit_wage_deduction(emp, rec, ler)
    amount = float(ler.get("deduction_amount") or 0)
    await _db.attendance.update_one(
        {"_id": att_id},
        {"$set": {"location_exit_request": ler, "updated_at": _now()}},
    )
    import notify as _notify
    msg = location_exit_decision_message(decision, deduct, amount)
    await _notify.insert_notification(_db, {
        "_id": str(uuid.uuid4()),
        "company_id": rec["company_id"],
        "user_id": emp.get("user_id") or rec.get("employee_id"),
        "type": "location_exit_decision",
        "title": f"Konum dışı çıkış {label}" + (" · kesinti" if deduct else " · kesinti yok"),
        "message": f"{rec.get('employee_name')} — {msg} {ler.get('decision_note') or ''}".strip(),
        "link": "/mesai",
        "is_read": False,
        "created_at": _now(),
    })
    return {"status": "success", "record": _clean(await _db.attendance.find_one({"_id": att_id})), "message": msg, "wage_deduction": deduct, "deduction_amount": amount}


async def accrue_task_yevmiye(emp: dict, rec: dict, workplace: Optional[dict], schedule: dict) -> Optional[dict]:
    """Görev konumunda giriş: kart ücretinden 1 günlük yevmiye (ödenmemiş)."""
    if (workplace or {}).get("kind") != "task":
        return None
    wage = personnel_wage.reference_daily_wage(emp)
    if wage <= 0:
        return None
    if personnel_wage.pay_type_of(emp) != "daily" and personnel_wage.daily_wage_of(emp) <= 0:
        return None
    att_id = rec.get("id") or rec.get("_id")
    date = rec.get("date")
    if rec.get("yevmiye_bonus_id"):
        existing = await _db.bonus_payments.find_one({"_id": rec["yevmiye_bonus_id"]})
        if existing:
            return existing
    if date:
        existing = await _db.bonus_payments.find_one({
            "employee_id": emp["_id"], "type": "yevmiye", "source": "attendance", "date": date,
        })
        if existing:
            await _db.attendance.update_one({"_id": att_id}, {"$set": {"yevmiye_bonus_id": existing["_id"], "yevmiye_full_amount": existing.get("daily_wage") or existing.get("amount")}})
            return existing
    bonus_id = str(uuid.uuid4())
    period = (date or "")[:7] or datetime.now(timezone.utc).strftime("%Y-%m")
    doc = {
        "_id": bonus_id,
        "company_id": emp["company_id"],
        "employee_id": emp["_id"],
        "employee_name": emp.get("full_name"),
        "type": "yevmiye",
        "type_label": "Yevmiye",
        "period": period,
        "date": date,
        "amount": wage,
        "daily_wage": wage,
        "worked_days": 1,
        "note": f"Görev girişi · {personnel_wage.wage_line(1, wage)}",
        "status": "pending",
        "source": "attendance",
        "attendance_id": att_id,
        "is_official": False,
        "created_at": _now(),
    }
    await _db.bonus_payments.insert_one(doc)
    await _db.attendance.update_one({"_id": att_id}, {"$set": {"yevmiye_bonus_id": bonus_id, "yevmiye_full_amount": wage}})
    rec["yevmiye_bonus_id"] = bonus_id
    rec["yevmiye_full_amount"] = wage
    return doc


async def sync_yevmiye_adjustment(emp: dict, rec: dict, schedule: dict) -> Optional[dict]:
    """Geç giriş / erken çıkış yevmiyeyi düşürür; ücret değişimi yönetici onayına düşer."""
    bid = rec.get("yevmiye_bonus_id")
    if not bid:
        return None
    bonus = await _db.bonus_payments.find_one({"_id": bid})
    if not bonus or bonus.get("status") == "paid":
        return bonus
    wage = float(rec.get("yevmiye_full_amount") or bonus.get("daily_wage") or personnel_wage.reference_daily_wage(emp) or 0)
    late = int(rec.get("late_minutes") or 0)
    early = int(rec.get("early_leave_minutes") or 0)
    sched_m = personnel_wage.scheduled_work_minutes(schedule)
    proposed = personnel_wage.yevmiye_adjusted_amount(wage, late, early, sched_m)
    if not personnel_wage.yevmiye_adjustment_needed(late, early) or proposed >= wage:
        return bonus
    prev = rec.get("yevmiye_adjustment_request") or {}
    if prev.get("status") in ("approved", "rejected") and int(prev.get("late_minutes") or 0) == late and int(prev.get("early_leave_minutes") or 0) == early:
        return bonus
    req = {
        "status": "pending",
        "full_amount": wage,
        "proposed_amount": proposed,
        "late_minutes": late,
        "early_leave_minutes": early,
        "requested_at": prev.get("requested_at") or _now(),
    }
    await _db.attendance.update_one({"_id": rec.get("id") or rec.get("_id")}, {"$set": {"yevmiye_adjustment_request": req}})
    rec["yevmiye_adjustment_request"] = req
    await notify_managers(
        emp["company_id"],
        "yevmiye_adjustment",
        f"Geç giriş ücreti: {emp.get('full_name')}",
        f"{emp.get('full_name')} {rec.get('date')}: tam {wage} ₺ → kesilecek {proposed} ₺ · Ücret kes / ücret kesme"
        + (f" · {late} dk geç" if late else "")
        + (f" · {early} dk erken" if early else ""),
        link="/personnel?tab=attendance",
        dedupe_key=f"yev:{emp['_id']}:{rec.get('date')}",
    )
    return bonus


@router.post("/personnel/attendance/{att_id}/yevmiye-decision")
async def decide_yevmiye_adjustment(att_id: str, req: Dict[str, Any], request: Request):
    user = await _current_user(request)
    if user.get("role") not in ("admin", "manager", "accountant"):
        raise HTTPException(status_code=403, detail="Yevmiye onaylamak için yönetici yetkisi gerekir.")
    rec = await _db.attendance.find_one({"_id": att_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Puantaj kaydı bulunamadı.")
    adj = rec.get("yevmiye_adjustment_request") or {}
    if adj.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Bekleyen yevmiye düzeltmesi yok.")
    decision = (req.get("decision") or "").strip().lower()
    if decision not in ("approve", "reject", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="decision: approve veya reject olmalı.")
    approved = decision in ("approve", "approved")
    full_amt = float(adj.get("full_amount") or rec.get("yevmiye_full_amount") or 0)
    proposed = float(adj.get("proposed_amount") or full_amt)
    final_amt = proposed if approved else full_amt
    adj = {
        **adj,
        "status": "approved" if approved else "rejected",
        "decided_at": _now(),
        "decided_by": str(user.get("_id") or user.get("id") or ""),
        "final_amount": final_amt,
    }
    await _db.attendance.update_one({"_id": att_id}, {"$set": {"yevmiye_adjustment_request": adj, "updated_at": _now()}})
    bid = rec.get("yevmiye_bonus_id")
    if bid:
        note = f"Görev yevmiye · {personnel_wage.wage_line(1, final_amt)}"
        if approved:
            note += f" (kart {full_amt} ₺, geç/erken düşüldü)"
        await _db.bonus_payments.update_one(
            {"_id": bid, "status": {"$ne": "paid"}},
            {"$set": {"amount": final_amt, "daily_wage": final_amt if approved else (rec.get("yevmiye_full_amount") or full_amt), "note": note}},
        )
    import notify as _notify
    emp_row = await _db.employees.find_one({"_id": rec.get("employee_id")}) or {}
    await _notify.insert_notification(_db, {
        "_id": str(uuid.uuid4()),
        "company_id": rec["company_id"],
        "user_id": emp_row.get("user_id") or rec.get("employee_id"),
        "type": "yevmiye_adjustment",
        "title": "Ücret kesildi" if approved else "Ücret kesilmedi",
        "message": f"{rec.get('employee_name')} — {final_amt} ₺",
        "link": "/mesai",
        "is_read": False,
        "created_at": _now(),
        "roles": [],
        "employee_id": rec.get("employee_id"),
    })
    return {
        "status": "success",
        "message": ("Ücret kesildi." if approved else "Ücret kesilmedi.") + f" Yevmiye {final_amt:g} ₺.",
        "amount": final_amt,
        "approved": approved,
    }


@router.post("/personnel/attendance/early-leave-request")
async def request_early_leave(req: Dict[str, Any], request: Request):
    """Personel bugün için erken çıkış talebi oluşturur; yönetici onaylar."""
    user = await _current_user(request)
    emp = await employee_for_user(user)
    if not emp:
        raise HTTPException(status_code=403, detail="Kullanıcınız bir personel kartına bağlı değil (Personel Kartı → Sistem Kullanıcısı).")
    reason = (req.get("reason") or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=400, detail="Erken çıkış nedeni en az 3 karakter olmalı.")
    company = await _db.companies.find_one({"_id": emp["company_id"]}) or {}
    schedule = merge_schedule(company, emp)
    today = _today(schedule)
    existing = await _db.attendance.find_one({"employee_id": emp["_id"], "date": today}) or {}
    if not existing.get("check_in"):
        raise HTTPException(status_code=400, detail="Erken çıkış talebi için önce giriş yapmalısınız.")
    if existing.get("check_out"):
        raise HTTPException(status_code=400, detail="Bugün zaten çıkış yapılmış.")
    prev = existing.get("early_leave_request") or {}
    if prev.get("status") == "pending":
        raise HTTPException(status_code=400, detail="Bekleyen bir erken çıkış talebiniz var.")
    if prev.get("status") == "approved":
        raise HTTPException(status_code=400, detail="Erken çıkış talebiniz zaten onaylandı — çıkış yapabilirsiniz.")
    planned = (req.get("planned_time") or "").strip() or None
    if planned:
        try:
            _hm(planned)
        except Exception:
            raise HTTPException(status_code=400, detail="Geçersiz planlanan çıkış saati (HH:MM).")
    elr = {
        "status": "pending",
        "reason": reason[:400],
        "planned_time": planned,
        "requested_at": _now(),
        "requested_by": str(user.get("_id") or user.get("id") or ""),
        "decided_at": None,
        "decided_by": None,
        "decision_note": "",
    }
    if existing.get("_id"):
        await _db.attendance.update_one({"_id": existing["_id"]}, {"$set": {"early_leave_request": elr, "early_leave_approved": False, "updated_at": _now()}})
        rec = _clean(await _db.attendance.find_one({"_id": existing["_id"]}))
    else:
        rec = await apply_day(emp, today, {"status": "present", "check_in": existing.get("check_in")}, source=existing.get("source") or "self", confirmed=True)
        await _db.attendance.update_one({"_id": rec["id"]}, {"$set": {"early_leave_request": elr, "early_leave_approved": False}})
        rec = _clean(await _db.attendance.find_one({"_id": rec["id"]}))
    when = f" (planlanan {planned})" if planned else ""
    await notify_managers(
        emp["company_id"],
        "early_leave_request",
        f"Erken çıkış talebi: {emp['full_name']}",
        f"{emp['full_name']} bugün erken çıkış talep etti{when}: {reason[:200]}",
        link="/personnel?tab=attendance",
        dedupe_key=f"early:{emp['_id']}:{today}",
    )
    return {"status": "success", "record": rec, "message": "Erken çıkış talebiniz yöneticiye iletildi."}


@router.delete("/personnel/attendance/early-leave-request")
async def cancel_early_leave_request(request: Request):
    user = await _current_user(request)
    emp = await employee_for_user(user)
    if not emp:
        raise HTTPException(status_code=403, detail="Personel kartı bulunamadı.")
    company = await _db.companies.find_one({"_id": emp["company_id"]}) or {}
    schedule = merge_schedule(company, emp)
    today = _today(schedule)
    existing = await _db.attendance.find_one({"employee_id": emp["_id"], "date": today})
    if not existing or (existing.get("early_leave_request") or {}).get("status") != "pending":
        raise HTTPException(status_code=404, detail="İptal edilecek bekleyen talep yok.")
    await _db.attendance.update_one({"_id": existing["_id"]}, {"$unset": {"early_leave_request": ""}, "$set": {"updated_at": _now()}})
    return {"status": "success", "message": "Erken çıkış talebi iptal edildi."}


@router.post("/personnel/attendance/{att_id}/early-leave-decision")
async def decide_early_leave(att_id: str, req: Dict[str, Any], request: Request):
    user = await _current_user(request)
    if user.get("role") not in ("admin", "manager", "accountant"):
        raise HTTPException(status_code=403, detail="Erken çıkış onaylamak için yönetici yetkisi gerekir.")
    rec = await _db.attendance.find_one({"_id": att_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Puantaj kaydı bulunamadı.")
    elr = rec.get("early_leave_request") or {}
    if elr.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Bekleyen erken çıkış talebi yok.")
    decision = (req.get("decision") or "").strip().lower()
    if decision not in ("approve", "reject", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="decision: approve veya reject olmalı.")
    approved = decision in ("approve", "approved")
    elr = {
        **elr,
        "status": "approved" if approved else "rejected",
        "decided_at": _now(),
        "decided_by": str(user.get("_id") or user.get("id") or ""),
        "decision_note": (req.get("note") or "")[:300],
    }
    await _db.attendance.update_one(
        {"_id": att_id},
        {"$set": {"early_leave_request": elr, "early_leave_approved": approved, "updated_at": _now()}},
    )
    import notify as _notify
    await _notify.insert_notification(_db, {
        "_id": str(uuid.uuid4()),
        "company_id": rec["company_id"],
        "user_id": rec.get("employee_id"),
        "type": "early_leave_decision",
        "title": "Erken çıkış " + ("onaylandı" if approved else "reddedildi"),
        "message": f"{rec.get('employee_name')} — {elr['status']}. {elr.get('decision_note') or ''}".strip(),
        "link": "/mesai",
        "is_read": False,
        "created_at": _now(),
    })
    return {"status": "success", "record": _clean(await _db.attendance.find_one({"_id": att_id})),
            "message": "Erken çıkış talebi onaylandı." if approved else "Erken çıkış talebi reddedildi."}


def _req_hhmm(v: Any, label: str) -> str:
    raw = (v or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail=f"{label} gerekli (HH:MM).")
    try:
        return _valid_time(raw[:5] if len(raw) >= 5 else raw)
    except HTTPException:
        raise HTTPException(status_code=400, detail=f"Geçersiz {label} (HH:MM).")


@router.post("/personnel/attendance/intraday-leave-request")
async def request_intraday_leave(req: Dict[str, Any], request: Request):
    """Personel bugün için çıkış–dönüş saatli gün içi izin talebi oluşturur (çıkış yapılmış olsa da)."""
    user = await _current_user(request)
    emp = await employee_for_user(user)
    if not emp:
        raise HTTPException(status_code=403, detail="Kullanıcınız bir personel kartına bağlı değil (Personel Kartı → Sistem Kullanıcısı).")
    reason = (req.get("reason") or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=400, detail="Gün içi izin nedeni en az 3 karakter olmalı.")
    out_time = _req_hhmm(req.get("out_time"), "Çıkış saati")
    return_time = _req_hhmm(req.get("return_time"), "Dönüş (giriş) saati")
    if _hm(return_time) <= _hm(out_time):
        raise HTTPException(status_code=400, detail="Dönüş saati çıkış saatinden sonra olmalı.")
    company = await _db.companies.find_one({"_id": emp["company_id"]}) or {}
    schedule = merge_schedule(company, emp)
    today = _today(schedule)
    existing = await _db.attendance.find_one({"employee_id": emp["_id"], "date": today}) or {}
    prev = existing.get("intraday_leave_request") or {}
    if prev.get("status") == "pending":
        raise HTTPException(status_code=400, detail="Bekleyen bir gün içi izin talebiniz var.")
    if prev.get("status") == "approved":
        raise HTTPException(status_code=400, detail="Gün içi izin talebiniz zaten onaylandı.")
    ilr = {
        "status": "pending",
        "reason": reason[:400],
        "out_time": out_time,
        "return_time": return_time,
        "requested_at": _now(),
        "requested_by": str(user.get("_id") or user.get("id") or ""),
        "decided_at": None,
        "decided_by": None,
        "decision_note": "",
    }
    if existing.get("_id"):
        await _db.attendance.update_one(
            {"_id": existing["_id"]},
            {"$set": {"intraday_leave_request": ilr, "intraday_leave_approved": False, "updated_at": _now()}},
        )
        rec = _clean(await _db.attendance.find_one({"_id": existing["_id"]}))
    else:
        rec = await apply_day(emp, today, {"status": "present"}, source=existing.get("source") or "self", confirmed=True)
        await _db.attendance.update_one(
            {"_id": rec["id"]},
            {"$set": {"intraday_leave_request": ilr, "intraday_leave_approved": False}},
        )
        rec = _clean(await _db.attendance.find_one({"_id": rec["id"]}))
    mins = max(0, _hm(return_time) - _hm(out_time))
    await notify_managers(
        emp["company_id"],
        "intraday_leave_request",
        f"Gün içi izin talebi: {emp['full_name']}",
        f"{emp['full_name']} bugün {out_time}–{return_time} ({mins} dk) gün içi izin talep etti: {reason[:200]}",
        link="/personnel?tab=attendance",
        dedupe_key=f"intraday:{emp['_id']}:{today}",
    )
    return {"status": "success", "record": rec, "message": "Gün içi izin talebiniz yöneticiye iletildi."}


@router.delete("/personnel/attendance/intraday-leave-request")
async def cancel_intraday_leave_request(request: Request):
    user = await _current_user(request)
    emp = await employee_for_user(user)
    if not emp:
        raise HTTPException(status_code=403, detail="Personel kartı bulunamadı.")
    company = await _db.companies.find_one({"_id": emp["company_id"]}) or {}
    schedule = merge_schedule(company, emp)
    today = _today(schedule)
    existing = await _db.attendance.find_one({"employee_id": emp["_id"], "date": today})
    if not existing or (existing.get("intraday_leave_request") or {}).get("status") != "pending":
        raise HTTPException(status_code=404, detail="İptal edilecek bekleyen talep yok.")
    await _db.attendance.update_one(
        {"_id": existing["_id"]},
        {"$unset": {"intraday_leave_request": ""}, "$set": {"intraday_leave_approved": False, "updated_at": _now()}},
    )
    return {"status": "success", "message": "Gün içi izin talebi iptal edildi."}


@router.post("/personnel/attendance/{att_id}/intraday-leave-decision")
async def decide_intraday_leave(att_id: str, req: Dict[str, Any], request: Request):
    user = await _current_user(request)
    if user.get("role") not in ("admin", "manager", "accountant"):
        raise HTTPException(status_code=403, detail="Gün içi izin onaylamak için yönetici yetkisi gerekir.")
    rec = await _db.attendance.find_one({"_id": att_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Puantaj kaydı bulunamadı.")
    ilr = rec.get("intraday_leave_request") or {}
    if ilr.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Bekleyen gün içi izin talebi yok.")
    decision = (req.get("decision") or "").strip().lower()
    if decision not in ("approve", "reject", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="decision: approve veya reject olmalı.")
    approved = decision in ("approve", "approved")
    ilr = {
        **ilr,
        "status": "approved" if approved else "rejected",
        "decided_at": _now(),
        "decided_by": str(user.get("_id") or user.get("id") or ""),
        "decision_note": (req.get("note") or "")[:300],
    }
    emp = await _db.employees.find_one({"_id": rec["employee_id"]})
    if emp:
        saved = await apply_day(
            emp,
            rec["date"],
            {"intraday_leave_request": ilr, "intraday_leave_approved": approved},
            source=rec.get("source") or "self",
        )
    else:
        await _db.attendance.update_one(
            {"_id": att_id},
            {"$set": {"intraday_leave_request": ilr, "intraday_leave_approved": approved, "updated_at": _now()}},
        )
        saved = _clean(await _db.attendance.find_one({"_id": att_id}))
    import notify as _notify
    await _notify.insert_notification(_db, {
        "_id": str(uuid.uuid4()),
        "company_id": rec["company_id"],
        "user_id": rec.get("employee_id"),
        "type": "intraday_leave_decision",
        "title": "Gün içi izin " + ("onaylandı" if approved else "reddedildi"),
        "message": f"{rec.get('employee_name')} — {ilr.get('out_time')}–{ilr.get('return_time')} · {ilr['status']}. {ilr.get('decision_note') or ''}".strip(),
        "link": "/mesai",
        "is_read": False,
        "created_at": _now(),
    })
    return {
        "status": "success",
        "record": saved,
        "message": "Gün içi izin talebi onaylandı." if approved else "Gün içi izin talebi reddedildi.",
    }


@router.put("/personnel/attendance/assign-overtime")
async def assign_overtime(req: Dict[str, Any], request: Request):
    """Yönetici personele gün bazlı fazla mesai atar; çıkış hesabı beklenen bitiş = mesai bitişi + atanan saat."""
    user = await _current_user(request)
    if user.get("role") not in ("admin", "manager", "accountant"):
        raise HTTPException(status_code=403, detail="Fazla mesai atamak için yönetici yetkisi gerekir.")
    emp = await _db.employees.find_one({"_id": req.get("employee_id")})
    if not emp:
        raise HTTPException(status_code=404, detail="Personel bulunamadı.")
    company = await _db.companies.find_one({"_id": emp["company_id"]}) or {}
    schedule = merge_schedule(company, emp)
    start_t = (req.get("start_time") or req.get("start") or "").strip()
    end_t = (req.get("end_time") or req.get("end") or "").strip()
    ranged = hours_from_time_range(start_t, end_t)
    if ranged is not None:
        hours = ranged
    else:
        try:
            hours = _as_float(req.get("hours"), 0.0)
        except Exception:
            hours = 0.0
    if hours < 0:
        raise HTTPException(status_code=400, detail="Fazla mesai saati negatif olamaz.")
    hours = round(hours, 2)
    date = (req.get("date") or "").strip() or _today(schedule)
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Geçersiz tarih.")
    note = (req.get("note") or "").strip()[:200]
    existing = await _db.attendance.find_one({"employee_id": emp["_id"], "date": date}) or {}
    patch = {
        "assigned_overtime_hours": hours,
        "assigned_overtime_by": str(user.get("_id") or user.get("id") or ""),
        "assigned_overtime_at": _now(),
        "assigned_overtime_note": note,
    }
    if start_t:
        patch["assigned_overtime_start"] = start_t[:5]
    if end_t:
        patch["assigned_overtime_end"] = end_t[:5]
    if req.get("note") is not None and note:
        # keep attendance note separate unless empty
        patch["note"] = note if not existing.get("note") else existing.get("note")
    rec = await apply_day(emp, date, patch, source=existing.get("source") or "manager")
    msg = f"{emp['full_name']} için {date} tarihine {hours} sa fazla mesai atandı (beklenen çıkış {rec.get('expected_end')})."
    if hours == 0:
        msg = f"{emp['full_name']} için {date} fazla mesai ataması kaldırıldı."
    else:
        import notify as _notify
        await _notify.insert_notification(_db, _notify.notification_doc(
            emp["company_id"], "overtime_assigned",
            f"+ Mesai yazıldı: {emp.get('full_name')}",
            msg,
            link="/mesai",
            user_id=emp.get("user_id"),
            employee_id=emp.get("_id"),
            roles=[],
        ))
    return {"status": "success", "record": rec, "message": msg}


@router.post("/personnel/attendance/{att_id}/confirm")
async def confirm_attendance(att_id: str, request: Request, req: Dict[str, Any] = None):
    user = await _current_user(request)
    rec = await _db.attendance.find_one({"_id": att_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Puantaj kaydı bulunamadı.")
    emp = await employee_for_user(user)
    if user.get("role") != "admin" and (not emp or emp["_id"] != rec["employee_id"]):
        raise HTTPException(status_code=403, detail="Yalnızca kendi puantaj kaydınızı onaylayabilirsiniz.")
    note = (req or {}).get("note")
    upd = {"employee_confirmed": True, "employee_confirmed_at": _now()}
    if note:
        upd["employee_note"] = note
    # Personel itiraz sonrası "yine de onayla" derse kutudan düşür
    if (rec.get("dispute_note") or "").strip() and not rec.get("dispute_resolved"):
        upd["dispute_resolved"] = True
        upd["dispute_resolution"] = "employee_confirmed"
        upd["dispute_resolved_at"] = _now()
        upd["dispute_resolved_by"] = str(user.get("_id") or user.get("id") or "")
    await _db.attendance.update_one({"_id": att_id}, {"$set": upd})
    return _clean(await _db.attendance.find_one({"_id": att_id}))


@router.post("/personnel/attendance/{att_id}/dispute")
async def dispute_attendance(att_id: str, req: Dict[str, Any], request: Request):
    user = await _current_user(request)
    rec = await _db.attendance.find_one({"_id": att_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Puantaj kaydı bulunamadı.")
    emp = await employee_for_user(user)
    if not emp or emp["_id"] != rec["employee_id"]:
        raise HTTPException(status_code=403, detail="Yalnızca kendi kaydınıza itiraz edebilirsiniz.")
    note = (req.get("note") or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="İtiraz açıklaması gerekli.")
    await _db.attendance.update_one(
        {"_id": att_id},
        {
            "$set": {
                "employee_confirmed": False,
                "dispute_note": note,
                "disputed_at": _now(),
                "dispute_resolved": False,
                "dispute_resolution": None,
                "dispute_resolved_at": None,
                "dispute_resolved_by": None,
                "dispute_decision_note": None,
            }
        },
    )
    import notify as _notify
    await _notify.insert_notification(_db, {"_id": str(uuid.uuid4()), "company_id": rec["company_id"], "type": "attendance_dispute", "title": "Puantaj itirazı",
                                        "message": f"{rec.get('employee_name')} {rec.get('date')} kaydına itiraz etti: {note[:120]}", "link": "/personnel?tab=attendance", "is_read": False, "created_at": _now()})
    return _clean(await _db.attendance.find_one({"_id": att_id}))


@router.post("/personnel/attendance/{att_id}/dispute-decision")
async def decide_attendance_dispute(att_id: str, req: Dict[str, Any], request: Request):
    """Yönetici puantaj itirazını sonlandırır: Düzeltildi (approve) veya Reddet."""
    user = await _current_user(request)
    if user.get("role") not in ("admin", "manager", "accountant"):
        raise HTTPException(status_code=403, detail="İtirazı yanıtlamak için yönetici yetkisi gerekir.")
    rec = await _db.attendance.find_one({"_id": att_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Puantaj kaydı bulunamadı.")
    note = (rec.get("dispute_note") or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="Bu kayıtta açık itiraz yok.")
    if rec.get("dispute_resolved"):
        raise HTTPException(status_code=400, detail="İtiraz zaten sonlandırılmış.")
    decision = (req.get("decision") or "").strip().lower()
    if decision not in ("approve", "reject", "approved", "rejected", "resolve", "dismiss"):
        raise HTTPException(status_code=400, detail="decision: approve (düzeltildi) veya reject olmalı.")
    accepted = decision in ("approve", "approved", "resolve")
    decision_note = (req.get("note") or "")[:300]
    upd = {
        "dispute_resolved": True,
        "dispute_resolution": "accepted" if accepted else "rejected",
        "dispute_resolved_at": _now(),
        "dispute_resolved_by": str(user.get("_id") or user.get("id") or ""),
        "dispute_decision_note": decision_note,
        "updated_at": _now(),
    }
    # Düzeltildi: personel güncel saatleri yeniden onaylasın
    if accepted:
        upd["employee_confirmed"] = False
        upd["employee_confirmed_at"] = None
    await _db.attendance.update_one({"_id": att_id}, {"$set": upd})
    import notify as _notify
    emp = await _db.employees.find_one({"_id": rec.get("employee_id")}) or {}
    title = "Puantaj itirazı düzeltildi" if accepted else "Puantaj itirazı reddedildi"
    msg = (
        f"{rec.get('employee_name')} — {rec.get('date') or ''} itirazı "
        f"{'düzeltildi; kaydı yeniden onaylayın' if accepted else 'reddedildi'}."
        + (f" {decision_note}" if decision_note else "")
    ).strip()
    await _notify.insert_notification(_db, {
        "_id": str(uuid.uuid4()),
        "company_id": rec["company_id"],
        "user_id": emp.get("user_id") or rec.get("employee_id"),
        "type": "attendance_dispute_decision",
        "title": title,
        "message": msg,
        "link": "/mesai",
        "is_read": False,
        "created_at": _now(),
    })
    return {
        "status": "success",
        "record": _clean(await _db.attendance.find_one({"_id": att_id})),
        "message": "İtiraz düzeltildi olarak kapatıldı." if accepted else "İtiraz reddedildi.",
    }


# ---------- Yönetici bildirimleri ----------
_mail_account_fn = None
_smtp_send_fn = None


def init_notify(mail_account_fn, smtp_send_fn):
    global _mail_account_fn, _smtp_send_fn
    _mail_account_fn, _smtp_send_fn = mail_account_fn, smtp_send_fn


async def notify_managers(company_id: str, ntype: str, title: str, message: str, link: str = "/personnel?tab=attendance", dedupe_key: Optional[str] = None) -> dict:
    if dedupe_key:
        if await _db.attendance_alerts.find_one({"_id": f"{company_id}:{dedupe_key}"}):
            return {"status": "duplicate"}
        await _db.attendance_alerts.insert_one({"_id": f"{company_id}:{dedupe_key}", "company_id": company_id, "type": ntype, "created_at": _now()})
    import notify as _notify
    roles = _notify.roles_for_type(ntype)
    await _notify.insert_notification(_db, _notify.notification_doc(company_id, ntype, title, message, link=link, roles=roles))
    mail = {"status": "skipped"}
    if _mail_account_fn and _smtp_send_fn:
        try:
            a = await _mail_account_fn(company_id)
            holders = await _notify.users_with_roles(_db, company_id, roles or ("admin",))
            to = sorted({u["email"] for u in holders if u.get("email")}) or [a["email"]]
            await _smtp_send_fn(a, to, f"[TamKobi] {title}", message, html=f"<p><b>{title}</b></p><p>{message}</p>")
            mail = {"status": "sent", "to": to}
        except HTTPException as e:
            mail = {"status": "skipped", "detail": e.detail}
        except Exception as e:
            mail = {"status": "failed", "detail": str(e)[:120]}
    return {"status": "sent", "mail": mail}


async def _on_leave_today(emp_id: str, date: str) -> bool:
    return bool(await _db.leave_requests.find_one({"employee_id": emp_id, "status": "approved", "start_date": {"$lte": date}, "end_date": {"$gte": date}}))


async def run_missing_checkin_check(company_id: Optional[str] = None, force: bool = False) -> list:
    """Mesai başlangıcı + tolerans geçtiyse giriş yapmamış aktif personel için günde bir kez yöneticiye bildirim."""
    results = []
    q = {"_id": company_id} if company_id else {}
    async for company in _db.companies.find(q):
        base = merge_schedule(company)
        if not base.get("notify_missing_checkin", True) and not force:
            continue
        now = local_now(base)
        today = now.strftime("%Y-%m-%d")
        emps = await _db.employees.find({"company_id": company["_id"], "status": "active"}).to_list(300)
        missing = []
        for emp in emps:
            sch = merge_schedule(company, emp)
            wd = now.weekday()
            plan = await _db.shift_plans.find_one({"employee_id": emp["_id"], "date": today})
            if plan:
                if plan.get("off"):
                    continue
                win = {"start": plan.get("start") or sch["start"]}
            else:
                if wd not in (sch.get("work_days") or []):
                    continue
                win = day_window(sch, wd)
            deadline = _hm(win["start"]) + int(sch.get("late_tolerance_minutes") or 0)
            if not force and now.hour * 60 + now.minute < deadline:
                continue
            rec = await _db.attendance.find_one({"employee_id": emp["_id"], "date": today})
            if rec and (rec.get("check_in") or rec.get("status") in ("leave", "absent")):
                continue
            if await _on_leave_today(emp["_id"], today):
                continue
            missing.append(emp["full_name"])
        if missing:
            names = ", ".join(missing[:8]) + (f" (+{len(missing) - 8})" if len(missing) > 8 else "")
            r = await notify_managers(company["_id"], "attendance_missing", f"Giriş yapmayan {len(missing)} personel",
                                      f"{today} · mesai başlangıcı geçti, henüz giriş yapmayanlar: {names}", dedupe_key=f"missing:{today}")
            results.append({"company_id": company["_id"], "missing": missing, **r})
    return results


async def watcher_loop(interval_s: int = 60):
    import asyncio
    while True:
        try:
            await run_missing_checkin_check()
        except Exception:
            pass
        await asyncio.sleep(interval_s)


@router.post("/personnel/attendance/run-alerts")
async def run_alerts_now(request: Request, company_id: Optional[str] = "comp_nexus_main_01", force: bool = False):
    user = await _current_user(request)
    if user.get("role") not in ("admin", "manager", "accountant"):
        raise HTTPException(status_code=403, detail="Bu işlem için yönetici yetkisi gerekir.")
    if not await _db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Firma bulunamadı.")
    return {"status": "success", "results": await run_missing_checkin_check(company_id, force=force)}


@router.get("/personnel/overtime-preview")
async def overtime_preview(company_id: Optional[str] = "comp_nexus_main_01", period: Optional[str] = None):
    company = await _db.companies.find_one({"_id": company_id}) or {}
    period = period or _today(merge_schedule(company))[:7]
    out = []
    for emp in await _db.employees.find({"company_id": company_id, "status": "active"}).to_list(300):
        p = await overtime_pay_for_period(company, emp, period)
        out.append({"employee_id": emp["_id"], "employee_name": emp["full_name"], "payroll_salary": emp.get("payroll_salary"), "salary": emp.get("salary"), "second_salary": emp.get("second_salary") or 0, **p})
    return {"period": period, "rows": out, "total": round(sum(r["amount"] for r in out), 2)}


LEAVE_TYPES = {"annual": "Yıllık", "sick": "Hastalık", "unpaid": "Ücretsiz", "other": "Diğer"}


# ---------- Vardiya planı ----------
def _week_dates(week_start: str) -> list:
    d0 = datetime.strptime(week_start, "%Y-%m-%d")
    d0 = d0 - __import__("datetime").timedelta(days=d0.weekday())
    return [(d0 + __import__("datetime").timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]


@router.get("/personnel/shifts")
async def get_shifts(company_id: Optional[str] = "comp_nexus_main_01", week_start: Optional[str] = None):
    company = await _db.companies.find_one({"_id": company_id}) or {}
    base = merge_schedule(company)
    week_start = week_start or _today(base)
    dates = _week_dates(week_start)
    plans = {(p["employee_id"], p["date"]): p for p in await _db.shift_plans.find({"company_id": company_id, "date": {"$in": dates}}).to_list(2000)}
    leaves = await _db.leave_requests.find({"company_id": company_id, "status": "approved", "start_date": {"$lte": dates[-1]}, "end_date": {"$gte": dates[0]}}).to_list(1000)
    rows = []
    conflicts = 0
    for emp in await _db.employees.find({"company_id": company_id, "status": "active"}).sort("full_name", 1).to_list(300):
        sch = merge_schedule(company, emp)
        cells = []
        for d in dates:
            wd = datetime.strptime(d, "%Y-%m-%d").weekday()
            p = plans.get((emp["_id"], d))
            lv = next((l for l in leaves if l["employee_id"] == emp["_id"] and l["start_date"] <= d <= l["end_date"]), None)
            if p:
                cell = {"date": d, "planned": True, "id": p["_id"], "off": bool(p.get("off")), "start": p.get("start"), "end": p.get("end"), "break_minutes": p.get("break_minutes"), "note": p.get("note", "")}
            else:
                off = wd not in (sch.get("work_days") or [])
                w = day_window(sch, wd)
                cell = {"date": d, "planned": False, "off": off, "start": None if off else w["start"], "end": None if off else w["end"], "break_minutes": None if off else w["break_minutes"], "note": ""}
            if lv:
                cell["leave"] = {"id": lv["_id"], "type": lv.get("type"), "label": LEAVE_TYPES.get(lv.get("type"), lv.get("type"))}
                cell["conflict"] = bool(cell["planned"] and not cell["off"])
                conflicts += cell["conflict"]
            cells.append(cell)
        rows.append({"employee_id": emp["_id"], "employee_name": emp["full_name"], "department": emp.get("department"), "cells": cells})
    return {"week_start": dates[0], "dates": dates, "day_labels": DAY_LABELS, "rows": rows, "conflicts": conflicts}


@router.put("/personnel/shifts")
async def put_shifts(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    items = req.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="items listesi gerekli.")
    saved = 0
    warnings = []
    for it in items:
        emp = await _db.employees.find_one({"_id": it.get("employee_id")})
        if not emp:
            raise HTTPException(status_code=404, detail="Çalışan bulunamadı.")
        if not it.get("off") and it.get("date"):
            lv = await _db.leave_requests.find_one({"employee_id": emp["_id"], "status": "approved", "start_date": {"$lte": it["date"]}, "end_date": {"$gte": it["date"]}})
            if lv:
                warnings.append(f"{emp['full_name']} {it['date']} tarihinde onaylı {LEAVE_TYPES.get(lv.get('type'), '')} izinli — vardiya çakışıyor.")
        try:
            datetime.strptime(it.get("date") or "", "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Geçersiz tarih.")
        off = bool(it.get("off"))
        doc = {"company_id": company_id, "employee_id": emp["_id"], "employee_name": emp["full_name"], "date": it["date"], "off": off, "note": (it.get("note") or "")[:200], "updated_at": _now()}
        if not off:
            doc["start"] = _valid_time(it.get("start"))
            doc["end"] = _valid_time(it.get("end"))
            if _hm(doc["end"]) <= _hm(doc["start"]):
                raise HTTPException(status_code=400, detail=f"{it['date']}: bitiş başlangıçtan sonra olmalı.")
            doc["break_minutes"] = max(0, int(it.get("break_minutes") if it.get("break_minutes") not in (None, "") else 60))
        else:
            doc.update({"start": None, "end": None, "break_minutes": 0})
        await _db.shift_plans.update_one({"employee_id": emp["_id"], "date": it["date"]}, {"$set": doc, "$setOnInsert": {"_id": str(uuid.uuid4()), "created_at": _now()}}, upsert=True)
        saved += 1
    return {"status": "success", "saved": saved, "warnings": warnings, "message": f"{saved} vardiya kaydedildi." + (f" Uyarı: {warnings[0]}" if warnings else "")}


@router.delete("/personnel/shifts/{shift_id}")
async def delete_shift(shift_id: str):
    sh = await _db.shift_plans.find_one({"_id": shift_id})
    if not sh:
        raise HTTPException(status_code=404, detail="Vardiya bulunamadı.")
    import trash
    await trash.soft_delete("shift_plans", sh, "shift", f"{sh.get('employee_name')} · {sh.get('date')}", note=f"{sh.get('start') or ''}-{sh.get('end') or ''}" if sh.get("start") else "İzin/Off")
    return {"status": "success", "message": "Vardiya çöp kutusuna taşındı."}


@router.post("/personnel/shifts/copy-week")
async def copy_week(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    src = _week_dates(req["from_week_start"])
    dst = _week_dates(req["to_week_start"])
    plans = await _db.shift_plans.find({"company_id": company_id, "date": {"$in": src}}).to_list(2000)
    n = 0
    for p in plans:
        nd = dst[src.index(p["date"])]
        doc = {k: v for k, v in p.items() if k not in ("_id", "created_at")}
        doc.update({"date": nd, "updated_at": _now()})
        await _db.shift_plans.update_one({"employee_id": p["employee_id"], "date": nd}, {"$set": doc, "$setOnInsert": {"_id": str(uuid.uuid4()), "created_at": _now()}}, upsert=True)
        n += 1
    return {"status": "success", "copied": n, "message": f"{n} vardiya {dst[0]} haftasına kopyalandı."}


# ---------- Personel self-servis izin talebi ----------


@router.get("/personnel/leaves/me")
async def my_leaves(request: Request):
    user = await _current_user(request)
    emp = await employee_for_user(user)
    if not emp:
        return {"employee": None, "leaves": [], "balance": None}
    leaves = await _db.leave_requests.find({"employee_id": emp["_id"]}).sort("created_at", -1).to_list(100)
    annual = emp.get("annual_leave_days", 14)
    used = emp.get("used_leave_days", 0)
    pending_days = sum(l.get("days", 0) for l in leaves if l.get("status") == "pending" and l.get("type") == "annual")
    return {"employee": {"id": emp["_id"], "full_name": emp["full_name"]}, "leaves": [_clean(l) for l in leaves], "types": LEAVE_TYPES,
            "balance": {"annual": annual, "used": used, "remaining": annual - used, "pending_days": pending_days}}


def parse_advance_self(req: Dict[str, Any]) -> Dict[str, Any]:
    try:
        amount = float(str(req.get("amount") or "").replace(",", ".").replace(" ", ""))
    except (TypeError, ValueError):
        amount = 0.0
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Avans tutarı sıfırdan büyük olmalı.")
    period = (req.get("period") or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m")
    if len(period) != 7 or period[4] != "-" or not period[:4].isdigit() or not period[5:].isdigit():
        raise HTTPException(status_code=400, detail="Dönem YYYY-AA formatında olmalı.")
    return {"amount": round(amount, 2), "note": (req.get("note") or "").strip()[:300], "period": period}


def bonus_counts_as_advance(b: Dict[str, Any]) -> bool:
    """Bekleyen self-servis avans talebi kalan alacaktan düşülmez."""
    if (b.get("type") or "") not in ("advance", "borc"):
        return False
    if b.get("status") in ("rejected",):
        return False
    if b.get("source") == "self" and b.get("status") == "pending":
        return False
    return True


@router.post("/personnel/bonuses/self")
async def request_my_advance(req: Dict[str, Any], request: Request):
    """Personel avans talebi: yönetici onaylar; kasa çıkışı sonradan yapılır."""
    user = await _current_user(request)
    emp = await employee_for_user(user)
    if not emp:
        raise HTTPException(status_code=403, detail="Kullanıcınız bir personel kartına bağlı değil.")
    parsed = parse_advance_self(req)
    existing = await _db.bonus_payments.find_one({
        "employee_id": emp["_id"], "type": "advance", "source": "self", "status": "pending",
    })
    if existing:
        raise HTTPException(status_code=400, detail="Bekleyen bir avans talebiniz var.")
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": emp["company_id"],
        "employee_id": emp["_id"],
        "employee_name": emp["full_name"],
        "type": "advance",
        "type_label": "Avans",
        "period": parsed["period"],
        "amount": parsed["amount"],
        "note": parsed["note"],
        "is_official": False,
        "account_id": None,
        "partner_id": None,
        "account_name": None,
        "status": "pending",
        "source": "self",
        "created_at": _now(),
    }
    await _db.bonus_payments.insert_one(doc)
    when = f" ({parsed['period']})"
    await notify_managers(
        emp["company_id"],
        "advance_request",
        f"Avans talebi: {emp['full_name']}",
        f"{emp['full_name']} {parsed['amount']:,.2f} ₺ avans talep etti{when}. {parsed['note']}".strip(),
        link="/personnel?tab=payroll",
        dedupe_key=f"advance:{emp['_id']}:{parsed['period']}",
    )
    return {**_clean(doc), "message": "Avans talebiniz yöneticiye iletildi."}


@router.delete("/personnel/bonuses/self/{bonus_id}")
async def cancel_my_advance(bonus_id: str, request: Request):
    user = await _current_user(request)
    emp = await employee_for_user(user)
    rec = await _db.bonus_payments.find_one({"_id": bonus_id})
    if not rec or not emp or rec.get("employee_id") != emp["_id"] or rec.get("source") != "self":
        raise HTTPException(status_code=404, detail="Avans talebi bulunamadı.")
    if rec.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Yalnızca bekleyen talepler iptal edilebilir.")
    await _db.bonus_payments.delete_one({"_id": bonus_id})
    return {"status": "success", "message": "Avans talebi iptal edildi."}


@router.post("/personnel/leaves/self")
async def create_my_leave(req: Dict[str, Any], request: Request):
    user = await _current_user(request)
    emp = await employee_for_user(user)
    if not emp:
        raise HTTPException(status_code=403, detail="Kullanıcınız bir personel kartına bağlı değil.")
    try:
        start = datetime.strptime(req.get("start_date") or "", "%Y-%m-%d")
        end = datetime.strptime(req.get("end_date") or "", "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Başlangıç ve bitiş tarihi gerekli.")
    if end < start:
        raise HTTPException(status_code=400, detail="Bitiş tarihi başlangıçtan önce olamaz.")
    leave_type = req.get("type", "annual")
    if leave_type not in LEAVE_TYPES:
        raise HTTPException(status_code=400, detail="Geçersiz izin türü.")
    days = float(req.get("days") or ((end - start).days + 1))
    if days <= 0:
        raise HTTPException(status_code=400, detail="Gün sayısı sıfırdan büyük olmalı.")
    overlap = await _db.leave_requests.find_one({"employee_id": emp["_id"], "status": {"$in": ["pending", "approved"]}, "start_date": {"$lte": req["end_date"]}, "end_date": {"$gte": req["start_date"]}})
    if overlap:
        raise HTTPException(status_code=400, detail=f"Bu tarihlerle çakışan bir izin talebiniz var ({overlap['start_date']} → {overlap['end_date']}).")
    if leave_type == "annual":
        pending_days = sum(l.get("days", 0) for l in await _db.leave_requests.find({"employee_id": emp["_id"], "status": "pending", "type": "annual"}).to_list(200))
        remaining = emp.get("annual_leave_days", 14) - emp.get("used_leave_days", 0) - pending_days
        if days > remaining:
            raise HTTPException(status_code=400, detail=f"Yetersiz yıllık izin bakiyesi. Kullanılabilir: {remaining:g} gün (bekleyen talepler düşülmüştür).")
    doc = {"_id": str(uuid.uuid4()), "company_id": emp["company_id"], "employee_id": emp["_id"], "employee_name": emp["full_name"], "type": leave_type,
           "start_date": req["start_date"], "end_date": req["end_date"], "days": days, "reason": (req.get("reason") or "")[:300], "status": "pending", "source": "self",
           "decided_at": None, "created_at": _now()}
    await _db.leave_requests.insert_one(doc)
    await notify_managers(emp["company_id"], "leave_request", f"İzin talebi: {emp['full_name']}", f"{emp['full_name']} {LEAVE_TYPES[leave_type].lower()} izin talep etti: {req['start_date']} → {req['end_date']} ({days:g} gün). {doc['reason']}".strip(), link="/personnel?tab=leaves")
    return _clean(doc)


@router.delete("/personnel/leaves/self/{leave_id}")
async def cancel_my_leave(leave_id: str, request: Request):
    user = await _current_user(request)
    emp = await employee_for_user(user)
    leave = await _db.leave_requests.find_one({"_id": leave_id})
    if not leave or not emp or leave["employee_id"] != emp["_id"]:
        raise HTTPException(status_code=404, detail="İzin talebi bulunamadı.")
    if leave.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Yalnızca bekleyen talepler iptal edilebilir.")
    await _db.leave_requests.delete_one({"_id": leave_id})
    return {"status": "success"}


# ---------- Vardiya şablonları & toplu atama ----------
def _clean_template_days(days: Any) -> dict:
    out = {}
    if not isinstance(days, dict):
        raise HTTPException(status_code=400, detail="Şablon günleri gerekli.")
    for k, v in days.items():
        if str(k) not in {"0", "1", "2", "3", "4", "5", "6"} or not isinstance(v, dict):
            continue
        if v.get("off"):
            out[str(k)] = {"off": True}
            continue
        d = {"off": False, "start": _valid_time(v.get("start")), "end": _valid_time(v.get("end")), "break_minutes": max(0, int(v.get("break_minutes") if v.get("break_minutes") not in (None, "") else 60))}
        if _hm(d["end"]) <= _hm(d["start"]):
            raise HTTPException(status_code=400, detail=f"{DAY_LABELS[int(k)]}: bitiş başlangıçtan sonra olmalı.")
        out[str(k)] = d
    if not out:
        raise HTTPException(status_code=400, detail="En az bir gün tanımlayın.")
    return out


@router.get("/personnel/shift-templates")
async def list_shift_templates(company_id: Optional[str] = "comp_nexus_main_01"):
    return [_clean(t) for t in await _db.shift_templates.find({"company_id": company_id}).sort("name", 1).to_list(100)]


@router.post("/personnel/shift-templates")
async def create_shift_template(req: Dict[str, Any]):
    name = (req.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Şablon adı gerekli.")
    doc = {"_id": str(uuid.uuid4()), "company_id": req.get("company_id", "comp_nexus_main_01"), "name": name[:60], "days": _clean_template_days(req.get("days")), "created_at": _now()}
    await _db.shift_templates.insert_one(doc)
    return _clean(doc)


@router.delete("/personnel/shift-templates/{tpl_id}")
async def delete_shift_template(tpl_id: str):
    tpl = await _db.shift_templates.find_one({"_id": tpl_id})
    if not tpl:
        raise HTTPException(status_code=404, detail="Şablon bulunamadı.")
    import trash
    await trash.soft_delete("shift_templates", tpl, "shift_template", tpl.get("name") or tpl_id)
    return {"status": "success", "message": "Şablon çöp kutusuna taşındı."}


@router.post("/personnel/shifts/bulk-assign")
async def bulk_assign_shifts(req: Dict[str, Any]):
    """Bir şablonu departmanın (veya seçili personelin) tüm haftasına tek seferde uygula."""
    company_id = req.get("company_id", "comp_nexus_main_01")
    dates = _week_dates(req.get("week_start") or _today())
    days = _clean_template_days(req.get("days") or (await _db.shift_templates.find_one({"_id": req.get("template_id")}) or {}).get("days"))
    q: Dict[str, Any] = {"company_id": company_id, "status": "active"}
    if req.get("employee_ids"):
        q["_id"] = {"$in": list(req["employee_ids"])}
    elif req.get("department") and req["department"] != "all":
        q["department"] = req["department"]
    emps = await _db.employees.find(q).to_list(500)
    if not emps:
        raise HTTPException(status_code=404, detail="Seçime uyan aktif personel yok.")
    skip_leave = bool(req.get("skip_leave", True))
    overwrite = bool(req.get("overwrite", True))
    saved, skipped_leave, skipped_existing, conflicts = 0, 0, 0, []
    for emp in emps:
        for i, d in enumerate(dates):
            tpl = days.get(str(i))
            if not tpl:
                continue
            existing = await _db.shift_plans.find_one({"employee_id": emp["_id"], "date": d})
            if existing and not overwrite:
                skipped_existing += 1
                continue
            lv = await _db.leave_requests.find_one({"employee_id": emp["_id"], "status": "approved", "start_date": {"$lte": d}, "end_date": {"$gte": d}})
            if lv and not tpl.get("off"):
                if skip_leave:
                    skipped_leave += 1
                    continue
                conflicts.append(f"{emp['full_name']} {d}")
            doc = {"company_id": company_id, "employee_id": emp["_id"], "employee_name": emp["full_name"], "date": d, "off": bool(tpl.get("off")),
                   "start": None if tpl.get("off") else tpl["start"], "end": None if tpl.get("off") else tpl["end"], "break_minutes": 0 if tpl.get("off") else tpl["break_minutes"],
                   "note": (req.get("note") or "")[:200], "source": "bulk", "updated_at": _now()}
            await _db.shift_plans.update_one({"employee_id": emp["_id"], "date": d}, {"$set": doc, "$setOnInsert": {"_id": str(uuid.uuid4()), "created_at": _now()}}, upsert=True)
            saved += 1
    msg = f"{len(emps)} personel için {saved} vardiya atandı."
    if skipped_leave:
        msg += f" {skipped_leave} izinli gün atlandı."
    if skipped_existing:
        msg += f" {skipped_existing} mevcut plan korundu."
    if conflicts:
        msg += f" Uyarı: {len(conflicts)} izin çakışması."
    return {"status": "success", "employees": len(emps), "saved": saved, "skipped_leave": skipped_leave, "skipped_existing": skipped_existing, "conflicts": conflicts, "week_start": dates[0], "message": msg}
