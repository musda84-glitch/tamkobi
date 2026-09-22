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

export function referenceDailyWage(emp) {
  const wage = dailyWageOf(emp);
  if (wage > 0) return wage;
  const salary = Number(emp?.salary) || 0;
  if (salary > 0) return Math.round((salary / WORKDAYS_PER_MONTH) * 100) / 100;
  return 0;
}

export function yevmiyeAdjustedAmount(dailyWage, lateMinutes = 0, earlyMinutes = 0, scheduledMinutes = 480) {
  const wage = Number(dailyWage) || 0;
  const sched = Math.max(1, Math.trunc(Number(scheduledMinutes) || 480));
  const cut = Math.max(0, Math.trunc(Number(lateMinutes) || 0)) + Math.max(0, Math.trunc(Number(earlyMinutes) || 0));
  const worked = Math.max(0, sched - cut);
  return Math.round((wage * worked / sched) * 100) / 100;
}

export function yevmiyeAdjustmentNeeded(lateMinutes = 0, earlyMinutes = 0) {
  return (Number(lateMinutes) || 0) > 0 || (Number(earlyMinutes) || 0) > 0;
}

export function attendanceYevmiyeCoveredDays(bonuses) {
  return (bonuses || []).reduce((sum, b) => {
    if (String(b?.type || "") !== "yevmiye" || String(b?.source || "") !== "attendance") return sum;
    return sum + Math.max(0, Math.trunc(Number(b?.worked_days) || 1));
  }, 0);
}

export function yevmiyeStatusLine(rec) {
  const adj = rec?.yevmiye_adjustment_request || {};
  const full = Number(rec?.yevmiye_full_amount ?? adj.full_amount) || 0;
  const proposed = Number(adj.proposed_amount ?? adj.final_amount) || 0;
  if (adj.status === "pending" && proposed) {
    return `Yevmiye ${proposed} ₺ önerildi — yönetici onayı bekleniyor`;
  }
  if (adj.status === "approved") {
    return `Yevmiye ${adj.final_amount ?? proposed} ₺ (geç/erken onaylandı)`;
  }
  if (adj.status === "rejected" && full) {
    return `Yevmiye ${full} ₺ (kart ücreti)`;
  }
  if (full) return `Yevmiye ${full} ₺ (kart ücreti)`;
  return "";
}
