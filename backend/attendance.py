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

DEFAULT_SCHEDULE = {"start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4], "days": {}, "late_tolerance_minutes": 10, "overtime_tolerance_minutes": 15, "count_early_as_overtime": False, "require_geo": True, "timezone": "Europe/Istanbul",
                    "overtime_method": "legal", "overtime_multiplier": 1.5, "holiday_multiplier": 2.0, "monthly_hours_divisor": 225, "notify_missing_checkin": True, "notify_late_checkin": True}
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


def merge_schedule(company: dict, employee: Optional[dict] = None) -> dict:
    s = {**DEFAULT_SCHEDULE, **((company or {}).get("work_schedule") or {})}
    s["days"] = dict(s.get("days") or {})
    if employee and employee.get("work_schedule"):
        ov = employee["work_schedule"]
        s = {**s, **{k: v for k, v in ov.items() if k != "days" and v not in (None, "", [])}}
        if ov.get("days"):
            s["days"] = {**s["days"], **{k: v for k, v in ov["days"].items() if v}}
    return s


def day_window(schedule: dict, weekday: int) -> dict:
    """Haftanın günü için etkin başlangıç/bitiş/mola (gün bazlı override varsa onu kullanır)."""
    d = (schedule.get("days") or {}).get(str(weekday)) or {}
    return {"start": d.get("start") or schedule["start"], "end": d.get("end") or schedule["end"],
            "break_minutes": int(d.get("break_minutes") if d.get("break_minutes") is not None else schedule.get("break_minutes") or 0)}


def compute_day(rec: dict, schedule: dict) -> dict:
    """check_in/check_out (HH:MM) → hours, normal_hours, overtime_hours, late_minutes, early_leave_minutes, is_off_day."""
    out = {"hours": 0.0, "normal_hours": 0.0, "overtime_hours": 0.0, "late_minutes": 0, "early_leave_minutes": 0, "is_off_day": False}
    try:
        wd = datetime.strptime(rec.get("date"), "%Y-%m-%d").weekday()
    except Exception:
        wd = 0
    out["is_off_day"] = wd not in (schedule.get("work_days") or DEFAULT_SCHEDULE["work_days"])
    ci, co = rec.get("check_in"), rec.get("check_out")
    win = day_window(schedule, wd)
    start, end = _hm(win["start"]), _hm(win["end"])
    if ci and not out["is_off_day"]:
        out["late_minutes"] = max(0, _hm(ci) - start - int(schedule.get("late_tolerance_minutes") or 0))
    if not (ci and co):
        return out
    a, b = _hm(ci), _hm(co)
    if b < a:
        b += 24 * 60
    worked = max(0, b - a - win["break_minutes"])
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
        if schedule.get("notify_late_checkin", True):
            await notify_managers(emp["company_id"], "attendance_late", f"Geç giriş: {emp['full_name']}",
                                  f"{emp['full_name']} bugün {now_s} saatinde giriş yaptı — mesai başlangıcına göre {rec['late_minutes']} dk geç.", dedupe_key=f"late:{emp['_id']}:{today}")
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
    await _db.notifications.insert_one({"_id": str(uuid.uuid4()), "company_id": company_id, "type": ntype, "title": title, "message": message, "link": link, "is_read": False, "created_at": _now()})
    mail = {"status": "skipped"}
    if _mail_account_fn and _smtp_send_fn:
        try:
            a = await _mail_account_fn(company_id)
            admins = await _db.users.find({"role": "admin", "email": {"$exists": True, "$ne": ""}}).to_list(20)
            to = sorted({u["email"] for u in admins if u.get("email")}) or [a["email"]]
            await _smtp_send_fn(a, to, f"[NexusHesap] {title}", message, html=f"<p><b>{title}</b></p><p>{message}</p>")
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
