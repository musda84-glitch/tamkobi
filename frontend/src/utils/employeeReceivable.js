import { empIdOf } from "./personnelIds";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Ödenmemiş bordro tutarı (tahakkuk). */
export function unpaidPayrollTotal(payrolls, emp) {
  const eid = empIdOf(emp);
  if (!eid) return 0;
  return (payrolls || []).reduce((sum, p) => {
    if (empIdOf(p) !== eid) return sum;
    if (p.status === "paid") return sum;
    return sum + num(p.final_payable ?? p.net_salary);
  }, 0);
}

/**
 * Liste kartındaki Kalan Alacak: API bakiyesi + tahakkuk edilip
 * API'ye henüz yansımayan ödenmemiş bordro.
 */
export function employeeReceivableAmount(emp, payrolls = []) {
  const bal = emp?.balance || {};
  const apiRem = num(bal.remaining);
  const apiPay = num(bal.unpaid_payroll);
  const localPay = unpaidPayrollTotal(payrolls, emp);
  const gap = Math.max(0, Math.round((localPay - apiPay) * 100) / 100);
  return Math.round((apiRem + gap) * 100) / 100;
}
