import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link, useLocation } from "react-router-dom";
import { Check, Sparkles, ArrowRight, ShieldCheck, Boxes, Users, FileText, Warehouse, Factory, MessageCircle, ChevronDown, Image as ImageIcon, PlayCircle } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { PLAN_COLORS } from "../components/saas/saasUi";
import { SiteHeader, siteBrand } from "../components/saas/SiteChrome";
import ModulePackBuilder from "../components/saas/ModulePackBuilder";
import { serializeModuleKeys } from "../utils/modulePack";
import { LegalFooterLinks } from "../components/LegalConsent";
import { Seo, buildFaqJsonLd, buildOrgSoftwareJsonLd } from "../components/Seo";
import { buildSiteFaq } from "../utils/siteFaq";
import { billableCatalog, highlightModules } from "../utils/pricingHighlights";

const tl = (n) => (Number(n) || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
const lim = (n, unit) => (Number(n) > 0 ? `${tl(n)} ${unit}` : `Sınırsız ${unit}`);

function waDigits(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = `90${d.replace(/^0+/, "")}`;
  if (d.length === 10) d = `90${d}`;
  return d;
}

const QUOTA_ROWS = [
  { key: "user_limit", label: "Kullanıcı", fmt: (p) => lim(p.user_limit, "kullanıcı") },
  { key: "company_limit", label: "Şirket", fmt: (p) => lim(p.company_limit, "şirket") },
  { key: "product_limit", label: "Stok / ürün", fmt: (p) => lim(p.product_limit, "stok") },
  { key: "contact_limit", label: "Cari", fmt: (p) => lim(p.contact_limit, "cari") },
  { key: "storage_limit_mb", label: "Depolama", fmt: (p) => (Number(p.storage_limit_mb) > 0 ? `${tl(p.storage_limit_mb)} MB` : "Sınırsız depolama") },
];

export default function PricingPage() {
  const { authenticated } = useAuth() || {};
  const { pathname } = useLocation();
  const [d, setD] = useState(null);
  const [yearly, setYearly] = useState(false);
  const [picked, setPicked] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);

  useEffect(() => {
    axios.get(`${API_URL}/public/plans`)
      .then((r) => setD(r.data))
      .catch(() => setD({ plans: [], catalog: [], trial_days: 14, brand_name: "TamKobi" }));
  }, []);

  const brand = siteBrand(d?.brand_name);
  const plans = d?.plans || [];
  const catalog = d?.catalog || [];
  const trialDays = Number(d?.trial_days) > 0 ? Number(d.trial_days) : 14;
  const faq = useMemo(() => buildSiteFaq(trialDays), [trialDays]);
  const billable = useMemo(() => billableCatalog(catalog), [catalog]);
  const wa = waDigits(d?.support_whatsapp || "");
  const publicUrl = (d?.public_url || "https://tamkobi.com").replace(/\/$/, "");
  const jsonLd = useMemo(() => [
    ...buildOrgSoftwareJsonLd({
      brand,
      url: publicUrl,
      email: d?.support_email,
      phone: d?.support_phone,
      plans,
      trialDays,
    }),
    buildFaqJsonLd(faq),
  ], [brand, publicUrl, d?.support_email, d?.support_phone, trialDays, plans, faq]);

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100" data-testid="pricing-page">
      <Seo
        title={pathname === "/web" || pathname === "/fiyatlar"
          ? "Fiyatlar ve Paketler | TamKobi Bulut ERP"
          : "KOBİ'ler için Bulut ERP ve e-Fatura Programı | TamKobi"}
        description="TamKobi — fatura, stok, e-ticaret ve üretim için bulut ERP. Paketinizi seçin, 14 gün ücretsiz deneyin; kredi kartı gerekmez."
        path={pathname === "/web" || pathname === "/fiyatlar" ? "/web" : "/"}
        jsonLd={jsonLd}
      />
      <SiteHeader
        brand={brand}
        right={(
          <div className="flex items-center gap-3 text-xs">
            <a href="#paketler" className="text-slate-300 hover:text-white hidden sm:inline" data-testid="site-nav-plans">Paketler</a>
            <a href="#sss" className="text-slate-300 hover:text-white hidden sm:inline" data-testid="site-nav-faq">SSS</a>
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
          <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-400 font-semibold">{brand.toLocaleUpperCase("tr-TR")} · Bulut ERP</div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.05] mt-3">İşletmenizi tek panelden yönetin, <span className="text-emerald-400">ihtiyacınız kadar</span> ödeyin.</h1>
          <p className="text-slate-400 text-sm sm:text-base mt-4">Fatura, cari, stok, e-ticaret, kargo, personel ve üretim. Hazır paketlerden birini seçin veya modülleri tek tek işaretleyerek kendi paketini oluşturun. {trialDays} gün ücretsiz deneyin, kredi kartı gerekmez.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8 text-xs">
          {[[FileText, "e-Fatura & cari"], [Warehouse, "Stok ve depo"], [Factory, "Üretim & e-ticaret"]].map(([I, t]) => (
            <div key={t} className="flex items-center gap-2.5 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-slate-300"><I className="w-4 h-4 text-emerald-400" />{t}</div>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit mt-8 text-xs">
          {[[false, "Aylık"], [true, "Yıllık · 2 ay hediye"]].map(([v, l]) => (
            <button key={l} onClick={() => setYearly(v)} className={`px-4 py-2 rounded-lg font-semibold transition ${yearly === v ? "bg-white text-slate-900" : "text-slate-300"}`} data-testid={`pricing-billing-${v ? "y" : "m"}`}>{l}</button>
          ))}
        </div>
      </section>

      {/* Ürün görselleri / demo yer tutucuları — sahte müşteri yorumu yok */}
      <section className="max-w-6xl mx-auto px-6 pb-10" data-testid="media-placeholders">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-3xl border border-dashed border-white/20 bg-white/[0.03] p-8 min-h-[180px] flex flex-col items-center justify-center text-center" data-testid="screenshot-placeholder">
            <ImageIcon className="w-8 h-8 text-slate-500 mb-2" />
            <div className="text-sm font-bold text-slate-300">Ürün ekran görüntüsü</div>
            <p className="text-[11px] text-slate-500 mt-1 max-w-xs">Buraya panel / fatura / stok ekran görüntüsü ekleyin (ör. public/brand/screenshots/).</p>
          </div>
          <div className="rounded-3xl border border-dashed border-white/20 bg-white/[0.03] p-8 min-h-[180px] flex flex-col items-center justify-center text-center" data-testid="demo-video-placeholder">
            <PlayCircle className="w-8 h-8 text-slate-500 mb-2" />
            <div className="text-sm font-bold text-slate-300">Demo videosu</div>
            <p className="text-[11px] text-slate-500 mt-1 max-w-xs">YouTube / Vimeo bağlantısı veya gömülü oynatıcı için yer tutucu.</p>
          </div>
        </div>
      </section>

      <section id="paketler" className="max-w-6xl mx-auto px-6 pb-10 scroll-mt-8">
        {!d ? <div className="text-slate-500 text-xs">Yükleniyor…</div> : plans.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-10 text-center" data-testid="pricing-empty">
            <div className="text-lg font-bold">Şu anda yayınlanmış paket yok.</div>
            <p className="text-sm text-slate-400 mt-2">Yakında yeni paketler eklenecek. Destek için bizimle iletişime geçebilirsiniz.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {plans.map((p, i) => {
                const highlights = highlightModules(p.modules, catalog, 6);
                return (
                  <div key={p.id} className={`relative rounded-3xl p-6 flex flex-col border transition-transform hover:-translate-y-1 ${p.is_popular ? "bg-white text-slate-900 border-white shadow-2xl shadow-emerald-500/10" : "bg-white/5 border-white/10"}`} style={{ animationDelay: `${i * 80}ms` }} data-testid={`pricing-card-${p.id}`}>
                    {p.is_popular && <span className="absolute -top-3 left-6 bg-emerald-500 text-slate-900 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><Sparkles className="w-3 h-3" /> En çok tercih edilen</span>}
                    <span className={`w-fit px-2 py-0.5 rounded-md text-[10px] font-bold ${PLAN_COLORS[p.color] || PLAN_COLORS.slate}`}>{p.name}</span>
                    <div className={`text-xs mt-3 min-h-[32px] ${p.is_popular ? "text-slate-500" : "text-slate-400"}`}>{p.tagline}</div>
                    <div className="mt-4"><span className="text-4xl font-black">{tl(yearly ? p.price_yearly / 12 : p.price_monthly)} ₺</span><span className={`text-xs ${p.is_popular ? "text-slate-500" : "text-slate-400"}`}> /ay{yearly ? ` · yıllık ${tl(p.price_yearly)} ₺` : ""}</span></div>
                    <div className={`text-[11px] mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 ${p.is_popular ? "text-slate-500" : "text-slate-400"}`} data-testid={`pricing-limits-${p.id}`}>
                      <Users className="w-3 h-3 shrink-0" />
                      <span>{lim(p.user_limit, "kullanıcı")}</span>
                      <span>·</span>
                      <span>{lim(p.company_limit, "şirket")}</span>
                      <span>·</span>
                      <span>{lim(p.product_limit, "stok")}</span>
                      <span>·</span>
                      <span>{lim(p.contact_limit, "cari")}</span>
                      <span>·</span>
                      <span>{Number(p.storage_limit_mb) > 0 ? `${tl(p.storage_limit_mb)} MB depolama` : "Sınırsız depolama"}</span>
                      <span>·</span>
                      <Boxes className="w-3 h-3 shrink-0" /> {(p.modules || []).length} modül
                    </div>
                    <ul className="mt-5 space-y-1.5 text-xs flex-1" data-testid={`pricing-highlights-${p.id}`}>
                      {highlights.map((m) => (
                        <li key={m.key} className="flex items-center gap-2">
                          <Check className="w-3.5 h-3.5 shrink-0 text-emerald-500" />{m.label}
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={() => setShowCompare(true)} className={`mt-3 text-[11px] font-semibold text-left ${p.is_popular ? "text-emerald-700" : "text-emerald-400"}`} data-testid={`pricing-compare-link-${p.id}`}>
                      Tüm özellikleri karşılaştır
                    </button>
                    <Link to={`/kayit?plan=${p.id}`} className={`mt-4 w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${p.is_popular ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-emerald-500 text-slate-900 hover:bg-emerald-400"}`} data-testid={`pricing-start-${p.id}`}>{trialDays} gün ücretsiz başla <ArrowRight className="w-4 h-4" /></Link>
                  </div>
                );
              })}
            </div>

            {showCompare && billable.length > 0 && (
              <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]" data-testid="pricing-compare-table">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                  <h3 className="text-sm font-bold">Özellik karşılaştırması</h3>
                  <button type="button" className="text-[11px] text-slate-400 hover:text-white" onClick={() => setShowCompare(false)} data-testid="pricing-compare-close">Kapat</button>
                </div>
                <table className="w-full text-[11px] min-w-[640px]">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-white/10">
                      <th className="p-3 font-semibold">Modül</th>
                      {plans.map((p) => <th key={p.id} className="p-3 font-semibold">{p.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {QUOTA_ROWS.map((row) => (
                      <tr key={row.key} className="border-b border-white/5" data-testid={`compare-quota-${row.key}`}>
                        <td className="p-3 text-slate-300 font-semibold">{row.label}</td>
                        {plans.map((p) => (
                          <td key={p.id} className="p-3 text-slate-300">{row.fmt(p)}</td>
                        ))}
                      </tr>
                    ))}
                    {billable.map((m) => (
                      <tr key={m.key} className="border-b border-white/5">
                        <td className="p-3 text-slate-300">{m.label}</td>
                        {plans.map((p) => (
                          <td key={p.id} className="p-3">
                            {(p.modules || []).includes(m.key)
                              ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                              : <span className="text-slate-600">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!showCompare && plans.length > 0 && (
              <button type="button" onClick={() => setShowCompare(true)} className="mt-6 text-xs font-semibold text-emerald-400 hover:text-emerald-300" data-testid="pricing-compare-open">
                Tüm özellikleri karşılaştır
              </button>
            )}
          </>
        )}
      </section>

      <section id="sss" className="max-w-3xl mx-auto px-6 pb-16 scroll-mt-8" data-testid="faq-section">
        <h2 className="text-xl font-bold mb-2">Sık sorulan sorular</h2>
        <p className="text-sm text-slate-400 mb-6">e-Fatura, güvenlik, geçiş, deneme ve destek hakkında kısa cevaplar.</p>
        <div className="space-y-2">
          {faq.map((item, idx) => {
            const open = openFaq === idx;
            return (
              <div key={item.q} className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden" data-testid={`faq-item-${idx}`}>
                <button type="button" className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold" onClick={() => setOpenFaq(open ? -1 : idx)} data-testid={`faq-toggle-${idx}`}>
                  <span>{item.q}</span>
                  <ChevronDown className={`w-4 h-4 shrink-0 transition ${open ? "rotate-180" : ""}`} />
                </button>
                {open ? <div className="px-4 pb-4 text-xs text-slate-400 leading-relaxed" data-testid={`faq-answer-${idx}`}>{item.a}</div> : null}
              </div>
            );
          })}
        </div>
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
          >{trialDays} gün ücretsiz başla <ArrowRight className="w-4 h-4" /></Link>
          <div className="mt-10 text-[11px] text-slate-500 flex flex-wrap items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> Fiyatlar KDV hariçtir.
            {d?.support_email ? <span>Destek: {d.support_email}{d.support_phone ? ` · ${d.support_phone}` : ""}</span> : null}
          </div>
        </section>
      )}

      <footer className="border-t border-white/10 py-6 text-center text-[11px] text-slate-500 space-y-2">
        <LegalFooterLinks className="text-slate-500" prefix="pricing-footer" />
        <div>{brand} · Bulut ERP</div>
      </footer>

      {wa ? (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-emerald-500 text-slate-900 font-bold text-xs shadow-lg shadow-emerald-500/30 hover:bg-emerald-400"
          data-testid="whatsapp-fab"
          aria-label="WhatsApp ile yazın"
        >
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </a>
      ) : null}
    </div>
  );
}
