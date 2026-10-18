import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { ArrowDownCircle, ArrowUpCircle, FileText, Percent } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount(Number(n) || 0);

export function useDashboardOverview(companyId) {
  const [d, setD] = useState(null);
  const load = useCallback(() => {
    if (!companyId) return;
    axios.get(`${API_URL}/dashboard/overview?company_id=${companyId}`).then((r) => setD(r.data)).catch(() => {});
  }, [companyId]);
  useEffect(() => { load(); }, [load]);
  useDataRefresh(load, { companyId, scopes: ["orders", "notifications", "all"] });
  return d;
}

function MoneyBarCard({ title, icon: Icon, tone, data, testid }) {
  const total = Number(data?.total) || 0;
  const overdue = Number(data?.overdue) || 0;
  const notDue = Number(data?.not_due) || 0;
  const overduePct = total > 0 ? Math.round((overdue / total) * 100) : 0;
  const notDuePct = total > 0 ? Math.round((notDue / total) * 100) : 0;
  const overdueWidth = total > 0 ? (overdue / total) * 100 : 0;
  const notDueWidth = total > 0 ? (notDue / total) * 100 : 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4" data-testid={testid}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Icon className={`w-4 h-4 ${tone}`} /> {title}
        </div>
        <div className="text-sm font-bold text-slate-900">{fmt(total)} ₺</div>
      </div>
      <div className="mt-3 h-2.5 rounded-full bg-slate-100 overflow-hidden flex" data-testid={`${testid}-bar`}>
        {overdue > 0 ? (
          <div className="h-full bg-rose-500" style={{ width: `${overdueWidth}%`, minWidth: 4 }} data-testid={`${testid}-overdue`} />
        ) : null}
        {notDue > 0 ? (
          <div className="h-full bg-emerald-500" style={{ width: `${notDueWidth}%`, minWidth: 4 }} data-testid={`${testid}-pending`} />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
        <span className="font-semibold text-rose-600">Gecikmiş {fmt(overdue)} ₺ · %{overduePct}</span>
        <span className="font-semibold text-emerald-700">Vadesi gelmemiş {fmt(notDue)} ₺ · %{notDuePct}</span>
      </div>
    </div>
  );
}

function InvoiceVatCards({ d }) {
  const navigate = useNavigate();
  const inv = d.invoices || { outgoing: {}, incoming: {} };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4" data-testid="invoices-card">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><FileText className="w-4 h-4 text-indigo-600" /> Faturalar</div>
          <button onClick={() => navigate("/invoices")} className="text-[11px] bg-slate-100 hover:bg-slate-200 rounded-lg px-2 py-1 font-semibold" data-testid="drafts-btn">Taslak: {d.drafts?.count || 0} · {fmt(d.drafts?.total)} ₺</button>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-slate-400 text-[10px] uppercase"><th className="text-left"></th><th>Bu Ay</th><th>Bu Hafta</th><th>Bugün</th></tr></thead>
          <tbody>
            <tr className="border-t"><td className="py-1.5 font-semibold text-emerald-700">Giden (Satış)</td>{["month", "week", "today"].map((k) => <td key={k} className="text-center font-bold">{inv.outgoing?.[k] || 0}</td>)}</tr>
            <tr className="border-t"><td className="py-1.5 font-semibold text-rose-700">Gelen (Alış)</td>{["month", "week", "today"].map((k) => <td key={k} className="text-center font-bold">{inv.incoming?.[k] || 0}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4" data-testid="vat-card">
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Percent className="w-4 h-4 text-amber-600" /> KDV Özeti <span className="text-[10px] font-normal text-slate-400">{d.vat?.month}</span></div>
          <span className="text-[10px] text-slate-500">Beyan: <b>{d.vat?.declaration_date ? new Date(d.vat.declaration_date).toLocaleDateString("tr-TR") : "—"}</b> · {d.vat?.days_left ?? "—"} gün</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-slate-50 rounded-lg p-2"><div className="text-[10px] text-slate-400">Hesaplanan</div><b>{fmt(d.vat?.calculated)}</b></div>
          <div className="bg-slate-50 rounded-lg p-2"><div className="text-[10px] text-slate-400">İndirilecek</div><b>{fmt(d.vat?.deductible)}</b></div>
          <div className={`rounded-lg p-2 ${(d.vat?.payable || 0) > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            <div className="text-[10px] opacity-70">{(d.vat?.payable || 0) > 0 ? "Ödenecek" : "Devreden"}</div>
            <b data-testid="vat-payable">{fmt(Math.abs(d.vat?.payable || 0))}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

export const OverviewPanel = ({ companyId, part = "collections" }) => {
  const d = useDashboardOverview(companyId);
  if (!d) return null;
  if (part === "invoices") return <InvoiceVatCards d={d} />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="overview-panel">
      <MoneyBarCard title="Tahsilatlar" icon={ArrowDownCircle} tone="text-emerald-600" data={d.collections} testid="collections-card" />
      <MoneyBarCard title="Ödemeler" icon={ArrowUpCircle} tone="text-rose-600" data={d.payments} testid="payments-card" />
    </div>
  );
};
