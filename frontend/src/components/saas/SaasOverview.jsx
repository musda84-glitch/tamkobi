import React, { useEffect, useState } from "react";
import { Building2, Users, Wallet, AlertTriangle, Inbox, Globe, Sparkles } from "lucide-react";
import { Building2, Users, Wallet, AlertTriangle, Inbox, Globe, Sparkles, Mail } from "lucide-react";
import React from "react";
import { Building2, Users, Wallet, AlertTriangle, Inbox, Globe, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API_URL } from "../../context/AuthContext";
import { fmtTL, fmtDate, StatCard, StatusBadge, PlanChip } from "./saasUi";

const AiOverviewBanner = () => {
  const [ai, setAi] = useState(null);
  useEffect(() => { axios.get(`${API_URL}/system/ai`).then((r) => setAi(r.data)).catch(() => {}); }, []);
  return (
    <Link to="/sistem/ai" className="flex flex-wrap items-center justify-between gap-3 bg-violet-50 border border-violet-200 rounded-2xl px-4 py-3 hover:bg-violet-100/70" data-testid="overview-go-ai">
      <span className="font-semibold text-violet-950 inline-flex items-center gap-2">
        <Sparkles className="w-4 h-4" />
        AI Entegrasyonu — tüm şirketler {ai ? <><b className="ml-1">{ai.provider_label} {ai.advisor_label}</b> kullanır</> : "bu sağlayıcıyı kullanır"}
      </span>
      <span className="text-violet-800 font-bold">Ayarla →</span>
    </Link>
  );
};

export const SaasOverview = ({ data, catalog, onOpenCompany, onGoRequests }) => {
  if (!data) return <div className="text-xs text-slate-400 p-6">Yükleniyor…</div>;
  const labels = Object.fromEntries(catalog.map((m) => [m.key, m.label]));
  const usage = Object.entries(data.module_usage).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-5 text-xs" data-testid="saas-overview">
      <AiOverviewBanner />
      <Link to="/sistem/web" className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 hover:bg-emerald-100/70" data-testid="overview-go-web">
        <span className="font-semibold text-emerald-900 inline-flex items-center gap-2"><Globe className="w-4 h-4" /> TamKobi müşteri sitesi yayında — vitrini yönetmek için tıklayın</span>
        <span className="text-emerald-800 font-bold">Web Sitesi →</span>
      </Link>
      <Link to="/sistem/posta" className="flex flex-wrap items-center justify-between gap-3 bg-sky-50 border border-sky-200 rounded-2xl px-4 py-3 hover:bg-sky-100/70" data-testid="overview-go-mail">
        <span className="font-semibold text-sky-900 inline-flex items-center gap-2"><Mail className="w-4 h-4" /> Posta sunucusu — hangi panel maili hangi kutuyu kullanır</span>
        <span className="text-sky-800 font-bold">Posta →</span>
      </Link>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Müşteri Şirket" value={data.companies} sub={`${data.by_status.active || 0} aktif · ${data.by_status.trial || 0} deneme`} testId="stat-companies" />
        <StatCard label="Müşteri Kullanıcı" value={data.users} sub={`${data.platform_admins || 0} panel yöneticisi hariç`} testId="stat-users" />
        <StatCard label="Aylık Gelir (MRR)" value={fmtTL(data.mrr)} sub="aktif lisanslar, KDV hariç" accent="text-emerald-700" testId="stat-mrr" />
        <StatCard label="Bekleyen Talep" value={data.pending_requests} sub={data.pending_requests ? "onay bekliyor" : "talep yok"} accent={data.pending_requests ? "text-amber-600" : "text-slate-900"} testId="stat-requests" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 xl:col-span-1">
          <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-1.5"><Wallet className="w-4 h-4 text-slate-400" /> Paket Dağılımı</h3>
          <ul className="space-y-2">{Object.entries(data.by_plan).map(([n, c]) => <li key={n} className="flex items-center justify-between"><span className="font-semibold text-slate-700">{n}</span><span className="bg-slate-100 px-2 py-0.5 rounded-md font-bold">{c}</span></li>)}</ul>
          {data.expiring.length > 0 && (<><h3 className="font-bold text-slate-900 mt-5 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-amber-500" /> 7 Gün İçinde Bitecek</h3>
            <ul className="space-y-1.5">{data.expiring.map((r) => <li key={r.id}><button onClick={() => onOpenCompany(r.id)} className="w-full text-left flex items-center justify-between hover:bg-slate-50 rounded-lg px-1 py-1" data-testid={`expiring-${r.id}`}><span className="truncate">{r.name}</span><span className="text-amber-700 font-bold">{r.license.days_left} gün</span></button></li>)}</ul></>)}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="font-bold text-slate-900 mb-3">Modül Kullanımı</h3>
          <ul className="space-y-1.5">{usage.map(([k, c]) => <li key={k}><div className="flex justify-between mb-0.5"><span className="text-slate-700">{labels[k] || k}</span><span className="font-bold">{c}/{data.companies}</span></div><div className="h-1.5 bg-slate-100 rounded-full"><div className="h-1.5 bg-amber-400 rounded-full" style={{ width: `${data.companies ? (c / data.companies) * 100 : 0}%` }} /></div></li>)}</ul>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-1.5"><Building2 className="w-4 h-4 text-slate-400" /> Son Eklenen Şirketler</h3>
          <ul className="divide-y">{data.recent.map((r) => <li key={r.id}><button onClick={() => onOpenCompany(r.id)} className="w-full text-left py-2 hover:bg-slate-50 rounded-lg px-1" data-testid={`recent-${r.id}`}><div className="flex items-center justify-between"><b className="text-slate-800 truncate">{r.name}</b><StatusBadge status={r.license.status} /></div><div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5"><PlanChip name={r.license.plan_name} color={r.license.plan_color} /><Users className="w-3 h-3" />{r.usage.users} · {fmtDate(r.created_at)}</div></button></li>)}</ul>
          <button onClick={onGoRequests} className="mt-3 w-full py-2 border border-dashed border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-1.5" data-testid="overview-go-requests"><Inbox className="w-3.5 h-3.5" /> Yükseltme taleplerini gör</button>
        </div>
      </div>
    </div>
  );
};
