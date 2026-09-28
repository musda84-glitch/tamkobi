"""Atölye Duraklat: yalnızca mesai / mola / fazla mesai penceresinde; bitiş+toleransta otomatik."""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import attendance as att

PAUSE_OUTSIDE_DETAIL = (
    "Duraklat yalnızca mesai, mola veya fazla mesai saatlerinde kullanılabilir."
)
PAUSE_NO_OPERATOR_DETAIL = "Duraklat için operatör (personel) seçilmelidir."
AUTO_PAUSE_REASON = "Mesai bitişi (tolerans dahil) — otomatik duraklatma"


def _win_bounds(
    schedule: dict,
    date: str,
    plan: Optional[dict] = None,
) -> Optional[Tuple[int, int, int]]:
    """(start_m, end_m, break_minutes) veya izin/kapalı günde None."""
    if plan and plan.get("off"):
        return None
    try:
        wd = __import__("datetime").datetime.strptime(str(date)[:10], "%Y-%m-%d").weekday()
    except Exception:
        wd = att.local_now(schedule).weekday()
    if plan and (plan.get("start") or plan.get("end")):
        start = str(plan.get("start") or att.day_window(schedule, wd)["start"])[:5]
        end = str(plan.get("end") or att.day_window(schedule, wd)["end"])[:5]
        br = int(plan.get("break_minutes") if plan.get("break_minutes") is not None else att.day_window(schedule, wd)["break_minutes"])
        return att._hm(start), att._hm(end), max(0, br)
    if wd not in (schedule.get("work_days") or att.DEFAULT_SCHEDULE["work_days"]):
        return None
    win = att.day_window(schedule, wd)
    return att._hm(str(win["start"])[:5]), att._hm(str(win["end"])[:5]), max(0, int(win["break_minutes"] or 0))


def break_window_minutes(start_m: int, end_m: int, break_minutes: int) -> Optional[Tuple[int, int]]:
    """Mola aralığı: mesai ortasına ortalanmış (saat aralığı yoksa süreye göre)."""
    br = max(0, int(break_minutes or 0))
    if br <= 0:
        return None
    if end_m >= start_m:
        span = end_m - start_m
    else:
        span = (24 * 60 - start_m) + end_m
    if span <= 0:
        return None
    mid = start_m + span // 2
    half = br // 2
    b0 = mid - half
    b1 = b0 + br
    return b0 % (24 * 60), b1 % (24 * 60) if b1 >= 24 * 60 else b1


def _in_range(now_m: int, a: int, b: int) -> bool:
    """[a, b] — gece sarması (b < a) destekli."""
    if b >= a:
        return a <= now_m <= b
    return now_m >= a or now_m <= b


def pause_deadline_hm(
    schedule: dict,
    rec: Optional[dict],
    date: str,
    plan: Optional[dict] = None,
) -> Optional[str]:
    """Duraklat izni / otomatik duraklatma sınırı: beklenen bitiş + çıkış toleransı."""
    end = att.expected_checkout_hm(rec, schedule, date, plan)
    if not end:
        return None
    tol = int(schedule.get("exit_tolerance_minutes") or 0)
    if tol <= 0:
        return str(end)[:5]
    return att._add_minutes(str(end)[:5], tol)


def resolve_pause_phase(
    *,
    schedule: dict,
    rec: Optional[dict] = None,
    date: Optional[str] = None,
    plan: Optional[dict] = None,
    now_hm: Optional[str] = None,
) -> Dict[str, Any]:
    """Mesai / mola / fazla mesai / dışında — Duraklat izni."""
    sch = schedule or att.DEFAULT_SCHEDULE
    day = date or att._today(sch)
    now_s = (now_hm or att.local_now(sch).strftime("%H:%M"))[:5]
    now_m = att._hm(now_s)
    bounds = _win_bounds(sch, day, plan)
    deadline = pause_deadline_hm(sch, rec, day, plan)
    if not bounds or not deadline:
        return {
            "allowed": False,
            "phase": "outside",
            "reason": PAUSE_OUTSIDE_DETAIL,
            "now": now_s,
            "deadline": None,
            "mesai_end": None,
            "break": None,
        }
    start_m, end_m, br = bounds
    mesai_end = att.day_end_hm(sch, day, plan)
    expected = att.expected_checkout_hm(rec, sch, day, plan) or mesai_end
    deadline_m = att._hm(str(deadline)[:5])
    # İzin penceresi: mesai başlangıcı → beklenen bitiş + çıkış toleransı
    if not _in_range(now_m, start_m, deadline_m):
        return {
            "allowed": False,
            "phase": "outside",
            "reason": PAUSE_OUTSIDE_DETAIL,
            "now": now_s,
            "deadline": deadline,
            "mesai_end": mesai_end,
            "break": None,
        }
    br_win = break_window_minutes(start_m, end_m, br)
    if br_win and _in_range(now_m, br_win[0], br_win[1]):
        phase = "mola"
    elif expected and mesai_end and att._hm(str(expected)[:5]) > att._hm(str(mesai_end)[:5]) and now_m > end_m:
        phase = "fazla_mesai"
    elif now_m > end_m:
        # Bitiş sonrası tolerans (henüz otomatik duraklatma yok)
        phase = "tolerans"
    else:
        phase = "mesai"
    return {
        "allowed": True,
        "phase": phase,
        "reason": None,
        "now": now_s,
        "deadline": deadline,
        "mesai_end": mesai_end,
        "expected_end": expected,
        "break": (
            {"start": att._add_minutes("00:00", br_win[0])[:5], "end": att._add_minutes("00:00", br_win[1])[:5]}
            if br_win
            else None
        ),
    }


def should_auto_pause_now(
    *,
    schedule: dict,
    rec: Optional[dict] = None,
    date: Optional[str] = None,
    plan: Optional[dict] = None,
    now_hm: Optional[str] = None,
) -> bool:
    """Beklenen bitiş + çıkış toleransı geçildiyse otomatik Duraklat."""
    sch = schedule or att.DEFAULT_SCHEDULE
    day = date or att._today(sch)
    now_s = (now_hm or att.local_now(sch).strftime("%H:%M"))[:5]
    if not _win_bounds(sch, day, plan):
        return False
    deadline = pause_deadline_hm(sch, rec, day, plan)
    if not deadline:
        return False
    try:
        return att._hm(now_s) >= att._hm(str(deadline)[:5])
    except Exception:
        return False


async def pause_policy_for_employee(
    emp: Optional[dict],
    company: Optional[dict],
    *,
    now_hm: Optional[str] = None,
) -> Dict[str, Any]:
    """Personel için Duraklat politikası (vardiya planı + puantaj OT dahil)."""
    if not emp:
        return {
            "allowed": False,
            "phase": "outside",
            "reason": PAUSE_NO_OPERATOR_DETAIL,
            "now": now_hm,
            "deadline": None,
        }
    sch = att.merge_schedule(company or {}, emp)
    day = att._today(sch)
    plan = None
    rec = None
    db = att._db
    if db is not None:
        plan = await db.shift_plans.find_one({"employee_id": emp.get("_id") or emp.get("id"), "date": day})
        rec = await db.attendance.find_one({"employee_id": emp.get("_id") or emp.get("id"), "date": day}) or {}
    return resolve_pause_phase(schedule=sch, rec=rec, date=day, plan=plan, now_hm=now_hm)


async def run_auto_pause_work_orders(company_id: Optional[str] = None) -> list:
    """Mesai bitiş + çıkış toleransı geçen operatörlerin devam eden iş emirlerini duraklat."""
    from datetime import datetime, timezone

    db = att._db
    if db is None:
        return []
    results = []
    q = {"_id": company_id} if company_id else {}
    async for company in db.companies.find(q):
        base = att.merge_schedule(company)
        now = att.local_now(base)
        today = now.strftime("%Y-%m-%d")
        now_s = now.strftime("%H:%M")
        emps = await db.employees.find({"company_id": company["_id"], "status": "active"}).to_list(500)
        for emp in emps:
            sch = att.merge_schedule(company, emp)
            plan = await db.shift_plans.find_one({"employee_id": emp["_id"], "date": today})
            rec = await db.attendance.find_one({"employee_id": emp["_id"], "date": today}) or {}
            if not should_auto_pause_now(schedule=sch, rec=rec, date=today, plan=plan, now_hm=now_s):
                continue
            name = str(emp.get("full_name") or "").strip()
            if not name:
                continue
            wos = await db.work_orders.find(
                {
                    "company_id": company["_id"],
                    "status": "in_progress",
                    "$or": [{"operator_name": name}, {"assigned_name": name}],
                }
            ).to_list(200)
            if not wos:
                continue
            now_iso = datetime.now(timezone.utc).isoformat()
            ids = [w["_id"] for w in wos]
            await db.work_orders.update_many(
                {"_id": {"$in": ids}},
                {
                    "$set": {"status": "paused", "paused_at": now_iso, "auto_paused": True},
                    "$push": {
                        "logs": {
                            "at": now_iso,
                            "action": "pause",
                            "by": name,
                            "note": AUTO_PAUSE_REASON,
                        }
                    },
                },
            )
            results.append(
                {
                    "company_id": company["_id"],
                    "employee_id": emp["_id"],
                    "employee_name": name,
                    "paused": len(ids),
                    "work_order_ids": ids,
                }
            )
    return results
