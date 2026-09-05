import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CalendarRange, ChevronLeft, ChevronRight, Copy, Loader2, X, Trash2, AlertTriangle, Users } from "lucide-react";
import { BulkAssignModal } from "./BulkAssignModal";
import { API_URL } from "../context/AuthContext";

const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const monday = (iso) => { const d = new Date(iso + "T00:00:00"); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return d.toISOString().slice(0, 10); };
const inp = "bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs";

const CellEditor = ({ row, cell, companyId, onClose, onSaved }) => {
  const [f, setF] = useState({ off: cell.off, start: cell.start || "09:00", end: cell.end || "18:00", break_minutes: cell.break_minutes ?? 60, note: cell.note || "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await axios.put(`${API_URL}/personnel/shifts`, { company_id: companyId, items: [{ employee_id: row.employee_id, date: cell.date, ...f }] }); if (r.data.warnings?.length) toast.warning(r.data.warnings[0], { duration: 6000 }); else toast.success("Vardiya kaydedildi."); onSaved(); onClose(); }
    catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  const reset = async () => { if (!cell.id) return onClose(); try { await axios.delete(`${API_URL}/personnel/shifts/${cell.id}`); toast.success("Plan kaldırıldı, varsayılan mesai geçerli."); onSaved(); onClose(); } catch { toast.error("Silinemedi."); } };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="shift-cell-editor">
        <div className="flex items-center justify-between border-b pb-2"><b>{row.employee_name} · {cell.date}</b><button onClick={onClose} className="text-slate-400"><X className="w-4 h-4" /></button></div>
        {cell.leave && <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-800" data-testid="shift-leave-warning"><AlertTriangle className="w-4 h-4 shrink-0" /><span>Bu gün için <b>onaylı {cell.leave.label} izni</b> var. Çalışma saati atarsanız çakışma oluşur; "İzinli / tatil" işaretlemeniz önerilir.</span></div>}
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={f.off} onChange={(e) => setF({ ...f, off: e.target.checked })} data-testid="shift-off" /> İzinli / tatil (çalışma = fazla mesai)</label>
        {!f.off && <div className="grid grid-cols-3 gap-2">
          <div><label className="block text-[10px] text-slate-500 mb-0.5">Başlangıç</label><input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className={`${inp} w-full`} data-testid="shift-start" /></div>
          <div><label className="block text-[10px] text-slate-500 mb-0.5">Bitiş</label><input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className={`${inp} w-full`} data-testid="shift-end" /></div>
          <div><label className="block text-[10px] text-slate-500 mb-0.5">Mola (dk)</label><input type="number" min="0" value={f.break_minutes} onChange={(e) => setF({ ...f, break_minutes: Number(e.target.value) })} className={`${inp} w-full`} data-testid="shift-break" /></div>
        </div>}
        <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Not (örn. gece vardiyası, şube B)" className={`${inp} w-full`} data-testid="shift-note" />
        <div className="flex justify-between pt-1">
          <button onClick={reset} className="flex items-center gap-1 text-slate-500 hover:text-rose-600" data-testid="shift-reset"><Trash2 className="w-3.5 h-3.5" /> {cell.planned ? "Planı kaldır" : "Vazgeç"}</button>
          <button onClick={save} disabled={busy} className="px-4 py-1.5 bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-1" data-testid="shift-save">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Kaydet</button>
        </div>
      </div>
    </div>
  );
};

export const ShiftPlanner = ({ companyId, onChanged }) => {
  const [week, setWeek] = useState(monday(new Date().toISOString().slice(0, 10)));
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [bulk, setBulk] = useState(false);
  const load = useCallback(() => axios.get(`${API_URL}/personnel/shifts?company_id=${companyId}&week_start=${week}`).then((r) => setD(r.data)).catch(() => toast.error("Vardiya planı yüklenemedi.")), [companyId, week]);
  useEffect(() => { load(); }, [load]);
  const copyPrev = async () => { try { const r = await axios.post(`${API_URL}/personnel/shifts/copy-week`, { company_id: companyId, from_week_start: addDays(week, -7), to_week_start: week }); toast.success(r.data.message); load(); } catch (err) { toast.error(err.response?.data?.detail || "Kopyalanamadı."); } };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 text-xs" data-testid="shift-planner">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2"><CalendarRange className="w-4 h-4 text-indigo-600" /> Haftalık Vardiya Planı</h4>
        <div className="flex items-center gap-1">
          <button onClick={() => setWeek(addDays(week, -7))} className="p-1.5 border rounded-lg hover:bg-slate-50" data-testid="shift-prev-week"><ChevronLeft className="w-4 h-4" /></button>
          <span className="font-mono font-semibold px-2" data-testid="shift-week-label">{week} → {addDays(week, 6)}</span>
          <button onClick={() => setWeek(addDays(week, 7))} className="p-1.5 border rounded-lg hover:bg-slate-50" data-testid="shift-next-week"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => setWeek(monday(today))} className="px-2 py-1.5 border rounded-lg hover:bg-slate-50 font-semibold" data-testid="shift-this-week">Bu hafta</button>
          <button onClick={copyPrev} className="flex items-center gap-1 px-2 py-1.5 border rounded-lg hover:bg-slate-50 font-semibold" title="Önceki haftanın planını bu haftaya kopyala" data-testid="shift-copy-prev"><Copy className="w-3.5 h-3.5" /> Önceki haftayı kopyala</button>
          <button onClick={() => setBulk(true)} className="flex items-center gap-1 px-2 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold" title="Bir şablonu departmanın tüm haftasına uygula" data-testid="shift-bulk-assign"><Users className="w-3.5 h-3.5" /> Toplu Ata</button>
        </div>
      </div>
      {d?.conflicts > 0 && <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-800 font-semibold" data-testid="shift-conflicts-banner"><AlertTriangle className="w-4 h-4" /> {d.conflicts} vardiya onaylı izin günüyle çakışıyor — turuncu işaretli hücreleri kontrol edin.</div>}
      <p className="text-[11px] text-slate-500">Hücreye tıklayarak o gün için farklı saat / izin atayın. Planlanan gün <span className="text-indigo-700 font-bold">mavi</span>, varsayılan mesai gri görünür; giriş/çıkış ve fazla mesai o günün planına göre hesaplanır.</p>
      {!d ? <div className="text-slate-400">Yükleniyor…</div> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[720px]">
          <thead><tr><th className="text-left px-2 py-1.5 text-[10px] uppercase text-slate-500">Çalışan</th>{d.dates.map((dt, i) => <th key={dt} className={`px-1 py-1.5 text-[10px] uppercase ${dt === today ? "text-indigo-700" : "text-slate-500"}`}>{d.day_labels[i]}<div className="font-mono text-[9px] font-normal">{dt.slice(5)}</div></th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{d.rows.map((row) => (
            <tr key={row.employee_id} data-testid={`shift-row-${row.employee_id}`}>
              <td className="px-2 py-1.5 font-semibold text-slate-900 whitespace-nowrap">{row.employee_name}<div className="text-[10px] text-slate-400 font-normal">{row.department}</div></td>
              {row.cells.map((c) => (
                <td key={c.date} className="p-0.5">
                  <button onClick={() => setEdit({ row, cell: c })} className={`relative w-full h-12 rounded-lg border text-[10px] font-semibold leading-tight px-1 transition hover:ring-2 hover:ring-indigo-300 ${c.conflict ? "bg-amber-50 border-amber-400 text-amber-800 ring-1 ring-amber-300" : c.planned ? (c.off ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-indigo-50 border-indigo-300 text-indigo-800") : c.leave ? "bg-amber-50/60 border-amber-200 text-amber-700" : (c.off ? "bg-slate-50 border-slate-100 text-slate-300" : "bg-white border-slate-200 text-slate-500")}`} data-testid={`shift-cell-${row.employee_id}-${c.date}`} title={c.conflict ? `Çakışma: onaylı ${c.leave.label} izni` : c.leave ? `Onaylı ${c.leave.label} izni` : c.note}>
                    {c.conflict && <AlertTriangle className="absolute top-0.5 right-0.5 w-3 h-3 text-amber-600" data-testid={`shift-conflict-${row.employee_id}-${c.date}`} />}
                    {c.leave && !c.planned ? <>{c.leave.label}<br />izinli</> : c.off ? "İzin" : <>{c.start}<br />{c.end}</>}{c.note && <div className="truncate text-[9px] font-normal opacity-70">{c.note}</div>}
                  </button>
                </td>))}
            </tr>))}</tbody>
        </table></div>
      )}
      {bulk && d && <BulkAssignModal companyId={companyId} weekStart={d.week_start} rows={d.rows} onClose={() => setBulk(false)} onDone={() => { load(); onChanged?.(); }} />}
      {edit && <CellEditor row={edit.row} cell={edit.cell} companyId={companyId} onClose={() => setEdit(null)} onSaved={() => { load(); onChanged?.(); }} />}
    </div>
  );
};
