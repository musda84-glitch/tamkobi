
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { RefreshCw, Save, Coins } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { FX_CODES, fmtMoney } from "./FxPicker";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono";

export const FxRatesPanel = ({ companyId }) => {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pack, setPack] = useState({ rates: {}, currencies: FX_CODES });
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState({});
  const load = useCallback(async (d = date, fetch = true) => {
    try {
      const r = await axios.get(`${API_URL}/fx/rates`, { params: { company_id: companyId, date: d, fetch } });
      setPack(r.data);
      setDate(r.data.date || d);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Kurlar alınamadı.");
    }
  }, [companyId, date]);
  useEffect(() => { load(date, true); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  const fetchTcmb = async () => {
    setBusy("fetch");
    try {
      const r = await axios.post(`${API_URL}/fx/fetch`, { date }, { params: { company_id: companyId } });
      setPack({ ...pack, date: r.data.date, source: "tcmb", rates: r.data.rates });
      setDate(r.data.date);
      toast.success(r.data.message);
    } catch (e) { toast.error(e.response?.data?.detail || "TCMB alınamadı."); } finally { setBusy(""); }
  };
  const saveRow = async (code) => {
    const rate = Number(draft[code] ?? pack.rates?.[code]?.rate);
    if (!rate) return toast.error("Kur girin.");
    setBusy(code);
    try {
      const row = await axios.put(`${API_URL}/fx/rates`, { date, currency: code, rate }, { params: { company_id: companyId } });
      setPack((p) => ({ ...p, rates: { ...p.rates, [code]: row.data } }));
      setDraft((d) => { const n = { ...d }; delete n[code]; return n; });
      toast.success(`${code} kuru kaydedildi.`);
    } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(""); }
  };
  const codes = (pack.currencies || FX_CODES).filter((c) => c !== "TRY");
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs max-w-3xl" data-testid="fx-rates-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Coins className="w-4 h-4 text-emerald-600" /> Döviz Kurları</h3>
          <p className="text-slate-500 mt-0.5">TCMB günlük bülten otomatik çekilir. Satırdaki kuru değiştirip kaydederseniz o gün için manuel kur kullanılır. Faturalar, masraflar ve dış ticaret bu tabloyu okur.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); load(e.target.value, true); }} className={inputCls + " w-40"} data-testid="fx-date" />
          <button type="button" onClick={fetchTcmb} disabled={!!busy} className="px-3 py-2 bg-slate-900 text-white rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="fx-fetch"><RefreshCw className={`w-3.5 h-3.5 ${busy === "fetch" ? "animate-spin" : ""}`} /> TCMB’den çek</button>
        </div>
      </div>
      <div className="text-[10px] text-slate-400">{pack.source === "tcmb" ? "Kaynak: TCMB" : pack.source === "manual" ? "Kaynak: karışık / manuel" : "Henüz kur yok"} · tarih {pack.date || date}</div>
      <table className="w-full">
        <thead className="text-[10px] uppercase text-slate-400"><tr><th className="text-left py-2">Döviz</th><th className="text-right py-2">Alış</th><th className="text-right py-2">Satış / Kullanılan</th><th className="text-left py-2 pl-3">Kaynak</th><th /></tr></thead>
        <tbody className="divide-y">{codes.map((code) => {
          const row = pack.rates?.[code] || {};
          const val = draft[code] ?? row.rate ?? "";
          return (
            <tr key={code} data-testid={`fx-row-${code}`}>
              <td className="py-2 font-bold text-slate-800">{code}</td>
              <td className="py-2 text-right text-slate-500">{row.buying != null ? fmtMoney(row.buying) : "—"}</td>
              <td className="py-2 text-right"><input type="number" step="0.0001" min="0" value={val} onChange={(e) => setDraft({ ...draft, [code]: e.target.value })} className={inputCls + " text-right w-32 ml-auto"} data-testid={`fx-input-${code}`} /></td>
              <td className="py-2 pl-3 text-slate-500">{row.source === "manual" ? "Manuel" : row.source === "tcmb" ? "TCMB" : "—"}</td>
              <td className="py-2 text-right"><button type="button" onClick={() => saveRow(code)} disabled={busy === code} className="px-2 py-1 border rounded-lg font-semibold inline-flex items-center gap-1" data-testid={`fx-save-${code}`}><Save className="w-3 h-3" /> Kaydet</button></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
};
