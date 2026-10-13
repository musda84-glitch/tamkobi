import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { SystemLayout } from "../components/saas/SystemLayout";
import { CompanyLicenseDrawer } from "../components/saas/CompanyLicenseDrawer";
import {
  companyDetailTabFromUrl,
  companyDetailTabToUrl,
} from "../utils/companyDetailTabs";

const cred = { withCredentials: true };

/**
 * ynt: /sistem/sirketler/:companyId — şirket detayı (eski drawer yerine tam sayfa).
 * Sekmeler URL’de (?tab=entegrator); iş mantığı CompanyLicenseDrawer’da.
 */
export default function CompanyDetailPage() {
  const { companyId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshLicense } = useAuth();
  const [plans, setPlans] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [overviewMeta, setOverviewMeta] = useState(null);

  const tab = companyDetailTabFromUrl(searchParams.get("tab"));

  const setTab = useCallback((nextId) => {
    const urlTab = companyDetailTabToUrl(nextId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (urlTab === "license") next.delete("tab");
      else next.set("tab", urlTab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const loadMeta = useCallback(async () => {
    try {
      const [p, m, c] = await Promise.all([
        axios.get(`${API_URL}/system/plans`, cred),
        axios.get(`${API_URL}/system/modules`, cred),
        axios.get(`${API_URL}/system/companies`, cred),
      ]);
      setPlans(Array.isArray(p.data) ? p.data : []);
      setCatalog(Array.isArray(m.data) ? m.data : []);
      setCompanies(Array.isArray(c.data) ? c.data : []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sistem verileri alınamadı.");
    }
    try {
      const o = await axios.get(`${API_URL}/system/overview`, cred);
      setOverviewMeta(o.data);
    } catch { /* overview opsiyonel */ }
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  const changed = useCallback(() => {
    loadMeta();
    refreshLicense?.();
  }, [loadMeta, refreshLicense]);

  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const ok = window.confirm("Kaydedilmemiş değişiklikler var. Sayfadan çıkmak istiyor musunuz?");
    if (ok) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const goBack = () => {
    if (dirty && !window.confirm("Kaydedilmemiş değişiklikler var. Sayfadan çıkmak istiyor musunuz?")) return;
    setDirty(false);
    navigate("/sistem/sirketler");
  };

  if (!companyId) {
    return (
      <SystemLayout pendingCount={overviewMeta?.pending_requests || 0} openTickets={overviewMeta?.open_tickets || 0}>
        <div className="text-slate-300 text-xs" data-testid="company-detail-missing-id">Şirket seçilmedi.</div>
      </SystemLayout>
    );
  }

  return (
    <SystemLayout pendingCount={overviewMeta?.pending_requests || 0} openTickets={overviewMeta?.open_tickets || 0}>
      <div className="max-w-[1500px] mx-auto space-y-4" data-testid="company-detail-page">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-100 font-semibold border border-white/10"
            data-testid="company-detail-back"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Şirketler
          </button>
          <nav className="text-slate-400 flex items-center gap-1.5 flex-wrap" data-testid="company-detail-breadcrumb" aria-label="breadcrumb">
            <Link to="/sistem" className="hover:text-amber-300">Platform</Link>
            <span className="text-slate-600">/</span>
            <Link to="/sistem/sirketler" className="hover:text-amber-300">Şirketler</Link>
            <span className="text-slate-600">/</span>
            <span className="text-slate-200 font-semibold truncate max-w-[240px]" data-testid="company-detail-crumb-id">{companyId}</span>
          </nav>
        </div>

        <div className="bg-slate-50 text-slate-900 rounded-3xl min-h-[60vh] overflow-hidden">
          <CompanyLicenseDrawer
            layout="page"
            companyId={companyId}
            plans={plans}
            catalog={catalog}
            companies={companies}
            initialTab={tab}
            controlledTab={tab}
            onTabChange={setTab}
            onDirtyChange={setDirty}
            onClose={goBack}
            onChanged={changed}
          />
        </div>
      </div>
    </SystemLayout>
  );
}
