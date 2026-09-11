
/**
 * Dedicated TamKobi vitrin page. Must not share SystemAdminPage's :section matching —
 * /sistem/web used to render an empty "Genel Bakış" shell when the section param was missing.
 */
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL, useAuth } from "../context/AuthContext";
import { SystemLayout } from "../components/saas/SystemLayout";
import { WebsiteAdminPanel } from "../components/saas/WebsiteAdminPanel";

export default function WebsiteAdminPage() {
  const { user, authenticated, refreshLicense } = useAuth();
  const [overview, setOverview] = useState(null);
  const [plans, setPlans] = useState([]);
  const load = useCallback(async () => {
    const cred = { withCredentials: true };
    const grab = async (path, fallback) => {
      try {
        const r = await axios.get(`${API_URL}${path}`, cred);
        return r.data;
      } catch (e) {
        toast.error(e.response?.data?.detail || "Sistem verileri alınamadı.");
        return fallback;
      }
    };
    const [o, p] = await Promise.all([
      grab("/system/overview", null),
      grab("/system/plans", []),
    ]);
    setOverview(o);
    setPlans(Array.isArray(p) ? p : []);
  }, []);
  useEffect(() => {
    if (user?.is_super_admin && authenticated) load();
  }, [load, user, authenticated]);
  return (
    <SystemLayout pendingCount={overview?.pending_requests || 0}>
      <div className="max-w-[1500px] mx-auto space-y-5" data-testid="system-admin-page">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-semibold">Platform</div>
            <h1 className="text-2xl font-bold text-white" data-testid="system-section-title">Web Sitesi</h1>
            <p className="text-xs text-slate-400 mt-1">tamkobi.com vitrini, paket yayını ve marka ayarları</p>
          </div>
          {overview && (
            <div className="flex gap-2 text-xs">
              {[["Şirket", overview.companies], ["Müşteri kullanıcı", overview.users], ["Panel", overview.platform_admins ?? "—"], ["MRR", `${(overview.mrr || 0).toLocaleString("tr-TR")} ₺`]].map(([l, v]) => (
                <div key={l} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-slate-200">
                  <div className="text-[10px] text-slate-400">{l}</div>
                  <div className="font-bold">{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-slate-50 text-slate-900 rounded-3xl p-5 min-h-[60vh]">
          <WebsiteAdminPanel plans={plans} onChanged={() => { load(); refreshLicense(); }} />
        </div>
      </div>
    </SystemLayout>
  );
}
