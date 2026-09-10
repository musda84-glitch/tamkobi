import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { SystemLayout } from "../components/saas/SystemLayout";
import { CompanyLicenseDrawer } from "../components/saas/CompanyLicenseDrawer";
import { findSystemSection } from "../components/saas/systemSections";

export default function SystemAdminPage() {
  const { user, authenticated, refreshLicense } = useAuth();
  const { pathname } = useLocation();
  const { section: routeSection } = useParams();
  const page = (routeSection || pathname.replace(/\/+$/, "").split("/")[2] || "").toLowerCase();
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
  const section = findSystemSection(page);
  const title = section ? section.label : "Bölüm bulunamadı";
  return (
    <SystemLayout pendingCount={overview?.pending_requests || 0} openTickets={overview?.open_tickets || 0}>
      <div className="max-w-[1500px] mx-auto space-y-5" data-testid="system-admin-page">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-semibold">Platform</div><h1 className="text-2xl font-bold text-white" data-testid="system-section-title">{title}</h1></div>
          {overview && <div className="flex gap-2 text-xs">{[["Şirket", overview.companies], ["Müşteri kullanıcı", overview.users], ["Panel", overview.platform_admins ?? "—"], ["MRR", `${(overview.mrr || 0).toLocaleString("tr-TR")} ₺`]].map(([l, v]) => <div key={l} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-slate-200"><div className="text-[10px] text-slate-400">{l}</div><div className="font-bold">{v}</div></div>)}</div>}
        </div>
        <div className="bg-slate-50 text-slate-900 rounded-3xl p-5 min-h-[60vh]">
          {section
            ? section.render({ overview, companies, plans, catalog, requests, changed, openCompany: setOpenId, goRequests: () => navigate("/sistem/talepler") })
            : <MissingSection page={page} />}
        </div>
        {openId && <CompanyLicenseDrawer companyId={openId} plans={plans} catalog={catalog} onClose={() => setOpenId(null)} onChanged={changed} />}
      </div>
    </SystemLayout>
  );
}

/** Adresten gelen bölüm listede yoksa boş beyaz alan yerine bunu göster. */
const MissingSection = ({ page }) => (
  <div className="text-xs text-slate-500 space-y-2" data-testid="system-section-missing">
    <p className="font-semibold text-slate-800">“{page}” diye bir platform bölümü yok.</p>
    <p>Adresi kontrol edin ya da sol menüden bir bölüm seçin.</p>
    <Link to="/sistem" className="inline-block px-3 py-1.5 bg-slate-900 text-white rounded-lg font-bold" data-testid="system-section-missing-home">Genel Bakış’a dön</Link>
  </div>
);
