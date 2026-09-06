import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { SystemLayout, SYSTEM_NAV } from "../components/saas/SystemLayout";
import { SaasOverview } from "../components/saas/SaasOverview";
import { CompaniesTable } from "../components/saas/CompaniesTable";
import { CompanyLicenseDrawer } from "../components/saas/CompanyLicenseDrawer";
import { PlansPanel } from "../components/saas/PlansPanel";
import { RequestsPanel } from "../components/saas/RequestsPanel";
import { PaymentsPanel, RemindersPanel, PlatformSettingsPanel } from "../components/saas/PlatformPanels";
import { PlatformUsersPanel } from "../components/saas/PlatformUsersPanel";
import { WebsiteAdminPanel } from "../components/saas/WebsiteAdminPanel";

export default function SystemAdminPage() {
  const { user, authenticated, refreshLicense } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [plans, setPlans] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [requests, setRequests] = useState([]);
  const [openId, setOpenId] = useState(null);
  const load = useCallback(async () => {
    const cred = { withCredentials: true };
    const grab = async (path, set) => {
      try { const r = await axios.get(`${API_URL}${path}`, cred); set(r.data); return true; } catch (e) { toast.error(e.response?.data?.detail || "Sistem verileri alınamadı."); return false; }
    };
    await Promise.all([
      grab("/system/overview", setOverview),
      grab("/system/companies", setCompanies),
      grab("/system/plans", setPlans),
      grab("/system/modules", setCatalog),
      grab("/system/upgrade-requests", setRequests),
    ]);
  }, []);
  useEffect(() => { if (user?.is_super_admin && authenticated) load(); }, [load, user, authenticated]);
  const changed = () => { load(); refreshLicense(); };
  const title = (SYSTEM_NAV.find(([p]) => p === pathname) || SYSTEM_NAV[0])[1];
  return (
    <SystemLayout pendingCount={overview?.pending_requests || 0}>
      <div className="max-w-[1500px] mx-auto space-y-5" data-testid="system-admin-page">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-semibold">Platform</div><h1 className="text-2xl font-bold text-white" data-testid="system-section-title">{title}</h1></div>
          {overview && <div className="flex gap-2 text-xs">{[["Şirket", overview.companies], ["Müşteri kullanıcı", overview.users], ["Panel", overview.platform_admins ?? "—"], ["MRR", `${(overview.mrr || 0).toLocaleString("tr-TR")} ₺`]].map(([l, v]) => <div key={l} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-slate-200"><div className="text-[10px] text-slate-400">{l}</div><div className="font-bold">{v}</div></div>)}</div>}
        </div>
        <div className="bg-slate-50 text-slate-900 rounded-3xl p-5 min-h-[60vh]">
          {pathname === "/sistem" && <SaasOverview data={overview} catalog={catalog} onOpenCompany={setOpenId} onGoRequests={() => navigate("/sistem/talepler")} />}
          {pathname === "/sistem/web" && <WebsiteAdminPanel plans={plans} onChanged={changed} />}
          {pathname === "/sistem/sirketler" && <CompaniesTable rows={companies} plans={plans} onOpen={setOpenId} onCreated={(r) => { changed(); setOpenId(r.id); }} />}
          {pathname === "/sistem/kullanicilar" && <PlatformUsersPanel />}
          {pathname === "/sistem/paketler" && <PlansPanel plans={plans} catalog={catalog} onChanged={changed} />}
          {pathname === "/sistem/moduller" && <ModuleCatalog catalog={catalog} plans={plans} />}
          {pathname === "/sistem/talepler" && <RequestsPanel requests={requests} onChanged={changed} onOpenCompany={setOpenId} />}
          {pathname === "/sistem/odemeler" && <PaymentsPanel />}
          {pathname === "/sistem/hatirlatmalar" && <RemindersPanel />}
          {pathname === "/sistem/ayarlar" && <PlatformSettingsPanel />}
        </div>
        {openId && <CompanyLicenseDrawer companyId={openId} plans={plans} catalog={catalog} onClose={() => setOpenId(null)} onChanged={changed} />}
      </div>
    </SystemLayout>
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
