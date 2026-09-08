import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BarChart3, Download, Printer, TrendingUp, TrendingDown, Clock, Package, Wallet, Percent, PieChart } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const KINDS = [["sales", "Satış", TrendingUp], ["purchases", "Alış", TrendingDown], ["aging", "Cari Yaşlandırma", Clock], ["stock", "Stok", Package], ["cashflow", "Nakit Akışı", Wallet], ["vat", "KDV", Percent], ["profit", "Kârlılık", PieChart]];
const COLS = {
  sales: [["name", "Cari / Grup"], ["count", "Fatura", "n"], ["quantity", "Miktar", "n"], ["net", "Net", "m"], ["vat", "KDV", "m"], ["gross", "Toplam", "m"], ["paid", "Tahsil", "m"]],
  purchases: [["name", "Cari / Grup"], ["count", "Fatura", "n"], ["quantity", "Miktar", "n"], ["net", "Net", "m"], ["vat", "KDV", "m"], ["gross", "Toplam", "m"], ["paid", "Ödenen", "m"]],
  aging: [["name", "Cari"], ["type", "Tür", "t"], ["invoices", "Fatura", "n"], ["not_due", "Vadesi Gelmemiş", "m"], ["d1_30", "1-30 gün", "m"], ["d31_60", "31-60", "m"], ["d61_90", "61-90", "m"], ["d90p", "90+", "m"], ["total", "Toplam", "m"]],
  stock: [["name", "Ürün"], ["sku", "SKU"], ["category", "Kategori"], ["quantity", "Stok", "n"], ["min", "Min", "n"], ["cost", "Maliyet", "m"], ["price", "Satış", "m"], ["cost_value", "Stok Değeri (Maliyet)", "m"], ["sale_value", "Stok Değeri (Satış)", "m"], ["status", "Durum", "s"]],
  cashflow: [["name", "Ay"], ["inflow", "Giren", "m"], ["outflow", "Çıkan", "m"], ["net", "Net", "m"]],
  vat: [["name", "Ay"], ["sales_net", "Satış Matrah", "m"], ["sales_vat", "Hesaplanan KDV", "m"], ["purchase_net", "Alış Matrah", "m"], ["purchase_vat", "İndirilecek KDV", "m"], ["payable_vat", "Ödenecek / (Devreden)", "m"]],
  profit: [["name", "Grup"], ["quantity", "Miktar", "n"], ["revenue", "Ciro", "m"], ["cost", "Maliyet", "m"], ["profit", "Kâr", "m"], ["margin", "Marj %", "p"]]
};
const STATUS = { critical: ["Stok Yok", "bg-rose-50 text-rose-700"], low: ["Kritik", "bg-amber-50 text-amber-700"], ok: ["Yeterli", "bg-emerald-50 text-emerald-700"] };
const cell = (v, t) => t === "m" ? fmt(v) + " ₺" : t === "p" ? `%${fmt(v)}` : t === "n" ? (Number(v) || 0).toLocaleString("tr-TR") : t === "t" ? (v === "receivable" ? "Alacak" : "Borç") : t === "s" ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS[v]?.[1]}`}>{STATUS[v]?.[0]}</span> : v ?? "-";

export default function ReportsPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const first = new Date(); first.setDate(1);
  const [kind, setKind] = useState("sales");
  const [from, setFrom] = useState(first.toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [group, setGroup] = useState("contact");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await axios.get(`${API_URL}/reports/${kind}?company_id=${companyId}&date_from=${from}&date_to=${to}&group=${group}`); setData(r.data); } catch { toast.error("Rapor alınamadı."); } finally { setLoading(false); } }, [kind, from, to, group, companyId]);
  useEffect(() => { load(); }, [load]);
  const cols = COLS[kind];
  const rows = data?.rows || [];
  const preset = (d) => { const t = new Date(); const f = new Date(); if (d === "month") f.setDate(1); else if (d === "quarter") { f.setMonth(Math.floor(t.getMonth() / 3) * 3, 1); } else if (d === "year") f.setMonth(0, 1); else f.setDate(t.getDate() - d); setFrom(f.toISOString().slice(0, 10)); setTo(t.toISOString().slice(0, 10)); };
  const exportCsv = () => {
    const lines = [cols.map((c) => c[1]).join(";"), ...rows.map((r) => cols.map((c) => { const v = r[c[0]]; return typeof v === "number" ? String(v).replace(".", ",") : `"${(v ?? "").toString().replace(/"/g, '""')}"`; }).join(";"))];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${kind}-raporu-${from}_${to}.csv`; a.click(); toast.success("Excel (CSV) indirildi.");
  };
  const t = data?.totals || {};
  const kpis = { sales: [["Toplam Satış", t.gross], ["Net", t.net], ["KDV", t.vat], ["Açık Alacak", t.open]], purchases: [["Toplam Alış", t.gross], ["Net", t.net], ["KDV", t.vat], ["Açık Borç", t.open]], aging: [["Toplam Alacak", t.total], ["Vadesi Geçen", (t.d1_30 || 0) + (t.d31_60 || 0) + (t.d61_90 || 0) + (t.d90p || 0)], ["90+ Gün", t.d90p], ["Toplam Borcumuz", data?.totals_payable?.total]], stock: [["Stok Değeri (Maliyet)", t.cost_value], ["Stok Değeri (Satış)", t.sale_value], ["Ürün", t.count, "n"], ["Stok Yok / Kritik", `${t.critical || 0} / ${t.low || 0}`, "raw"]], cashflow: [["Giren", t.inflow], ["Çıkan", t.outflow], ["Net", t.net], ["Kasa+Banka Şimdi", t.cash_now], ["Beklenen Tahsilat", t.expected_in], ["Beklenen Ödeme", t.expected_out], ["Öngörülen Nakit", t.projected]], vat: [["Hesaplanan KDV", t.sales_vat], ["İndirilecek KDV", t.purchase_vat], ["Ödenecek KDV", t.payable_vat], ["Satış Matrahı", t.sales_net]], profit: [["Ciro", t.revenue], ["Maliyet", t.cost], ["Brüt Kâr", t.profit], ["Masraflar", t.expenses], ["Net Kâr", t.net_profit], ["Net Marj", t.net_margin, "p"]] }[kind] || [];

  return (
    <div className="space-y-5" data-testid="reports-page">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><BarChart3 className="w-6 h-6 text-emerald-600" /> Raporlar</h1><p className="text-xs sm:text-sm text-slate-500">Satış, alış, yaşlandırma, stok, nakit akışı, KDV ve kârlılık — tarih filtresi, Excel/PDF</p></div>
        <div className="flex flex-wrap items-center gap-2 text-xs no-print">
          {[["month", "Bu Ay"], ["quarter", "Bu Çeyrek"], ["year", "Bu Yıl"], [30, "Son 30 Gün"], [90, "Son 90 Gün"]].map(([k, l]) => <button key={k} onClick={() => preset(k)} className="px-2.5 py-1.5 rounded-lg border bg-white hover:bg-slate-50 font-semibold" data-testid={`report-preset-${k}`}>{l}</button>)}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded-lg p-1.5 bg-white" data-testid="report-from" /><span className="text-slate-400">—</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded-lg p-1.5 bg-white" data-testid="report-to" />
          <button onClick={exportCsv} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="report-export-excel"><Download className="w-3.5 h-3.5" /> Excel</button>
          <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold" data-testid="report-export-pdf"><Printer className="w-3.5 h-3.5" /> PDF / Yazdır</button>
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto no-print">{KINDS.map(([k, l, Icon]) => <button key={k} onClick={() => { setKind(k); setGroup(k === "profit" ? "product" : "contact"); }} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${kind === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} data-testid={`report-tab-${k}`}><Icon className="w-3.5 h-3.5" /> {l}</button>)}
        {(kind === "sales" || kind === "purchases" || kind === "profit") && <div className="ml-auto flex gap-1 text-[11px]">{[["contact", "Cariye göre"], ["product", "Ürüne göre"], ["month", "Aya göre"]].map(([k, l]) => <button key={k} onClick={() => setGroup(k)} className={`px-2 py-1 rounded-lg font-semibold ${group === k ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`} data-testid={`report-group-${k}`}>{l}</button>)}</div>}
      </div>
      <div id="print-area" className="space-y-4">
        <div className="hidden print:block text-sm font-bold">{activeCompany?.name} — {KINDS.find((k) => k[0] === kind)?.[1]} Raporu ({from} – {to})</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{kpis.map(([l, v, ty]) => <div key={l} className="bg-white border border-slate-200 rounded-2xl p-4" data-testid={`report-kpi-${l}`}><div className="text-[10px] uppercase font-semibold text-slate-400">{l}</div><div className="text-lg font-bold text-slate-900">{ty === "raw" ? v : ty === "n" ? (v || 0) : ty === "p" ? `%${fmt(v)}` : `${fmt(v)} ₺`}</div></div>)}</div>
        {kind === "cashflow" && data?.categories?.length > 0 && <div className="bg-white border rounded-2xl p-4 text-xs"><div className="font-bold text-slate-700 mb-2">Kategoriye Göre</div><div className="grid grid-cols-2 md:grid-cols-4 gap-2">{data.categories.map((c) => <div key={c.name} className="flex justify-between bg-slate-50 rounded-lg p-2"><span>{c.name}</span><b className={c.net >= 0 ? "text-emerald-700" : "text-rose-700"}>{fmt(c.net)} ₺</b></div>)}</div></div>}
        {kind === "vat" && data?.by_rate?.length > 0 && <div className="bg-white border rounded-2xl p-4 text-xs"><div className="font-bold text-slate-700 mb-2">KDV Oranına Göre</div><div className="grid grid-cols-2 md:grid-cols-4 gap-2">{data.by_rate.map((c) => <div key={c.name} className="bg-slate-50 rounded-lg p-2"><div className="font-bold">{c.name}</div><div>Satış KDV: {fmt(c.sales_vat)} ₺</div><div>Alış KDV: {fmt(c.purchase_vat)} ₺</div></div>)}</div></div>}
        {data?.insights?.length > 0 && (
          <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-1.5" data-testid="report-insights">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">Karar özeti</div>
            {data.insights.map((ins, i) => (
              <div key={i} className={`text-xs ${ins.level === "alert" ? "text-rose-300" : ins.level === "warn" ? "text-amber-200" : "text-slate-200"}`} data-testid={`report-insight-${i}`}>{ins.text}</div>
            ))}
          </div>
        )}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-xs text-left" data-testid="report-table">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold border-b"><tr>{cols.map((c) => <th key={c[0]} className={`px-3 py-2 ${c[2] && c[2] !== "t" && c[2] !== "s" ? "text-right" : ""}`}>{c[1]}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-slate-400">Yükleniyor…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-slate-400">Bu aralıkta veri yok.</td></tr>}
              {rows.map((r, i) => <tr key={i} className={kind === "aging" && r.d90p > 0 ? "bg-rose-50/40" : ""} data-testid={`report-row-${i}`}>{cols.map((c) => <td key={c[0]} className={`px-3 py-2 ${c[2] && c[2] !== "t" && c[2] !== "s" ? "text-right font-medium" : ""} ${c[0] === "name" ? "font-semibold text-slate-900" : ""}`}>{cell(r[c[0]], c[2])}</td>)}</tr>)}
            </tbody>
            {rows.length > 0 && <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-900"><tr>{cols.map((c, i) => <td key={c[0]} className={`px-3 py-2 ${c[2] === "m" || c[2] === "n" || c[2] === "p" ? "text-right" : ""}`}>{i === 0 ? "TOPLAM" : c[2] === "m" && t[c[0]] !== undefined ? fmt(t[c[0]]) + " ₺" : c[2] === "n" && t[c[0]] !== undefined ? t[c[0]] : c[2] === "p" && t[c[0]] !== undefined ? `%${fmt(t[c[0]])}` : ""}</td>)}</tr></tfoot>}
          </table>
        </div>
      </div>
    </div>
  );
}
