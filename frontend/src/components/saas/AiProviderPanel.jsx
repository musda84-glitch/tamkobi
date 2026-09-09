
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, Loader2, Sparkles, PlugZap } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { Toggle, inputCls } from "./saasUi";

export const AiProviderPanel = () => {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ api_key: "" });
  const [busy, setBusy] = useState(false);
  const load = () => axios.get(`${API_URL}/system/ai`).then((r) => setD(r.data)).catch(() => toast.error("AI ayarları alınamadı."));
  useEffect(() => { load(); }, []);
  const catalog = d?.catalog || [];
  const current = useMemo(() => catalog.find((c) => c.id === d?.provider) || catalog[0], [catalog, d]);
  const models = current?.models || [];
  if (!d) return <div className="text-xs text-slate-400">Yükleniyor…</div>;

  const save = async () => {
    setBusy(true);
    try {
      const r = await axios.put(`${API_URL}/system/ai`, {
        enabled: d.enabled,
        provider: d.provider,
        advisor_model: d.advisor_model,
        extract_model: d.extract_model,
        api_key: f.api_key || undefined,
      });
      setD(r.data);
      setF({ api_key: "" });
      toast.success("AI entegrasyonu kaydedildi. Tüm şirketler bu sağlayıcıyı kullanır.");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Kaydedilemedi.");
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/system/ai/test`, {});
      setD((prev) => ({ ...prev, last_test: { ok: r.data.ok, reason: r.data.reason } }));
      (r.data.ok ? toast.success : toast.error)(r.data.message);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Test yapılamadı.");
    } finally { setBusy(false); }
  };

  const pickProvider = (id) => {
    const meta = catalog.find((c) => c.id === id);
    const ids = (meta?.models || []).map((m) => m.id);
    setD({
      ...d,
      provider: id,
      advisor_model: ids.includes(d.advisor_model) ? d.advisor_model : (ids[0] || d.advisor_model),
      extract_model: ids.includes(d.extract_model) ? d.extract_model : (ids[Math.min(1, ids.length - 1)] || ids[0] || d.extract_model),
    });
  };

  return (
    <div className="space-y-4 text-xs max-w-3xl" data-testid="saas-ai-settings">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-500" /> Sistem AI sağlayıcısı</h3>
            <p className="text-[11px] text-slate-500 mt-1">Faturalar, stok aktarımı, sipariş ayrıştırma, kredi ekstresi, B2B AI sepet ve finansal danışman aynı entegrasyonu kullanır. Şirket bazında ayrı anahtar yoktur.</p>
          </div>
          <label className="flex items-center gap-2"><Toggle on={!!d.enabled} onChange={(v) => setD({ ...d, enabled: v })} testId="ai-enabled" /> <span>Aktif</span></label>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="ai-provider-picks">
          {catalog.map((p) => (
            <button key={p.id} type="button" onClick={() => pickProvider(p.id)} className={`px-3 py-2 rounded-xl border font-bold ${d.provider === p.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:border-slate-400"}`} data-testid={`ai-provider-${p.id}`}>{p.label}</button>
          ))}
        </div>
        {current?.hint && <p className="text-[11px] text-slate-500 bg-slate-50 rounded-xl px-3 py-2">{current.hint}</p>}
        {d.last_test && <div className={`text-[10px] rounded-lg px-3 py-2 ${d.last_test.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`} data-testid="ai-last-test">Son test: {d.last_test.ok ? "başarılı" : `başarısız – ${d.last_test.reason || ""}`}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Danışman modeli</label>
            <select value={d.advisor_model} onChange={(e) => setD({ ...d, advisor_model: e.target.value })} className={inputCls} data-testid="ai-advisor-model">
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Belge / ayrıştırma modeli</label>
            <select value={d.extract_model} onChange={(e) => setD({ ...d, extract_model: e.target.value })} className={inputCls} data-testid="ai-extract-model">
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">API anahtarı {(d.has_key || d.has_env_key) && <span className="text-emerald-600">{d.has_key ? "(kayıtlı)" : "(ortam değişkeni)"}</span>}</label>
            <input type="password" value={f.api_key} onChange={(e) => setF({ api_key: e.target.value })} placeholder={d.has_key ? "••••••••" : d.has_env_key ? "Boş bırakırsanız EMERGENT_LLM_KEY kullanılır" : "sk-… veya Emergent anahtarı"} className={inputCls} data-testid="ai-api-key" autoComplete="off" />
          </div>
        </div>
        <div className="rounded-xl bg-amber-50 text-amber-900 px-3 py-2 text-[11px]" data-testid="ai-active-badge">
          Aktif: <b>{current?.label || d.provider_label}</b> · danışman <b>{models.find((m) => m.id === d.advisor_model)?.label || d.advisor_label}</b> · ayrıştırma <b>{models.find((m) => m.id === d.extract_model)?.label || d.extract_label}</b>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={test} disabled={busy || !(d.has_key || d.has_env_key)} className="px-4 py-2 border border-amber-300 text-amber-800 rounded-xl font-bold disabled:opacity-50 flex items-center gap-1.5" data-testid="ai-test"><PlugZap className="w-4 h-4" /> Bağlantıyı Test Et</button>
          <button type="button" onClick={save} disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="ai-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button>
        </div>
      </div>
    </div>
  );
};
