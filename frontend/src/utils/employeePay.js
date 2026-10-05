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
  const have = new Set((lines || []).map((l) => l.key));
  return keys.filter((k) => have.has(k) || k === "salary");
}

const PAY_KIND_KEYS = new Set(EMPLOYEE_PAY_KINDS.map((k) => k.key));

/** Öde modalı: belirli kalem veya tüm bakiye. */
export function employeePayModalStart(initialKind, lines) {
  if (initialKind === "advance") return { mode: "split", selected: [] };
  if (PAY_KIND_KEYS.has(initialKind)) return { mode: "split", selected: [initialKind] };
  return { mode: "all", selected: (lines || []).map((l) => l.key) };
}

export function employeePayModalTitle(initialKind, emp) {
  const name = emp?.full_name || "";
  if (initialKind === "advance") return name ? `Avans — ${name}` : "Avans";
  if (PAY_KIND_KEYS.has(initialKind)) {
    const label = employeePayKindLabel(initialKind, emp);
    return name ? `${label} — ${name}` : label;
  }
  return name ? `Ödeme — ${name}` : "Ödeme";
}

/** Ücret kaydı sonrası: yemek/yol hak edişinde yazıldıysa veya planlandıysa mesaj. */
export function employeeAllowanceSaveMessage(accrual, startDate, fallback = "Ücret ve mesai bilgileri kaydedildi.") {
  if (!accrual) return fallback;
  if (Number(accrual?.posted_count) > 0) return accrual.message || "Yemek/yol hak edişi yazıldı.";
  const due = accrual?.scheduled_date
    || (accrual?.skipped || []).find((s) => s.reason === "not_due")?.due_date
    || startDate;
  if (due) {
    const [y, m, d] = String(due).slice(0, 10).split("-");
    const label = d && m && y ? `${d}.${m}.${y}` : due;
    return `Kaydedildi. ${label} tarihinde yemek/yol alacağa yazılacak.`;
  }
  return accrual?.message || fallback;
}
