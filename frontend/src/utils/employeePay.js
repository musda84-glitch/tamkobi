import { isDailyWage } from "./personnelWage";

export const EMPLOYEE_PAY_KINDS = [
  { key: "salary", label: "Maaş", field: "unpaid_payroll", testid: "emp-pay-kind-salary" },
  { key: "overtime", label: "Mesai", field: "overtime_due", testid: "emp-pay-kind-overtime" },
  { key: "bonus", label: "Prim", field: "bonus_pending", testid: "emp-pay-kind-bonus" },
  { key: "meal", label: "Yemek", field: "meal_due", testid: "emp-pay-kind-meal" },
  { key: "transport", label: "Yol", field: "transport_due", testid: "emp-pay-kind-transport" },
  { key: "expense", label: "Masraf", field: "unpaid_expenses", testid: "emp-pay-kind-expense" },
];

export function payDayOf(emp) {
  const fromField = Number(emp?.pay_day);
  if (fromField >= 1 && fromField <= 31) return fromField;
  const day = Number(String(emp?.pay_start_date || "").slice(8, 10));
  return day >= 1 && day <= 31 ? day : 1;
}

export function employeePayKindLabel(key, emp) {
  if (key === "salary" && isDailyWage(emp)) return "Bakiye";
  if (key === "bonus" && isDailyWage(emp)) return "Yevmiye";
  return EMPLOYEE_PAY_KINDS.find((k) => k.key === key)?.label || key;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Kart bakiyesinden ödenebilir alacak satırları (tutarı 0 olanlar gizli). */
export function employeeDueLines(balance, emp) {
  const b = balance || {};
  return EMPLOYEE_PAY_KINDS.map((k) => ({
    ...k,
    label: employeePayKindLabel(k.key, emp),
    amount: round2(b[k.field]),
  })).filter((l) => l.amount > 0.004);
}

export function employeePayTotal(lines, mode, selectedKeys) {
  const keys = Array.isArray(selectedKeys) ? selectedKeys : [];
  const pick = mode === "split" ? (lines || []).filter((l) => keys.includes(l.key)) : (lines || []);
  return round2(pick.reduce((s, l) => s + (Number(l.amount) || 0), 0));
}

export function employeePayKindsForSubmit(mode, lines, selectedKeys) {
  if (mode === "all") return (lines || []).map((l) => l.key);
  const keys = Array.isArray(selectedKeys) ? selectedKeys : [];
  return (lines || []).filter((l) => keys.includes(l.key)).map((l) => l.key);
}
