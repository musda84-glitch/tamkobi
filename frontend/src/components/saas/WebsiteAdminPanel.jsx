import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ExternalLink, Globe, Loader2, Save, Monitor, UserPlus, Package, ArrowUp, ArrowDown, Plus, ImagePlus } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { Toggle, inputCls, PlanChip } from "./saasUi";
import { getHostKind } from "../../utils/hosts";
import { showsPackageVitrin } from "../../utils/marketingSite";
import {
  PREVIEW_FRAME_GRACE_MS,
  PREVIEW_FRAME_SAFETY_MS,
  VITRIN_PREVIEW_MESSAGE,
  classifyPreviewFrame,
  resolveVitrinPreviewUrl,
  vitrinChildUrl,
} from "../../utils/vitrinPreview";

const cred = { withCredentials: true };
const TAI_PREVIEW_FALLBACK = "https://taiyazilim.com";

const EMPTY_CONTENT = {
  pages: {
    home: { seo_title: "", seo_description: "", hero_title: "", hero_text: "", hero_image: "", published: true },
    about: { seo_title: "", seo_description: "", title: "", text: "", image: "", published: true },
    services: { seo_title: "", seo_description: "", title: "", text: "", image: "", published: true },
    references: { seo_title: "", seo_description: "", title: "", text: "", image: "", published: true },
    contact: { seo_title: "", seo_description: "", title: "", text: "", email: "", phone: "", address: "", published: true },
  },
  services: [],
  references: [],
  products: [],
};

function newCard(prefix, extra) {
  const id = `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
  return { id, title: "", text: "", image: "", sort: 0, published: true, ...extra };
}

async function uploadImage(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await axios.post(`${API_URL}/files/upload?entity=site_media`, fd, cred);
  return r.data?.url || "";
}

const VitrinPreviewFrame = ({ url, title }) => {
  const [blocked, setBlocked] = useState(false);
  const readyRef = useRef(false);
  const timersRef = useRef([]);

  useEffect(() => {
    readyRef.current = false;
    setBlocked(false);
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      origin = "";
    }
    const later = (fn, ms) => {
      const id = window.setTimeout(fn, ms);
      timersRef.current.push(id);
    };
    const markBlocked = () => {
      if (!readyRef.current) setBlocked(true);
    };
    const onMessage = (ev) => {
      if (!origin || ev.origin !== origin) return;
      if (!ev.data || ev.data.type !== VITRIN_PREVIEW_MESSAGE) return;
      readyRef.current = true;
      setBlocked(false);
    };
    window.addEventListener("message", onMessage);
    later(markBlocked, PREVIEW_FRAME_SAFETY_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, [url]);

  const onLoad = (ev) => {
    if (classifyPreviewFrame(ev.currentTarget) === "readable") {
      readyRef.current = true;
      setBlocked(false);
      return;
    }
    const id = window.setTimeout(() => {
      if (!readyRef.current) setBlocked(true);
    }, PREVIEW_FRAME_GRACE_MS);
    timersRef.current.push(id);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="web-preview">
      <div className="px-4 py-2.5 border-b bg-slate-50 flex items-center justify-between">
        <span className="font-bold text-slate-900 inline-flex items-center gap-1.5"><Monitor className="w-4 h-4 text-slate-400" /> Canlı önizleme</span>
        <a href={url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1" data-testid="web-preview-fullscreen">Tam ekran <ExternalLink className="w-3.5 h-3.5" /></a>
      </div>
      <div className="bg-[#0b0f1a]">
        <iframe title={title} src={url} onLoad={onLoad} className={`w-full h-[640px] bg-[#0b0f1a] border-0 ${blocked ? "hidden" : ""}`} data-testid="web-preview-frame" />
        {blocked && (
          <div className="h-[640px] flex flex-col items-center justify-center gap-3 px-6 text-center" data-testid="web-preview-blocked">
            <p className="text-sm font-semibold text-white">Önizleme gösterilemiyor, Siteyi aç</p>
            <a href={url} target="_blank" rel="noreferrer" className="px-4 py-2.5 bg-emerald-400 hover:bg-emerald-300 text-slate-900 rounded-xl font-bold inline-flex items-center gap-1.5" data-testid="web-preview-blocked-open"><ExternalLink className="w-4 h-4" /> Siteyi aç</a>
          </div>
        )}
      </div>
    </div>
  );
};

export const WebsiteAdminPanel = ({ plans: plansProp, onChanged }) => {
  const [settings, setSettings] = useState(null);
  const [sites, setSites] = useState([]);
  const [slug, setSlug] = useState("tamkobi");
  const [publicPlans, setPublicPlans] = useState(null);
  const [ownPlans, setOwnPlans] = useState([]);
  const [content, setContent] = useState(null);
  const [inquiries, setInquiries] = useState([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await axios.get(`${API_URL}/system/settings`, cred);
      setSettings(s.data);
    } catch {
      setSettings({ brand_name: "TamKobi", public_url: "" });
      toast.error("Site ayarları alınamadı.");
    }
    try {
      const list = await axios.get(`${API_URL}/system/sites`, cred);
      setSites(Array.isArray(list.data) ? list.data : []);
    } catch {
      setSites([]);
    }
    try {
      const p = await axios.get(`${API_URL}/public/plans`);
      setPublicPlans(p.data);
    } catch {
      setPublicPlans({ plans: [], trial_days: 14 });
    }
    try {
      const all = await axios.get(`${API_URL}/system/plans`, cred);
      setOwnPlans(Array.isArray(all.data) ? all.data : []);
    } catch {
      setOwnPlans([]);
    }
  }, []);

  const loadSiteDetail = useCallback(async (next) => {
    if (!next || next === "tamkobi") {
      setContent(null);
      setInquiries([]);
      return;
    }
    try {
      const r = await axios.get(`${API_URL}/system/sites/${next}`, cred);
      setContent(r.data?.content || EMPTY_CONTENT);
    } catch {
      setContent(EMPTY_CONTENT);
    }
    try {
      const r = await axios.get(`${API_URL}/system/sites/${next}/inquiries`, cred);
      setInquiries(Array.isArray(r.data) ? r.data : []);
    } catch {
      setInquiries([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSiteDetail(slug); }, [slug, loadSiteDetail]);

  if (!settings) return <div className="text-xs text-slate-400 p-6">Yükleniyor…</div>;

  const selected = sites.find((s) => s.slug === slug) || (slug === "tamkobi" ? {
    slug: "tamkobi",
    brand_name: settings.brand_name || "TamKobi",
    public_url: settings.public_url || "",
    theme: "vitrin",
    active: true,
  } : {
    slug,
    brand_name: slug === "tai" ? "TAI Yazılım" : "",
    public_url: "",
    theme: "corporate",
    active: true,
  });
  const brand = selected?.brand_name || settings.brand_name || "TamKobi";
  const previewFallback = slug === "tai" ? TAI_PREVIEW_FALLBACK : undefined;
  const previewUrl = resolveVitrinPreviewUrl(selected?.public_url, undefined, previewFallback);
  const signupUrl = vitrinChildUrl(selected?.public_url, "/kayit", undefined, previewFallback);
  const onYnt = getHostKind() === "ynt";
  const plans = (plansProp && plansProp.length ? plansProp : ownPlans) || [];
  const published = plans.filter((p) => p.is_public).length;
  const packages = showsPackageVitrin(slug);
  const switchers = sites.length ? sites : [
    { slug: "tamkobi", brand_name: "TamKobi" },
    { slug: "tai", brand_name: "TAI Yazılım" },
  ];

  const saveBrand = async (e) => {
    e.preventDefault();
    setBusy("save");
    try {
      const body = {
        brand_name: selected?.brand_name || "",
        public_url: selected?.public_url || "",
        active: selected?.active !== false,
      };
      const r = await axios.put(`${API_URL}/system/sites/${slug}`, body, cred);
      setSites((prev) => prev.map((s) => (s.slug === slug ? { ...s, ...r.data } : s)));
      if (slug === "tamkobi") setSettings({ ...settings, brand_name: r.data.brand_name, public_url: r.data.public_url });
      toast.success("Site ayarları kaydedildi.");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally { setBusy(""); }
  };

  const publish = async (p, on) => {
    setBusy(p.id);
    try {
      await axios.put(`${API_URL}/system/plans/${p.id}`, { is_public: on }, cred);
      toast.success(on ? `${p.name} vitrine alındı.` : `${p.name} vitrinden kaldırıldı.`);
      onChanged?.();
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Güncellenemedi.");
    } finally { setBusy(""); }
  };

  const saveContent = async () => {
    setBusy("content");
    try {
      const r = await axios.put(`${API_URL}/system/sites/${slug}/content`, content, cred);
      setContent(r.data);
      toast.success("İçerik kaydedildi. Site yeniden derlenmeden güncellenir.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "İçerik kaydedilemedi.");
    } finally { setBusy(""); }
  };

  const patchSite = (partial) => {
    setSites((prev) => {
      if (!prev.some((s) => s.slug === slug)) return [...prev, { slug, ...selected, ...partial }];
      return prev.map((s) => (s.slug === slug ? { ...s, ...partial } : s));
    });
  };

  return (
    <div className="space-y-4 text-xs" data-testid="website-admin">
      <div className="flex flex-wrap gap-2" data-testid="site-switch" role="tablist" aria-label="Site seçici">
        {switchers.map((s) => {
          const label = s.slug === "tai" ? "TAI Yazılım" : "TamKobi";
          const on = slug === s.slug;
          return (
            <button
              key={s.slug}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setSlug(s.slug)}
              className={`px-4 py-2 rounded-xl font-bold ${on ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700"}`}
              data-testid={`site-switch-${s.slug}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="bg-slate-900 text-white rounded-2xl p-5 flex flex-wrap items-center gap-4">
        <div className="w-11 h-11 rounded-2xl bg-emerald-400 text-slate-900 flex items-center justify-center"><Globe className="w-5 h-5" /></div>
        <div className="flex-1 min-w-[220px]">
          <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">{selected?.active === false ? "Site gizli" : "Müşteri web sitesi yayında"}</div>
          <div className="text-lg font-bold mt-0.5">{brand} {packages ? "vitrini" : "sitesi"}</div>
          <p className="text-slate-300 mt-1">
            {packages
              ? `Giriş yapmışken ana sayfa ERP panelini açar. Vitrini buradan veya “Siteyi aç” ile görürsünüz. ${published} paket yayında · ${publicPlans?.trial_days || 14} gün deneme. Müşteriler sitede modülleri tek tek seçerek kendi paketini de oluşturabilir.`
              : "Kurumsal sayfalar, hizmet kartları ve iletişim bilgileri seçili siteye yazılır. Kayıt, siteyi yeniden derlemeden yayına girer."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={previewUrl} target="_blank" rel="noreferrer" className="px-4 py-2.5 bg-emerald-400 hover:bg-emerald-300 text-slate-900 rounded-xl font-bold inline-flex items-center gap-1.5" data-testid="web-open-site"><ExternalLink className="w-4 h-4" /> Siteyi aç</a>
          {packages ? <a href={signupUrl} target="_blank" rel="noreferrer" className="px-4 py-2.5 bg-white/10 hover:bg-white/15 rounded-xl font-semibold inline-flex items-center gap-1.5" data-testid="web-open-signup"><UserPlus className="w-4 h-4" /> Kayıt sayfası</a> : null}
        </div>
      </div>

      <div className={`grid grid-cols-1 ${packages ? "lg:grid-cols-2" : ""} gap-4`}>
        <form onSubmit={saveBrand} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="web-brand-form">
          <h3 className="font-bold text-slate-900 text-sm">Vitrin kimliği</h3>
          <div><label className="block font-semibold text-slate-700 mb-1">Marka adı</label><input value={selected?.brand_name || ""} onChange={(e) => patchSite({ brand_name: e.target.value })} className={inputCls} data-testid="web-brand-name" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Canlı adres</label><input value={selected?.public_url || ""} onChange={(e) => patchSite({ public_url: e.target.value })} placeholder={slug === "tai" ? TAI_PREVIEW_FALLBACK : "https://tamkobi.com"} className={inputCls} data-testid="web-public-url" /></div>
          {packages ? null : (
            <label className="flex items-center gap-2 font-semibold text-slate-700">
              <Toggle on={selected?.active !== false} onChange={(v) => patchSite({ active: v })} testId="web-site-active" />
              <span>{selected?.active === false ? "Gizli" : "Aktif"}</span>
            </label>
          )}
          <p className="text-[11px] text-slate-500">{onYnt ? "Canlı vitrin" : "Yerelde vitrin"}: <a href={previewUrl} className="text-emerald-700 font-semibold underline" data-testid="web-local-preview">{previewUrl}</a>.{onYnt ? null : <> Canlıda {previewUrl}.</>}</p>
          <div className="flex justify-end"><button type="submit" disabled={busy === "save"} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="web-brand-save">{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button></div>
        </form>

        {packages ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="web-plan-toggles">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-slate-900 text-sm">Vitrindeki paketler</h3>
              <Link to="/sistem/paketler" className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1" data-testid="web-go-plans"><Package className="w-3.5 h-3.5" /> Paketleri düzenle</Link>
            </div>
            <p className="text-[11px] text-slate-500">Açık olanlar web vitrininde görünür. Paket vitrini yalnız tamkobi.com içindir.</p>
            <ul className="divide-y">{(plans || []).map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-2" data-testid={`web-plan-${p.id}`}>
                <div className="min-w-0"><PlanChip name={p.name} color={p.color} /><div className="text-[10px] text-slate-400 mt-0.5 truncate">{p.price_monthly} ₺/ay · {p.modules?.length || 0} modül</div></div>
                <label className={`flex items-center gap-2 font-semibold ${p.is_public ? "text-emerald-700" : "text-slate-500"}`}>
                  <Toggle on={!!p.is_public} disabled={busy === p.id} onChange={(v) => publish(p, v)} testId={`web-publish-${p.id}`} />
                  <span>{p.is_public ? "Yayında" : "Gizli"}</span>
                </label>
              </li>
            ))}</ul>
          </div>
        ) : null}
      </div>

      {!packages && content ? (
        <TaiContentEditor content={content} setContent={setContent} busy={busy === "content"} onSave={saveContent} />
      ) : null}

      {!packages ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-4" data-testid="site-inquiries">
          <h3 className="font-bold text-slate-900 text-sm">Gelen talepler</h3>
          <p className="text-[11px] text-slate-500 mt-1">İletişim formundan gelen mesajlar. E-posta, purpose “general” platform posta kutusundan gider.</p>
          {inquiries.length === 0 ? <p className="text-slate-400 mt-3">Henüz talep yok.</p> : (
            <ul className="divide-y mt-2">
              {inquiries.map((row) => (
                <li key={row.id} className="py-3" data-testid={`inquiry-${row.id}`}>
                  <div className="flex flex-wrap justify-between gap-2 font-semibold text-slate-800">
                    <span>{row.name} · {row.email}</span>
                    <span className="text-[10px] text-slate-400">{row.mail_status === "sent" ? "E-posta gönderildi" : row.mail_status === "failed" ? "E-posta iletilemedi" : "Kutu yok"}</span>
                  </div>
                  {row.phone ? <div className="text-[11px] text-slate-500">{row.phone}</div> : null}
                  <p className="text-slate-600 mt-1 whitespace-pre-line">{row.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <VitrinPreviewFrame url={previewUrl} title={`${brand} önizleme`} />
    </div>
  );
};

function TaiContentEditor({ content, setContent, busy, onSave }) {
  const setPage = (key, partial) => {
    setContent({ ...content, pages: { ...content.pages, [key]: { ...content.pages[key], ...partial } } });
  };
  const setList = (key, rows) => setContent({ ...content, [key]: rows.map((row, i) => ({ ...row, sort: i })) });
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4" data-testid="tai-content-editor">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900 text-sm">İçerik</h3>
        <button type="button" onClick={onSave} disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="tai-content-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button>
      </div>
      <PageFields title="Ana sayfa" page={content.pages.home} hero onChange={(p) => setPage("home", p)} testId="tai-page-home" />
      <PageFields title="Hakkımızda" page={content.pages.about} image onChange={(p) => setPage("about", p)} testId="tai-page-about" />
      <PageFields title="Hizmetler girişi" page={content.pages.services} onChange={(p) => setPage("services", p)} testId="tai-page-services" />
      <CardList title="Hizmet kartları" rows={content.services || []} onChange={(rows) => setList("services", rows)} prefix="svc" testId="tai-services" />
      <PageFields title="Referanslar girişi" page={content.pages.references} onChange={(p) => setPage("references", p)} testId="tai-page-references" />
      <CardList title="Referans kartları" rows={content.references || []} onChange={(rows) => setList("references", rows)} prefix="ref" testId="tai-references" />
      <CardList title="Ürünler" rows={content.products || []} onChange={(rows) => setList("products", rows)} prefix="prd" withHref testId="tai-products" />
      <PageFields title="İletişim" page={content.pages.contact} contact onChange={(p) => setPage("contact", p)} testId="tai-page-contact" />
    </div>
  );
}

function PageFields({ title, page, onChange, hero, image, contact, testId }) {
  if (!page) return null;
  return (
    <fieldset className="border border-slate-100 rounded-xl p-3 space-y-2" data-testid={testId}>
      <legend className="px-1 font-bold text-slate-800">{title}</legend>
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="block font-semibold text-slate-600">SEO başlık<input value={page.seo_title || ""} onChange={(e) => onChange({ seo_title: e.target.value })} className={inputCls} /></label>
        <label className="block font-semibold text-slate-600">SEO açıklama<input value={page.seo_description || ""} onChange={(e) => onChange({ seo_description: e.target.value })} className={inputCls} /></label>
      </div>
      {hero ? (
        <>
          <label className="block font-semibold text-slate-600">Hero başlık<input value={page.hero_title || ""} onChange={(e) => onChange({ hero_title: e.target.value })} className={inputCls} data-testid="tai-hero-title" /></label>
          <label className="block font-semibold text-slate-600">Hero metin<textarea value={page.hero_text || ""} onChange={(e) => onChange({ hero_text: e.target.value })} className={`${inputCls} min-h-[72px]`} /></label>
          <ImageField value={page.hero_image} onChange={(url) => onChange({ hero_image: url })} />
        </>
      ) : (
        <>
          <label className="block font-semibold text-slate-600">Başlık<input value={page.title || ""} onChange={(e) => onChange({ title: e.target.value })} className={inputCls} /></label>
          <label className="block font-semibold text-slate-600">Metin<textarea value={page.text || ""} onChange={(e) => onChange({ text: e.target.value })} className={`${inputCls} min-h-[72px]`} /></label>
          {image ? <ImageField value={page.image} onChange={(url) => onChange({ image: url })} /> : null}
        </>
      )}
      {contact ? (
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="block font-semibold text-slate-600">E-posta<input value={page.email || ""} onChange={(e) => onChange({ email: e.target.value })} className={inputCls} data-testid="tai-contact-email" /></label>
          <label className="block font-semibold text-slate-600">Telefon<input value={page.phone || ""} onChange={(e) => onChange({ phone: e.target.value })} className={inputCls} /></label>
          <label className="block font-semibold text-slate-600">Adres<input value={page.address || ""} onChange={(e) => onChange({ address: e.target.value })} className={inputCls} /></label>
        </div>
      ) : null}
      <label className="flex items-center gap-2 font-semibold text-slate-700">
        <Toggle on={page.published !== false} onChange={(v) => onChange({ published: v })} />
        <span>{page.published === false ? "Gizli" : "Yayında"}</span>
      </label>
    </fieldset>
  );
}

function CardList({ title, rows, onChange, prefix, withHref, testId }) {
  const move = (index, dir) => {
    const next = rows.slice();
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    const [row] = next.splice(index, 1);
    next.splice(j, 0, row);
    onChange(next);
  };
  const patch = (index, partial) => onChange(rows.map((row, i) => (i === index ? { ...row, ...partial } : row)));
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-slate-800">{title}</h4>
        <button type="button" className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1" onClick={() => onChange([...rows, newCard(prefix, withHref ? { href: "" } : {})])} data-testid={`${testId}-add`}><Plus className="w-3.5 h-3.5" /> Ekle</button>
      </div>
      {(rows || []).map((row, index) => (
        <div key={row.id || index} className="border border-slate-100 rounded-xl p-3 space-y-2" data-testid={`${testId}-row-${row.id}`}>
          <div className="flex flex-wrap gap-2">
            <input value={row.title || ""} onChange={(e) => patch(index, { title: e.target.value })} placeholder="Başlık" className={`${inputCls} flex-1`} />
            <button type="button" className="px-2 border rounded-lg" onClick={() => move(index, -1)} aria-label="Yukarı"><ArrowUp className="w-3.5 h-3.5" /></button>
            <button type="button" className="px-2 border rounded-lg" onClick={() => move(index, 1)} aria-label="Aşağı"><ArrowDown className="w-3.5 h-3.5" /></button>
          </div>
          <textarea value={row.text || ""} onChange={(e) => patch(index, { text: e.target.value })} placeholder="Metin" className={`${inputCls} min-h-[56px]`} />
          {withHref ? <input value={row.href || ""} onChange={(e) => patch(index, { href: e.target.value })} placeholder="https://tamkobi.com" className={inputCls} /> : null}
          <ImageField value={row.image} onChange={(url) => patch(index, { image: url })} />
          <label className="flex items-center gap-2 font-semibold text-slate-700">
            <Toggle on={row.published !== false} onChange={(v) => patch(index, { published: v })} />
            <span>{row.published === false ? "Gizli" : "Yayında"}</span>
          </label>
        </div>
      ))}
    </div>
  );
}

function ImageField({ value, onChange }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value ? <img src={value} alt="" className="h-10 w-10 object-cover rounded-lg border" /> : null}
      <label className="inline-flex items-center gap-1 px-2 py-1 border rounded-lg font-semibold text-slate-600 cursor-pointer">
        <ImagePlus className="w-3.5 h-3.5" /> {busy ? "Yükleniyor…" : "Görsel yükle"}
        <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const url = await uploadImage(file);
            if (url) onChange(url);
          } catch (err) {
            toast.error(err.response?.data?.detail || "Görsel yüklenemedi.");
          } finally { setBusy(false); }
        }} />
      </label>
      {value ? <button type="button" className="text-[11px] text-slate-400" onClick={() => onChange("")}>Kaldır</button> : null}
    </div>
  );
}
