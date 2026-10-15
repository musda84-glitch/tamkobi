import React, { useState } from "react";
import { X } from "lucide-react";
import {
  despatchFormFrom,
  despatchSendLabel,
  despatchSendPayload,
  validateDespatchForm,
} from "../utils/despatchShipment";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-900";

export function DespatchSendDialog({ invoice, defaults, fallbackAddress = "", busy = false, onClose, onSubmit }) {
  const [form, setForm] = useState(() => despatchFormFrom(invoice, defaults, fallbackAddress));
  const [error, setError] = useState("");
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const own = form.despatch_mode !== "carrier";
  const label = despatchSendLabel(invoice);

  const submit = () => {
    const problems = validateDespatchForm(form);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setError("");
    onSubmit(despatchSendPayload(form));
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-3 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto" data-testid="despatch-send-dialog">
        <div className="flex items-center justify-between border-b pb-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">{label}</h3>
            <p className="text-[11px] text-slate-500">{invoice?.invoice_number} · nakliye bilgisi GİB'e gitmeden önce tamamlanır</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400" data-testid="despatch-send-close"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-slate-700">Sevk tarihi
            <input type="date" value={form.issue_date} onChange={(e) => set("issue_date", e.target.value)} className={`${inputCls} mt-1`} data-testid="despatch-issue-date" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Sevk saati
            <input type="time" value={form.issue_time} onChange={(e) => set("issue_time", e.target.value)} className={`${inputCls} mt-1`} data-testid="despatch-issue-time" />
          </label>
        </div>
        <label className="block text-xs font-semibold text-slate-700">Teslim adresi
          <textarea rows={2} value={form.shipping_address} onChange={(e) => set("shipping_address", e.target.value)} className={`${inputCls} mt-1`} data-testid="despatch-address" />
        </label>
        <div className="flex gap-2" data-testid="despatch-mode">
          <button type="button" onClick={() => set("despatch_mode", "own")} className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold border ${own ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`} data-testid="despatch-mode-own">Kendi aracım</button>
          <button type="button" onClick={() => set("despatch_mode", "carrier")} className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold border ${!own ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`} data-testid="despatch-mode-carrier">Taşıyıcı firma</button>
        </div>
        {own ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-slate-700 col-span-2">Plaka
              <input value={form.despatch_plate} onChange={(e) => set("despatch_plate", e.target.value)} className={`${inputCls} mt-1 font-mono`} placeholder="34ABC123" data-testid="despatch-plate" />
            </label>
            <label className="text-xs font-semibold text-slate-700">Şoför adı
              <input value={form.despatch_driver_first} onChange={(e) => set("despatch_driver_first", e.target.value)} className={`${inputCls} mt-1`} data-testid="despatch-driver-first" />
            </label>
            <label className="text-xs font-semibold text-slate-700">Şoför soyadı
              <input value={form.despatch_driver_last} onChange={(e) => set("despatch_driver_last", e.target.value)} className={`${inputCls} mt-1`} data-testid="despatch-driver-last" />
            </label>
            <label className="text-xs font-semibold text-slate-700 col-span-2">Şoför TCKN
              <input value={form.despatch_driver_tckn} onChange={(e) => set("despatch_driver_tckn", e.target.value)} className={`${inputCls} mt-1 font-mono`} inputMode="numeric" data-testid="despatch-driver-tckn" />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-slate-700">Taşıyıcı VKN/TCKN
              <input value={form.despatch_carrier_vkn} onChange={(e) => set("despatch_carrier_vkn", e.target.value)} className={`${inputCls} mt-1 font-mono`} data-testid="despatch-carrier-vkn" />
            </label>
            <label className="text-xs font-semibold text-slate-700">Ünvan
              <input value={form.despatch_carrier_name} onChange={(e) => set("despatch_carrier_name", e.target.value)} className={`${inputCls} mt-1`} data-testid="despatch-carrier-name" />
            </label>
            <label className="text-xs font-semibold text-slate-700 col-span-2">Kargo takip no <span className="font-normal text-slate-400">(isteğe bağlı)</span>
              <input value={form.cargo_tracking_number} onChange={(e) => set("cargo_tracking_number", e.target.value)} className={`${inputCls} mt-1`} data-testid="despatch-tracking" />
            </label>
          </div>
        )}
        {error ? <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2" data-testid="despatch-form-error">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg text-xs">Vazgeç</button>
          <button type="button" disabled={busy} onClick={submit} className="px-4 py-1.5 bg-fuchsia-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="despatch-send-submit">{busy ? "Gönderiliyor…" : label}</button>
        </div>
      </div>
    </div>
  );
}
