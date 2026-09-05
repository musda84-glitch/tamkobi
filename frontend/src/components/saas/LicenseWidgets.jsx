import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Lock, ArrowUpRight, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { API_URL } from "../../context/AuthContext";
import { STATUS_LABELS } from "./saasUi";

export const LicenseBadge = ({ license }) => {
  if (!license) return <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium text-[11px]">E-Fatura & E-Ticaret Canlı</span>;
  const s = license.status;
  const cls = s === "active" ? "text-emerald-700 bg-emerald-50" : s === "trial" ? "text-sky-700 bg-sky-50" : "text-rose-700 bg-rose-50";
  return (
    <Link to="/settings?tab=plan" className={`${cls} px-2 py-0.5 rounded-full font-medium text-[11px] flex items-center gap-1 hover:opacity-80`} data-testid="license-badge" title="Paketim & Modüller">
      {license.plan_name} · {STATUS_LABELS[s] || s}{license.days_left !== null && license.days_left !== undefined && (s === "trial" || license.expires_at) ? <><Clock className="w-3 h-3" />{license.days_left} gün</> : null}
    </Link>
  );
};

export const ModuleLockedPanel = ({ path, license: base, companyId }) => {
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(null);
  useEffect(() => { axios.get(`${API_URL}/license/me`, { params: { company_id: companyId } }).then((r) => setFull(r.data)).catch(() => {}); }, [companyId]);
  const license = full || base;
  const label = license?.catalog?.find((m) => m.key === path)?.label || path;
  const nextPlan = (license?.plans || []).find((p) => p.modules?.includes(path) && (!license?.plan_id || p.sort >= ((license.plans || []).find((x) => x.id === license.plan_id)?.sort ?? 0))) || (license?.plans || []).find((p) => p.modules?.includes(path));
  const request = async () => {
    if (!nextPlan) return toast.error("Uygun paket bulunamadı; sistem yöneticinizle iletişime geçin.");
    setBusy(true);
    try { const r = await axios.post(`${API_URL}/license/upgrade-request`, { company_id: companyId, plan_id: nextPlan.id, modules: [path], message: `${label} modülü için yükseltme` }); toast.success(r.data.message); } catch (e) { toast.error(e.response?.data?.detail || "Talep gönderilemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="bg-slate-900 text-slate-100 rounded-3xl p-10 max-w-2xl mx-auto mt-6 relative overflow-hidden" data-testid="module-locked">
      <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-amber-400/10 blur-2xl" />
      <div className="w-12 h-12 rounded-2xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center mb-5"><Lock className="w-6 h-6 text-amber-300" /></div>
      <h2 className="text-xl font-bold mb-2">{license?.locked ? `Hesabınız ${license.status_label?.toLowerCase()} durumda` : `“${label}” modülü paketinizde aktif değil`}</h2>
      <p className="text-sm text-slate-300 mb-6">{license?.locked ? "Tüm modüller geçici olarak kilitlendi. Lisansınızı yenilemek için sistem yöneticinizle iletişime geçin." : <>Mevcut paketiniz <b className="text-white">{license?.plan_name}</b>. Bu modülü kullanmak için {nextPlan ? <><b className="text-amber-300">{nextPlan.name}</b> paketine yükseltebilir</> : "paketinizi yükseltebilir"} ya da yöneticinizden yalnızca bu modülün açılmasını isteyebilirsiniz.</>}</p>
      <div className="flex flex-wrap gap-2">
        {!license?.locked && <button onClick={request} disabled={busy} className="px-4 py-2 bg-amber-400 text-slate-900 rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-amber-300 disabled:opacity-60" data-testid="module-locked-upgrade-btn"><ArrowUpRight className="w-4 h-4" /> Yükseltme Talebi Gönder</button>}
        <Link to="/settings?tab=plan" className="px-4 py-2 border border-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-800" data-testid="module-locked-plan-link">Paketimi Gör</Link>
      </div>
    </div>
  );
};
