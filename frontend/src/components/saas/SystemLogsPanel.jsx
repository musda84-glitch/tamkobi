import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, ScrollText } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

const LEVELS = ["", "ERROR", "WARNING", "INFO", "DEBUG"];
const CATEGORIES = ["", "error", "auth", "app", "sql", "client"];

/** Sistem paneli: hata / istek loglarını görüntüle ve düzeltmeye yönlendir. */
export function SystemLogsPanel() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ category: "error", level: "", event: "", email: "", company_id: "", limit: 100 });
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== "" && v != null) params[k] = v;
      });
      const r = await axios.get(`${API_URL}/system/logs`, { params });
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Loglar yüklenemedi.");
    } finally {
      setBusy(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const rotate = async () => {
    if (!window.confirm("Log dosyaları döndürülsün mü? (büyük dosyalar arşivlenir)")) return;
    try {
      const r = await axios.post(`${API_URL}/system/logs/rotate`);
      toast.success(r.data?.message || "Loglar döndürüldü.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Döndürülemedi.");
    }
  };

  return (
    <div className="space-y-4 text-xs max-w-5xl" data-testid="system-logs-panel">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <ScrollText className="w-4 h-4 text-rose-600" /> Panel & Sistem Logları
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              API hataları, auth olayları ve panel (React) çökmeleri. Satıra tıklayınca ayrıntı ve düzeltme ipucu görünür.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={load} disabled={busy} className="px-3 py-1.5 border rounded-lg font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="logs-refresh">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Yenile
            </button>
            <button type="button" onClick={rotate} className="px-3 py-1.5 border rounded-lg font-semibold inline-flex items-center gap-1.5" data-testid="logs-rotate">
              <RotateCcw className="w-3.5 h-3.5" /> Döndür
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <div>
            <label className="block font-semibold mb-1">Kategori</label>
            <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className={inputCls} data-testid="logs-filter-category">
              {CATEGORIES.map((c) => <option key={c || "all"} value={c}>{c || "Tümü"}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Seviye</label>
            <select value={filters.level} onChange={(e) => setFilters({ ...filters, level: e.target.value })} className={inputCls} data-testid="logs-filter-level">
              {LEVELS.map((l) => <option key={l || "all"} value={l}>{l || "Tümü"}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Olay</label>
            <input value={filters.event} onChange={(e) => setFilters({ ...filters, event: e.target.value })} className={inputCls} placeholder="panel_error" data-testid="logs-filter-event" />
          </div>
          <div>
            <label className="block font-semibold mb-1">E-posta</label>
            <input value={filters.email} onChange={(e) => setFilters({ ...filters, email: e.target.value })} className={inputCls} data-testid="logs-filter-email" />
          </div>
          <div>
            <label className="block font-semibold mb-1">Şirket ID</label>
            <input value={filters.company_id} onChange={(e) => setFilters({ ...filters, company_id: e.target.value })} className={inputCls} data-testid="logs-filter-company" />
          </div>
          <div>
            <label className="block font-semibold mb-1">Limit</label>
            <input type="number" min={20} max={500} value={filters.limit} onChange={(e) => setFilters({ ...filters, limit: Number(e.target.value) || 100 })} className={inputCls} data-testid="logs-filter-limit" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left" data-testid="logs-table">
            <thead className="bg-slate-50 border-b text-[10px] uppercase text-slate-500 font-semibold">
              <tr>
                <th className="px-3 py-2">Zaman</th>
                <th className="px-3 py-2">Seviye</th>
                <th className="px-3 py-2">Kategori</th>
                <th className="px-3 py-2">Olay</th>
                <th className="px-3 py-2">Mesaj</th>
                <th className="px-3 py-2">Kullanıcı</th>
                <th className="px-3 py-2">HTTP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!rows.length && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">{busy ? "Yükleniyor…" : "Kayıt yok."}</td></tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`cursor-pointer hover:bg-slate-50 ${selected?.id === row.id ? "bg-rose-50/60" : ""}`}
                  onClick={() => setSelected(row)}
                  data-testid={`logs-row-${row.id}`}
                >
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500 whitespace-nowrap">{row.created_at ? new Date(row.created_at).toLocaleString("tr-TR") : "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${String(row.level).toUpperCase() === "ERROR" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"}`}>{row.level}</span>
                  </td>
                  <td className="px-3 py-2 font-semibold">{row.category}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{row.event}</td>
                  <td className="px-3 py-2 max-w-xs truncate" title={row.message}>{row.message}</td>
                  <td className="px-3 py-2 text-slate-500 truncate max-w-[8rem]">{row.user_email || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{row.status_code || "—"}{row.path ? ` ${row.method || ""} ${row.path}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="bg-white border border-rose-200 rounded-2xl p-4 space-y-2" data-testid="logs-detail">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-bold text-slate-900 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-rose-600" /> Log ayrıntısı #{selected.id}</h4>
            <button type="button" onClick={() => setSelected(null)} className="text-slate-400 font-semibold">Kapat</button>
          </div>
          <p className="text-slate-800 whitespace-pre-wrap break-words">{selected.message}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div><span className="text-slate-400">Olay</span><div className="font-mono font-semibold">{selected.event}</div></div>
            <div><span className="text-slate-400">Şirket</span><div className="font-mono font-semibold">{selected.company_id || "—"}</div></div>
            <div><span className="text-slate-400">Kullanıcı</span><div className="font-semibold">{selected.user_email || "—"}</div></div>
            <div><span className="text-slate-400">Süre</span><div className="font-semibold">{selected.duration_ms != null ? `${selected.duration_ms} ms` : "—"}</div></div>
          </div>
          {selected.details && (
            <pre className="bg-slate-900 text-slate-100 rounded-xl p-3 overflow-x-auto text-[10px] leading-relaxed max-h-64" data-testid="logs-detail-json">
              {typeof selected.details === "string" ? selected.details : JSON.stringify(selected.details, null, 2)}
            </pre>
          )}
          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-2">
            Düzeltme: event/path bilgisinden ilgili modülü bulun; şirket ID varsa o tenant’ta tekrarlayın.
            <code className="mx-1">panel_error</code> React sınırı hatalarıdır — stack’teki bileşen dosyasına bakın.
          </p>
        </div>
      )}
    </div>
  );
}
