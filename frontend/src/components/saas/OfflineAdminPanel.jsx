import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../../context/AuthContext";
import { inputCls, Toggle } from "./saasUi";

export const POLL_MS = 5000;

const cred = { withCredentials: true };
const tl = (n) => Number(n || 0).toLocaleString("tr-TR");

export const OFFLINE_MODULE_FIELDS = [
  { id: "pos", label: "POS" },
  { id: "pick", label: "Sipariş toplama / barkod" },
  { id: "order", label: "Sipariş oluşturma" },
];

function detailOf(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail.detail === "string") return detail.detail;
  return fallback;
}

function draftFrom(row) {
  return {
    offline_enabled: row?.offline_enabled !== false,
    offline_max_minutes: Number(row?.offline_max_minutes ?? 10),
    idempotency_ttl_hours: Number(row?.idempotency_ttl_hours ?? 24),
    offline_modules: {
      pos: row?.offline_modules?.pos !== false,
      pick: row?.offline_modules?.pick !== false,
      order: row?.offline_modules?.order !== false,
    },
  };
}

export function OfflineAdminView({ data, onSave, savingId }) {
  const [query, setQuery] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [drafts, setDrafts] = useState(() => Object.fromEntries((data.companies || []).map((row) => [row.id, draftFrom(row)])));

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      (data.companies || []).forEach((row) => {
        if (!next[row.id]) next[row.id] = draftFrom(row);
      });
      return next;
    });
  }, [data]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return (data.companies || []).filter((row) => {
      if (onlyOpen && !row.offline_enabled) return false;
      if (!q) return true;
      return `${row.name || ""} ${row.id || ""}`.toLocaleLowerCase("tr").includes(q);
    });
  }, [data.companies, query, onlyOpen]);

  const totals = data.totals || {};
  const setDraft = (id, patch) => setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  return (
    <div className="space-y-4 text-xs text-slate-800" data-testid="offline-admin-page">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Çevrimdışı</h2>
        <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">
          Firma bazında çevrimdışı çalışma. Açık/kapalı, süre, modül ve idempotency saklama süresi yalnız süper admin tarafından değişir. Kayıt denetim günlüğüne yazılır.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-3" data-testid="offline-card-companies">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Firma</div>
          <div className="text-2xl font-bold mt-1">{tl(totals.companies)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3" data-testid="offline-card-enabled">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Çevrimdışı açık</div>
          <div className="text-2xl font-bold mt-1 text-emerald-700">{tl(totals.enabled)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3" data-testid="offline-card-pending">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Bekleyen</div>
          <div className="text-2xl font-bold mt-1">{tl(totals.pending)}</div>
          <div className="text-[11px] text-slate-500">Son 24 saatte bildirilen kuyruk</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3" data-testid="offline-card-conflicts">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Çakışan</div>
          <div className="text-2xl font-bold mt-1 text-rose-700">{tl(totals.conflicts)}</div>
          <div className="text-[11px] text-slate-500">Sunucunun reddettiği veya tutarını düzelttiği işlem</div>
        </div>
      </div>

      <section className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2" data-testid="offline-admin-table">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-sm">Firmalar</h3>
          <div className="flex flex-wrap gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Firma ara" className={inputCls + " w-40"} data-testid="offline-admin-search" />
            <button type="button" onClick={() => setOnlyOpen((v) => !v)} className={`px-2.5 py-1.5 rounded-lg border font-semibold ${onlyOpen ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`} data-testid="offline-admin-open-filter">
              Yalnızca açık olanlar
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead className="text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                {["Firma", "Açık", "Süre (dk)", "Modüller", "Anahtar (saat)", "Bekleyen", "Çakışan", ""].map((label) => (
                  <th key={label || "aksiyon"} className="py-2 pr-2 font-semibold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const draft = drafts[row.id] || draftFrom(row);
                return (
                  <tr key={row.id} className="border-t border-slate-100 align-top" data-testid={`offline-row-${row.id}`}>
                    <td className="py-2 pr-2">
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-[10px] text-slate-400">{row.id}</div>
                    </td>
                    <td className="py-2 pr-2">
                      <Toggle on={!!draft.offline_enabled} onChange={(on) => setDraft(row.id, { offline_enabled: on })} testId={`offline-enabled-${row.id}`} />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        min={1}
                        max={720}
                        value={draft.offline_max_minutes}
                        onChange={(e) => setDraft(row.id, { offline_max_minutes: Math.max(1, Math.min(720, Number(e.target.value) || 10)) })}
                        className={inputCls + " w-20"}
                        data-testid={`offline-minutes-${row.id}`}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-col gap-1">
                        {OFFLINE_MODULE_FIELDS.map((field) => (
                          <label key={field.id} className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={draft.offline_modules[field.id] !== false}
                              onChange={(e) => setDraft(row.id, { offline_modules: { ...draft.offline_modules, [field.id]: e.target.checked } })}
                              data-testid={`offline-module-${field.id}-${row.id}`}
                            />
                            <span>{field.label}</span>
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        min={1}
                        max={168}
                        value={draft.idempotency_ttl_hours}
                        onChange={(e) => setDraft(row.id, { idempotency_ttl_hours: Math.max(1, Math.min(168, Number(e.target.value) || 24)) })}
                        className={inputCls + " w-20"}
                        data-testid={`offline-ttl-${row.id}`}
                      />
                    </td>
                    <td className="py-2 pr-2 font-semibold" data-testid={`offline-pending-${row.id}`}>{tl(row.pending)}</td>
                    <td className="py-2 pr-2 font-semibold text-rose-700" data-testid={`offline-conflicts-${row.id}`}>{tl(row.conflicts)}</td>
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        disabled={savingId === row.id}
                        onClick={() => onSave(row.id, draft)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white font-semibold disabled:opacity-40"
                        data-testid={`offline-save-${row.id}`}
                      >
                        Kaydet
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-400">Firma yok.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function OfflineAdminPanel() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [savingId, setSavingId] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/system/offline-admin`, cred);
      setData(response.data);
      setLoadError("");
    } catch (error) {
      setLoadError(detailOf(error, "Çevrimdışı ayarları alınamadı."));
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const onSave = useCallback(async (companyId, body) => {
    setSavingId(companyId);
    try {
      await axios.put(`${API_URL}/system/offline-admin/companies/${companyId}`, body, cred);
      toast.success("Çevrimdışı ayarı kaydedildi.");
      await load();
    } catch (error) {
      toast.error(detailOf(error, "Ayar kaydedilemedi."));
    } finally {
      setSavingId("");
    }
  }, [load]);

  if (!data && loadError) return <div className="text-xs text-rose-600" data-testid="offline-admin-error">{loadError}</div>;
  if (!data) return <div className="text-xs text-slate-400" data-testid="offline-admin-loading">Yükleniyor…</div>;
  return <OfflineAdminView data={data} onSave={onSave} savingId={savingId} />;
}
