export const WORKDAYS_PER_MONTH = 26;

export function isDailyWage(emp) {
  const t = String(emp?.pay_type || "").toLowerCase();
  if (t === "daily" || t === "yevmiye" || t === "gunluk" || t === "günlük") return true;
  if (t === "monthly" || t === "aylik" || t === "aylık" || t === "maas" || t === "maaş") return false;
  return Number(emp?.daily_wage) > 0;
}

export function dailyWageOf(emp) {
  const n = Number(emp?.daily_wage);
  return Number.isFinite(n) ? n : 0;
}

export function yevmiyeDaysOf(emp) {
  const recorded = Math.max(0, Math.trunc(Number(emp?.yevmiye_days) || 0));
  if (recorded > 0) return recorded;
  const wage = dailyWageOf(emp);
  const amt = Number(emp?.yevmiye_due ?? emp?.balance?.bonus_pending) || 0;
  if (wage > 0 && amt > 0) return Math.round(amt / wage);
  return 0;
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
