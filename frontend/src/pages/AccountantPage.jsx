import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Calculator, Download, FileText, Landmark, Users, Receipt } from "lucide-react";
import { API_URL, BACKEND_URL, useAuth } from "../context/AuthContext";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

export default function AccountantPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [d, setD] = useState(null);
  useEffect(() => { axios.get(`${API_URL}/accountant/summary?company_id=${companyId}&month=${month}`).then((r) => setD(r.data)).catch(() => toast.error("Özet yüklenemedi.")); }, [companyId, month]);
  const exp = (kind) => window.open(`${BACKEND_URL}/api/accountant/export?company_id=${companyId}&month=${month}&kind=${kind}`, "_blank");
  if (!d) return null;
  const Card = ({ icon: Icon, title, rows, color }) => <div className="bg-white border border-slate-200 rounded-2xl p-4 text-xs space-y-1.5" data-testid={`acc-card-${title}`}><div className={`flex items-center gap-2 font-bold ${color}`}><Icon className="w-4 h-4" /> {title}</div>{rows.map(([l, v, b]) => <div key={l} className={`flex justify-between ${b ? "font-bold text-slate-900 border-t pt-1" : "text-slate-600"}`}><span>{l}</span><span>{typeof v === "number" ? `${fmt(v)} ₺` : v}</span></div>)}</div>;
  return (
    <div className="space-y-6" data-testid="accountant-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Mali Müşavir Paneli</h1><p className="text-xs sm:text-sm text-slate-500">Aylık KDV, fatura, kasa/banka ve bordro özeti — muhasebeciye tek tıkla dışa aktar</p></div>
        <div className="flex items-center gap-2"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-white border rounded-lg p-2 text-xs" data-testid="acc-month-input" /><button onClick={() => exp("invoices")} className="flex items-center gap-1 px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold" data-testid="acc-export-invoices"><Download className="w-3.5 h-3.5" /> Faturalar CSV</button><button onClick={() => exp("transactions")} className="flex items-center gap-1 px-3 py-2 border rounded-xl text-xs font-semibold" data-testid="acc-export-tx"><Download className="w-3.5 h-3.5" /> Kasa/Banka CSV</button></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card icon={Receipt} title="Satış Faturaları" color="text-emerald-700" rows={[["Adet", String(d.sales.count)], ["Matrah", d.sales.subtotal], ["KDV", d.sales.vat], ["Tahsil Edilmemiş", d.sales.unpaid], ["Toplam", d.sales.total, true]]} />
        <Card icon={FileText} title="Alış Faturaları" color="text-rose-700" rows={[["Adet", String(d.purchases.count)], ["Matrah", d.purchases.subtotal], ["KDV", d.purchases.vat], ["Toplam", d.purchases.total, true]]} />
        <Card icon={Calculator} title="KDV Beyanı" color="text-indigo-700" rows={[["Hesaplanan KDV", d.vat.calculated], ["İndirilecek KDV", d.vat.deductible], ["Devreden KDV", d.vat.carryover], ["Ödenecek KDV", d.vat.payable, true]]} />
        <Card icon={Landmark} title="Kasa / Banka" color="text-blue-700" rows={[["Hareket", String(d.cash.count)], ["Giriş", d.cash.inflow], ["Çıkış", d.cash.outflow], ["Net", d.cash.inflow - d.cash.outflow, true]]} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card icon={Users} title="Bordro" color="text-amber-700" rows={[["Bordro Adedi", String(d.payroll.count)], ["Brüt", d.payroll.gross], ["Net", d.payroll.net], ["İşveren Maliyeti", d.payroll.employer_cost, true]]} />
        <div className="bg-white border border-slate-200 rounded-2xl p-4 text-xs lg:col-span-2" data-testid="acc-vat-table"><div className="font-bold text-slate-900 mb-2">KDV Oranına Göre Dağılım</div><table className="w-full"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1">Oran</th><th className="text-right py-1">Satış Matrah</th><th className="text-right py-1">Hesaplanan</th><th className="text-right py-1">Alış Matrah</th><th className="text-right py-1">İndirilecek</th></tr></thead><tbody className="divide-y divide-slate-100">{d.vat.by_rate.map((r) => <tr key={r.rate}><td className="py-1.5 font-bold">%{r.rate}</td><td className="py-1.5 text-right">{fmt(r.sales_base)}</td><td className="py-1.5 text-right text-emerald-700">{fmt(r.sales_vat)}</td><td className="py-1.5 text-right">{fmt(r.purchase_base)}</td><td className="py-1.5 text-right text-rose-700">{fmt(r.purchase_vat)}</td></tr>)}</tbody></table><div className="mt-2 text-slate-500">E-Belgeler: GİB'e gönderilen {d.e_docs.gib_sent} • Taslak {d.e_docs.draft} • İrsaliye {d.e_docs.dispatch}</div></div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden"><div className="px-4 py-2.5 border-b text-xs font-bold text-slate-900">Dönem Belgeleri ({d.invoices.length})</div><div className="max-h-96 overflow-y-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold sticky top-0"><tr><th className="px-4 py-2">Belge</th><th className="px-4 py-2">Tarih</th><th className="px-4 py-2">Tür</th><th className="px-4 py-2">Cari</th><th className="px-4 py-2 text-right">Matrah</th><th className="px-4 py-2 text-right">KDV</th><th className="px-4 py-2 text-right">Toplam</th><th className="px-4 py-2">GİB</th></tr></thead><tbody className="divide-y divide-slate-100">{d.invoices.map((i) => <tr key={i.id}><td className="px-4 py-1.5 font-mono font-semibold">{i.invoice_number}</td><td className="px-4 py-1.5 text-slate-500">{i.issue_date}</td><td className="px-4 py-1.5 uppercase text-[10px] font-bold text-slate-500">{i.invoice_type} / {i.e_type}</td><td className="px-4 py-1.5">{i.contact_name}</td><td className="px-4 py-1.5 text-right">{fmt(i.subtotal)}</td><td className="px-4 py-1.5 text-right">{fmt(i.vat_total)}</td><td className="px-4 py-1.5 text-right font-bold">{fmt(i.grand_total)}</td><td className="px-4 py-1.5 text-slate-500">{i.gib_status || "Taslak"}</td></tr>)}</tbody></table></div></div>
    </div>
  );
}
