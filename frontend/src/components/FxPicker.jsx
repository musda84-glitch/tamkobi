import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

export const FX_CODES = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY"];
export const fmtMoney = (n, ccy = "TRY") => `${(Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy === "TRY" ? "₺" : ccy}`;

export function useFxRates(companyId, onDate) {
  const [pack, setPack] = useState({ rates: {}, currencies: FX_CODES, date: onDate });
  useEffect(() => {
    if (!companyId) return;
    axios.get(`${API_URL}/fx/rates`, { params: { company_id: companyId, date: onDate || undefined } }).then((r) => setPack(r.data)).catch(() => {});
  }, [companyId, onDate]);
  return pack;
}

/** Fatura / masraf / dış ticaret formlarında para birimi + kur. */
export function FxPicker({ companyId, date, currency, rate, source, onChange, testId = "fx" }) {
export function FxPicker({ companyId, date, currency, rate, source, onChange, testId = "fx", rateTestId }) {
  const pack = useFxRates(companyId, date);
  const ccy = currency || "TRY";
  const applyCcy = async (next) => {
    if (next === "TRY") {
      onChange({ currency: "TRY", fx_rate: 1, fx_source: "try" });
      return;
    }
    try {
      const r = await axios.get(`${API_URL}/fx/quote`, { params: { company_id: companyId, currency: next, date } });
      onChange({ currency: next, fx_rate: r.data.rate, fx_source: r.data.source });
    } catch {
      const cached = pack.rates?.[next]?.rate;
      onChange({ currency: next, fx_rate: cached || rate || "", fx_source: cached ? pack.rates[next].source : "manual" });
    }
  };
  const local = (Number(rate) || 1) * 1;
  return (
    <div className="grid grid-cols-2 gap-2" data-testid={`${testId}-picker`}>
      <div>
        <label className="block font-semibold text-slate-700 mb-1">Para birimi</label>
        <select value={ccy} onChange={(e) => applyCcy(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium" data-testid={`${testId}-currency`}>
          {(pack.currencies || FX_CODES).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className="block font-semibold text-slate-700 mb-1">Kur (1 {ccy} = ₺)</label>
        <input type="number" step="0.0001" min="0" disabled={ccy === "TRY"} value={ccy === "TRY" ? 1 : (rate ?? "")} onChange={(e) => onChange({ currency: ccy, fx_rate: e.target.value, fx_source: "manual" })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono" data-testid={`${testId}-rate`} />
        <input type="number" step="0.0001" min="0" disabled={ccy === "TRY"} value={ccy === "TRY" ? 1 : (rate ?? "")} onChange={(e) => onChange({ currency: ccy, fx_rate: e.target.value, fx_source: "manual" })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono" data-testid={rateTestId || `${testId}-rate`} />
        {ccy !== "TRY" && <div className="text-[10px] text-slate-400 mt-0.5">{source === "manual" ? "Manuel kur" : source === "tcmb" ? "TCMB" : "Kur"} · {fmtMoney(local, "TRY")}/1 {ccy}</div>}
      </div>
    </div>
  );
}
