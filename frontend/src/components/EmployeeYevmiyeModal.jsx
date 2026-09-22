import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CalendarDays, Trash2, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";
import { useEscape } from "../utils/useEscape";
import {
  dailyWageOf,
  parseYevmiyeDays,
  parseYevmiyeWage,
  periodWage,
  yevmiyeAddHint,
  yevmiyeDaysLine,
  yevmiyePayPayload,
} from "../utils/personnelWage";
import { formatTrAmount } from "../utils/money";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";
const empIdOf = (e) => e?.id || e?._id || "";

export function EmployeeYevmiyeModal({
  employee,
  companyId,
  accounts,
  haveDays = 0,
  editId = "",
  initialDays = "",
  initialWage = "",
  initialNote = "",
  onClose,
  onDone,
}) {
  useEscape(onClose);
  const [days, setDays] = useState(initialDays || "");
  const [wage, setWage] = useState(initialWage || String(dailyWageOf(employee) || ""));
  const [note, setNote] = useState(initialNote || "");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const nDays = parseYevmiyeDays(days);
  const nWage = parseYevmiyeWage(wage);

  const save = async (e) => {
    e.preventDefault();
    if (!nDays) { toast.error("1–31 arası gün sayısı girin."); return; }
    if (!nWage) { toast.error("Yevmiye ücreti girin."); return; }
    setBusy(true);
    try {
      if (nWage !== dailyWageOf(employee)) {
        await axios.put(`${API_URL}/personnel/employees/${empIdOf(employee)}`, { daily_wage: nWage });
      }
      const payload = {
        ...yevmiyePayPayload(empIdOf(employee), { ...employee, daily_wage: nWage }, days, new Date().toISOString().slice(0, 7), accountId, note, wage),
        ...splitPaymentTarget(accountId),
      };
      if (editId) await axios.put(`${API_URL}/personnel/bonuses/${editId}`, payload);
      else await axios.post(`${API_URL}/personnel/bonuses`, payload);
      const line = yevmiyeDaysLine({ daily_wage: nWage }, nDays, nWage);
      toast.success(accountId
        ? `${employee.full_name} için ${line} ödendi.`
        : `${employee.full_name} için ${line} personel alacağına yazıldı.`);
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Yevmiye kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editId || !window.confirm("Bu yevmiye kaydı silinsin mi?")) return;
    setBusy(true);
    try {
      await axios.delete(`${API_URL}/personnel/bonuses/${editId}`);
      toast.success("Yevmiye kaydı silindi.");
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose} data-testid="emp-yevmiye-modal">
      <form onSubmit={save} onClick={(ev) => ev.stopPropagation()} className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 text-xs shadow-2xl">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-amber-600" /> {editId ? "Yevmiye günü düzenle" : "Yevmiye günü"} — {employee.full_name}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-[11px] text-slate-500" data-testid="emp-yevmiye-hint">
          {editId ? "Bu kayıt güncellenir." : yevmiyeAddHint(haveDays, nDays || 0)}
        </p>
        <div>
          <label className="block font-semibold mb-1">Gün sayısı</label>
          <input type="number" min="1" max="31" value={days} onChange={(e) => setDays(e.target.value)} className={inputCls} data-testid="emp-yevmiye-days" placeholder="Örn: 3" />
        </div>
        <div>
          <label className="block font-semibold mb-1">Günlük yevmiye (₺)</label>
          <input type="number" step="0.01" min="0" value={wage} onChange={(e) => setWage(e.target.value)} className={inputCls} data-testid="emp-yevmiye-wage" />
        </div>
        {nDays && nWage ? (
          <p className="text-[11px] text-amber-800" data-testid="emp-yevmiye-total">
            {yevmiyeDaysLine({ daily_wage: nWage }, nDays, nWage)} = {formatTrAmount(periodWage({ pay_type: "daily", daily_wage: nWage }, nDays))} ₺
          </p>
        ) : null}
        <div>
          <label className="block font-semibold mb-1">Açıklama</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Yevmiye günü" className={inputCls} data-testid="emp-yevmiye-note" />
        </div>
        <div>
          <label className="block font-semibold mb-1">Kasa / Banka / Ortak</label>
          <PaymentTargetSelect
            companyId={companyId}
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            testId="emp-yevmiye-account"
            emptyLabel="Ödeme yok — personel alacağına yaz"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          {editId ? (
            <button type="button" onClick={remove} disabled={busy} className="mr-auto px-3 py-1.5 border border-rose-200 text-rose-700 rounded-lg inline-flex items-center gap-1" data-testid="emp-yevmiye-delete">
              <Trash2 className="w-3.5 h-3.5" /> Sil
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button type="submit" disabled={busy} className="px-4 py-1.5 bg-amber-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="emp-yevmiye-submit">
            {busy ? "…" : accountId ? "Kaydet & Öde" : (editId ? "Alacağı güncelle" : "Alacağa ekle")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EmployeeYevmiyeModal;
