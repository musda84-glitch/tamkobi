"""Mesai saatleri, personel self-servis puantaj (giriş/çıkış/onay) ve otomatik fazla mesai hesabı."""
import math
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api")
_db = None
_current_user = None

DEFAULT_SCHEDULE = {"start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4], "late_tolerance_minutes": 10, "overtime_tolerance_minutes": 15, "count_early_as_overtime": False, "require_geo": True, "timezone": "Europe/Istanbul"}
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


def merge_schedule(company: dict, employee: Optional[dict] = None) -> dict:
    s = {**DEFAULT_SCHEDULE, **((company or {}).get("work_schedule") or {})}
    if employee and employee.get("work_schedule"):
        s = {**s, **{k: v for k, v in employee["work_schedule"].items() if v not in (None, "", [])}}
    return s


def compute_day(rec: dict, schedule: dict) -> dict:
    """check_in/check_out (HH:MM) → hours, normal_hours, overtime_hours, late_minutes, early_leave_minutes, is_off_day."""
    out = {"hours": 0.0, "normal_hours": 0.0, "overtime_hours": 0.0, "late_minutes": 0, "early_leave_minutes": 0, "is_off_day": False}
    try:
        wd = datetime.strptime(rec.get("date"), "%Y-%m-%d").weekday()
    except Exception:
        wd = 0
    out["is_off_day"] = wd not in (schedule.get("work_days") or DEFAULT_SCHEDULE["work_days"])
    ci, co = rec.get("check_in"), rec.get("check_out")
    start, end = _hm(schedule["start"]), _hm(schedule["end"])
    if ci and not out["is_off_day"]:
        out["late_minutes"] = max(0, _hm(ci) - start - int(schedule.get("late_tolerance_minutes") or 0))
    if not (ci and co):
        return out
    a, b = _hm(ci), _hm(co)
    if b < a:
        b += 24 * 60
    worked = max(0, b - a - int(schedule.get("break_minutes") or 0))
    if out["is_off_day"]:
        ot = worked
    else:
        tol = int(schedule.get("overtime_tolerance_minutes") or 0)
        ot = (b - end) if b - end > tol else 0
        if schedule.get("count_early_as_overtime") and a < start:
            ot += start - a
        out["early_leave_minutes"] = max(0, end - b)
        ot = min(ot, worked)
    out["hours"] = round(worked / 60, 2)
    out["overtime_hours"] = round(ot / 60, 2)
    out["normal_hours"] = round(max(0, worked - ot) / 60, 2)
    return out


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


async def employee_for_user(user: dict):
    uid = str(user.get("_id", user.get("id")))
    return await _db.employees.find_one({"$or": [{"_id": user.get("employee_id") or "-"}, {"user_id": uid}]})


async def apply_day(employee: dict, date: str, patch: Dict[str, Any], source: str = "manual", confirmed: Optional[bool] = None) -> dict:
    company = await _db.companies.find_one({"_id": employee["company_id"]}) or {}
    schedule = merge_schedule(company, employee)
    existing = await _db.attendance.find_one({"employee_id": employee["_id"], "date": date}) or {}
    rec = {"company_id": employee["company_id"], "employee_id": employee["_id"], "employee_name": employee["full_name"], "date": date,
           "status": patch.get("status") or ("present" if (patch.get("check_in") or patch.get("check_out")) else existing.get("status")) or "present",
           "check_in": patch.get("check_in", existing.get("check_in")), "check_out": patch.get("check_out", existing.get("check_out")),
           "note": patch.get("note", existing.get("note", "")), "source": source}
    if rec["status"] in ("absent", "leave"):
        rec.update({"check_in": None, "check_out": None})
    rec.update(compute_day(rec, schedule))
    rec["schedule_snapshot"] = {"start": schedule["start"], "end": schedule["end"], "break_minutes": schedule["break_minutes"]}
    if confirmed is not None:
        rec["employee_confirmed"] = confirmed
        rec["employee_confirmed_at"] = _now() if confirmed else None
    elif "employee_confirmed" not in existing:
        rec["employee_confirmed"] = False
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


# ---------- Çalışma saatleri ----------
@router.get("/companies/{company_id}/work-schedule")
async def get_work_schedule(company_id: str):
    company = await _db.companies.find_one({"_id": company_id}) or {}
    return {"schedule": merge_schedule(company), "day_labels": DAY_LABELS, "defaults": DEFAULT_SCHEDULE}


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
        return {"employee": None, "records": [], "summary": summarize([]), "today": None, "schedule": None, "location": None}
    company = await _db.companies.find_one({"_id": emp["company_id"]}) or {}
    schedule = merge_schedule(company, emp)
    month = month or _today(schedule)[:7]
    rows = await _db.attendance.find({"employee_id": emp["_id"], "date": {"$regex": f"^{month}"}}).sort("date", -1).to_list(100)
    today = await _db.attendance.find_one({"employee_id": emp["_id"], "date": _today(schedule)})
    return {"employee": {"id": emp["_id"], "full_name": emp["full_name"], "department": emp.get("department"), "position": emp.get("position")},
            "month": month, "records": [_clean(r) for r in rows], "summary": summarize(rows), "today": _clean(today) if today else None,
            "schedule": schedule, "day_labels": DAY_LABELS, "location": company.get("location"), "now": now_hm(schedule), "today_date": _today(schedule)}


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
    loc = company.get("location")
    geo = None
    if loc and schedule.get("require_geo", True):
        try:
            lat, lng = float(req["latitude"]), float(req["longitude"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Konum gerekli: telefon konum iznini açın. Firma konumu tanımlı olduğundan giriş/çıkış yalnızca firma yakınından yapılabilir.")
        dist = haversine_m(lat, lng, loc["latitude"], loc["longitude"])
        radius = float(loc.get("radius_m") or 300)
        if dist > radius:
            raise HTTPException(status_code=400, detail=f"Firma konumuna {int(dist)} m uzaktasınız (izin verilen {int(radius)} m). {'Giriş' if action == 'check_in' else 'Çıkış'} yapılamadı.")
        geo = {"latitude": lat, "longitude": lng, "distance_m": round(dist), "accuracy_m": float(req.get("accuracy_m") or 0), "at": _now()}
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
    if geo:
        await _db.attendance.update_one({"_id": rec["id"]}, {"$set": {f"geo_{action}": geo}})
        rec[f"geo_{action}"] = geo
    msg = f"{'Giriş' if action == 'check_in' else 'Çıkış'} {now_s} olarak kaydedildi."
    if action == "check_in" and rec.get("late_minutes"):
        msg += f" Mesai başlangıcına göre {rec['late_minutes']} dk geç."
    if action == "check_out":
        if rec.get("overtime_hours"):
            msg += f" Bugün {rec['hours']} sa çalışıldı, {rec['overtime_hours']} sa fazla mesai otomatik yazıldı."
        elif rec.get("early_leave_minutes"):
            msg += f" Mesai bitişinden {rec['early_leave_minutes']} dk erken çıkış."
        else:
            msg += f" Bugün {rec['hours']} sa çalışıldı."
    if geo:
        msg += f" (firma konumuna {geo['distance_m']} m)"
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
    await _db.attendance.update_one({"_id": att_id}, {"$set": {"employee_confirmed": False, "dispute_note": note, "disputed_at": _now()}})
    await _db.notifications.insert_one({"_id": str(uuid.uuid4()), "company_id": rec["company_id"], "type": "attendance_dispute", "title": "Puantaj itirazı",
                                        "message": f"{rec.get('employee_name')} {rec.get('date')} kaydına itiraz etti: {note[:120]}", "link": "/personnel?tab=attendance", "is_read": False, "created_at": _now()})
    return _clean(await _db.attendance.find_one({"_id": att_id}))
