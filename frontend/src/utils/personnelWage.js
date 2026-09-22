export const WORKDAYS_PER_MONTH = 26;

export function isDailyWage(emp) {
  const t = String(emp?.pay_type || "monthly").toLowerCase();
  return t === "daily" || t === "yevmiye" || t === "gunluk" || t === "günlük";
}

export function dailyWageOf(emp) {
  const n = Number(emp?.daily_wage);
  return Number.isFinite(n) ? n : 0;
}

export function periodWage(emp, daysPresent = 0) {
  if (isDailyWage(emp)) {
    const days = Math.max(0, Math.trunc(Number(daysPresent) || 0));
    return Math.round(dailyWageOf(emp) * days * 100) / 100;
  }
  return Number(emp?.salary) || 0;
}

export function monthlyLoad(emp) {
  if (isDailyWage(emp)) {
    return Math.round(dailyWageOf(emp) * WORKDAYS_PER_MONTH * 100) / 100;
  }
  return Number(emp?.salary) || 0;
}

export function totalMonthlyLoad(employees) {
  return (employees || []).reduce((sum, e) => sum + monthlyLoad(e), 0);
}

export function payrollWageLine(p) {
  if (!isDailyWage(p)) return "";
  const days = Math.max(0, Math.trunc(Number(p?.worked_days) || 0));
  const wage = dailyWageOf(p);
  return `${days} gün × ${wage.toLocaleString("tr-TR")} ₺`;
}
