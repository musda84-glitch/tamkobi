import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Timer, Save, Loader2, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const inp = "bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs";

export const ScheduleFields = ({ s, set, labels, allowEmpty }) => (
  <div className="flex flex-wrap items-end gap-3 text-xs">
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Başlangıç</label><input type="time" value={s.start || ""} onChange={(e) => set("start", e.target.value)} className={inp} data-testid="ws-start" /></div>
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Bitiş</label><input type="time" value={s.end || ""} onChange={(e) => set("end", e.target.value)} className={inp} data-testid="ws-end" /></div>
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Mola (dk)</label><input type="number" min="0" value={s.break_minutes ?? ""} onChange={(e) => set("break_minutes", e.target.value === "" ? (allowEmpty ? null : 0) : Number(e.target.value))} className={`${inp} w-20`} data-testid="ws-break" /></div>
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Geç tolerans (dk)</label><input type="number" min="0" value={s.late_tolerance_minutes ?? ""} onChange={(e) => set("late_tolerance_minutes", e.target.value === "" ? (allowEmpty ? null : 0) : Number(e.target.value))} className={`${inp} w-20`} data-testid="ws-late-tol" /></div>
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Mesai tolerans (dk)</label><input type="number" min="0" value={s.overtime_tolerance_minutes ?? ""} onChange={(e) => set("overtime_tolerance_minutes", e.target.value === "" ? (allowEmpty ? null : 0) : Number(e.target.value))} className={`${inp} w-20`} data-testid="ws-ot-tol" /></div>
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Çalışma günleri</label><div className="flex gap-1">{labels.map((l, i) => { const on = (s.work_days || []).includes(i); return <button key={l} type="button" onClick={() => set("work_days", on ? (s.work_days || []).filter((d) => d !== i) : [...(s.work_days || []), i].sort())} className={`px-2 py-1 rounded-md font-bold text-[10px] border ${on ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-500"}`} data-testid={`ws-day-${i}`}>{l}</button>; })}</div></div>
  </div>
);

export const WorkScheduleSettings = ({ companyId, onSaved }) => {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get(`${API_URL}/companies/${companyId}/work-schedule`).then((r) => setD(r.data)); }, [companyId]);
  if (!d) return null;
  const s = d.schedule;
  const set = (k, v) => setD({ ...d, schedule: { ...s, [k]: v } });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await axios.put(`${API_URL}/companies/${companyId}/work-schedule`, s); setD({ ...d, schedule: r.data.schedule }); toast.success("Mesai saatleri kaydedildi. Yeni giriş/çıkışlar bu saatlere göre hesaplanır."); onSaved?.(); }
    catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="work-schedule-settings">
      <div className="flex items-center justify-between"><h4 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Timer className="w-4 h-4 text-indigo-600" /> Firma Mesai Saatleri</h4><span className="text-[11px] text-slate-500">Bitişten sonraki çıkış ve tatil günü çalışması otomatik fazla mesai</span></div>
      <ScheduleFields s={s} set={set} labels={d.day_labels} />
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!s.count_early_as_overtime} onChange={(e) => set("count_early_as_overtime", e.target.checked)} data-testid="ws-early-ot" /> Erken gelişi de mesai say</label>
        <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={s.require_geo !== false} onChange={(e) => set("require_geo", e.target.checked)} data-testid="ws-require-geo" /> Firma konumu tanımlıysa giriş/çıkış için konum zorunlu</label>
        <button type="submit" disabled={busy} className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-xl font-semibold disabled:opacity-50" data-testid="ws-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button>
      </div>
    </form>
  );
};

export const EmployeeScheduleModal = ({ employee, companySchedule, labels, onClose, onSaved }) => {
  const [s, setS] = useState({ start: "", end: "", break_minutes: null, late_tolerance_minutes: null, overtime_tolerance_minutes: null, work_days: [], ...(employee.work_schedule || {}) });
  const set = (k, v) => setS({ ...s, [k]: v });
  const save = async (mode) => {
    try {
      const payload = mode === "clear" ? null : Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)));
      await axios.put(`${API_URL}/personnel/employees/${employee.employee_id}`, { work_schedule: payload });
      toast.success(mode === "clear" ? "Personel firma saatlerine döndü." : `${employee.employee_name} için özel mesai saatleri kaydedildi.`); onSaved?.(); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="employee-schedule-modal">
        <div className="flex items-center justify-between border-b pb-2"><h3 className="text-sm font-bold">{employee.employee_name} — Özel Mesai Saatleri</h3><button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button></div>
        <p className="text-[11px] text-slate-500">Boş bırakılan alanlar firma ayarından alınır (firma: {companySchedule.start}–{companySchedule.end}, mola {companySchedule.break_minutes} dk).</p>
        <ScheduleFields s={s} set={set} labels={labels} allowEmpty />
        <div className="flex justify-between pt-2 border-t text-xs"><button onClick={() => save("clear")} className="px-3 py-1.5 border rounded-lg text-slate-600" data-testid="emp-ws-clear">Firma saatlerine dön</button><button onClick={() => save("save")} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="emp-ws-save">Kaydet</button></div>
      </div>
    </div>
  );
};
