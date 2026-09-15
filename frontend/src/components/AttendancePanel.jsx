
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Clock, LogIn, LogOut, CalendarX2, Timer, CheckCircle2, MessageSquareWarning, DoorOpen } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { WorkScheduleSettings, EmployeeScheduleModal } from "./WorkScheduleSettings";
import { ShiftPlanner } from "./ShiftPlanner";

export const AttendancePanel = ({ companyId }) => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [schedEmp, setSchedEmp] = useState(null);
  const [otAssign, setOtAssign] = useState(null); // { employee_id, employee_name, hours, date, note }
  const load = useCallback(async () => { try { const r = await axios.get(`${API_URL}/personnel/attendance?company_id=${companyId}&month=${month}`); setData(r.data); } catch { toast.error("Puantaj yüklenemedi."); } }, [companyId, month]);
  useEffect(() => { load(); }, [load]);
  const act = async (employee_id, body) => { try { const r = await axios.post(`${API_URL}/personnel/attendance`, { employee_id, ...body }); if (r.data.overtime_hours) toast.info(`${r.data.overtime_hours} sa fazla mesai otomatik yazıldı.`); load(); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } };
  const openOt = (s) => setOtAssign({ employee_id: s.employee_id, employee_name: s.employee_name, hours: s.today?.assigned_overtime_hours || "", date: new Date().toISOString().slice(0, 10), note: "" });
  const saveOt = async () => {
    if (!otAssign) return;
    try {
      const r = await axios.put(`${API_URL}/personnel/attendance/assign-overtime`, {
        employee_id: otAssign.employee_id,
        date: otAssign.date,
        hours: Number(otAssign.hours) || 0,
        note: otAssign.note || "",
      });
      toast.success(r.data.message || "Fazla mesai atandı.");
      setOtAssign(null);
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Atama kaydedilemedi."); }
  };
  const decideEarly = async (id, decision) => {
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/early-leave-decision`, { decision }, { withCredentials: true });
      toast.success(r.data.message || (decision === "approve" ? "Onaylandı" : "Reddedildi"));
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Karar kaydedilemedi."); }
  };

  if (!data) return null;
  return (
    <div className="space-y-4 text-xs" data-testid="attendance-panel">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-600" /> Puantaj — Giriş / Çıkış & Mesai</h3><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-slate-50 border rounded-lg p-1.5" data-testid="attendance-month-input" /></div>
      <WorkScheduleSettings companyId={companyId} onSaved={load} />
      <ShiftPlanner companyId={companyId} onChanged={load} />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold"><tr><th className="px-4 py-2">Çalışan</th><th className="px-4 py-2">Mesai</th><th className="px-4 py-2">Bugün</th><th className="px-4 py-2 text-right">Gün</th><th className="px-4 py-2 text-right">Devamsız</th><th className="px-4 py-2 text-right">İzin</th><th className="px-4 py-2 text-right">Saat</th><th className="px-4 py-2 text-right">F. Mesai</th><th className="px-4 py-2 text-right">Mesai ₺</th><th className="px-4 py-2 text-right">Geç</th><th className="px-4 py-2 text-right">Onaysız</th><th className="px-4 py-2"></th></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.summary.map((s) => (
          <tr key={s.employee_id} data-testid={`att-row-${s.employee_id}`}>
            <td className="px-4 py-2 font-semibold text-slate-900">{s.employee_name}</td>
            <td className="px-4 py-2"><button onClick={() => setSchedEmp(s)} className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-md border hover:bg-slate-50 ${s.has_override ? "border-indigo-300 text-indigo-700 bg-indigo-50" : "text-slate-500"}`} title="Personele özel mesai saatleri" data-testid={`att-sched-${s.employee_id}`}><Timer className="w-3 h-3" /> {s.schedule.start}–{s.schedule.end}{s.has_override ? " ★" : ""}</button></td>
            <td className="px-4 py-2 font-mono text-slate-600">{s.today ? `${s.today.check_in || "--:--"} → ${s.today.check_out || "--:--"}${s.today.status !== "present" ? ` (${s.today.status === "absent" ? "Devamsız" : "İzinli"})` : ""}` : "—"}{s.today?.late_minutes ? <span className="ml-1 text-[9px] font-bold text-rose-600">{s.today.late_minutes} dk geç</span> : null}{s.today?.assigned_overtime_hours ? <span className="ml-1 text-[9px] font-bold text-indigo-600" title={`Beklenen çıkış ${s.today.expected_end || ""}`}>+{s.today.assigned_overtime_hours} sa atanan</span> : null}</td>
            <td className="px-4 py-2 text-right font-bold text-emerald-700">{s.days_present}</td><td className="px-4 py-2 text-right text-rose-600">{s.days_absent}</td><td className="px-4 py-2 text-right text-amber-600">{s.days_leave}</td>
            <td className="px-4 py-2 text-right font-bold">{s.total_hours}</td><td className="px-4 py-2 text-right font-bold text-indigo-700">{s.overtime_hours}</td>
            <td className="px-4 py-2 text-right font-bold text-emerald-700" title={`${s.overtime_method === "fixed" ? "Sabit" : "Yasal"} · saatlik ${s.overtime_rate} ₺`} data-testid={`att-otpay-${s.employee_id}`}>{(s.overtime_pay || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</td>
            <td className={`px-4 py-2 text-right font-semibold ${s.late_count ? "text-rose-600" : "text-slate-400"}`} title={`${s.late_minutes} dk`}>{s.late_count}</td>
            <td className={`px-4 py-2 text-right font-semibold ${s.unconfirmed ? "text-amber-600" : "text-slate-400"}`}>{s.unconfirmed}</td>
            <td className="px-4 py-2"><div className="flex justify-end gap-1">
              <button onClick={() => act(s.employee_id, { action: "check_in" })} className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg font-semibold hover:bg-emerald-100" data-testid={`att-in-${s.employee_id}`}><LogIn className="w-3 h-3" /> Giriş</button>
              <button onClick={() => act(s.employee_id, { action: "check_out" })} className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-700 rounded-lg font-semibold hover:bg-slate-200" data-testid={`att-out-${s.employee_id}`}><LogOut className="w-3 h-3" /> Çıkış</button>
              <button onClick={() => act(s.employee_id, { status: "absent" })} className="flex items-center gap-1 px-2 py-1 bg-rose-50 text-rose-700 rounded-lg font-semibold hover:bg-rose-100" data-testid={`att-absent-${s.employee_id}`}><CalendarX2 className="w-3 h-3" /> Devamsız</button>
              <button onClick={() => openOt(s)} className="flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 rounded-lg font-semibold hover:bg-indigo-100" data-testid={`att-ot-${s.employee_id}`}><Timer className="w-3 h-3" /> F. Mesai</button>
            </div></td>
          </tr>))}</tbody></table></div></div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden"><div className="px-4 py-2.5 border-b font-bold text-slate-900 flex items-center justify-between"><span>Günlük Kayıtlar ({data.records.length})</span><span className="text-[10px] text-slate-400 font-normal">Personel kendi kaydını Personel Giriş Çıkış Kayıtları ekranından onaylar veya itiraz eder</span></div><div className="max-h-72 overflow-y-auto divide-y divide-slate-100">{data.records.map((r) => (
        <div key={r.id} className={`px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${r.is_off_day ? "bg-amber-50/40" : ""}`} data-testid={`att-rec-${r.id}`}>
          <span><b>{r.employee_name}</b> <span className="text-slate-400 font-mono">{r.date}</span></span>
          <span className="font-mono">{r.status === "present" ? `${r.check_in || "--:--"} → ${r.check_out || "--:--"} • ${r.hours || 0} sa` : r.status === "absent" ? "Devamsız" : "İzinli"}</span>
          {r.assigned_overtime_hours > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">atanan +{r.assigned_overtime_hours} sa</span>}{r.overtime_hours > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">+{r.overtime_hours} sa mesai{r.is_off_day ? " (tatil)" : ""}</span>}
          {r.late_minutes > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">{r.late_minutes} dk geç</span>}
          {r.early_leave_minutes > 0 && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${r.early_leave_approved || r.early_leave_request?.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{r.early_leave_minutes} dk erken{r.early_leave_approved || r.early_leave_request?.status === "approved" ? " (onaylı)" : ""}</span>}
          {r.early_leave_request?.status === "pending" && (
            <span className="inline-flex items-center gap-1.5 text-[10px]" data-testid={`att-early-pending-${r.id}`}>
              <DoorOpen className="w-3 h-3 text-amber-600" />
              <span className="font-semibold text-amber-700">Erken çıkış talebi{r.early_leave_request.planned_time ? ` · ${r.early_leave_request.planned_time}` : ""}</span>
              <span className="text-slate-500 max-w-[180px] truncate" title={r.early_leave_request.reason}>{r.early_leave_request.reason}</span>
              <button type="button" onClick={() => decideEarly(r.id, "approve")} className="px-1.5 py-0.5 rounded bg-emerald-600 text-white font-bold" data-testid={`att-early-approve-${r.id}`}>Onayla</button>
              <button type="button" onClick={() => decideEarly(r.id, "reject")} className="px-1.5 py-0.5 rounded bg-rose-600 text-white font-bold" data-testid={`att-early-reject-${r.id}`}>Reddet</button>
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-[10px]">{r.source === "self" && <span className="text-slate-400">telefon/self</span>}{r.dispute_note ? <span className="inline-flex items-center gap-1 text-rose-600 font-semibold" title={r.dispute_note}><MessageSquareWarning className="w-3 h-3" /> İtiraz: {r.dispute_note}</span> : r.employee_confirmed ? <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-3 h-3" /> Personel onayladı</span> : <span className="text-amber-600 font-semibold">Onay bekliyor</span>}</span>
        </div>))}{data.records.length === 0 && <div className="p-6 text-center text-slate-400">Bu ay kayıt yok.</div>}</div></div>
      
      {otAssign && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-testid="att-ot-modal" onClick={() => setOtAssign(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-slate-900">Fazla Mesai Ata — {otAssign.employee_name}</h4>
            <p className="text-[11px] text-slate-500">Atanan süre, beklenen çıkışı (mesai bitişi + fazla mesai) uzatır. Personel çıkışı her konumdan yapabilir; kayıt bu saate göre işlenir.</p>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Tarih</label><input type="date" value={otAssign.date} onChange={(e) => setOtAssign({ ...otAssign, date: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="att-ot-date" /></div>
              <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Saat</label><input type="number" min="0" step="0.5" value={otAssign.hours} onChange={(e) => setOtAssign({ ...otAssign, hours: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" placeholder="örn. 2" data-testid="att-ot-hours" /></div>
            </div>
            <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Not (opsiyonel)</label><input value={otAssign.note} onChange={(e) => setOtAssign({ ...otAssign, note: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="att-ot-note" /></div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOtAssign(null)} className="px-3 py-1.5 rounded-lg border font-semibold" data-testid="att-ot-cancel">Vazgeç</button>
              <button onClick={saveOt} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700" data-testid="att-ot-save">Kaydet</button>
            </div>
          </div>
        </div>
      )}
      {schedEmp && <EmployeeScheduleModal employee={schedEmp} companySchedule={data.schedule} onClose={() => setSchedEmp(null)} onSaved={load} />}
    </div>
  );
};
