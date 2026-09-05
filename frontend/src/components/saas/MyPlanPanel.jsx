import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Lock, Users, Sparkles, Clock, CreditCard } from "lucide-react";
import { API_URL, useAuth } from "../../context/AuthContext";
import { fmtTL, fmtDate, PlanChip, StatusBadge, groupByCategory } from "./saasUi";

export const MyPlanPanel = ({ companyId }) => {
  const { refreshLicense } = useAuth();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [yearly, setYearly] = useState(false);
  const load = useCallback(() => axios.get(`${API_URL}/license/me`, { params: { company_id: companyId } }).then((r) => setD(r.data)).catch(() => toast.error("Paket bilgisi alınamadı.")), [companyId]);
  useEffect(() => { load(); }, [load]);
  const [providers, setProviders] = useState({ stripe: true, paytr: false });
  const [paytr, setPaytr] = useState(null);
  useEffect(() => { axios.get(`${API_URL}/payments/providers`).then((r) => setProviders(r.data)).catch(() => {}); }, []);
  if (!d) return <div className="text-xs text-slate-400 p-6">Yükleniyor…</div>;
  const groups = groupByCategory(d.catalog);
  const request = async (plan) => {
    setBusy(true);
    try { const r = await axios.post(`${API_URL}/license/upgrade-request`, { company_id: companyId, plan_id: plan.id, message: `${plan.name} paketine geçiş (${yearly ? "yıllık" : "aylık"})` }); toast.success(r.data.message); await load(); refreshLicense(companyId); } catch (e) { toast.error(e.response?.data?.detail || "Talep gönderilemedi."); } finally { setBusy(false); }
  };
  const payPaytr = async (plan) => {
    setBusy(true);
    try { const r = await axios.post(`${API_URL}/payments/paytr/session`, { company_id: companyId, plan_id: plan.id, period: yearly ? "yearly" : "monthly", origin_url: window.location.origin }); setPaytr(r.data); } catch (e) { toast.error(e.response?.data?.detail || "PayTR başlatılamadı."); } finally { setBusy(false); }
  };
  const pay = async (plan) => {
    setBusy(true);
    try { const r = await axios.post(`${API_URL}/payments/checkout`, { company_id: companyId, plan_id: plan.id, period: yearly ? "yearly" : "monthly", origin_url: window.location.origin }); window.location.href = r.data.checkout_url; } catch (e) { toast.error(e.response?.data?.detail || "Ödeme başlatılamadı."); setBusy(false); }
  };
  return (
    <div className="space-y-5 text-xs" data-testid="my-plan-panel">
      {paytr && <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPaytr(null)}><div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-2xl p-3" data-testid="paytr-modal"><div className="flex items-center justify-between px-2 pb-2"><b className="text-slate-900">PayTR Güvenli Ödeme</b><button onClick={() => setPaytr(null)} className="text-slate-500 text-xs" data-testid="paytr-close">Kapat</button></div><iframe title="PayTR ödeme" src={paytr.iframe_url} className="w-full h-[640px] rounded-xl" frameBorder="0" /></div></div>}
      <div className="bg-slate-900 text-white rounded-2xl p-5 flex flex-wrap items-center gap-5">
        <div className="flex-1 min-w-[220px]">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Mevcut Paketiniz</div>
          <div className="flex items-center gap-2 mt-1"><span className="text-2xl font-bold" data-testid="my-plan-name">{d.plan_name}</span><StatusBadge status={d.status} testId="my-plan-status" /></div>
          <div className="text-slate-300 mt-1">{d.enabled_count}/{d.total_count} modül aktif · <Users className="inline w-3 h-3" /> {d.users}/{d.user_limit || "∞"} kullanıcı{d.days_left !== null && d.days_left !== undefined ? <> · <Clock className="inline w-3 h-3" /> {d.days_left} gün kaldı ({fmtDate(d.trial_ends_at || d.expires_at)})</> : ""}</div>
        </div>
        {d.pending_request && <div className="bg-amber-400/15 border border-amber-400/30 text-amber-200 rounded-xl px-3 py-2" data-testid="my-plan-pending">Bekleyen talep: <b>{d.pending_request.plan_name}</b> · {fmtDate(d.pending_request.created_at)}</div>}
      </div>

      <div>
        <h3 className="font-bold text-slate-900 text-sm mb-2">Modüller</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Object.entries(groups).map(([cat, mods]) => (
            <div key={cat} className="bg-white border border-slate-200 rounded-2xl p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{cat}</div>
              <ul className="space-y-1.5">{mods.map((m) => { const on = d.modules[m.key]; return (
                <li key={m.key} className="flex items-start gap-2" data-testid={`my-module-${m.key.replace("/", "")}`}>
                  <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${on ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{on ? <Check className="w-3 h-3" /> : <Lock className="w-2.5 h-2.5" />}</span>
                  <div><div className={`font-semibold ${on ? "text-slate-800" : "text-slate-400"}`}>{m.label}</div><div className="text-[10px] text-slate-400 leading-tight">{m.description}</div></div>
                </li>); })}</ul>
            </div>))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2"><h3 className="font-bold text-slate-900 text-sm">Paketler</h3>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">{[["m", "Aylık"], ["y", "Yıllık (−17%)"]].map(([k, l]) => <button key={k} onClick={() => setYearly(k === "y")} className={`px-3 py-1 rounded-md font-semibold ${yearly === (k === "y") ? "bg-white shadow text-slate-900" : "text-slate-500"}`} data-testid={`billing-${k}`}>{l}</button>)}</div></div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {d.plans.map((p) => { const cur = p.id === d.plan_id; return (
            <div key={p.id} className={`relative bg-white border rounded-2xl p-4 flex flex-col ${cur ? "border-emerald-500 ring-2 ring-emerald-500/20" : p.is_popular ? "border-indigo-300" : "border-slate-200"}`} data-testid={`plan-card-${p.id}`}>
              {p.is_popular && !cur && <span className="absolute -top-2 right-3 bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" /> Popüler</span>}
              <PlanChip name={p.name} color={p.color} />
              <div className="text-[11px] text-slate-500 mt-2 min-h-[28px]">{p.tagline}</div>
              <div className="text-xl font-bold text-slate-900 mt-2">{fmtTL(yearly ? p.price_yearly / 12 : p.price_monthly)}<span className="text-[10px] font-normal text-slate-500">/ay{yearly ? " (yıllık faturalanır)" : ""}</span></div>
              <div className="text-[10px] text-slate-500 mt-1">{p.user_limit ? `${p.user_limit} kullanıcı` : "Sınırsız kullanıcı"} · {p.modules.length} modül</div>
              <ul className="mt-3 space-y-1 flex-1">{d.catalog.filter((m) => !m.is_core).map((m) => <li key={m.key} className={`flex items-center gap-1.5 ${p.modules.includes(m.key) ? "text-slate-700" : "text-slate-300 line-through"}`}><Check className={`w-3 h-3 ${p.modules.includes(m.key) ? "text-emerald-600" : "text-slate-300"}`} />{m.label}</li>)}</ul>
              {cur && d.status === "active" ? <div className="mt-4 w-full py-2 rounded-xl font-bold bg-emerald-50 text-emerald-700 text-center" data-testid={`plan-current-${p.id}`}>Mevcut Paket</div> : (<>
                <button disabled={busy} onClick={() => pay(p)} className="mt-4 w-full py-2 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 flex items-center justify-center gap-1.5" data-testid={`plan-pay-${p.id}`}><CreditCard className="w-3.5 h-3.5" /> {cur ? "Yenile / Satın Al" : "Satın Al"} · {fmtTL(yearly ? p.price_yearly : p.price_monthly)}</button>
                {providers.paytr && <button disabled={busy} onClick={() => payPaytr(p)} className="mt-1.5 w-full py-2 rounded-xl font-bold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60 flex items-center justify-center gap-1.5" data-testid={`plan-paytr-${p.id}`}><CreditCard className="w-3.5 h-3.5" /> PayTR ile Öde (TL kart / taksit)</button>}
                <button disabled={busy || !!d.pending_request} onClick={() => request(p)} className="mt-1.5 w-full py-1.5 rounded-xl font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-50" data-testid={`plan-request-${p.id}`}>{d.pending_request ? "Talep bekliyor" : "Yöneticiden talep et"}</button></>)}
            </div>); })}
        </div>
        <p className="text-[10px] text-slate-400 mt-2">Kartla ödemede paket anında aktif olur (Stripe güvenli ödeme). "Yöneticiden talep et" ile manuel aktivasyon isteyebilirsiniz. Fiyatlar KDV hariçtir.</p>
      </div>
    </div>
  );
};
