
import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Target, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const BudgetPanel = ({ companyId, refreshKey }) => {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [edits, setEdits] = useState({});
  const load = () => axios.get(`${API_URL}/expense-budgets?company_id=${companyId}`).then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, [companyId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const budgets = Object.entries(edits).map(([category, monthly_limit]) => ({ category, monthly_limit: Number(monthly_limit) || 0 }));
    try { const r = await axios.put(`${API_URL}/expense-budgets`, { company_id: companyId, budgets }); setData(r.data); setEdits({}); toast.success("Bütçeler kaydedildi."); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); }
  };
  if (!data) return null;
  const withBudget = data.rows.filter((r) => r.monthly_limit > 0);
  const color = (s) => (s === "over" ? "bg-rose-500" : s === "warning" ? "bg-amber-500" : "bg-emerald-500");
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 space-y-3" data-testid="budget-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Target className="w-4 h-4 text-indigo-600" /> Aylık Bütçeler <span className="text-xs font-normal text-slate-500">({data.month})</span>
          {data.totals.limit > 0 && <span className="text-xs font-semibold text-slate-600">· {fmt(data.totals.spent)} / {fmt(data.totals.limit)} ₺ (%{data.totals.pct})</span>}</div>
        <button onClick={() => setOpen(!open)} className="text-xs font-semibold text-indigo-600 flex items-center gap-1" data-testid="budget-toggle">{open ? <>Kapat <ChevronUp className="w-3.5 h-3.5" /></> : <>Bütçe Belirle <ChevronDown className="w-3.5 h-3.5" /></>}</button>
      </div>
      {data.warnings.length > 0 && <div className="flex flex-wrap gap-2" data-testid="budget-warnings">{data.warnings.map((w) => <span key={w.category} className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg ${w.status === "over" ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}><AlertTriangle className="w-3 h-3" /> {w.category}: %{w.pct} {w.status === "over" ? "— bütçe aşıldı!" : "— limite yaklaşıyor"}</span>)}</div>}
      {!open && withBudget.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">{withBudget.map((r) => <div key={r.category} data-testid={`budget-row-${r.category}`}><div className="flex justify-between"><span className="font-semibold text-slate-700">{r.category}</span><span className="text-slate-500">{fmt(r.spent)} / {fmt(r.monthly_limit)} ₺</span></div><div className="h-1.5 bg-slate-100 rounded-full"><div className={`h-1.5 rounded-full ${color(r.status)}`} style={{ width: `${Math.min(100, r.pct)}%` }} /></div></div>)}</div>
      )}
      {!open && withBudget.length === 0 && <div className="text-xs text-slate-400">Henüz bütçe yok. Kategorilere aylık limit belirleyin; %80'e ulaşınca uyarı alırsınız.</div>}
      {open && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">{data.rows.map((r) => <label key={r.category} className="flex items-center justify-between gap-2 border rounded-lg px-2.5 py-1.5"><span className="truncate text-slate-700">{r.category}</span><input type="number" min="0" step="100" value={edits[r.category] ?? (r.monthly_limit || "")} onChange={(e) => setEdits({ ...edits, [r.category]: e.target.value })} placeholder="₺ / ay" className="w-24 border rounded-md p-1 text-right" data-testid={`budget-input-${r.category}`} /></label>)}</div>
          <div className="flex justify-end"><button onClick={save} disabled={!Object.keys(edits).length} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold disabled:opacity-40" data-testid="budget-save">Bütçeleri Kaydet</button></div>
        </div>
      )}
    </div>
  );
};
