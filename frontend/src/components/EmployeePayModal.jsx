import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Banknote, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";
import { useEscape } from "../utils/useEscape";
import { formatTrAmount } from "../utils/money";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { todayIsoDate } from "../utils/partnerTx";
import { employeeDueLines, employeePayKindsForSubmit, employeePayModalStart, employeePayModalTitle, employeePayTotal } from "../utils/employeePay";
import { notifyDataChanged } from "../utils/dataRefresh";

const fmt = (n) => formatTrAmount((Number(n) || 0));
const inputCls = "w-full border border-slate-200 rounded-lg p-2 text-xs bg-slate-50 focus:ring-2 focus:ring-emerald-500 outline-none";

export const EmployeePayModal = ({ employee, companyId, accounts, card, initialKind, onClose, onDone }) => {
  useEscape(onClose);
  const e = employee || {};
  const lines = useMemo(() => employeeDueLines(card?.balance, employee), [card?.balance, employee]);
  const [mode, setMode] = useState(() => employeePayModalStart(initialKind, employeeDueLines(card?.balance, employee)).mode);
  const [selected, setSelected] = useState(() => employeePayModalStart(initialKind, employeeDueLines(card?.balance, employee)).selected);
  const [date, setDate] = useState(() => e.pay_start_date || todayIsoDate());
  const [recurring, setRecurring] = useState(e.pay_recurring !== false);
  const [accountId, setAccountId] = useState("");
  const [advance, setAdvance] = useState("");
  const [newExp, setNewExp] = useState({ amount: "", category: "Personel Masrafı", description: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (accountId || !accounts?.[0]) return;
    const sgk = Boolean(String(e.sgk_number || "").trim());
    const bank = sgk ? (accounts || []).find((a) => String(a.type || "").toLowerCase() === "bank" && !a.is_integrated) : accounts[0];
    if (bank) setAccountId(bank.id || bank._id);
  }, [accounts, accountId, e.sgk_number]);

  const total = employeePayTotal(lines, mode, selected) + (Number(advance) || 0) + (Number(newExp.amount) || 0);
  const kinds = employeePayKindsForSubmit(mode, lines, selected);
  const canPay = kinds.length > 0 || Number(advance) > 0 || Number(newExp.amount) > 0;
  const toggle = (key) => setSelected((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);

  const submit = async (ev) => {
    ev.preventDefault();
    if (!date) { toast.error("Hak ediş tarihi girin."); return; }
    if (!accountId) { toast.error("Kasa / banka veya ortak hesabı seçin."); return; }
    const payKinds = employeePayKindsForSubmit(mode, lines, selected);
    if (!payKinds.length && !Number(advance) && !Number(newExp.amount)) {
      toast.error("Ödenecek kalem seçin veya avans / masraf girin.");
      return;
    }
    setBusy(true);
    try {
      const body = {
        mode,
        kinds: payKinds,
        date,
        recurring,
        ...splitPaymentTarget(accountId),
      };
      if (Number(advance) > 0) body.advance = Number(advance);
      if (Number(newExp.amount) > 0) body.new_expense = { amount: Number(newExp.amount), category: newExp.category, description: newExp.description };
      const r = await axios.post(`${API_URL}/personnel/employees/${e.id || e._id}/settle`, body);
      toast.success(r.data.message);
      await notifyDataChanged({ companyId, scopes: ["cash", "expenses"] });
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ödeme yapılamadı.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps((ev) => { ev.stopPropagation(); onClose(); })} data-testid="emp-pay-modal">
      <form onSubmit={submit} onClick={(ev) => ev.stopPropagation()} className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-3 text-xs shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Banknote className="w-4 h-4 text-emerald-600" /> {employeePayModalTitle(initialKind, e)}</h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5" data-testid="emp-pay-mode">
          {[["all", "Tüm bakiyeyi öde"], ["split", "Ayrı ayrı öde"]].map(([k, l]) => (
            <button type="button" key={k} onClick={() => setMode(k)} className={`flex-1 py-1.5 rounded-md font-semibold ${mode === k ? "bg-white shadow text-slate-900" : "text-slate-500"}`} data-testid={`emp-pay-mode-${k}`}>{l}</button>
          ))}
        </div>
        {lines.length === 0 ? (
          <div className="text-slate-500 bg-slate-50 rounded-lg p-3" data-testid="emp-pay-empty">Bu dönem bekleyen alacak yok. Avans veya yeni masraf girebilirsiniz.</div>
        ) : (
          <div className="space-y-1.5" data-testid="emp-pay-lines">
            {lines.map((l) => (
              <label key={l.key} className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${mode === "all" || selected.includes(l.key) ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200"}`}>
                <span className="inline-flex items-center gap-2">
                  {mode === "split" ? (
                    <input type="checkbox" checked={selected.includes(l.key)} onChange={() => toggle(l.key)} data-testid={l.testid} />
                  ) : null}
                  <span className="font-semibold text-slate-800">{l.label}</span>
                </span>
                <span className="font-bold text-slate-900">{fmt(l.amount)} ₺</span>
              </label>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-semibold mb-1">Hak ediş tarihi</label>
            <input type="date" required value={date} onChange={(ev) => setDate(ev.target.value)} className={inputCls} data-testid="emp-pay-date" />
          </div>
          <label className="flex items-center gap-2 mt-5 text-slate-700">
            <input type="checkbox" checked={recurring} onChange={(ev) => setRecurring(ev.target.checked)} data-testid="emp-pay-recurring" />
            Her ay tekrarla
          </label>
        </div>
        <p className="text-[11px] text-slate-500">Hak ediş tarihinde maaş, yemek ve yol yazılır. Her ay tekrarla açıksa sonraki ayların aynı gününde tekrarlanır.</p>
        <div className="grid grid-cols-2 gap-2 border-t pt-2">
          <div>
            <label className="block font-semibold mb-1">Avans (₺)</label>
            <input type="number" min="0" step="0.01" value={advance} onChange={(ev) => setAdvance(ev.target.value)} className={inputCls} data-testid="emp-pay-advance" placeholder="0" />
          </div>
          <div>
            <label className="block font-semibold mb-1">Yeni masraf (₺)</label>
            <input type="number" min="0" step="0.01" value={newExp.amount} onChange={(ev) => setNewExp({ ...newExp, amount: ev.target.value })} className={inputCls} data-testid="emp-pay-new-expense" placeholder="0" />
          </div>
          {Number(newExp.amount) > 0 ? (
            <div className="col-span-2">
              <label className="block font-semibold mb-1">Masraf açıklaması</label>
              <input value={newExp.description} onChange={(ev) => setNewExp({ ...newExp, description: ev.target.value })} className={inputCls} placeholder="Örn: Şehir dışı yol" />
            </div>
          ) : null}
        </div>
        <div>
          <label className="block font-semibold mb-1">Kasa / Banka / Kart / Ortak</label>
          <PaymentTargetSelect companyId={companyId} accounts={accounts} value={accountId} onChange={setAccountId} testId="emp-pay-account" emptyLabel="Hesap seçilmedi" className={inputCls} allowedTypes={String(e.sgk_number || "").trim() && (mode === "all" || selected.includes("salary")) ? ["bank"] : null} includePartners={!String(e.sgk_number || "").trim() || (mode === "split" && !selected.includes("salary"))} includeCreditCards={!String(e.sgk_number || "").trim() || (mode === "split" && !selected.includes("salary"))} />
        </div>
        <div className="flex justify-between items-center pt-2 border-t">
          <span className="font-bold text-slate-800" data-testid="emp-pay-total">Toplam {fmt(total)} ₺</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
            <button type="submit" disabled={busy || !canPay || !accountId} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="emp-pay-submit">{busy ? "…" : "Öde"}</button>
          </div>
        </div>
      </form>
    </div>
  );
};
