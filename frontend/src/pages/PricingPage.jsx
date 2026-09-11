
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { Check, Sparkles, ArrowRight, ShieldCheck, Boxes, Users, FileText, Warehouse, Factory } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { PLAN_COLORS } from "../components/saas/saasUi";
import { SiteHeader, siteBrand } from "../components/saas/SiteChrome";
import ModulePackBuilder from "../components/saas/ModulePackBuilder";
import { serializeModuleKeys } from "../utils/modulePack";
import { LegalFooterLinks } from "../components/LegalConsent";

const tl = (n) => (Number(n) || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });

export default function PricingPage() {
  const { authenticated } = useAuth() || {};
  const [d, setD] = useState(null);
  const [yearly, setYearly] = useState(false);
  const [picked, setPicked] = useState([]);
  useEffect(() => { axios.get(`${API_URL}/public/plans`).then((r) => setD(r.data)).catch(() => setD({ plans: [], catalog: [], trial_days: 14, brand_name: "TamKobi" })); }, []);
  const brand = siteBrand(d?.brand_name);
  const plans = d?.plans || [];
  const catalog = d?.catalog || [];
  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100" data-testid="pricing-page">
      <SiteHeader
        brand={brand}
        right={(
          <div className="flex items-center gap-3 text-xs">
            <a href="#paketler" className="text-slate-300 hover:text-white hidden sm:inline" data-testid="site-nav-plans">Paketler</a>
            <a href="#ozel-paket" className="text-slate-300 hover:text-white hidden sm:inline" data-testid="site-nav-custom">Kendi paketin</a>
            {authenticated ? (
              <Link to="/panel" className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded-xl font-bold" data-testid="pricing-go-panel">Panele git</Link>
            ) : (
              <>
                <Link to="/login" className="text-slate-300 hover:text-white" data-testid="pricing-login-link">Giriş Yap</Link>
                <Link to="/kayit" className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded-xl font-bold" data-testid="pricing-signup-link">Ücretsiz Dene</Link>
              </>
            )}
          </div>
        )}
      />
      <section className="max-w-6xl mx-auto px-6 pt-10 pb-6">
        <div className="max-w-2xl">
          <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-400 font-semibold">tamkobi.com · Bulut ERP</div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.05] mt-3">İşletmenizi tek panelden yönetin, <span className="text-emerald-400">ihtiyacınız kadar</span> ödeyin.</h1>
          <p className="text-slate-400 text-sm sm:text-base mt-4">Fatura, cari, stok, e-ticaret, kargo, personel ve üretim. Hazır paketlerden birini seçin veya modülleri tek tek işaretleyerek kendi paketini oluşturun. {d?.trial_days || 14} gün ücretsiz deneyin, kredi kartı gerekmez.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8 text-xs">
          {[[FileText, "e-Fatura & cari"], [Warehouse, "Stok ve depo"], [Factory, "Üretim & e-ticaret"]].map(([I, t]) => (
            <div key={t} className="flex items-center gap-2.5 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-slate-300"><I className="w-4 h-4 text-emerald-400" />{t}</div>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit mt-8 text-xs">{[[false, "Aylık"], [true, "Yıllık · 2 ay hediye"]].map(([v, l]) => <button key={l} onClick={() => setYearly(v)} className={`px-4 py-2 rounded-lg font-semibold transition ${yearly === v ? "bg-white text-slate-900" : "text-slate-300"}`} data-testid={`pricing-billing-${v ? "y" : "m"}`}>{l}</button>)}</div>
      </section>
      <section id="paketler" className="max-w-6xl mx-auto px-6 pb-16 scroll-mt-8">
        {!d ? <div className="text-slate-500 text-xs">Yükleniyor…</div> : plans.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-10 text-center" data-testid="pricing-empty">
            <div className="text-lg font-bold">Şu anda yayınlanmış paket yok.</div>
            <p className="text-sm text-slate-400 mt-2">Platform Yönetimi → Paketler ekranından bir paketi “Yayınla” ile vitrine alın.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {plans.map((p, i) => (
              <div key={p.id} className={`relative rounded-3xl p-6 flex flex-col border transition-transform hover:-translate-y-1 ${p.is_popular ? "bg-white text-slate-900 border-white shadow-2xl shadow-emerald-500/10" : "bg-white/5 border-white/10"}`} style={{ animationDelay: `${i * 80}ms` }} data-testid={`pricing-card-${p.id}`}>
                {p.is_popular && <span className="absolute -top-3 left-6 bg-emerald-500 text-slate-900 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><Sparkles className="w-3 h-3" /> En çok tercih edilen</span>}
                <span className={`w-fit px-2 py-0.5 rounded-md text-[10px] font-bold ${PLAN_COLORS[p.color] || PLAN_COLORS.slate}`}>{p.name}</span>
                <div className={`text-xs mt-3 min-h-[32px] ${p.is_popular ? "text-slate-500" : "text-slate-400"}`}>{p.tagline}</div>
                <div className="mt-4"><span className="text-4xl font-black">{tl(yearly ? p.price_yearly / 12 : p.price_monthly)} ₺</span><span className={`text-xs ${p.is_popular ? "text-slate-500" : "text-slate-400"}`}> /ay{yearly ? ` · yıllık ${tl(p.price_yearly)} ₺` : ""}</span></div>
                <div className={`text-[11px] mt-1 flex items-center gap-1 ${p.is_popular ? "text-slate-500" : "text-slate-400"}`}><Users className="w-3 h-3" /> {p.user_limit ? `${p.user_limit} kullanıcı` : "Sınırsız kullanıcı"} · {p.company_limit ? `${p.company_limit} şirket` : "Sınırsız şirket"} · {p.product_limit ? `${p.product_limit} stok` : "Sınırsız stok"} · {p.contact_limit ? `${p.contact_limit} cari` : "Sınırsız cari"} · {p.storage_limit_mb ? `${p.storage_limit_mb} MB resim` : "Sınırsız depolama"} · <Boxes className="w-3 h-3" /> {p.modules.length} modül</div>
                <ul className="mt-5 space-y-1.5 text-xs flex-1">{(d.catalog || []).filter((m) => !m.is_core).map((m) => <li key={m.key} className={`flex items-center gap-2 ${p.modules.includes(m.key) ? "" : p.is_popular ? "text-slate-300 line-through" : "text-slate-600 line-through"}`}><Check className={`w-3.5 h-3.5 shrink-0 ${p.modules.includes(m.key) ? "text-emerald-500" : "opacity-30"}`} />{m.label}</li>)}</ul>
                <Link to={`/kayit?plan=${p.id}`} className={`mt-6 w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${p.is_popular ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-emerald-500 text-slate-900 hover:bg-emerald-400"}`} data-testid={`pricing-start-${p.id}`}>{d.trial_days} gün ücretsiz başla <ArrowRight className="w-4 h-4" /></Link>
              </div>
            ))}
          </div>
        )}
      </section>
      {catalog.filter((m) => !m.is_core).length > 0 && (
        <section id="ozel-paket" className="max-w-6xl mx-auto px-6 pb-20 scroll-mt-8" data-testid="custom-pack-section">
          <h2 className="text-base md:text-lg font-bold mb-1">Kendi paketini oluştur</h2>
          <p className="text-sm text-slate-400 mb-5">Modülleri tek tek seçin; fiyat anında güncellenir. Deneme süresince kredi kartı gerekmez.</p>
          <ModulePackBuilder catalog={catalog} selected={picked} onChange={setPicked} yearly={yearly} />
          <Link
            to={picked.length ? `/kayit?modules=${serializeModuleKeys(picked)}` : "/kayit"}
            className={`mt-4 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm ${picked.length ? "bg-emerald-500 text-slate-900 hover:bg-emerald-400" : "bg-white/10 text-slate-400 pointer-events-none"}`}
            data-testid="custom-pack-start"
          >{d?.trial_days || 14} gün ücretsiz başla <ArrowRight className="w-4 h-4" /></Link>
          <div className="mt-10 text-[11px] text-slate-500 flex flex-wrap items-center gap-3"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Fiyatlar KDV hariçtir. Hazır paketler Platform Yönetimi’nden yayınlanır; modül fiyatları Modül Kataloğu’ndan değişir.{d?.support_email && <span>Destek: {d.support_email} {d.support_phone}</span>}</div>
        </section>
      )}
      <footer className="border-t border-white/10 py-6 text-center text-[11px] text-slate-500 space-y-2">
        <LegalFooterLinks className="text-slate-500" prefix="pricing-footer" />
        <div>{brand}.com · {brand} ERP</div>
      </footer>
    </div>
  );
}
