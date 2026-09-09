
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { CalendarCheck, ArrowDownCircle, ArrowUpCircle, FileText, Percent, AlertTriangle, ChevronRight } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Ring = ({ value, total, color, label, amount, testid }) => {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4 pt-2 first:pt-0" data-testid={testid}>
      <svg width="68" height="68" className="-rotate-90"><circle cx="34" cy="34" r={r} stroke="#e2e8f0" strokeWidth="8" fill="none" /><circle cx="34" cy="34" r={r} stroke={color} strokeWidth="8" fill="none" strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} strokeLinecap="round" style={{ transition: "stroke-dashoffset .6s" }} /></svg>
      <div className="min-w-0 flex-1"><div className="text-[10px] uppercase font-semibold text-slate-400">{label}</div><div className="text-base font-bold text-slate-900">{fmt(amount)} ₺</div></div><div className="text-xs font-bold text-slate-500">%{Math.round(pct)}</div>
    </div>
  );
};

const RingCard = ({ title, icon: Icon, data, tone, path, testid }) => {
  const navigate = useNavigate();
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4" data-testid={testid}>
      <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Icon className={`w-4 h-4 ${tone}`} /> {title}</div><button onClick={() => navigate(path)} className="text-[11px] text-slate-500 hover:text-slate-900 flex items-center">Detay <ChevronRight className="w-3 h-3" /></button></div>
      <div className="flex flex-col gap-2 divide-y divide-slate-100">
        <Ring value={data.total} total={data.total} color="#0f172a" label={title === "Tahsilatlar" ? "Toplam tahsil edilecek" : "Toplam ödenecek"} amount={data.total} />
        <Ring value={data.overdue} total={data.total} color="#e11d48" label="Gecikmiş" amount={data.overdue} />
        <Ring value={data.not_due} total={data.total} color="#10b981" label="Vadesi gelmemiş" amount={data.not_due} />
      </div>
    </div>
  );
};

export const OverviewPanel = ({ companyId }) => {
  const [d, setD] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { axios.get(`${API_URL}/dashboard/overview?company_id=${companyId}`).then((r) => setD(r.data)).catch(() => {}); }, [companyId]);
  if (!d) return null;
  const inv = d.invoices;
  return (
    <div className="space-y-4" data-testid="overview-panel">
      <div className="bg-slate-900 text-white rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3" data-testid="today-tasks">
        <div className="flex items-center gap-2 font-bold text-sm shrink-0"><CalendarCheck className="w-4 h-4 text-emerald-400" /> Bugün <span className="text-slate-400 font-normal text-xs">{new Date(d.date).toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" })}</span></div>
        <div className="flex flex-wrap gap-2">{d.tasks.length === 0 ? <span className="text-xs text-slate-300">Bugün için bekleyen görev yok 🎉</span> : d.tasks.map((t) => <button key={t.key} onClick={() => navigate(t.path)} className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-lg px-2.5 py-1.5 text-xs" data-testid={`task-${t.key}`}><b className="text-emerald-300">{t.count}</b> {t.label}{t.extra && <span className="text-rose-300">· {t.extra}</span>}</button>)}
          {d.budget_warnings.map((w) => <button key={w.category} onClick={() => navigate("/expenses")} className="flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-lg px-2.5 py-1.5 text-xs" data-testid={`task-budget-${w.category}`}><AlertTriangle className="w-3 h-3" /> {w.category} bütçesi %{w.pct}</button>)}</div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <RingCard title="Tahsilatlar" icon={ArrowDownCircle} data={d.collections} tone="text-emerald-600" path="/invoices" testid="collections-card" />
        <RingCard title="Ödemeler" icon={ArrowUpCircle} data={d.payments} tone="text-rose-600" path="/invoices" testid="payments-card" />
        <div className="grid grid-rows-2 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4" data-testid="invoices-card">
            <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2 text-sm font-bold text-slate-900"><FileText className="w-4 h-4 text-indigo-600" /> Faturalar</div><button onClick={() => navigate("/invoices")} className="text-[11px] bg-slate-100 hover:bg-slate-200 rounded-lg px-2 py-1 font-semibold" data-testid="drafts-btn">Taslak: {d.drafts.count} · {fmt(d.drafts.total)} ₺</button></div>
            <table className="w-full text-xs"><thead><tr className="text-slate-400 text-[10px] uppercase"><th className="text-left"></th><th>Bu Ay</th><th>Bu Hafta</th><th>Bugün</th></tr></thead>
              <tbody><tr className="border-t"><td className="py-1.5 font-semibold text-emerald-700">Giden (Satış)</td>{["month", "week", "today"].map((k) => <td key={k} className="text-center font-bold">{inv.outgoing[k]}</td>)}</tr><tr className="border-t"><td className="py-1.5 font-semibold text-rose-700">Gelen (Alış)</td>{["month", "week", "today"].map((k) => <td key={k} className="text-center font-bold">{inv.incoming[k]}</td>)}</tr></tbody></table>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4" data-testid="vat-card">
            <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Percent className="w-4 h-4 text-amber-600" /> KDV Özeti <span className="text-[10px] font-normal text-slate-400">{d.vat.month}</span></div><span className="text-[10px] text-slate-500">Beyan: <b>{new Date(d.vat.declaration_date).toLocaleDateString("tr-TR")}</b> · {d.vat.days_left} gün</span></div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="bg-slate-50 rounded-lg p-2"><div className="text-[10px] text-slate-400">Hesaplanan</div><b>{fmt(d.vat.calculated)}</b></div><div className="bg-slate-50 rounded-lg p-2"><div className="text-[10px] text-slate-400">İndirilecek</div><b>{fmt(d.vat.deductible)}</b></div><div className={`rounded-lg p-2 ${d.vat.payable > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}><div className="text-[10px] opacity-70">{d.vat.payable > 0 ? "Ödenecek" : "Devreden"}</div><b data-testid="vat-payable">{fmt(Math.abs(d.vat.payable))}</b></div></div>
          </div>
        </div>
      </div>
    </div>
  );
};
