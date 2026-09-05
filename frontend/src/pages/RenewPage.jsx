import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useParams } from "react-router-dom";
import { CreditCard, ShieldCheck, Loader2, Clock, Check } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PLAN_COLORS } from "../components/saas/saasUi";

const tl = (n) => (Number(n) || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";

export default function RenewPage() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [planId, setPlanId] = useState("");
  const [yearly, setYearly] = useState(false);
  const [busy, setBusy] = useState("");
  const [paytr, setPaytr] = useState(null);
  useEffect(() => { axios.get(`${API_URL}/public/renew/${token}`).then((r) => { setD(r.data); setPlanId(r.data.plan?.id || r.data.plans[0]?.id); }).catch((e) => setErr(e.response?.data?.detail || "Bağlantı doğrulanamadı.")); }, [token]);
  const pay = async (provider) => {
    setBusy(provider);
    try {
      const r = await axios.post(`${API_URL}/public/renew/${token}/checkout`, { plan_id: planId, period: yearly ? "yearly" : "monthly", provider, origin_url: window.location.origin });
      if (provider === "paytr") setPaytr(r.data); else window.location.href = r.data.checkout_url;
    } catch (e) { toast.error(e.response?.data?.detail || "Ödeme başlatılamadı."); } finally { setBusy(""); }
  };
  if (err) return <div className="min-h-screen bg-[#0b0f1a] text-slate-100 flex items-center justify-center p-6"><div className="bg-white/5 border border-white/10 rounded-3xl p-8 max-w-md text-center" data-testid="renew-error"><h1 className="text-lg font-bold mb-2">Bağlantı geçersiz</h1><p className="text-sm text-slate-300">{err}</p><a href="/login" className="inline-block mt-4 px-4 py-2 bg-emerald-500 text-slate-900 rounded-xl text-xs font-bold">Giriş Yap</a></div></div>;
  if (!d) return <div className="min-h-screen bg-[#0b0f1a] text-slate-400 flex items-center justify-center text-xs">Yükleniyor…</div>;
  const plan = d.plans.find((p) => p.id === planId) || d.plan;
  const lic = d.license;
  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100 flex items-center justify-center p-6" data-testid="renew-page">
      <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-[1fr_300px] gap-6">
        <div className="bg-white/5 border border-white/10 rounded-3xl p-7 space-y-5">
          <div><div className="text-[10px] uppercase tracking-[0.25em] text-emerald-400 font-semibold">Abonelik Yenileme</div><h1 className="text-2xl font-black mt-1">{d.company.name}</h1>
            <p className="text-sm text-slate-300 mt-2 flex items-center gap-2"><Clock className="w-4 h-4 text-amber-400" /> {lic.status === "expired" ? `${lic.plan_name} paketinizin süresi doldu; modüller kilitli.` : lic.days_left !== null ? `${lic.plan_name} paketiniz ${lic.days_left} gün içinde sona eriyor.` : `Mevcut paket: ${lic.plan_name}`}</p></div>
          <div><div className="text-xs font-semibold text-slate-300 mb-2">Paket</div><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{d.plans.map((p) => <button key={p.id} onClick={() => setPlanId(p.id)} className={`rounded-xl p-3 text-left border transition ${planId === p.id ? "bg-white text-slate-900 border-white" : "bg-white/5 border-white/10 hover:bg-white/10"}`} data-testid={`renew-plan-${p.id}`}><div className="text-xs font-bold">{p.name}</div><div className={`text-[10px] ${planId === p.id ? "text-slate-500" : "text-slate-400"}`}>{tl(p.price_monthly)}/ay</div></button>)}</div></div>
          <div><div className="text-xs font-semibold text-slate-300 mb-2">Dönem</div><div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit text-xs">{[[false, "Aylık"], [true, "Yıllık · 2 ay hediye"]].map(([v, l]) => <button key={l} onClick={() => setYearly(v)} className={`px-4 py-2 rounded-lg font-semibold ${yearly === v ? "bg-white text-slate-900" : "text-slate-300"}`} data-testid={`renew-billing-${v ? "y" : "m"}`}>{l}</button>)}</div></div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button onClick={() => pay("stripe")} disabled={!!busy} className="px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded-xl font-bold text-sm flex items-center gap-2 disabled:opacity-60" data-testid="renew-pay-stripe">{busy === "stripe" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />} Kartla Öde · {tl(yearly ? plan?.price_yearly : plan?.price_monthly)}</button>
            {d.providers?.paytr && <button onClick={() => pay("paytr")} disabled={!!busy} className="px-5 py-3 bg-sky-600 hover:bg-sky-500 text-white rounded-xl font-bold text-sm flex items-center gap-2 disabled:opacity-60" data-testid="renew-pay-paytr"><CreditCard className="w-4 h-4" /> PayTR (TL kart / taksit)</button>}
          </div>
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Ödeme onaylanınca paketiniz anında aktif olur, e-Arşiv faturanız e-posta ile gelir. Fiyatlar KDV hariçtir.</p>
        </div>
        {plan && <aside className="bg-white text-slate-900 rounded-3xl p-6 h-fit" data-testid="renew-summary">
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${PLAN_COLORS[plan.color] || PLAN_COLORS.slate}`}>{plan.name}</span>
          <div className="text-3xl font-black mt-3">{tl(yearly ? plan.price_yearly : plan.price_monthly)}<span className="text-xs font-normal text-slate-500"> /{yearly ? "yıl" : "ay"}</span></div>
          <div className="text-[11px] text-slate-500 mt-1">{plan.user_limit ? `${plan.user_limit} kullanıcı` : "Sınırsız kullanıcı"} · {plan.modules.length} modül</div>
          <ul className="mt-4 space-y-1 text-xs">{(plan.modules || []).slice(0, 12).map((m) => <li key={m} className="flex items-center gap-1.5"><Check className="w-3 h-3 text-emerald-600" />{(d.catalog || []).find((c) => c.key === m)?.label || m}</li>)}{plan.modules.length > 12 && <li className="text-slate-400">+{plan.modules.length - 12} modül daha</li>}</ul>
        </aside>}
      </div>
      {paytr && <div className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4" onClick={() => setPaytr(null)}><div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-2xl p-3" data-testid="renew-paytr-modal"><iframe title="PayTR" src={paytr.iframe_url} className="w-full h-[640px] rounded-xl" frameBorder="0" /></div></div>}
    </div>
  );
}
