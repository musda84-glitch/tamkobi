import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Banknote, Plus, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";
import { useEscape } from "../utils/useEscape";
import { formatTrAmount } from "../utils/money";
import { MoneyInput } from "./MoneyInput";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { todayIsoDate } from "../utils/partnerTx";
import {
  CASH_SHORT_MSG,
  PAYMENT_LINE_KINDS,
  SGK_BANK_MSG,
  accountIdOf,
  cashShortfallWarning,
  defaultPayAccount,
  employeePayModalTitle,
  hasPayStartDate,
  initialPaymentKind,
  istanbulPeriod,
  PAY_START_MISSING_MSG,
  paymentPreview,
  posSalaryWarning,
  sgkCashBlocked,
  shiftPeriod,
} from "../utils/employeePay";
import { notifyDataChanged } from "../utils/dataRefresh";

const fmt = (n) => formatTrAmount(Number(n) || 0);
const inputCls = "w-full border border-slate-200 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none";

function newIdemKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `pay_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function emptyLine(kind, accountId) {
  return { key: newIdemKey(), kind: kind || "salary", amount: "", accountId: accountId || "", description: "" };
}

export const EmployeePayModal = ({ employee, companyId, accounts, card, initialKind, sgkSalaryBankOnly = true, onClose, onDone }) => {
  useEscape(onClose);
  const e = employee || {};
  const empId = e.id || e._id;
  const [month, setMonth] = useState(() => card?.balance?.month || istanbulPeriod());
  const [summary, setSummary] = useState(() => card?.balance || {});
  const [date, setDate] = useState(() => todayIsoDate());
  const [rows, setRows] = useState(() => [emptyLine(initialPaymentKind(initialKind), "")]);
  const [busy, setBusy] = useState(false);
  const [idemKey] = useState(newIdemKey);

  const preferred = useMemo(() => defaultPayAccount(accounts), [accounts]);

  useEffect(() => {
    const id = accountIdOf(preferred);
    if (!id) return;
    setRows((prev) => prev.map((r) => (r.accountId ? r : { ...r, accountId: id })));
  }, [preferred]);

  useEffect(() => {
    if (!empId || !month) return undefined;
    let cancel = false;
    axios.get(`${API_URL}/personnel/employees/${empId}/card`, { params: { month } })
      .then((r) => { if (!cancel && r.data?.balance) setSummary(r.data.balance); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [empId, month]);

  const remaining = Number(summary.remaining) || 0;
  const unpaidPayroll = Number(summary.unpaid_payroll) || 0;
  const payStartMissing = !hasPayStartDate(e) && summary.pay_start_defined !== true;
  const salaryEarned = summary.salary_earned != null ? Number(summary.salary_earned) : unpaidPayroll;
  const premium = summary.premium != null ? Number(summary.premium) : (Number(summary.bonus_pending) || 0) + (Number(summary.overtime_due) || 0);
  const deductions = summary.deductions != null ? Number(summary.deductions) : Number(summary.advances) || 0;
  const previous = Number(summary.previous_payments) || 0;
  const preview = paymentPreview(remaining, rows);
  const manualSalary = unpaidPayroll <= 0.004 && rows.some((r) => r.kind === "salary" && Number(r.amount) > 0);
  const sgkWarn = sgkCashBlocked(e, sgkSalaryBankOnly, rows, accounts);
  const cashWarn = cashShortfallWarning(rows, accounts);
  const posWarn = posSalaryWarning(rows, accounts);
  const payable = rows.some((r) => Number(r.amount) > 0 && r.accountId);

  const patch = (key, field, value) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  const fillRemaining = () => {
    const amt = Math.max(0, remaining);
    const kind = unpaidPayroll > 0.004 ? "salary" : (amt > 0.004 ? "remaining" : "salary");
    const id = accountIdOf(preferred);
    setRows((prev) => {
      const next = prev.length ? [...prev] : [emptyLine(kind, id)];
      next[0] = { ...next[0], kind, amount: amt > 0.004 ? String(amt) : next[0].amount, accountId: next[0].accountId || id };
      return next;
    });
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const lines = rows.filter((r) => Number(r.amount) > 0);
    if (!lines.length) { toast.error("Ödenecek tutar girin."); return; }
    if (lines.some((r) => !r.accountId)) { toast.error("Her satır için kasa veya banka seçin."); return; }
    if (sgkWarn) { toast.error(SGK_BANK_MSG); return; }
    if (cashWarn) { toast.error(CASH_SHORT_MSG); return; }
    setBusy(true);
    try {
      const body = {
        date,
        period: month,
        idempotency_key: idemKey,
        lines: lines.map((r) => ({
          kind: r.kind,
          amount: Number(r.amount),
          description: r.description,
          ...splitPaymentTarget(r.accountId),
        })),
      };
      const r = await axios.post(`${API_URL}/personnel/employees/${empId}/settle`, body, {
        headers: { "Idempotency-Key": idemKey },
      });
      toast.success(r.data?.message || "Ödeme kaydedildi.");
      if (r.data?.receipt_id && typeof window !== "undefined" && window.open) {
        window.open(`${API_URL}/personnel/receipts/${r.data.receipt_id}`, "_blank", "noopener");
      }
      await notifyDataChanged({ companyId, scopes: ["cash", "expenses"] });
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ödeme yapılamadı.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps((ev) => { ev.stopPropagation(); onClose(); })} data-testid="emp-pay-modal">
      <form onSubmit={submit} onClick={(ev) => ev.stopPropagation()} className="bg-white rounded-2xl w-full max-w-xl p-5 space-y-3 text-xs shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Banknote className="w-4 h-4 text-emerald-600" /> {employeePayModalTitle(initialKind, e)}</h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex items-center justify-between gap-2" data-testid="emp-pay-period">
          <button type="button" className="px-2 py-1 border rounded-lg" onClick={() => setMonth((m) => shiftPeriod(m, -1))} data-testid="emp-pay-period-prev">←</button>
          <input type="month" value={month} onChange={(ev) => setMonth(ev.target.value)} className={`${inputCls} text-center font-semibold`} data-testid="emp-pay-month" />
          <button type="button" className="px-2 py-1 border rounded-lg" onClick={() => setMonth((m) => shiftPeriod(m, 1))} data-testid="emp-pay-period-next">→</button>
        </div>

        {payStartMissing ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 font-semibold" data-testid="emp-pay-no-start">{PAY_START_MISSING_MSG}</div>
        ) : null}
        <div className="grid grid-cols-2 gap-2" data-testid="emp-pay-summary">
          <div className="rounded-lg bg-slate-50 px-2 py-1.5"><div className="text-[10px] text-slate-500">Hak edilen maaş</div><div className="font-semibold">{payStartMissing ? PAY_START_MISSING_MSG : `${fmt(salaryEarned)} ₺`}</div></div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5"><div className="text-[10px] text-slate-500">Prim / mesai</div><div className="font-semibold">{fmt(premium)} ₺</div></div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5"><div className="text-[10px] text-slate-500">Kesintiler</div><div className="font-semibold">{fmt(deductions)} ₺</div></div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5"><div className="text-[10px] text-slate-500">Önceki ödemeler</div><div className="font-semibold">{fmt(previous)} ₺</div></div>
        </div>
        <div className={`rounded-xl px-3 py-3 text-center ${remaining < -0.004 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-900"}`} data-testid="emp-pay-remaining">
          <div className="text-[10px] uppercase tracking-wide font-semibold">{remaining < -0.004 ? "Kalan borç" : "Kalan alacak"}</div>
          <div className="text-2xl font-black">{fmt(Math.abs(remaining))} ₺</div>
        </div>

        <div className="space-y-2" data-testid="emp-pay-lines">
          {rows.map((row, i) => (
            <div key={row.key} className="rounded-xl border border-slate-200 p-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select value={row.kind} onChange={(ev) => patch(row.key, "kind", ev.target.value)} className={inputCls} data-testid={`emp-pay-line-kind-${i}`}>
                  {PAYMENT_LINE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
                <MoneyInput value={row.amount} onChange={(n) => patch(row.key, "amount", n ?? "")} className={inputCls} placeholder="Tutar" data-testid={`emp-pay-line-amount-${i}`} />
              </div>
              <PaymentTargetSelect companyId={companyId} accounts={accounts} value={row.accountId} onChange={(id) => patch(row.key, "accountId", id)} testId={`emp-pay-line-account-${i}`} emptyLabel="Kasa / banka" className={inputCls} />
              <input value={row.description} onChange={(ev) => patch(row.key, "description", ev.target.value)} className={inputCls} placeholder="Açıklama" data-testid={`emp-pay-line-note-${i}`} />
              {rows.length > 1 ? (
                <button type="button" className="text-rose-600" onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}>Satırı sil</button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className="px-3 py-1.5 border rounded-lg font-semibold inline-flex items-center gap-1" onClick={() => setRows((prev) => [...prev, emptyLine("salary", accountIdOf(preferred))])} data-testid="emp-pay-add-line"><Plus className="w-3.5 h-3.5" /> Satır ekle</button>
          <button type="button" className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold" onClick={fillRemaining} data-testid="emp-pay-fill-remaining">Kalanı öde</button>
        </div>

        <div>
          <label className="block font-semibold mb-1">Ödeme tarihi</label>
          <input type="date" required value={date} onChange={(ev) => setDate(ev.target.value)} className={inputCls} data-testid="emp-pay-date" />
        </div>

        {manualSalary ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2" data-testid="emp-pay-manual-salary">Bu dönem için tahakkuk yok; maaş elle giriliyor.</div>
        ) : null}
        {sgkWarn ? <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2" data-testid="emp-pay-sgk-warn">{sgkWarn}</div> : null}
        {cashWarn ? <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2" data-testid="emp-pay-cash-warn">{cashWarn}</div> : null}
        {posWarn ? <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2" data-testid="emp-pay-pos-warn">{posWarn}</div> : null}

        <div className="rounded-xl bg-slate-50 px-3 py-2" data-testid="emp-pay-preview">
          {preview.overpaid ? (
            <div className="font-semibold text-rose-700">Fazla ödeme {fmt(Math.abs(preview.remainingAfter))} ₺ — sonraki maaştan düşülecek</div>
          ) : (
            <div className="font-semibold text-slate-800">Ödeme sonrası kalan {fmt(preview.remainingAfter)} ₺</div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button type="submit" disabled={busy || !payable || Boolean(sgkWarn) || Boolean(cashWarn)} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="emp-pay-submit">{busy ? "…" : "Öde"}</button>
        </div>
      </form>
    </div>
  );
};
