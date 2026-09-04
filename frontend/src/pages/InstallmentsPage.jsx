import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { CalendarClock, AlertTriangle, CalendarDays, ArrowDownRight, ArrowUpRight, CheckCircle2, MessageSquare, FileText } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { InstallmentRows } from "../components/InstallmentPlanModal";
import { QuickMessageModal } from "../components/QuickMessageModal";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const FILTERS = [["pending", "Bekleyen"], ["overdue", "Vadesi Geçen"], ["receivable", "Alacak (Satış)"], ["payable", "Borç (Alış)"], ["paid", "Ödenen"], ["all", "Tümü"]];

export default function InstallmentsPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [remind, setRemind] = useState(null);

  const load = useCallback(async () => {
    const qs = filter === "receivable" || filter === "payable" ? `direction=${filter}&status=pending` : `status=${filter === "all" ? "" : filter}`;
    try {
      const [r, s, a, c] = await Promise.all([axios.get(`${API_URL}/installments?company_id=${companyId}&${qs}`), axios.get(`${API_URL}/installments/summary?company_id=${companyId}`), axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`), axios.get(`${API_URL}/contacts?company_id=${companyId}`)]);
      setRows(r.data); setSummary(s.data); setAccounts(a.data); setContacts(c.data);
    } catch { toast.error("Taksitler yüklenemedi."); }
  }, [companyId, filter]);
  useEffect(() => { load(); }, [load]);

  const grouped = rows.reduce((acc, r) => { const k = r.invoice_id || `bal-${r.contact_id}`; (acc[k] = acc[k] || []).push(r); return acc; }, {});
  const Card = ({ icon: Icon, label, value, sub, tone, testId }) => (
    <div className={`bg-white rounded-2xl border p-4 flex items-center gap-3 ${tone}`} data-testid={testId}><div className="p-2 rounded-xl bg-slate-50"><Icon className="w-5 h-5" /></div><div><div className="text-[10px] uppercase font-semibold text-slate-400">{label}</div><div className="text-lg font-bold text-slate-900">{value}</div>{sub && <div className="text-[11px] text-slate-500">{sub}</div>}</div></div>
  );

  return (
    <div className="space-y-6" data-testid="installments-page">
      <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Taksitler</h1><p className="text-xs sm:text-sm text-slate-500">Satış & alış faturalarının taksit planları, vade takibi ve tahsilat/ödeme</p></div>
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card icon={AlertTriangle} label="Vadesi Geçen" value={`${fmt(summary.overdue.amount)} ₺`} sub={`${summary.overdue.count} taksit`} tone="border-rose-200 text-rose-600" testId="inst-card-overdue" />
          <Card icon={CalendarDays} label="Bu Ay Vadeli" value={`${fmt(summary.this_month.amount)} ₺`} sub={`${summary.this_month.count} taksit`} tone="border-amber-200 text-amber-600" testId="inst-card-month" />
          <Card icon={ArrowDownRight} label="Bekleyen Alacak" value={`${fmt(summary.pending_receivable)} ₺`} tone="border-emerald-200 text-emerald-600" testId="inst-card-receivable" />
          <Card icon={ArrowUpRight} label="Bekleyen Borç" value={`${fmt(summary.pending_payable)} ₺`} tone="border-blue-200 text-blue-600" testId="inst-card-payable" />
          <Card icon={CheckCircle2} label="Tahsil / Ödenen" value={`${fmt(summary.paid_total)} ₺`} tone="border-slate-200 text-slate-600" testId="inst-card-paid" />
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 text-xs overflow-x-auto">
        {FILTERS.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition ${filter === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid={`inst-filter-${k}`}>{l}</button>)}
      </div>
      {Object.keys(grouped).length === 0 && <div className="bg-white border border-dashed rounded-2xl p-10 text-center text-xs text-slate-400" data-testid="inst-empty"><CalendarClock className="w-8 h-8 mx-auto mb-2 text-slate-300" />Bu filtrede taksit yok. Faturalar sayfasında bir faturaya sağ tıklayıp "Taksitlendir" ile plan oluşturabilirsiniz.</div>}
      <div className="space-y-3">
        {Object.entries(grouped).map(([invId, list]) => {
          const f = list[0];
          const c = contacts.find((x) => x.id === f.contact_id) || {};
          const remaining = list.reduce((s, r) => s + r.amount - (r.paid_amount || 0), 0);
          return (
            <div key={invId} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2" data-testid={`inst-group-${f.invoice_number}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${f.direction === "receivable" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{f.direction === "receivable" ? "ALACAK" : "BORÇ"}</span>
                <button onClick={() => navigate(f.invoice_id ? `/invoices?contact_id=${f.contact_id}` : `/contacts?contact_id=${f.contact_id}`)} className="font-mono font-bold text-slate-900 hover:underline flex items-center gap-1" data-testid={`inst-invoice-link-${f.invoice_number}`}><FileText className="w-3.5 h-3.5 text-slate-400" /> {f.invoice_number}</button>
                <button onClick={() => navigate(`/contacts?contact_id=${f.contact_id}`)} className="font-semibold text-slate-700 hover:text-emerald-700 hover:underline">{f.contact_name}</button>
                <span className="text-slate-400">{list.filter((r) => r.status === "paid").length}/{f.total_count} ödendi</span>
                <span className="ml-auto font-bold text-slate-900">Kalan {fmt(remaining)} ₺</span>
                {f.direction === "receivable" && <button onClick={() => setRemind({ inst: list.find((r) => r.status !== "paid") || f, contact: c })} className="flex items-center gap-1 px-2 py-1 border rounded-lg text-violet-700 hover:bg-violet-50 font-semibold" data-testid={`inst-remind-${f.invoice_number}`}><MessageSquare className="w-3.5 h-3.5" /> Hatırlat</button>}
              </div>
              <InstallmentRows rows={list} accounts={accounts} companyId={companyId} onPaid={load} />
            </div>
          );
        })}
      </div>
      {remind && <QuickMessageModal companyId={companyId} recipient={{ contact_id: remind.inst.contact_id, name: remind.inst.contact_name, phone: remind.contact.phone, email: remind.contact.email }} defaultSubject={`Taksit Hatırlatması - ${remind.inst.invoice_number}`} defaultMessage={`Sayın ${remind.inst.contact_name}, ${remind.inst.invoice_number} nolu faturanızın ${remind.inst.label} (${fmt(remind.inst.amount)} ₺) vadesi ${remind.inst.due_date} tarihidir. Ödemeniz için teşekkür ederiz.`} context="installment" refId={remind.inst.id} onClose={() => setRemind(null)} />}
    </div>
  );
}
