"""Aylık maaş veya günlük yevmiye — dönem ücreti."""

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
