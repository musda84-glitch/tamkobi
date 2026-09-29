import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Car, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";
import {
  emptyVehicleForm,
  filterVehicles,
  validateVehicleForm,
  vehicleFromRow,
  vehiclePayload,
  vehicleStatusLabel,
  vehicleTitle,
  VEHICLE_STATUSES,
} from "../utils/vehicles";

function VehicleModal({ open, initial, companyId, onClose, onSaved }) {
  useEscape(onClose);
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState(() => (initial ? vehicleFromRow(initial) : emptyVehicleForm()));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(initial ? vehicleFromRow(initial) : emptyVehicleForm());
  }, [initial, open]);

  if (!open) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    const err = validateVehicleForm(form);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const body = vehiclePayload(form, companyId);
      const r = isEdit
        ? await axios.put(`${API_URL}/vehicles/${initial.id}`, body)
        : await axios.post(`${API_URL}/vehicles`, body);
      toast.success(r.data.message || (isEdit ? "Araç güncellendi." : "Araç kaydedildi."));
      onSaved?.(r.data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Araç kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs";
  const label = "block text-[10px] font-semibold text-slate-600 mb-0.5";

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl max-h-[92vh] overflow-y-auto"
        data-testid="vehicle-modal"
      >
        <div className="flex justify-between items-start border-b pb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Car className="w-4 h-4 text-emerald-600" /> {isEdit ? "Araç düzenle" : "Yeni araç"}
            </h3>
            <p className="text-slate-500">Plaka, marka / model ve durum</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400" data-testid="vehicle-modal-close"><X className="w-5 h-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className={label} htmlFor="veh-plate">Plaka *</label>
            <input id="veh-plate" value={form.plate} onChange={(e) => set("plate", e.target.value)} className={`${field} font-mono uppercase`} placeholder="34 ABC 123" data-testid="vehicle-plate" autoFocus />
          </div>
          <div>
            <label className={label} htmlFor="veh-brand">Marka</label>
            <input id="veh-brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} className={field} placeholder="Ford" data-testid="vehicle-brand" />
          </div>
          <div>
            <label className={label} htmlFor="veh-model">Model</label>
            <input id="veh-model" value={form.model} onChange={(e) => set("model", e.target.value)} className={field} placeholder="Transit" data-testid="vehicle-model" />
          </div>
          <div>
            <label className={label} htmlFor="veh-year">Model yılı</label>
            <input id="veh-year" type="number" min={1950} max={2100} value={form.year} onChange={(e) => set("year", e.target.value)} className={field} placeholder="2022" data-testid="vehicle-year" />
          </div>
          <div>
            <label className={label} htmlFor="veh-color">Renk</label>
            <input id="veh-color" value={form.color} onChange={(e) => set("color", e.target.value)} className={field} data-testid="vehicle-color" />
          </div>
          <div className="col-span-2">
            <label className={label} htmlFor="veh-status">Durum</label>
            <select id="veh-status" value={form.status} onChange={(e) => set("status", e.target.value)} className={field} data-testid="vehicle-status">
              {VEHICLE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={label} htmlFor="veh-notes">Not</label>
            <textarea id="veh-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} className={field} data-testid="vehicle-notes" />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button type="submit" disabled={busy} className="flex items-center gap-1 px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="vehicle-save">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {isEdit ? "Kaydet" : "Ekle"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function VehiclesPage() {
  const { activeCompany, can } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const canEdit = can("/vehicles", "edit");
  const canDelete = can("/vehicles", "delete");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [modal, setModal] = useState(null); // null | {} | row

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/vehicles`, { params: { company_id: companyId } });
      setRows(r.data.vehicles || []);
      setSummary(r.data.summary || null);
    } catch {
      toast.error("Araç listesi yüklenemedi.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => filterVehicles(rows, { status, q }), [rows, status, q]);

  const remove = async (row) => {
    if (!canDelete) { toast.error("Silme yetkiniz yok."); return; }
    if (!window.confirm(`${vehicleTitle(row)} çöp kutusuna taşınsın mı?`)) return;
    try {
      const r = await axios.delete(`${API_URL}/vehicles/${row.id || row._id}`);
      toast.success(r.data.message || "Araç silindi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    }
  };

  const statusTone = (st) => ({
    active: "bg-emerald-50 text-emerald-800 border-emerald-200",
    inactive: "bg-slate-100 text-slate-600 border-slate-200",
    maintenance: "bg-amber-50 text-amber-800 border-amber-200",
  }[st] || "bg-slate-50 text-slate-600 border-slate-200");

  return (
    <div className="space-y-6" data-testid="vehicles-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Car className="w-6 h-6 text-emerald-600" /> Araçlarım
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">Şirket araçları — plaka, marka / model ve durum</p>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setModal({})}
            className="flex items-center gap-1.5 self-start bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20"
            data-testid="vehicle-new-btn"
          >
            <Plus className="w-4 h-4" /> Yeni araç
          </button>
        ) : null}
      </div>

      {summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="vehicles-summary">
          {[
            ["Toplam", summary.total],
            ["Aktif", summary.active],
            ["Pasif", summary.inactive],
            ["Bakımda", summary.maintenance],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
              <div className="text-lg font-bold text-slate-900">{value ?? 0}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Plaka, marka, model ara…"
            className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
            data-testid="vehicle-search"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {[{ value: "all", label: "Tümü" }, ...VEHICLE_STATUSES].map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatus(s.value)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border ${status === s.value ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
              data-testid={`vehicle-filter-${s.value}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold">Plaka</th>
              <th className="text-left px-3 py-2.5 font-semibold hidden sm:table-cell">Marka / Model</th>
              <th className="text-left px-3 py-2.5 font-semibold hidden md:table-cell">Yıl</th>
              <th className="text-left px-3 py-2.5 font-semibold">Durum</th>
              <th className="text-right px-3 py-2.5 font-semibold">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Yükleniyor…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400" data-testid="vehicles-empty">Kayıt yok. “Yeni araç” ile filo ekleyin.</td></tr>
            ) : visible.map((row) => {
              const id = row.id || row._id;
              return (
                <tr key={id} className="border-t border-slate-100 hover:bg-slate-50/70" data-testid={`vehicle-row-${id}`}>
                  <td className="px-3 py-2.5 font-mono font-bold text-slate-900">{row.plate}</td>
                  <td className="px-3 py-2.5 text-slate-700 hidden sm:table-cell">{[row.brand, row.model].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600 hidden md:table-cell">{row.year || "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-md border text-[10px] font-semibold ${statusTone(row.status)}`}>
                      {vehicleStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      {canEdit ? (
                        <button type="button" onClick={() => setModal(row)} className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg" title="Düzenle" data-testid={`vehicle-edit-${id}`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button type="button" onClick={() => remove(row)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg" title="Sil" data-testid={`vehicle-del-${id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <VehicleModal
        open={modal !== null}
        initial={modal && modal.id ? modal : null}
        companyId={companyId}
        onClose={() => setModal(null)}
        onSaved={load}
      />
    </div>
  );
}
