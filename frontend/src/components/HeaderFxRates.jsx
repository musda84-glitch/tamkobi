import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Coins, RefreshCw, Save } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";

const CHIP_CODES = ["USD", "EUR"];
const EDIT_CODES = ["USD", "EUR", "GBP", "CHF", "JPY"];
const cred = { withCredentials: true };

const fmtRate = (n) => {
  const v = Number(n);
  if (!v) return "—";
  return v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

const sourceLabel = (pack) => {
  const rows = Object.values(pack?.rates || {});
  if (!rows.length) return { text: "Kur yok", kind: "empty" };
  const sources = new Set(rows.map((r) => r.source).filter(Boolean));
  if (sources.size === 1 && sources.has("tcmb")) return { text: "TCMB", kind: "auto" };
  if (sources.has("manual")) return { text: "Ayarlı", kind: "manual" };
  return { text: "TCMB", kind: "auto" };
};

export const HeaderFxRates = ({ companyId }) => {
  const { can, feature } = useAuth();
  const box = useRef(null);
  const [pack, setPack] = useState(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState("");
  const masked = feature("view_prices") === false;
  const canEdit = can("/settings", "edit");

  const load = useCallback(async (fetch = true) => {
    if (!companyId || masked) return;
    try {
      const r = await axios.get(`${API_URL}/fx/rates`, { ...cred, params: { company_id: companyId, fetch } });
      setPack(r.data || { date: "", rates: {} });
    } catch {
      // Keep the chip visible even if TCMB/API is down — user can still type a rate.
      setPack((p) => p || { date: "", rates: {} });
    }
  }, [companyId, masked]);

  useEffect(() => {
    // İlk boyamada TCMB'ye gitme — önbellek / son bilinen kur; ağ çağrısını idle'a bırak
    load(false);
    let idleId;
    let timeoutId;
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => load(true), { timeout: 4000 });
    } else {
      timeoutId = setTimeout(() => load(true), 1500);
    }
    return () => {
      if (idleId != null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(true), 15 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (masked || !companyId) return null;
  const view = pack || { date: "", rates: {} };

  const src = sourceLabel(view);
  const fetchTcmb = async () => {
    setBusy("fetch");
    try {
      const r = await axios.post(`${API_URL}/fx/fetch`, { date: view.date }, { ...cred, params: { company_id: companyId } });
      setPack({ ...view, date: r.data.date, source: "tcmb", rates: r.data.rates || view.rates });
      setDraft({});
      toast.success(r.data.message || "TCMB kurları alındı.");
    } catch (e) {
      toast.error(e.response?.data?.detail || "TCMB alınamadı. Manuel kur girebilirsiniz.");
    } finally { setBusy(""); }
  };
  const saveRow = async (code) => {
    const rate = Number(draft[code] ?? view.rates?.[code]?.rate);
    if (!rate) return toast.error("Kur girin.");
    setBusy(code);
    try {
      const row = await axios.put(`${API_URL}/fx/rates`, { date: view.date, currency: code, rate }, { ...cred, params: { company_id: companyId } });
      setPack((p) => ({ ...p, source: "manual", rates: { ...(p?.rates || {}), [code]: row.data } }));
      setDraft((d) => { const n = { ...d }; delete n[code]; return n; });
      toast.success(`${code} kuru kaydedildi.`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Kaydedilemedi.");
    } finally { setBusy(""); }
  };

  return (
    <div className="relative hidden md:block" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 max-w-[280px] lg:max-w-none bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-lg px-2.5 py-1.5 text-[11px] transition"
        title="Döviz kurları — tıklayarak düzenleyin"
        data-testid="header-fx-chip"
      >
        <Coins className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
        <span className="flex items-center gap-2 font-mono text-slate-700">
          {CHIP_CODES.map((code) => (
            <span key={code} className="whitespace-nowrap">
              <span className="font-semibold text-slate-500">{code}</span>{" "}
              <span className="font-bold text-slate-800">{fmtRate(view.rates?.[code]?.rate)}</span>
            </span>
          ))}
        </span>
        <span className={`hidden lg:inline text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full ${
          src.kind === "manual" ? "bg-amber-100 text-amber-700" : src.kind === "auto" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
        }`}>
          {src.text}
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-[340px] bg-white border border-slate-200 rounded-xl shadow-2xl z-50 p-3 text-xs" data-testid="header-fx-popover">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <div className="font-bold text-slate-900">Döviz kurları</div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {src.kind === "manual" ? "Ayarlı (manuel) kur" : src.kind === "empty" ? "Kur henüz yok — TCMB çekin veya yazın" : "Otomatik TCMB kuru"} · {view.date || "bugün"}
              </div>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={fetchTcmb}
                disabled={!!busy}
                className="px-2 py-1 bg-slate-900 text-white rounded-lg font-semibold inline-flex items-center gap-1 disabled:opacity-60"
                data-testid="header-fx-fetch"
              >
                <RefreshCw className={`w-3 h-3 ${busy === "fetch" ? "animate-spin" : ""}`} /> TCMB
              </button>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {EDIT_CODES.map((code) => {
              const row = view.rates?.[code] || {};
              const val = draft[code] ?? row.rate ?? "";
              return (
                <div key={code} className="flex items-center gap-2 py-1.5" data-testid={`header-fx-row-${code}`}>
                  <span className="w-10 font-bold text-slate-800">{code}</span>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    disabled={!canEdit}
                    value={val}
                    onChange={(e) => setDraft({ ...draft, [code]: e.target.value })}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 font-mono text-right disabled:opacity-60"
                    data-testid={`header-fx-input-${code}`}
                  />
                  <span className="w-14 text-[10px] text-slate-400">{row.source === "manual" ? "Ayarlı" : row.source === "tcmb" ? "TCMB" : "—"}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => saveRow(code)}
                      disabled={busy === code}
                      className="p-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                      title="Kaydet"
                      data-testid={`header-fx-save-${code}`}
                    >
                      <Save className="w-3 h-3 text-slate-600" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!canEdit && <p className="text-[10px] text-slate-400 mt-2">Kurları düzenlemek için Firma Ayarları yetkisi gerekir.</p>}
        </div>
      )}
    </div>
  );
};
