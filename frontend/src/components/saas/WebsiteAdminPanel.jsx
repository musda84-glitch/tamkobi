
import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ExternalLink, Globe, Loader2, Save, Monitor, UserPlus, Package } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { Toggle, inputCls, PlanChip } from "./saasUi";
import { getHostKind } from "../../utils/hosts";
import {
  PREVIEW_FRAME_GRACE_MS,
  PREVIEW_FRAME_SAFETY_MS,
  VITRIN_PREVIEW_MESSAGE,
  classifyPreviewFrame,
  resolveVitrinPreviewUrl,
  vitrinChildUrl,
} from "../../utils/vitrinPreview";

const cred = { withCredentials: true };
const previewPath = "/web";

const VitrinPreviewFrame = ({ url }) => {
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
        <iframe title="TamKobi vitrin önizleme" src={url} onLoad={onLoad} className={`w-full h-[640px] bg-[#0b0f1a] border-0 ${blocked ? "hidden" : ""}`} data-testid="web-preview-frame" />
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
  const [publicPlans, setPublicPlans] = useState(null);
  const [ownPlans, setOwnPlans] = useState([]);
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
  useEffect(() => { load(); }, [load]);
  if (!settings) return <div className="text-xs text-slate-400 p-6">Yükleniyor…</div>;
  const brand = settings.brand_name || "TamKobi";
  const previewUrl = resolveVitrinPreviewUrl(settings.public_url);
  const signupUrl = vitrinChildUrl(settings.public_url, "/kayit");
  const onYnt = getHostKind() === "ynt";
  const localHref = onYnt ? previewUrl : previewPath;
  const localLabel = onYnt ? previewUrl : `${window.location.origin}${previewPath}`;
  const plans = (plansProp && plansProp.length ? plansProp : ownPlans) || [];
  const published = plans.filter((p) => p.is_public).length;
  const saveBrand = async (e) => {
    e.preventDefault();
    setBusy("save");
    try {
      const r = await axios.put(`${API_URL}/system/settings`, { brand_name: settings.brand_name, public_url: settings.public_url }, cred);
      setSettings({ ...settings, ...r.data });
      toast.success("Site ayarları kaydedildi.");
      await load();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(""); }
  };
  const publish = async (p, on) => {
    setBusy(p.id);
    try {
      await axios.put(`${API_URL}/system/plans/${p.id}`, { is_public: on }, cred);
      toast.success(on ? `${p.name} vitrine alındı.` : `${p.name} vitrinden kaldırıldı.`);
      onChanged();
      await load();
    } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); } finally { setBusy(""); }
  };
  return (
    <div className="space-y-4 text-xs" data-testid="website-admin">
      <div className="bg-slate-900 text-white rounded-2xl p-5 flex flex-wrap items-center gap-4">
        <div className="w-11 h-11 rounded-2xl bg-emerald-400 text-slate-900 flex items-center justify-center"><Globe className="w-5 h-5" /></div>
        <div className="flex-1 min-w-[220px]">
          <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">Müşteri web sitesi yayında</div>
          <div className="text-lg font-bold mt-0.5">{brand} vitrini</div>
          <p className="text-slate-300 mt-1">Giriş yapmışken ana sayfa ERP panelini açar. Vitrini buradan veya “Siteyi aç” ile görürsünüz. {published} paket yayında · {publicPlans?.trial_days || 14} gün deneme. Müşteriler sitede modülleri tek tek seçerek kendi paketini de oluşturabilir.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={previewUrl} target="_blank" rel="noreferrer" className="px-4 py-2.5 bg-emerald-400 hover:bg-emerald-300 text-slate-900 rounded-xl font-bold inline-flex items-center gap-1.5" data-testid="web-open-site"><ExternalLink className="w-4 h-4" /> Siteyi aç</a>
          <a href={signupUrl} target="_blank" rel="noreferrer" className="px-4 py-2.5 bg-white/10 hover:bg-white/15 rounded-xl font-semibold inline-flex items-center gap-1.5" data-testid="web-open-signup"><UserPlus className="w-4 h-4" /> Kayıt sayfası</a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form onSubmit={saveBrand} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="web-brand-form">
          <h3 className="font-bold text-slate-900 text-sm">Vitrin kimliği</h3>
          <div><label className="block font-semibold text-slate-700 mb-1">Marka adı</label><input value={settings.brand_name || ""} onChange={(e) => setSettings({ ...settings, brand_name: e.target.value })} className={inputCls} data-testid="web-brand-name" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Canlı adres</label><input value={settings.public_url || ""} onChange={(e) => setSettings({ ...settings, public_url: e.target.value })} placeholder="https://tamkobi.com" className={inputCls} data-testid="web-public-url" /></div>
          <p className="text-[11px] text-slate-500">{onYnt ? "Canlı vitrin" : "Yerelde vitrin"}: <a href={localHref} className="text-emerald-700 font-semibold underline" data-testid="web-local-preview">{localLabel}</a>.{onYnt ? null : <> Canlıda {previewUrl}.</>}</p>
          <div className="flex justify-end"><button type="submit" disabled={busy === "save"} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="web-brand-save">{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button></div>
        </form>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="web-plan-toggles">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-slate-900 text-sm">Vitrindeki paketler</h3>
            <Link to="/sistem/paketler" className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1" data-testid="web-go-plans"><Package className="w-3.5 h-3.5" /> Paketleri düzenle</Link>
          </div>
          <p className="text-[11px] text-slate-500">Açık olanlar web vitrininde görünür.</p>
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
      </div>

      <VitrinPreviewFrame url={previewUrl} />
    </div>
  );
};
