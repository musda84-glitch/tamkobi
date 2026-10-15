import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link, NavLink, useLocation } from "react-router-dom";
import { API_URL } from "../context/AuthContext";
import { Seo } from "../components/Seo";
import NotFoundPage from "./NotFoundPage";
import { hostnameOf } from "../utils/hosts";
import {
  TAI_HOSTS,
  marketingSlugFromLocation,
  publishedCards,
  taiPageKey,
} from "../utils/marketingSite";
import { TAI_FAVICON_ICO, TAI_FAVICON_PNG, TAI_LOGO_SRC } from "../utils/platformBrand";
import { announceVitrinPreview } from "../utils/vitrinPreview";

const NAVY = "#13295B";
const RED = "#CC1F26";

const NAV = [
  { to: "/", label: "Ana sayfa", key: "home", end: true },
  { to: "/hakkimizda", label: "Hakkımızda", key: "about" },
  { to: "/hizmetler", label: "Hizmetler", key: "services" },
  { to: "/referanslar", label: "Referanslar", key: "references" },
  { to: "/iletisim", label: "İletişim", key: "contact" },
];

function apiQuery() {
  const host = hostnameOf();
  if (TAI_HOSTS.includes(host)) return "";
  return "?slug=tai";
}

/** Panel önizlemesi ynt hostunda kalırken Host yönlendirmesini kesmesin. */
function linkQuery() {
  const host = hostnameOf();
  if (TAI_HOSTS.includes(host)) return "";
  return "?site=tai&onizleme=1";
}

function pageSeo(content, key) {
  const page = content?.pages?.[key] || {};
  return {
    title: page.seo_title || "TAI Yazılım",
    description: page.seo_description || "TAI Yazılım kurumsal yazılım ve TamKobi.",
  };
}

export default function TaiSite({ page }) {
  const { pathname } = useLocation();
  const key = page || taiPageKey(pathname);
  const slug = marketingSlugFromLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "", hp_company: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (slug !== "tai") return;
    announceVitrinPreview();
  }, [slug]);

  useLayoutEffect(() => {
    if (slug !== "tai") return undefined;
    const links = [
      { rel: "icon", href: TAI_FAVICON_ICO },
      { rel: "icon", type: "image/png", href: TAI_FAVICON_PNG },
    ];
    const created = links.map((spec) => {
      const el = document.createElement("link");
      el.setAttribute("rel", spec.rel);
      if (spec.type) el.setAttribute("type", spec.type);
      el.setAttribute("href", spec.href);
      el.setAttribute("data-tai-icon", "1");
      document.head.appendChild(el);
      return el;
    });
    return () => created.forEach((el) => el.remove());
  }, [slug]);

  useEffect(() => {
    if (slug !== "tai") return undefined;
    let on = true;
    axios.get(`${API_URL}/public/site${apiQuery()}`)
      .then((r) => { if (on) setData(r.data); })
      .catch(() => { if (on) setError("Site şu anda yüklenemedi."); });
    return () => { on = false; };
  }, [slug]);

  const content = data?.content || null;
  const pages = content?.pages || {};
  const services = useMemo(() => publishedCards(content?.services), [content]);
  const references = useMemo(() => publishedCards(content?.references), [content]);
  const products = useMemo(() => publishedCards(content?.products), [content]);
  const nav = NAV.filter((item) => item.key === "home" || pages[item.key]);
  const seo = pageSeo(content, key);
  const brand = data?.brand_name || "TAI Yazılım";

  if (slug !== "tai") return <NotFoundPage />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setSent("");
    try {
      const r = await axios.post(`${API_URL}/public/site/contact${apiQuery()}`, form);
      if (r.data?.ok) {
        setSent("Talebiniz alındı. Teşekkürler.");
        setForm({ name: "", email: "", phone: "", message: "", hp_company: "" });
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      setSent(typeof detail === "string" ? detail : "Gönderilemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900" data-testid="tai-site" data-page={key}>
      <Seo title={seo.title} description={seo.description} path={pathname || "/"} siteName={brand} image="/brand/tai/tai-icon-512.png" />
      <header className="text-white" style={{ background: NAVY }} data-testid="tai-header">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4">
            <Link to={`/${linkQuery()}`} className="flex items-center gap-2.5 min-w-0" data-testid="tai-brand">
            <img src={data?.logo || TAI_LOGO_SRC} alt={brand} className="w-9 h-9 rounded-lg bg-white/10" />
            <span className="font-bold tracking-tight truncate">{brand}</span>
          </Link>
          <nav className="flex items-center gap-4 text-xs font-semibold">
            {nav.map((item) => (
              <NavLink
                key={item.key}
                to={`${item.to}${linkQuery()}`}
                end={item.end}
                className={({ isActive }) => (isActive ? "text-white" : "text-white/75 hover:text-white")}
                data-testid={`tai-nav-${item.key}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {!data && !error ? <div className="max-w-6xl mx-auto px-5 py-16 text-sm text-slate-500">Yükleniyor…</div> : null}
      {error ? <div className="max-w-6xl mx-auto px-5 py-16 text-sm" data-testid="tai-error">{error}</div> : null}

      {data && key === "home" && pages.home ? (
        <main>
          <section className="text-white" style={{ background: NAVY }} data-testid="tai-hero">
            <div className="max-w-6xl mx-auto px-5 py-16 grid md:grid-cols-2 gap-8 items-center">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: RED }}>TAI Yazılım</div>
                <h1 className="text-4xl sm:text-5xl font-black leading-tight mt-3">{pages.home.hero_title}</h1>
                <p className="mt-4 text-sm text-white/80 whitespace-pre-line">{pages.home.hero_text}</p>
                <Link to={`/iletisim${linkQuery()}`} className="inline-block mt-6 px-5 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: RED }} data-testid="tai-hero-cta">İletişime geçin</Link>
              </div>
              {pages.home.hero_image ? <img src={pages.home.hero_image} alt="" className="rounded-2xl w-full max-h-80 object-cover bg-white/10" /> : null}
            </div>
          </section>
          {services.length ? (
            <section className="max-w-6xl mx-auto px-5 py-14" data-testid="tai-home-services">
              <h2 className="text-2xl font-black" style={{ color: NAVY }}>{pages.services?.title || "Hizmetler"}</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                {services.map((card) => <Card key={card.id} card={card} />)}
              </div>
            </section>
          ) : null}
          {products.length ? (
            <section className="bg-slate-50 border-y" data-testid="tai-products">
              <div className="max-w-6xl mx-auto px-5 py-14">
                <h2 className="text-2xl font-black" style={{ color: NAVY }}>Ürünler</h2>
                <div className="grid md:grid-cols-2 gap-4 mt-6">
                  {products.map((card) => (
                    <a key={card.id} href={card.href || "https://tamkobi.com"} className="block bg-white border rounded-2xl p-5 hover:border-[#13295B]" data-testid={`tai-product-${card.id}`}>
                      {card.image ? <img src={card.image} alt="" className="h-12 w-12 object-contain mb-3" /> : null}
                      <div className="font-bold text-lg" style={{ color: NAVY }}>{card.title}</div>
                      <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">{card.text}</p>
                    </a>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </main>
      ) : null}

      {data && key === "about" && pages.about ? <Article page={pages.about} testId="tai-about" /> : null}
      {data && key === "services" && pages.services ? (
        <section className="max-w-6xl mx-auto px-5 py-14" data-testid="tai-services">
          <h1 className="text-3xl font-black" style={{ color: NAVY }}>{pages.services.title}</h1>
          <p className="mt-3 text-sm text-slate-600 whitespace-pre-line max-w-2xl">{pages.services.text}</p>
          <div className="grid sm:grid-cols-2 gap-4 mt-8">
            {services.map((card) => <Card key={card.id} card={card} />)}
          </div>
        </section>
      ) : null}
      {data && key === "references" && pages.references ? (
        <section className="max-w-6xl mx-auto px-5 py-14" data-testid="tai-references">
          <h1 className="text-3xl font-black" style={{ color: NAVY }}>{pages.references.title}</h1>
          <p className="mt-3 text-sm text-slate-600 whitespace-pre-line max-w-2xl">{pages.references.text}</p>
          <div className="grid sm:grid-cols-3 gap-4 mt-8">
            {references.map((card) => <Card key={card.id} card={card} />)}
          </div>
        </section>
      ) : null}
      {data && key === "contact" && pages.contact ? (
        <section className="max-w-6xl mx-auto px-5 py-14 grid md:grid-cols-2 gap-10" data-testid="tai-contact">
          <div>
            <h1 className="text-3xl font-black" style={{ color: NAVY }}>{pages.contact.title}</h1>
            <p className="mt-3 text-sm text-slate-600 whitespace-pre-line">{pages.contact.text}</p>
            <ul className="mt-6 text-sm space-y-2">
              {pages.contact.email ? <li data-testid="tai-contact-email">{pages.contact.email}</li> : null}
              {pages.contact.phone ? <li data-testid="tai-contact-phone">{pages.contact.phone}</li> : null}
              {pages.contact.address ? <li data-testid="tai-contact-address" className="whitespace-pre-line">{pages.contact.address}</li> : null}
            </ul>
          </div>
          <form onSubmit={submit} className="border rounded-2xl p-5 space-y-3 relative" data-testid="tai-contact-form">
            <div className="absolute -left-[9999px] h-0 overflow-hidden" aria-hidden="true">
              <label>Şirket web sitesi
                <input tabIndex={-1} autoComplete="off" value={form.hp_company} onChange={(e) => setForm({ ...form, hp_company: e.target.value })} data-testid="contact-honeypot" />
              </label>
            </div>
            <Field label="Ad soyad" value={form.name} onChange={(v) => setForm({ ...form, name: v })} testId="contact-name" />
            <Field label="E-posta" value={form.email} onChange={(v) => setForm({ ...form, email: v })} testId="contact-email" type="email" />
            <Field label="Telefon" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} testId="contact-phone" />
            <label className="block text-xs font-semibold text-slate-700">Mesaj
              <textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[120px]" data-testid="contact-message" />
            </label>
            <button type="submit" disabled={busy} className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60" style={{ background: RED }} data-testid="contact-submit">{busy ? "Gönderiliyor…" : "Gönder"}</button>
            {sent ? <p className="text-xs text-slate-600" data-testid="contact-result">{sent}</p> : null}
          </form>
        </section>
      ) : null}

      {data && !pages[key] ? (
        <div className="max-w-6xl mx-auto px-5 py-16 text-sm text-slate-500" data-testid="tai-unpublished">Bu sayfa yayında değil.</div>
      ) : null}

      <footer className="border-t py-6 text-center text-[11px] text-slate-500">{brand}</footer>
    </div>
  );
}

function Article({ page, testId }) {
  return (
    <article className="max-w-3xl mx-auto px-5 py-14" data-testid={testId}>
      <h1 className="text-3xl font-black" style={{ color: NAVY }}>{page.title}</h1>
      {page.image ? <img src={page.image} alt="" className="mt-6 rounded-2xl w-full max-h-80 object-cover" /> : null}
      <p className="mt-4 text-sm text-slate-700 leading-relaxed whitespace-pre-line">{page.text}</p>
    </article>
  );
}

function Card({ card }) {
  return (
    <div className="border rounded-2xl p-4 bg-white" data-testid={`tai-card-${card.id}`}>
      {card.image ? <img src={card.image} alt="" className="h-16 w-full object-cover rounded-lg mb-3" /> : null}
      <div className="font-bold" style={{ color: NAVY }}>{card.title}</div>
      <p className="text-xs text-slate-600 mt-1 whitespace-pre-line">{card.text}</p>
    </div>
  );
}

function Field({ label, value, onChange, testId, type = "text" }) {
  return (
    <label className="block text-xs font-semibold text-slate-700">{label}
      <input type={type} required={type !== "text" || label.startsWith("Ad")} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" data-testid={testId} />
    </label>
  );
}
