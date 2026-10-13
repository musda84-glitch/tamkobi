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

export const PAYMENT_LINE_KINDS = [
  { key: "salary", label: "Maaş" },
  { key: "remaining", label: "Kalan ödeme" },
  { key: "advance", label: "Avans" },
  { key: "bonus", label: "Prim" },
  { key: "expense", label: "Masraf iadesi" },
  { key: "meal", label: "Yol/Yemek" },
];

const CASH_TYPES = new Set(["cash", "kasa", "cashbox", "nakit", "cash_box"]);
const POS_TYPES = new Set(["pos", "okc_pos", "credit_card", "customer_credit_card"]);
const SALARY_LINE_KINDS = new Set(["salary", "remaining"]);
export const SGK_BANK_MSG = "SGK'lı personelin resmi maaşı bankadan ödenmelidir";
export const CASH_SHORT_MSG = "Kasa bakiyesi yetersiz";
export const OVERPAY_MSG = "sonraki maaştan düşülecek";

export function istanbulPeriod(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit" }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return y && m ? `${y}-${m}` : "";
}

export function shiftPeriod(period, delta) {
  const [y, m] = String(period || "").split("-").map(Number);
  if (!y || !m) return period || "";
  const idx = y * 12 + (m - 1) + delta;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}`;
}

export function accountTypeOf(acc) {
  return String(acc?.type || "").toLowerCase();
}

export function accountIdOf(acc) {
  return acc?.id || acc?._id || "";
}

/** Maaş için varsayılan: banka, yoksa kasa. POS/kart seçilmez. */
export function defaultPayAccount(accounts) {
  const list = accounts || [];
  const bank = list.find((a) => accountTypeOf(a) === "bank");
  if (bank) return bank;
  return list.find((a) => CASH_TYPES.has(accountTypeOf(a))) || null;
}

export function sgkInsured(emp) {
  return emp?.sgk_insured === true || Boolean(String(emp?.sgk_number || "").trim());
}

export function officialSalaryOf(emp) {
  if (!sgkInsured(emp)) return 0;
  if (emp?.official_salary !== undefined && emp?.official_salary !== null && emp?.official_salary !== "") {
    return round2(emp.official_salary);
  }
  return round2(emp?.salary);
}

export function sgkRuleOn(companyOrFlag) {
  if (typeof companyOrFlag === "boolean") return companyOrFlag;
  const company = companyOrFlag || {};
  if (company.settings && Object.prototype.hasOwnProperty.call(company.settings, "sgk_salary_bank_only")) {
    return Boolean(company.settings.sgk_salary_bank_only);
  }
  if (Object.prototype.hasOwnProperty.call(company, "sgk_salary_bank_only")) return Boolean(company.sgk_salary_bank_only);
  return true;
}

export function sgkCashBlocked(emp, ruleOnFlag, lines, accounts) {
  if (!sgkRuleOn(ruleOnFlag) || !sgkInsured(emp)) return null;
  const official = officialSalaryOf(emp);
  const salaryLines = (lines || []).filter((l) => SALARY_LINE_KINDS.has(l.kind) && Number(l.amount) > 0.004);
  if (!salaryLines.length || official <= 0.004) return null;
  const byId = Object.fromEntries((accounts || []).map((a) => [accountIdOf(a), a]));
  let bank = 0;
  let other = 0;
  for (const l of salaryLines) {
    const id = l.accountId || l.account_id;
    const acc = byId[id];
    const amt = Number(l.amount) || 0;
    if (accountTypeOf(acc) === "bank" && !l.partner_id) bank += amt;
    else other += amt;
  }
  const need = Math.min(official, salaryLines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  if (bank + 0.004 < need && other > 0.004) return SGK_BANK_MSG;
  return null;
}

export function cashShortfallWarning(lines, accounts) {
  const byId = Object.fromEntries((accounts || []).map((a) => [accountIdOf(a), a]));
  const totals = {};
  for (const l of lines || []) {
    const id = l.accountId || l.account_id;
    const acc = byId[id];
    if (!id || !CASH_TYPES.has(accountTypeOf(acc))) continue;
    totals[id] = (totals[id] || 0) + (Number(l.amount) || 0);
  }
  for (const [id, total] of Object.entries(totals)) {
    const bal = Number(byId[id]?.current_balance);
    if (Number.isFinite(bal) && bal + 0.004 < total) return CASH_SHORT_MSG;
  }
  return null;
}

export function posSalaryWarning(lines, accounts) {
  const byId = Object.fromEntries((accounts || []).map((a) => [accountIdOf(a), a]));
  const hit = (lines || []).some((l) => SALARY_LINE_KINDS.has(l.kind) && POS_TYPES.has(accountTypeOf(byId[l.accountId || l.account_id])));
  return hit ? "POS/kart hesabı maaşta varsayılan değildir." : null;
}

export function paymentPreview(remaining, lines) {
  const paying = round2((lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const after = round2((Number(remaining) || 0) - paying);
  return {
    paying,
    remainingAfter: after,
    overpaid: after < -0.004,
    message: after < -0.004 ? OVERPAY_MSG : "",
  };
}

export function initialPaymentKind(initialKind) {
  if (initialKind === "advance") return "advance";
  if (initialKind === "meal" || initialKind === "transport") return "meal";
  if (initialKind === "bonus" || initialKind === "expense" || initialKind === "salary" || initialKind === "remaining") return initialKind;
  if (initialKind === "overtime") return "bonus";
  return "salary";
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
