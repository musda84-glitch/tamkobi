import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { FolderOpen, Loader2, Save } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";
import { formatBytes, formatLimitMb, formatPercent } from "../../utils/storageFormat";

const cred = { withCredentials: true };
const MB = 1024 * 1024;

const statusClass = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
};

function whenLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

function MiniBar({ percent }) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const tone = pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2 min-w-[7.5rem]">
      <div className="h-1.5 w-16 shrink-0 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, pct > 0 ? 4 : 0)}%` }} />
      </div>
      <span className="tabular-nums text-slate-600">{formatPercent(pct)}</span>
    </div>
  );
}

export const CompanyStoragePanel = ({
  companyId,
  detail,
  limitAmount,
  limitUnit,
  unlimited,
  onLimitAmount,
  onLimitUnit,
  onUnlimited,
  onSave,
  saving,
  planLimitMb = 0,
  onReload,
  onChanged,
}) => {
  const [requests, setRequests] = useState(null);
  const [busyId, setBusyId] = useState("");

  const loadRequests = useCallback(() => {
    if (!companyId) return Promise.resolve();
    return axios.get(`${API_URL}/system/storage/${companyId}/requests`, cred)
      .then((r) => setRequests(Array.isArray(r.data?.items) ? r.data.items : []))
      .catch(() => setRequests([]));
  }, [companyId]);

  useEffect(() => { loadRequests(); }, [loadRequests, detail]);

  const used = Number(detail?.used_bytes ?? detail?.total_bytes ?? 0);
  const limitMb = Number(detail?.storage_limit_mb || 0);
  const isUnlimited = !limitMb;
  const limitBytes = isUnlimited ? 0 : limitMb * MB;
  const freeBytes = isUnlimited ? null : Math.max(0, limitBytes - used);
  const percent = isUnlimited || !limitBytes ? null : (used / limitBytes) * 100;
  const barPct = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const barTone = barPct >= 100 ? "bg-rose-500" : barPct >= 80 ? "bg-amber-400" : "bg-emerald-500";
  const folders = detail?.folders || [];
  const folderTotal = folders.reduce((sum, row) => sum + Number(row.bytes || 0), 0) || used || 1;

  const resolve = async (row, status, note) => {
    setBusyId(row.id);
    try {
      await axios.put(
        `${API_URL}/system/storage/${companyId}/requests/${row.id}`,
        { status, note: note || "" },
        cred,
      );
      toast.success(status === "approved" ? "Talep onaylandı. Yeni limit uygulandı." : "Talep reddedildi.");
      await loadRequests();
      await onReload?.();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyId("");
    }
  };

  const approve = (row) => resolve(row, "approved", "");

  const reject = (row) => {
    const note = window.prompt("Red notu");
    if (note == null) return;
    if (!String(note).trim()) {
      toast.error("Red notu zorunlu.");
      return;
    }
    resolve(row, "rejected", String(note).trim());
  };

  return (
    <div className="space-y-4 min-w-0" data-testid="drawer-storage">
      <div className="grid grid-cols-1 min-[900px]:grid-cols-[minmax(0,1fr)_18rem] gap-3 items-start">
        <div className="space-y-3 min-w-0">
          <div className="grid grid-cols-3 gap-2 min-[900px]:gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl px-2.5 py-3 min-w-0 sm:px-3" data-testid="storage-stat-used">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold truncate">Kullanılan</div>
              <div className="text-base sm:text-xl font-bold text-slate-900 mt-1 truncate">{formatBytes(used)}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl px-2.5 py-3 min-w-0 sm:px-3" data-testid="storage-stat-limit">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold truncate">Limit</div>
              <div className="text-base sm:text-xl font-bold text-slate-900 mt-1 truncate">{formatLimitMb(limitMb)}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl px-2.5 py-3 min-w-0 sm:px-3" data-testid="storage-stat-free">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold truncate">Boş</div>
              <div className="text-base sm:text-xl font-bold text-slate-900 mt-1 truncate">{freeBytes == null ? "Sınırsız" : formatBytes(freeBytes)}</div>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2" data-testid="storage-usage-rate">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-bold text-slate-900 text-sm">Kullanım Oranı</span>
              <span className="text-sm font-bold tabular-nums text-slate-800">{percent == null ? "Sınırsız" : formatPercent(percent)}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full ${barTone}`} style={{ width: `${isUnlimited ? 8 : Math.max(barPct, used ? 4 : 0)}%` }} />
            </div>
            <div className="text-[11px] text-slate-600" data-testid="drawer-storage-usage">
              {formatBytes(used)} / {isUnlimited ? "sınırsız" : formatLimitMb(limitMb)}
            </div>
          </div>
        </div>

        <form
          className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3"
          data-testid="storage-limit-card"
          onSubmit={(e) => { e.preventDefault(); onSave?.(); }}
        >
          <h3 className="font-bold text-slate-900 text-sm">Depolama limiti</h3>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={limitAmount}
              disabled={unlimited || saving}
              onChange={(e) => onLimitAmount?.(e.target.value)}
              className={`${inputCls} min-w-0 flex-1 disabled:bg-slate-50`}
              placeholder={planLimitMb ? String(planLimitMb) : "paket"}
              data-testid="drawer-storage-limit"
            />
            <select
              value={limitUnit}
              disabled={unlimited || saving}
              onChange={(e) => onLimitUnit?.(e.target.value)}
              className={`${inputCls} w-[4.5rem] shrink-0 disabled:bg-slate-50`}
              data-testid="drawer-storage-unit"
            >
              <option value="mb">MB</option>
              <option value="gb">GB</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-slate-700 font-semibold">
            <input
              type="checkbox"
              checked={!!unlimited}
              onChange={(e) => onUnlimited?.(e.target.checked)}
              data-testid="drawer-storage-unlimited"
            />
            Sınırsız
          </label>
          <p className="text-[10px] text-slate-400 leading-snug">
            Boş bırakılırsa paket limiti kullanılır ({formatLimitMb(planLimitMb)}).
          </p>
          <button
            type="submit"
            disabled={!!saving}
            className="w-full px-3 py-2 bg-slate-900 text-white rounded-lg font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            data-testid="drawer-storage-save"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Kaydet
          </button>
        </form>
      </div>

      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden min-w-0" data-testid="drawer-storage-folders">
        <h3 className="font-bold text-slate-900 text-sm px-4 pt-4 pb-2">Klasörler</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Klasör</th>
                <th className="px-3 py-2 font-semibold text-right">Dosya sayısı</th>
                <th className="px-3 py-2 font-semibold text-right">Boyut</th>
                <th className="px-4 py-2 font-semibold">Oran</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {folders.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">Klasör kaydı yok.</td>
                </tr>
              ) : folders.map((folder) => {
                const share = (Number(folder.bytes || 0) / folderTotal) * 100;
                return (
                  <tr key={folder.id || folder.area_key} data-testid={`drawer-storage-folder-${folder.area_key}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-800 inline-flex items-center gap-2 min-w-0 max-w-[16rem]">
                        <FolderOpen className="w-4 h-4 shrink-0 text-amber-500" />
                        <span className="truncate">{folder.label}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{folder.file_count || 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatBytes(folder.bytes)}</td>
                    <td className="px-4 py-2.5"><MiniBar percent={share} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden min-w-0" data-testid="storage-requests">
        <h3 className="font-bold text-slate-900 text-sm px-4 pt-4 pb-2">Artırma talepleri</h3>
        {requests == null ? (
          <div className="px-4 py-6 text-slate-400">Yükleniyor…</div>
        ) : requests.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-400" data-testid="storage-requests-empty">
            Henüz depolama artış talebi yok.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Tarih</th>
                  <th className="px-3 py-2 font-semibold">Talep eden</th>
                  <th className="px-3 py-2 font-semibold">Mevcut</th>
                  <th className="px-3 py-2 font-semibold">İstenen</th>
                  <th className="px-3 py-2 font-semibold">Not</th>
                  <th className="px-3 py-2 font-semibold">Durum</th>
                  <th className="px-4 py-2 font-semibold text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((row) => {
                  const pending = row.status === "pending";
                  return (
                    <tr key={row.id} data-testid={`storage-request-${row.id}`}>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{whenLabel(row.created_at)}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-800">{row.requested_by_name || "—"}</div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[10rem]">{row.requested_by}</div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{formatLimitMb(row.current_limit_mb)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-semibold">{formatLimitMb(row.requested_limit_mb)}</td>
                      <td className="px-3 py-2.5 max-w-[14rem]">
                        <div className="truncate">{row.message || "—"}</div>
                        {row.admin_note ? <div className="text-[10px] text-slate-400 truncate">Yönetici: {row.admin_note}</div> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${statusClass[row.status] || statusClass.pending}`}>
                          {row.status_label || (row.status === "approved" ? "Onaylandı" : row.status === "rejected" ? "Reddedildi" : "Bekliyor")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {pending ? (
                          <div className="inline-flex flex-nowrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => approve(row)}
                              className="px-2.5 py-1 rounded-lg border border-emerald-600 text-emerald-700 bg-white font-bold whitespace-nowrap hover:bg-emerald-50 disabled:opacity-60"
                              data-testid={`storage-request-approve-${row.id}`}
                            >
                              Onayla
                            </button>
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => reject(row)}
                              className="px-2.5 py-1 rounded-lg border border-rose-600 text-rose-700 bg-white font-bold whitespace-nowrap hover:bg-rose-50 disabled:opacity-60"
                              data-testid={`storage-request-reject-${row.id}`}
                            >
                              Reddet
                            </button>
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
