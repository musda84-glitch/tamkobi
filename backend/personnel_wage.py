"""Aylık maaş veya günlük yevmiye — dönem ücreti."""
from typing import Any

WORKDAYS_PER_MONTH = 26


def pay_type_of(emp: dict | None) -> str:
    raw = str((emp or {}).get("pay_type") or "monthly").strip().lower()
    return "daily" if raw in ("daily", "yevmiye", "gunluk", "günlük") else "monthly"


def daily_wage_of(emp: dict | None) -> float:
    try:
        return float((emp or {}).get("daily_wage") or 0)
    except (TypeError, ValueError):
        return 0.0


def period_wage(emp: dict | None, days_present: int = 0) -> float:
    """Bordro neti: yevmiyeli = günlük × gelen gün; aylık = salary."""
    emp = emp or {}
    if pay_type_of(emp) == "daily":
        days = max(0, int(days_present or 0))
        return round(daily_wage_of(emp) * days, 2)
    try:
        return float(emp.get("salary") or 0)
    except (TypeError, ValueError):
        return 0.0


def monthly_load(emp: dict | None) -> float:
    """Liste / yük tahmini: yevmiye × 26 iş günü."""
    emp = emp or {}
    if pay_type_of(emp) == "daily":
        return round(daily_wage_of(emp) * WORKDAYS_PER_MONTH, 2)
    try:
        return float(emp.get("salary") or 0)
    except (TypeError, ValueError):
        return 0.0


def wage_line(days_present: int = 0, daily_wage: float = 0) -> str:
    """Bordro açıklaması: '18 gün × 1500 ₺'."""
    try:
        days = max(0, int(days_present or 0))
    except (TypeError, ValueError):
        days = 0
    try:
        wage = float(daily_wage or 0)
    except (TypeError, ValueError):
        wage = 0.0
    if wage == int(wage):
        wage_s = str(int(wage))
    else:
        wage_s = f"{wage:.2f}".rstrip("0").rstrip(".")
    return f"{days} gün × {wage_s} ₺"


def payroll_wage_line(payroll: dict | None) -> str:
    p = payroll or {}
    if pay_type_of(p) != "daily":
        return ""
    return wage_line(p.get("worked_days"), p.get("daily_wage"))


def reference_daily_wage(emp: dict | None) -> float:
    """Karttaki günlük ücret; yoksa aylık / 26."""
    wage = daily_wage_of(emp)
    if wage > 0:
        return wage
    try:
        salary = float((emp or {}).get("salary") or 0)
    except (TypeError, ValueError):
        salary = 0.0
    if salary > 0:
        return round(salary / WORKDAYS_PER_MONTH, 2)
    return 0.0


def _hhmm_minutes(value: Any) -> int:
    raw = str(value or "09:00")
    parts = raw.split(":")
    try:
        return int(parts[0]) * 60 + int(parts[1] if len(parts) > 1 else 0)
    except (TypeError, ValueError):
        return 0


def scheduled_work_minutes(schedule: dict | None, window: dict | None = None) -> int:
    """Planlanan günlük çalışma dakikası; window varsa (gün bazlı mesai) onu kullanır."""
    s = schedule or {}
    win = window if isinstance(window, dict) else {}
    start = _hhmm_minutes(win.get("start") or s.get("start") or "09:00")
    end = _hhmm_minutes(win.get("end") or s.get("end") or "18:00")
    if end <= start:
        end += 24 * 60
    brk_src = win.get("break_minutes") if win.get("break_minutes") is not None else s.get("break_minutes")
    try:
        brk = int(brk_src or 0)
    except (TypeError, ValueError):
        brk = 0
    return max(1, end - start - max(0, brk))


def yevmiye_adjusted_amount(
    daily_wage: float,
    late_minutes: int = 0,
    early_minutes: int = 0,
    scheduled_minutes: int = 480,
) -> float:
    """Geç giriş + erken çıkış dakikası orantılı düşülür."""
    try:
        wage = float(daily_wage or 0)
    except (TypeError, ValueError):
        wage = 0.0
    sched = max(1, int(scheduled_minutes or 480))
    cut = max(0, int(late_minutes or 0)) + max(0, int(early_minutes or 0))
    worked = max(0, sched - cut)
    return round(wage * worked / sched, 2)


def yevmiye_adjustment_needed(late_minutes: int = 0, early_minutes: int = 0) -> bool:
    return int(late_minutes or 0) > 0 or int(early_minutes or 0) > 0


def calculated_day_wage(emp: dict | None, rec: dict | None = None, schedule: dict | None = None) -> float:
    """Çalışılan gün için hesaplanan ücret (yevmiye veya aylık/26; geç/erken orantılı)."""
    rec = rec or {}
    base = reference_daily_wage(emp)
    full = _num(rec.get("yevmiye_full_amount"), base) or base
    if full <= 0:
        return 0.0
    adj = rec.get("yevmiye_adjustment_request") or {}
    status = str(adj.get("status") or "").strip().lower()
    if status == "approved":
        try:
            return round(float(adj.get("proposed_amount")), 2)
        except (TypeError, ValueError):
            pass
    if status == "rejected":
        try:
            return round(float(adj.get("full_amount") or full), 2)
        except (TypeError, ValueError):
            return round(full, 2)
    late = int(rec.get("late_minutes") or 0)
    early = int(rec.get("early_leave_minutes") or 0)
    if status == "pending" and adj.get("proposed_amount") is not None:
        try:
            return round(float(adj.get("proposed_amount")), 2)
        except (TypeError, ValueError):
            pass
    if yevmiye_adjustment_needed(late, early):
        snap = rec.get("schedule_snapshot") if isinstance(rec.get("schedule_snapshot"), dict) else None
        return yevmiye_adjusted_amount(full, late, early, scheduled_work_minutes(schedule, snap))
    return round(full, 2)


def pending_yevmiye_adjustment(
    emp: dict | None,
    rec: dict | None = None,
    schedule: dict | None = None,
    now: str | None = None,
) -> dict | None:
    """Geç/erken kesintisi için yönetici onayı bekleyen yevmiye kaydı (bonus şart değil)."""
    rec = rec or {}
    emp = emp or {}
    full = _num(rec.get("yevmiye_full_amount"), reference_daily_wage(emp)) or reference_daily_wage(emp)
    late = int(rec.get("late_minutes") or 0)
    early = int(rec.get("early_leave_minutes") or 0)
    snap = rec.get("schedule_snapshot") if isinstance(rec.get("schedule_snapshot"), dict) else None
    proposed = yevmiye_adjusted_amount(full, late, early, scheduled_work_minutes(schedule, snap))
    if not yevmiye_adjustment_needed(late, early) or proposed >= full:
        return None
    prev = rec.get("yevmiye_adjustment_request") or {}
    prev_status = str(prev.get("status") or "").strip().lower()
    if prev_status in ("approved", "rejected") and int(prev.get("late_minutes") or 0) == late and int(prev.get("early_leave_minutes") or 0) == early:
        return None
    if prev_status == "pending":
        return {
            **prev,
            "status": "pending",
            "full_amount": full,
            "proposed_amount": proposed,
            "late_minutes": late,
            "early_leave_minutes": early,
        }
    return {
        "status": "pending",
        "full_amount": full,
        "proposed_amount": proposed,
        "late_minutes": late,
        "early_leave_minutes": early,
        "requested_at": prev.get("requested_at") or now,
    }


def puantaj_day_wage_fields(emp: dict | None, rec: dict | None = None, schedule: dict | None = None) -> dict:
    """Puantaj gün satırı: görünen ücret + kes/kesme sorusu alanları."""
    rec = rec or {}
    wage = calculated_day_wage(emp, rec, schedule)
    full = _num(rec.get("yevmiye_full_amount"), reference_daily_wage(emp)) or reference_daily_wage(emp)
    adj = rec.get("yevmiye_adjustment_request") or {}
    status = str(adj.get("status") or "").strip().lower()
    late = int(rec.get("late_minutes") or 0)
    early = int(rec.get("early_leave_minutes") or 0)
    snap = rec.get("schedule_snapshot") if isinstance(rec.get("schedule_snapshot"), dict) else None
    proposed = round(full, 2)
    if adj.get("proposed_amount") is not None:
        try:
            proposed = round(float(adj.get("proposed_amount")), 2)
        except (TypeError, ValueError):
            proposed = round(full, 2)
    elif yevmiye_adjustment_needed(late, early):
        proposed = yevmiye_adjusted_amount(full, late, early, scheduled_work_minutes(schedule, snap))
    decided = status in ("approved", "rejected")
    ask = (not decided) and yevmiye_adjustment_needed(late, early) and proposed + 0.009 < full
    return {
        "wage": wage,
        "wage_full": round(full, 2) if full else 0.0,
        "wage_proposed": proposed,
        "wage_adjustment_status": status,
        "wage_ask": bool(ask),
        "early_leave_minutes": early,
    }


def _num(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def attendance_yevmiye_covered_days(bonuses: list | None) -> int:
    """Görev girişinden yazılmış yevmiye günleri — bordroda tekrar sayılmaz."""
    total = 0
    for b in bonuses or []:
        if str(b.get("type") or "") != "yevmiye":
            continue
        if str(b.get("source") or "") != "attendance":
            continue
        try:
            total += max(0, int(b.get("worked_days") or 1))
        except (TypeError, ValueError):
            total += 1
    return total


def payroll_days_minus_attendance_yevmiye(days_present: int, covered_days: int) -> int:
    try:
        present = max(0, int(days_present or 0))
    except (TypeError, ValueError):
        present = 0
    try:
        covered = max(0, int(covered_days or 0))
    except (TypeError, ValueError):
        covered = 0
    return max(0, present - covered)
