import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Bot, Loader2, Sparkles, Send, ChevronDown, ChevronUp } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { showProductionAiAdvisor } from "../utils/selfPersonnelNav";

const QUICK = [
  "Güncel üretim ve reçete durumunu yönetici için özetle.",
  "Darboğaz ve eksik hammadde risklerini önceliklendir.",
  "Atölye iş emirlerinde geciken / duraklayan adımları yorumla.",
];

/**
 * Şirket bazlı ai.production eklentisi açıkken Üretim & Atölye’de yönetici AI yorumu.
 */
export function ProductionAiAdvisor({ companyId, compact = false }) {
  const { addonOn, feature, user } = useAuth();
  const [open, setOpen] = useState(!compact);
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState("");
  const [metrics, setMetrics] = useState(null);
  const [q, setQ] = useState("");

  if (!showProductionAiAdvisor(user) || !addonOn("ai.production") || !feature("production_ai")) return null;

  const run = async (message) => {
    const text = (message || q || "").trim();
    setBusy(true);
    try {
      let res;
      if (!text || text === QUICK[0]) {
        res = await axios.get(`${API_URL}/ai/production-summary`, { params: { company_id: companyId }, timeout: 120000 });
      } else {
        res = await axios.post(`${API_URL}/ai/production-advisor`, { company_id: companyId, message: text }, { timeout: 120000 });
      }
      setAdvice(res.data?.advice || "");
      setMetrics(res.data?.metrics || null);
      setOpen(true);
      if (message) setQ("");
    } catch (e) {
      const d = e.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "AI üretim analizi alınamadı.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white ${compact ? "p-3" : "p-4"} space-y-2`} data-testid="production-ai-advisor">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
            <Bot className="w-4 h-4 text-emerald-700" /> AI Üretim & Reçete
            <span className="text-[9px] font-semibold uppercase tracking-wide text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">yönetici</span>
          </div>
          {!compact && <p className="text-[11px] text-slate-500 mt-0.5">Emirler, reçeteler ve atölye işlerini analiz eder; aksiyon önerir. Sistem → Araçlar / şirket lisansından açılır-kapanır.</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={() => run(QUICK[0])} disabled={busy} className="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 disabled:opacity-50" data-testid="production-ai-analyze">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Analiz et
          </button>
          <button type="button" onClick={() => setOpen((v) => !v)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg" data-testid="production-ai-toggle" aria-label="panel">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {open && (
        <>
          {metrics && (
            <div className="flex flex-wrap gap-2 text-[10px]" data-testid="production-ai-metrics">
              {[
                ["Reçete", metrics.recipes],
                ["Açık emir", metrics.open_orders],
                ["Üretimde", metrics.in_production],
                ["Eksik bildirim", metrics.missing_notifications],
                ["Atölye WO", metrics.open_work_orders],
                ["Duraklatılmış", metrics.paused_work_orders],
              ].map(([l, v]) => (
                <span key={l} className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600"><b className="text-slate-900">{v ?? 0}</b> {l}</span>
              ))}
            </div>
          )}
          {advice ? (
            <div className="text-xs text-slate-800 whitespace-pre-wrap bg-white border border-emerald-100 rounded-xl p-3 max-h-64 overflow-y-auto" data-testid="production-ai-advice">{advice}</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((p) => (
                <button key={p} type="button" disabled={busy} onClick={() => run(p)} className="text-[10px] px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 text-slate-600 font-medium disabled:opacity-50">{p}</button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run(q)}
              placeholder="Yönetici sorusu… (örn. hangi istasyon yoğun?)"
              className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"
              data-testid="production-ai-input"
              disabled={busy}
            />
            <button type="button" onClick={() => run(q)} disabled={busy || !q.trim()} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg disabled:opacity-40" data-testid="production-ai-send">
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
