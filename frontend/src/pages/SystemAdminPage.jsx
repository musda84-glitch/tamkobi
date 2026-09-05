import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { ShieldCheck, LayoutGrid, Building2, Package, Inbox, Boxes } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { SaasOverview } from "../components/saas/SaasOverview";
import { CompaniesTable } from "../components/saas/CompaniesTable";
import { CompanyLicenseDrawer } from "../components/saas/CompanyLicenseDrawer";
import { PlansPanel } from "../components/saas/PlansPanel";
import { RequestsPanel } from "../components/saas/RequestsPanel";

const TABS = [["overview", "Genel Bakış", LayoutGrid], ["companies", "Şirketler & Lisanslar", Building2], ["plans", "Paketler", Package], ["modules", "Modül Kataloğu", Boxes], ["requests", "Yükseltme Talepleri", Inbox]];

export default function SystemAdminPage() {
  const { user, refreshLicense } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "overview";
  const [overview, setOverview] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [plans, setPlans] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [requests, setRequests] = useState([]);
  const [openId, setOpenId] = useState(null);
  const load = useCallback(async () => {
    try {
      const [o, c, p, m, r] = await Promise.all([axios.get(`${API_URL}/system/overview`), axios.get(`${API_URL}/system/companies`), axios.get(`${API_URL}/system/plans`), axios.get(`${API_URL}/system/modules`), axios.get(`${API_URL}/system/upgrade-requests`)]);
      setOverview(o.data); setCompanies(c.data); setPlans(p.data); setCatalog(m.data); setRequests(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Sistem verileri alınamadı."); }
  }, []);
  useEffect(() => { if (user?.is_super_admin) load(); }, [load, user]);
  if (user && !user.is_super_admin) return <div className="bg-white border rounded-2xl p-10 text-center text-slate-600" data-testid="system-denied"><ShieldCheck className="w-8 h-8 mx-auto text-slate-300 mb-2" /><div className="text-lg font-bold text-slate-900 mb-1">Sistem Yönetimi</div><div className="text-sm">Bu alan yalnızca platform yöneticisine açıktır.</div></div>;
  const changed = () => { load(); refreshLicense(); };
  const go = (t) => setParams({ tab: t });
  return (
    <div className="space-y-5" data-testid="system-admin-page">
      <div className="bg-slate-900 text-white rounded-3xl p-6 relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="flex flex-wrap items-center justify-between gap-4 relative">
          <div><div className="text-[10px] uppercase tracking-[0.2em] text-amber-300 font-semibold flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Platform Yönetimi</div><h1 className="text-2xl sm:text-3xl font-bold mt-1">NexusHesap SaaS Paneli</h1><p className="text-xs text-slate-300 mt-1">Müşteri şirketleri, paketler, modül lisansları ve yükseltme talepleri tek ekranda. Bir modülü kapattığınızda müşterinin menüsünden kaldırılır ve API erişimi engellenir.</p></div>
          <div className="flex gap-2 text-xs">{overview && <><div className="bg-white/10 rounded-xl px-3 py-2"><div className="text-[10px] text-slate-300">Şirket</div><div className="text-lg font-bold">{overview.companies}</div></div><div className="bg-white/10 rounded-xl px-3 py-2"><div className="text-[10px] text-slate-300">MRR</div><div className="text-lg font-bold text-amber-300">{(overview.mrr || 0).toLocaleString("tr-TR")} ₺</div></div></>}</div>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">{TABS.map(([k, l, Icon]) => <button key={k} onClick={() => go(k)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${tab === k ? "bg-amber-400 text-slate-900 shadow" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`} data-testid={`system-tab-${k}`}><Icon className="w-4 h-4" /> {l}{k === "requests" && overview?.pending_requests ? <span className="ml-1 bg-rose-500 text-white rounded-full px-1.5 text-[10px]">{overview.pending_requests}</span> : null}</button>)}</div>
      {tab === "overview" && <SaasOverview data={overview} catalog={catalog} onOpenCompany={setOpenId} onGoRequests={() => go("requests")} />}
      {tab === "companies" && <CompaniesTable rows={companies} plans={plans} onOpen={setOpenId} onCreated={(r) => { changed(); setOpenId(r.id); }} />}
      {tab === "plans" && <PlansPanel plans={plans} catalog={catalog} onChanged={changed} />}
      {tab === "modules" && <ModuleCatalog catalog={catalog} plans={plans} />}
      {tab === "requests" && <RequestsPanel requests={requests} onChanged={changed} onOpenCompany={setOpenId} />}
      {openId && <CompanyLicenseDrawer companyId={openId} plans={plans} catalog={catalog} onClose={() => setOpenId(null)} onChanged={changed} />}
    </div>
  );
}

const ModuleCatalog = ({ catalog, plans }) => (
  <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto text-xs" data-testid="saas-module-catalog">
    <table className="w-full min-w-[720px]">
      <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2.5 text-left">Modül</th><th className="px-3 py-2.5 text-left">Kategori</th><th className="px-3 py-2.5 text-left">Açıklama</th>{plans.map((p) => <th key={p.id} className="px-3 py-2.5 text-center">{p.name}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{catalog.map((m) => <tr key={m.key} data-testid={`catalog-row-${m.key.replace("/", "") || "dashboard"}`}><td className="px-3 py-2 font-semibold text-slate-800">{m.label}{m.is_core && <span className="ml-1.5 text-[9px] bg-slate-100 text-slate-500 px-1 rounded">çekirdek</span>}</td><td className="px-3 py-2 text-slate-500">{m.category}</td><td className="px-3 py-2 text-slate-500">{m.description}</td>{plans.map((p) => <td key={p.id} className="px-3 py-2 text-center">{m.is_core || p.modules.includes(m.key) ? <span className="text-emerald-600 font-bold">✓</span> : <span className="text-slate-300">—</span>}</td>)}</tr>)}</tbody>
    </table>
  </div>
);
