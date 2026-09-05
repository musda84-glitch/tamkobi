import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { Check, Sparkles, ArrowRight, ShieldCheck, Zap, Boxes, Users } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PLAN_COLORS, groupByCategory } from "../components/saas/saasUi";

const tl = (n) => (Number(n) || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });

export default function PricingPage() {
  const [d, setD] = useState(null);
  const [yearly, setYearly] = useState(false);
  useEffect(() => { axios.get(`${API_URL}/public/plans`).then((r) => setD(r.data)).catch(() => {}); }, []);
  const groups = d ? groupByCategory(d.catalog) : {};
  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100" data-testid="pricing-page">
      <header className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/fiyatlar" className="font-bold text-lg">Nexus<span className="text-emerald-400">Hesap</span></Link>
        <div className="flex items-center gap-3 text-xs"><Link to="/login" className="text-slate-300 hover:text-white" data-testid="pricing-login-link">Giriş Yap</Link><Link to="/kayit" className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded-xl font-bold" data-testid="pricing-signup-link">Ücretsiz Dene</Link></div>
      </header>
      <section className="max-w-6xl mx-auto px-6 pt-10 pb-6">
        <div className="max-w-2xl">
          <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-400 font-semibold">Bulut ERP · CRM · Ön Muhasebe</div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.05] mt-3">İşletmenizi tek panelden yönetin, <span className="text-emerald-400">ihtiyacınız kadar</span> ödeyin.</h1>
          <p className="text-slate-400 text-sm sm:text-base mt-4">Fatura, cari, stok, e-ticaret, kargo, personel ve üretim modülleri; paketinize göre açılır. {d?.trial_days || 14} gün ücretsiz deneyin, kredi kartı gerekmez.</p>
        </div>
        <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit mt-8 text-xs">{[[false, "Aylık"], [true, "Yıllık · 2 ay hediye"]].map(([v, l]) => <button key={l} onClick={() => setYearly(v)} className={`px-4 py-2 rounded-lg font-semibold transition ${yearly === v ? "bg-white text-slate-900" : "text-slate-300"}`} data-testid={`pricing-billing-${v ? "y" : "m"}`}>{l}</button>)}</div>
      </section>
      <section className="max-w-6xl mx-auto px-6 pb-16 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {!d ? <div className="text-slate-500 text-xs">Yükleniyor…</div> : d.plans.map((p, i) => (
          <div key={p.id} className={`relative rounded-3xl p-6 flex flex-col border transition-transform hover:-translate-y-1 ${p.is_popular ? "bg-white text-slate-900 border-white shadow-2xl shadow-emerald-500/10" : "bg-white/5 border-white/10"}`} style={{ animationDelay: `${i * 80}ms` }} data-testid={`pricing-card-${p.id}`}>
            {p.is_popular && <span className="absolute -top-3 left-6 bg-emerald-500 text-slate-900 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><Sparkles className="w-3 h-3" /> En çok tercih edilen</span>}
            <span className={`w-fit px-2 py-0.5 rounded-md text-[10px] font-bold ${PLAN_COLORS[p.color] || PLAN_COLORS.slate}`}>{p.name}</span>
            <div className={`text-xs mt-3 min-h-[32px] ${p.is_popular ? "text-slate-500" : "text-slate-400"}`}>{p.tagline}</div>
            <div className="mt-4"><span className="text-4xl font-black">{tl(yearly ? p.price_yearly / 12 : p.price_monthly)} ₺</span><span className={`text-xs ${p.is_popular ? "text-slate-500" : "text-slate-400"}`}> /ay{yearly ? ` · yıllık ${tl(p.price_yearly)} ₺` : ""}</span></div>
            <div className={`text-[11px] mt-1 flex items-center gap-1 ${p.is_popular ? "text-slate-500" : "text-slate-400"}`}><Users className="w-3 h-3" /> {p.user_limit ? `${p.user_limit} kullanıcı` : "Sınırsız kullanıcı"} · <Boxes className="w-3 h-3" /> {p.modules.length} modül</div>
            <ul className="mt-5 space-y-1.5 text-xs flex-1">{d.catalog.filter((m) => !m.is_core).map((m) => <li key={m.key} className={`flex items-center gap-2 ${p.modules.includes(m.key) ? "" : p.is_popular ? "text-slate-300 line-through" : "text-slate-600 line-through"}`}><Check className={`w-3.5 h-3.5 shrink-0 ${p.modules.includes(m.key) ? "text-emerald-500" : "opacity-30"}`} />{m.label}</li>)}</ul>
            <Link to={`/kayit?plan=${p.id}`} className={`mt-6 w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${p.is_popular ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-emerald-500 text-slate-900 hover:bg-emerald-400"}`} data-testid={`pricing-start-${p.id}`}>{d.trial_days} gün ücretsiz başla <ArrowRight className="w-4 h-4" /></Link>
          </div>))}
      </section>
      {d && <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-base md:text-lg font-bold mb-4 flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> Tüm modüller</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{Object.entries(groups).map(([cat, mods]) => <div key={cat} className="bg-white/5 border border-white/10 rounded-2xl p-4"><div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-2">{cat}</div><ul className="space-y-1.5">{mods.map((m) => <li key={m.key}><div className="text-xs font-semibold">{m.label}</div><div className="text-[11px] text-slate-400">{m.description}</div></li>)}</ul></div>)}</div>
        <div className="mt-10 text-[11px] text-slate-500 flex flex-wrap items-center gap-3"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Fiyatlar KDV hariçtir. Paketler arası geçiş anında yapılır; ödeme Stripe güvencesiyle alınır.{d.support_email && <span>Destek: {d.support_email} {d.support_phone}</span>}</div>
      </section>}
    </div>
  );
}
