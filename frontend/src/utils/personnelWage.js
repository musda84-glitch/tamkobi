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

export function parseYevmiyeDays(raw) {
  const n = Math.trunc(Number(String(raw || "").trim().replace(",", ".")));
  if (!Number.isFinite(n) || n < 1 || n > 31) return null;
  return n;
}

export function parseYevmiyeWage(raw) {
  const n = Number(String(raw || "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function yevmiyeAddHint(existingDays = 0, newDays = 0) {
  if (existingDays > 0 && newDays > 0) return `${existingDays} gün + ${newDays} gün = ${existingDays + newDays} gün`;
  if (existingDays > 0) return `Mevcut ${existingDays} gün · yazılan gün artı olarak eklenir`;
  return "Yazılan gün personel alacağına eklenir.";
}

export function yevmiyeDaysLine(emp, days = 0, wageOverride) {
  const d = Math.max(0, Math.trunc(Number(days) || 0));
  const wage = wageOverride != null ? Number(wageOverride) : dailyWageOf(emp);
  return `${d} gün × ${wage.toLocaleString("tr-TR")} ₺`;
}

export function yevmiyePayPayload(employeeId, emp, daysRaw, period, accountId, note, wageRaw = "") {
  const days = parseYevmiyeDays(daysRaw) || 0;
  const wage = parseYevmiyeWage(wageRaw) ?? dailyWageOf(emp);
  return {
    employee_id: employeeId,
    type: "yevmiye",
    amount: periodWage({ ...emp, daily_wage: wage, pay_type: "daily" }, days),
    period,
    note: (note || "").trim() || yevmiyeDaysLine({ daily_wage: wage }, days, wage),
    worked_days: days,
    daily_wage: wage,
  };
}

export function ledgerPayPayload(employeeId, side, amount, period, note) {
  const debt = side === "borc";
  return {
    employee_id: employeeId,
    type: debt ? "borc" : "bakiye",
    amount: Number(String(amount || "").replace(",", ".")) || 0,
    period,
    note: (note || "").trim() || (debt ? "Borç" : "Bakiye ödemesi"),
  };
}

export function employeePayActionTitle(key, emp) {
  if (key === "salary") return isDailyWage(emp) ? "Bakiye öde" : "Maaş";
  if (key === "bonus") return isDailyWage(emp) ? "Yevmiye günü" : "Prim öde";
  return "";
}
