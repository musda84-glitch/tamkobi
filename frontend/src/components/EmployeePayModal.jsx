import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Banknote, Check, Plus, Printer, X } from "lucide-react";
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
  expenseLinkableForReimburse,
  initialPaymentKind,
  istanbulPeriod,
  PAY_START_MISSING_MSG,
  paymentPreview,
  REIMBURSE_CATEGORIES,
  REIMBURSE_DEFAULT_CATEGORY,
  REIMBURSE_EFFECT_DEBT,
  REIMBURSE_EFFECT_ENTITLEMENT,
  REIMBURSE_KIND,
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

function accountTitle(accounts, id) {
  const row = (accounts || []).find((a) => String(a.id || a._id || "") === String(id || ""));
  return row?.account_name || row?.name || "";
}

function savedPaymentSummary(employee, lines, accounts, data) {
  const serverLines = Array.isArray(data?.lines) ? data.lines : [];
  const serverAccounts = [...new Set(serverLines.map((l) => String(l.account_name || "").trim()).filter(Boolean))];
  const localAccounts = [...new Set((lines || []).map((l) => accountTitle(accounts, l.accountId)).filter(Boolean))];
  const totalFromServer = serverLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const totalFromLocal = (lines || []).reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const overpaid = Boolean(data?.overpaid);
  return {
    name: employee?.full_name || employee?.name || "",
    total: serverLines.length ? totalFromServer : totalFromLocal,
    account: (serverAccounts.length ? serverAccounts : localAccounts).join(", "),
    overpaid,
    excess: overpaid ? Math.abs(Number(data?.remaining_after) || 0) : 0,
    receiptId: data?.receipt_id || "",
  };
}

function emptyLine(kind, accountId) {
  return {
    key: newIdemKey(),
    kind: kind || "salary",
    amount: "",
    accountId: accountId || "",
    description: "",
    expenseId: "",
    category: REIMBURSE_DEFAULT_CATEGORY,
    chargeToAccount: false,
    accountEffect: REIMBURSE_EFFECT_DEBT,
    recurring: false,
    recurringDay: "",
    recurringEnd: "",
  };
}

function expenseOptionLabel(exp) {
  const num = exp.expense_number || exp.number || "MSR";
  const desc = exp.description || exp.category || "";
  return [num, desc].filter(Boolean).join(" · ");
}

export const EmployeePayModal = ({ employee, companyId, accounts, card, initialKind, sgkSalaryBankOnly = true, onClose, onDone }) => {
  const e = employee || {};
  const empId = e.id || e._id;
  const [month, setMonth] = useState(() => card?.balance?.month || istanbulPeriod());
  const [summary, setSummary] = useState(() => card?.balance || {});
  const [date, setDate] = useState(() => todayIsoDate());
  const [rows, setRows] = useState(() => [emptyLine(initialPaymentKind(initialKind), "")]);
  const [busy, setBusy] = useState(false);
  const [openDebts, setOpenDebts] = useState([]);
  const [categories, setCategories] = useState(REIMBURSE_CATEGORIES);
  const [idemKey] = useState(newIdemKey);
  const [saved, setSaved] = useState(null);
  const dismiss = () => {
    if (saved) onDone?.();
    onClose?.();
  };
  useEscape(dismiss);

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

  useEffect(() => {
    if (!empId || !companyId) return undefined;
    let cancel = false;
    axios.get(`${API_URL}/expenses`, { params: { company_id: companyId, employee_id: empId } })
      .then((r) => {
        const rows = Array.isArray(r.data) ? r.data : (r.data?.expenses || []);
        if (!cancel) setOpenDebts(rows.filter(expenseLinkableForReimburse));
      })
      .catch(() => { if (!cancel) setOpenDebts([]); });
    axios.get(`${API_URL}/expenses/categories`, { params: { company_id: companyId } })
      .then((r) => {
        const rows = Array.isArray(r.data) ? r.data : [];
        const names = rows.map((c) => c.name || c).filter(Boolean);
        if (!cancel && names.length) setCategories([...new Set([...REIMBURSE_CATEGORIES, ...names])]);
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, [empId, companyId]);

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
          ...(r.kind === REIMBURSE_KIND ? {
            category: r.category || REIMBURSE_DEFAULT_CATEGORY,
            charge_to_account: !!r.chargeToAccount,
            ...(r.chargeToAccount ? { account_effect: r.accountEffect || REIMBURSE_EFFECT_DEBT } : {}),
            ...(r.expenseId ? { expense_id: r.expenseId } : {}),
            ...(r.recurring ? {
              recurring: true,
              recurring_day: Number(r.recurringDay) || undefined,
              recurring_end: r.recurringEnd || undefined,
            } : {}),
          } : {}),
          ...splitPaymentTarget(r.accountId),
        })),
      };
      const r = await axios.post(`${API_URL}/personnel/employees/${empId}/settle`, body, {
        headers: { "Idempotency-Key": idemKey },
      });
      toast.success(r.data?.message || "Ödeme kaydedildi.");
      setSaved(savedPaymentSummary(e, lines, accounts, r.data));
      await notifyDataChanged({ companyId, scopes: ["cash", "expenses"] });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ödeme yapılamadı.");
    } finally { setBusy(false); }
  };

  const printReceipt = () => {
    if (!saved?.receiptId || typeof window === "undefined" || typeof window.open !== "function") return;
    window.open(`${API_URL}/personnel/receipts/${saved.receiptId}`, "_blank", "noopener");
  };

  if (saved) {
    return (
      <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps((ev) => { ev.stopPropagation(); dismiss(); })} data-testid="emp-pay-modal">
        <div onClick={(ev) => ev.stopPropagation()} className="bg-white rounded-2xl w-full max-w-md p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto" data-testid="emp-pay-saved">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-11 h-11 rounded-full bg-emerald-600 text-white flex items-center justify-center">
              <Check className="w-6 h-6" strokeWidth={3} />
            </div>
            <div className="min-w-0 pt-0.5">
              <h3 className="text-base sm:text-lg font-bold text-slate-900">Ödeme kaydedildi</h3>
              <p className="text-sm text-slate-500 truncate">{saved.name}</p>
            </div>
          </div>
          <dl className="mt-4 divide-y divide-slate-100 text-sm">
            <div className="flex items-start justify-between gap-3 py-2.5">
              <dt className="text-slate-500 shrink-0">Personel</dt>
              <dd className="font-semibold text-slate-900 text-right break-words" data-testid="emp-pay-saved-person">{saved.name}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 py-2.5">
              <dt className="text-slate-500 shrink-0">Tutar</dt>
              <dd className="font-semibold text-slate-900 text-right" data-testid="emp-pay-saved-amount">{fmt(saved.total)} ₺</dd>
            </div>
            <div className="flex items-start justify-between gap-3 py-2.5">
              <dt className="text-slate-500 shrink-0">Hesap</dt>
              <dd className="font-semibold text-slate-900 text-right break-words" data-testid="emp-pay-saved-account">{saved.account || "—"}</dd>
            </div>
          </dl>
          {saved.overpaid ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2.5 text-sm leading-snug" data-testid="emp-pay-saved-overpay">
              Fazla ödeme {fmt(saved.excess)} ₺ — sonraki maaştan düşülecek
            </div>
          ) : null}
          <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" onClick={dismiss} className="w-full sm:w-auto min-h-11 px-4 py-2.5 border border-slate-200 rounded-lg font-semibold text-sm text-slate-700" data-testid="emp-pay-saved-close">Kapat</button>
            <button type="button" onClick={printReceipt} disabled={!saved.receiptId} className="w-full sm:w-auto min-h-11 px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-semibold text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50" data-testid="emp-pay-saved-print">
              <Printer className="w-4 h-4" /> Makbuzu yazdır
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps((ev) => { ev.stopPropagation(); dismiss(); })} data-testid="emp-pay-modal">
      <form onSubmit={submit} onClick={(ev) => ev.stopPropagation()} className="bg-white rounded-2xl w-full max-w-xl p-4 sm:p-5 space-y-3 text-xs shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Banknote className="w-4 h-4 text-emerald-600" /> {employeePayModalTitle(initialKind, e)}</h3>
          <button type="button" onClick={dismiss} className="text-slate-400"><X className="w-5 h-5" /></button>
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
              {row.kind === REIMBURSE_KIND ? (
                <>
                  <div className="text-[11px] text-slate-500" data-testid={`emp-pay-line-reimburse-hint-${i}`}>
                    Şirketin personel için yaptığı masraf (kira, telefon, yol, yemek). Masraflar modülünde MSR kaydı oluşur; kaynak hesap Çıkış (−) yazar.
                  </div>
                  <select value={row.category || REIMBURSE_DEFAULT_CATEGORY} onChange={(ev) => patch(row.key, "category", ev.target.value)} className={inputCls} data-testid={`emp-pay-line-category-${i}`}>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={row.expenseId || ""} onChange={(ev) => patch(row.key, "expenseId", ev.target.value)} className={inputCls} data-testid={`emp-pay-line-expense-${i}`}>
                    <option value="">Yeni masraf kaydı aç</option>
                    {openDebts.map((exp) => {
                      const id = exp.id || exp._id;
                      return <option key={id} value={id}>{expenseOptionLabel(exp)}</option>;
                    })}
                  </select>
                  <label className="flex items-center gap-2 text-slate-700" data-testid={`emp-pay-line-charge-${i}`}>
                    <input type="checkbox" checked={!!row.chargeToAccount} onChange={(ev) => patch(row.key, "chargeToAccount", ev.target.checked)} data-testid={`emp-pay-line-charge-box-${i}`} />
                    Personel hesabına yaz
                  </label>
                  {row.chargeToAccount ? (
                    <div className="grid grid-cols-1 gap-1" data-testid={`emp-pay-line-effect-${i}`}>
                      <label className="flex items-center gap-2">
                        <input type="radio" name={`effect-${row.key}`} checked={(row.accountEffect || REIMBURSE_EFFECT_DEBT) === REIMBURSE_EFFECT_DEBT} onChange={() => patch(row.key, "accountEffect", REIMBURSE_EFFECT_DEBT)} data-testid={`emp-pay-line-effect-debt-${i}`} />
                        Maaştan düşülecek (personel borcu)
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="radio" name={`effect-${row.key}`} checked={row.accountEffect === REIMBURSE_EFFECT_ENTITLEMENT} onChange={() => patch(row.key, "accountEffect", REIMBURSE_EFFECT_ENTITLEMENT)} data-testid={`emp-pay-line-effect-entitlement-${i}`} />
                        Personele ek ödeme / hak ediş
                      </label>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400">Kapalıysa yalnızca şirket gideri olur; maaş, avans ve hak ediş etkilenmez.</div>
                  )}
                  <label className="flex items-center gap-2 text-slate-700" data-testid={`emp-pay-line-recurring-${i}`}>
                    <input type="checkbox" checked={!!row.recurring} onChange={(ev) => patch(row.key, "recurring", ev.target.checked)} data-testid={`emp-pay-line-recurring-box-${i}`} />
                    Her ay tekrarla
                  </label>
                  {row.recurring ? (
                    <div className="grid grid-cols-2 gap-2" data-testid={`emp-pay-line-recurring-fields-${i}`}>
                      <input type="number" min="1" max="31" value={row.recurringDay} onChange={(ev) => patch(row.key, "recurringDay", ev.target.value)} className={inputCls} placeholder="Gün (1–31)" data-testid={`emp-pay-line-recurring-day-${i}`} />
                      <input type="date" value={row.recurringEnd || ""} onChange={(ev) => patch(row.key, "recurringEnd", ev.target.value)} className={inputCls} title="Bitiş (boş = süresiz)" data-testid={`emp-pay-line-recurring-end-${i}`} />
                    </div>
                  ) : null}
                </>
              ) : null}
              {rows.length > 1 ? (
                <button type="button" className="text-rose-600" onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}>Satırı sil</button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
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

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={dismiss} className="w-full sm:w-auto min-h-11 px-3 py-2 border rounded-lg">İptal</button>
          <button type="submit" disabled={busy || !payable || Boolean(sgkWarn) || Boolean(cashWarn)} className="w-full sm:w-auto min-h-11 px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="emp-pay-submit">{busy ? "…" : "Öde"}</button>
        </div>
      </form>
    </div>
  );
};
