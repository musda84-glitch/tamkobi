import { isDailyWage, periodWage, yevmiyeDaysOf } from "./personnelWage";

export function bonusDue(balance) {
  return Number(balance?.bonus_pending) || 0;
}

export function overtimeDue(balance) {
  if (balance?.overtime_due != null && Number.isFinite(Number(balance.overtime_due))) {
    return Number(balance.overtime_due) || 0;
  }
  return Number(balance?.overtime_pay) || 0;
}

export function remainingDue(balance, unpaidFallback = 0) {
  if (balance && balance.remaining != null && Number.isFinite(Number(balance.remaining))) {
    return Number(balance.remaining) || 0;
  }
  return unpaidFallback;
}

export function remainingLeaveDays(emp) {
  return (Number(emp?.annual_leave_days) || 14) - (Number(emp?.used_leave_days) || 0);
}

export function employeeCompRows(emp, balance, opts = {}) {
  const meal = Number(emp?.meal_allowance ?? balance?.meal_allowance ?? balance?.meal_due ?? 0) || 0;
  const yol = Number(emp?.transport_allowance ?? balance?.transport_allowance ?? balance?.transport_due ?? 0) || 0;
  const daily = isDailyWage(emp);
  const wage = daily ? (Number(emp?.daily_wage) || 0) : (Number(emp?.salary) || 0);
  const recordedDays = Math.max(0, Math.trunc(Number(opts.yevmiyeDays ?? emp?.yevmiye_days) || 0));
  const present = Math.max(0, Math.trunc(Number(opts.daysPresent) || 0));
  const prim = bonusDue(balance);
  const recordedAmt = Number(opts.yevmiyeAmount ?? emp?.yevmiye_due) || 0;
  const bonusValue = daily
    ? (recordedAmt > 0 ? recordedAmt : prim > 0 ? prim : periodWage(emp, recordedDays || present))
    : prim;
  const days = recordedDays > 0
    ? recordedDays
    : (daily && wage > 0 && bonusValue > 0 ? Math.round(bonusValue / wage) : present);
  const mesai = overtimeDue(balance);
  return [
    { key: "meal", label: "Yemek", value: meal },
    { key: "yol", label: "Yol", value: yol },
    { key: "salary", label: daily ? "Yevmiye" : "Maaş", value: wage },
    {
      key: "bonus",
      label: daily ? "Yevmiye günü" : "Prim hakedişi",
      value: bonusValue,
      hint: daily ? `${days} gün` : undefined,
      days: daily ? days : undefined,
    },
    { key: "overtime", label: "Fazla mesai ücreti", value: mesai },
    { key: "total", label: "Toplam", value: meal + yol + wage + bonusValue + mesai },
  ];
}

export function employeeCompGroups(rows) {
  const byKey = Object.fromEntries((rows || []).map((r) => [r.key, r]));
  const pick = (...keys) => keys.map((k) => byKey[k]).filter(Boolean);
  const wageTitle = byKey.salary?.label === "Yevmiye" ? "Yevmiye" : "Maaş";
  return [
    { key: "allowance", title: "Yan hak", rows: pick("meal", "yol") },
    { key: "wage", title: wageTitle, rows: pick("salary", "bonus") },
    { key: "sum", title: "Özet", rows: pick("overtime", "total") },
  ];
}

export function employeeCompRowCaption(row, daily) {
  const label = row.key === "salary" && daily ? `${row.label} / gün` : row.label;
  if (row.key === "bonus" && row.days != null) return `${label} · ${row.days} gün`;
  return label;
}

export function fmtCardMoney(n) {
  return `${Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
}
