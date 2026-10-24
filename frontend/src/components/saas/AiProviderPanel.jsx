import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, Loader2, Sparkles, PlugZap, KeyRound, Pencil, X } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { Toggle, inputCls } from "./saasUi";

const errText = (e, fallback) => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string" && d.trim()) return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || x?.detail || JSON.stringify(x)).filter(Boolean).join(" · ") || fallback;
  if (d && typeof d === "object") return d.msg || d.message || fallback;
  return fallback;
};

const maskedKeyLabel = (d) => {
  if (d?.key_hint) return `••••••••${d.key_hint}`;
  if (d?.has_key) return "••••••••••••";
  if (d?.has_env_key) return "ortam değişkeni";
  return "";
};

export const AiProviderPanel = () => {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ api_key: "" });
  const [editKey, setEditKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => axios.get(`${API_URL}/system/ai`).then((r) => {
    setD(r.data);
    setF({ api_key: "" });
    setEditKey(false);
  }).catch(() => toast.error("AI ayarları alınamadı."));
  useEffect(() => { load(); }, []);
  const catalog = d?.catalog || [];
  const current = useMemo(() => catalog.find((c) => c.id === d?.provider) || null, [catalog, d]);
  const custom = !!current?.custom;
  const pendingKey = (f.api_key || "").trim();
  const showKeyInput = editKey || !(d?.has_key || d?.has_env_key);
  const canTest = !!(d?.has_key || d?.has_env_key || pendingKey || (custom && (d?.base_url || "").trim()));
  if (!d) return <div className="text-xs text-slate-400">Yükleniyor…</div>;

  const save = async () => {
    if (!pendingKey && !d.has_key && !d.has_env_key && !(custom && (d.base_url || "").trim())) {
      toast.error("API anahtarını girin, sonra Kaydet'e basın. (veya sunucuda ortam değişkeni tanımlayın)");
      return;
    }
    setBusy(true);
    try {
      // Sağlayıcı ve model kayıtlı kalsın; form bu alanları değiştirmez.
      const payload = {
        enabled: d.enabled,
        api_key: pendingKey || undefined,
      };
      if (custom) payload.base_url = d.base_url || "";
      const r = await axios.put(`${API_URL}/system/ai`, payload);
      setD(r.data);
      setF({ api_key: "" });
      setEditKey(false);
      toast.success(r.data.has_key
        ? `AI ayarları kaydedildi. Anahtar saklandı (${maskedKeyLabel(r.data)}).`
        : "AI entegrasyonu kaydedildi.");
      try {
        const t = await axios.post(`${API_URL}/system/ai/test`, {
          provider: r.data.provider,
          advisor_model: r.data.advisor_model,
          extract_model: r.data.extract_model,
          base_url: r.data.base_url || "",
        });
        setD((prev) => ({
          ...prev,
          last_test: { ok: t.data.ok, reason: t.data.reason },
          ready: t.data.ok,
        }));
        (t.data.ok ? toast.success : toast.error)(t.data.message);
      } catch (te) {
        toast.error(errText(te, "Bağlantı testi yapılamadı."));
      }
    } catch (e) {
      toast.error(errText(e, "Kaydedilemedi."));
    } finally { setBusy(false); }
  };

  const test = async () => {
    if (!canTest) {
      toast.error("Test için API anahtarı girin veya önce kaydedin.");
      return;
    }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/system/ai/test`, {
        api_key: pendingKey || undefined,
        provider: d.provider,
        advisor_model: d.advisor_model,
        extract_model: d.extract_model,
        base_url: d.base_url || "",
      });
      setD((prev) => ({ ...prev, last_test: { ok: r.data.ok, reason: r.data.reason } }));
      (r.data.ok ? toast.success : toast.error)(r.data.message);
    } catch (e) {
      toast.error(errText(e, "Test yapılamadı."));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 text-xs max-w-3xl" data-testid="saas-ai-settings">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-500" /> Yapay zekâ</h3>
            <p className="text-[11px] text-slate-500 mt-1">Faturalar, stok aktarımı, sipariş ayrıştırma, kredi ekstresi, B2B sepet ve finansal danışman aynı entegrasyonu kullanır. Şirket bazında ayrı anahtar yoktur.</p>
          </div>
          <label className="flex items-center gap-2"><Toggle on={!!d.enabled} onChange={(v) => setD({ ...d, enabled: v })} testId="ai-enabled" /> <span>Aktif</span></label>
        </div>
        {d.last_test && <div className={`text-[10px] rounded-lg px-3 py-2 ${d.last_test.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`} data-testid="ai-last-test">Son test: {d.last_test.ok ? "başarılı" : `başarısız – ${d.last_test.reason || ""}`}</div>}
        <div className="grid grid-cols-1 gap-3">
          {custom && (
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Uç nokta adresi</label>
              <input value={d.base_url || ""} onChange={(e) => setD({ ...d, base_url: e.target.value, last_test: null })} placeholder="https://ornek.example/v1" className={inputCls} data-testid="ai-base-url" autoComplete="off" />
              <p className="text-[10px] text-slate-500 mt-1">Sohbet uç noktası. Sonuna <b>/chat/completions</b> otomatik eklenir.</p>
            </div>
          )}
          <div className="space-y-2">
            <label className="block font-semibold text-slate-700 mb-1">API anahtarı</label>
            {!showKeyInput ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5" data-testid="ai-key-saved">
                <KeyRound className="w-4 h-4 text-emerald-700" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-emerald-900">Kayıtlı anahtar korunuyor</div>
                  <div className="font-mono text-[11px] text-emerald-800" data-testid="ai-key-hint">{maskedKeyLabel(d)}</div>
                  <div className="text-[10px] text-emerald-700/80 mt-0.5">Sayfa yenilense de silinmez. Değiştirmek için yeni anahtar girin.</div>
                </div>
                <button type="button" onClick={() => { setEditKey(true); setF({ api_key: "" }); }} className="px-3 py-1.5 border border-emerald-300 bg-white text-emerald-800 rounded-lg font-semibold inline-flex items-center gap-1" data-testid="ai-key-change">
                  <Pencil className="w-3.5 h-3.5" /> Değiştir
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={f.api_key}
                    onChange={(e) => {
                      setF({ api_key: e.target.value });
                      if (d.last_test) setD({ ...d, last_test: null });
                    }}
                    placeholder="API anahtarı"
                    className={inputCls}
                    data-testid="ai-api-key"
                    autoComplete="new-password"
                  />
                  {(d.has_key || d.has_env_key) && (
                    <button type="button" onClick={() => { setEditKey(false); setF({ api_key: "" }); }} className="p-2 text-slate-400 hover:text-slate-700" title="Vazgeç" data-testid="ai-key-cancel">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">Yeni anahtarı yazıp <b>Kaydet</b> deyin. Boş kaydetmek mevcut kayıtlı anahtarı silmez.</p>
              </div>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-amber-50 text-amber-900 px-3 py-2 text-[11px]" data-testid="ai-active-badge">
          Yapay zekâ {d.enabled === false ? "kapalı" : "etkin"}
          {d.has_key ? <> · anahtar <b data-testid="ai-badge-key">{maskedKeyLabel(d)}</b></> : null}
        </div>
        {d.last_test && d.last_test.ok === false && (
          <div className="rounded-xl bg-rose-50 text-rose-800 border border-rose-200 px-3 py-2 text-[11px]" data-testid="ai-last-test-fail">
            Son bağlantı testi başarısız: <b>{d.last_test.reason || "bilinmeyen hata"}</b>
            <span className="block mt-0.5 text-rose-700">Geçerli API anahtarını yazıp Kaydet → Bağlantıyı Test Et ile doğrulayın. Kayıtlı anahtar tek başına çalıştığı anlamına gelmez.</span>
          </div>
        )}
        {d.last_test && d.last_test.ok === true && (
          <div className="rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-2 text-[11px]" data-testid="ai-last-test-ok">
            Son bağlantı testi başarılı.
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={test} disabled={busy || !canTest} className="px-4 py-2 border border-amber-300 text-amber-800 rounded-xl font-bold disabled:opacity-50 flex items-center gap-1.5" data-testid="ai-test"><PlugZap className="w-4 h-4" /> Bağlantıyı Test Et</button>
          <button type="button" onClick={save} disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="ai-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button>
        </div>
      </div>
    </div>
  );
};
