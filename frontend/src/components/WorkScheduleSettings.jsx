
import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Timer, Save, Loader2, X, RotateCcw, Bell, Banknote } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { isDailyWage, monthlyLoad } from "../utils/personnelWage";

const inp = "bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs";
export const DAY_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const eff = (s, d, k) => (s.days?.[d]?.[k] ?? s[k]) ?? "";

/* Gün gün mesai tablosu: satır işaretli ise çalışma günü; saat/mola gün bazında farklılaştırılabilir */
export const DaySchedule = ({ s, onChange, fallback }) => {
  const base = { ...(fallback || {}), ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length))) };
  const workDays = s.work_days?.length ? s.work_days : (fallback?.work_days || []);
  const setDay = (d, k, v) => { const days = { ...(s.days || {}) }; days[d] = { ...(days[d] || {}), [k]: v === "" ? undefined : v }; if (!Object.values(days[d]).some((x) => x !== undefined)) delete days[d]; onChange({ ...s, days }); };
  const toggle = (d) => onChange({ ...s, work_days: workDays.includes(d) ? workDays.filter((x) => x !== d) : [...workDays, d].sort() });
  const reset = (d) => { const days = { ...(s.days || {}) }; delete days[d]; onChange({ ...s, days }); };
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden" data-testid="day-schedule">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 font-semibold"><tr><th className="px-3 py-1.5 text-left">Gün</th><th className="px-3 py-1.5 text-left">Başlangıç</th><th className="px-3 py-1.5 text-left">Bitiş</th><th className="px-3 py-1.5 text-left">Mola (dk)</th><th className="px-3 py-1.5"></th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {DAY_LABELS.map((l, d) => { const on = workDays.includes(d); const custom = !!s.days?.[String(d)]; return (
            <tr key={l} className={on ? "" : "bg-slate-50/60 text-slate-400"} data-testid={`ds-row-${d}`}>
              <td className="px-3 py-1"><label className="flex items-center gap-2 cursor-pointer font-semibold"><input type="checkbox" checked={on} onChange={() => toggle(d)} data-testid={`ws-day-${d}`} /> {l}{custom && <span className="text-[9px] text-indigo-600 font-bold">özel</span>}</label></td>
              <td className="px-3 py-1"><input type="time" disabled={!on} value={eff({ ...base, days: s.days }, String(d), "start")} onChange={(e) => setDay(String(d), "start", e.target.value)} className={inp} data-testid={`ds-start-${d}`} /></td>
              <td className="px-3 py-1"><input type="time" disabled={!on} value={eff({ ...base, days: s.days }, String(d), "end")} onChange={(e) => setDay(String(d), "end", e.target.value)} className={inp} data-testid={`ds-end-${d}`} /></td>
              <td className="px-3 py-1"><input type="number" min="0" disabled={!on} value={eff({ ...base, days: s.days }, String(d), "break_minutes")} onChange={(e) => setDay(String(d), "break_minutes", e.target.value === "" ? "" : Number(e.target.value))} className={`${inp} w-20`} data-testid={`ds-break-${d}`} /></td>
              <td className="px-3 py-1 text-right">{custom && <button type="button" onClick={() => reset(String(d))} title="Varsayılana dön" className="text-slate-400 hover:text-slate-700" data-testid={`ds-reset-${d}`}><RotateCcw className="w-3.5 h-3.5" /></button>}</td>
            </tr>); })}
        </tbody>
      </table>
    </div>
  );
};

export const ScheduleFields = ({ s, set, allowEmpty }) => (
  <div className="flex flex-wrap items-end gap-3 text-xs">
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Varsayılan başlangıç</label><input type="time" value={s.start || ""} onChange={(e) => set("start", e.target.value)} className={inp} data-testid="ws-start" /></div>
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Varsayılan bitiş</label><input type="time" value={s.end || ""} onChange={(e) => set("end", e.target.value)} className={inp} data-testid="ws-end" /></div>
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Mola (dk)</label><input type="number" min="0" value={s.break_minutes ?? ""} onChange={(e) => set("break_minutes", e.target.value === "" ? (allowEmpty ? null : 0) : Number(e.target.value))} className={`${inp} w-20`} data-testid="ws-break" /></div>
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Geç tolerans (dk)</label><input type="number" min="0" value={s.late_tolerance_minutes ?? ""} onChange={(e) => set("late_tolerance_minutes", e.target.value === "" ? (allowEmpty ? null : 0) : Number(e.target.value))} className={`${inp} w-20`} data-testid="ws-late-tol" /></div>
    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Mesai tolerans (dk)</label><input type="number" min="0" value={s.overtime_tolerance_minutes ?? ""} onChange={(e) => set("overtime_tolerance_minutes", e.target.value === "" ? (allowEmpty ? null : 0) : Number(e.target.value))} className={`${inp} w-20`} data-testid="ws-ot-tol" /></div>
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
    try { const r = await axios.put(`${API_URL}/companies/${companyId}/work-schedule`, s); setD({ ...d, schedule: r.data.schedule }); toast.success("Mesai ayarları kaydedildi. Yeni giriş/çıkışlar bu saatlere göre hesaplanır."); onSaved?.(); }
    catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="work-schedule-settings">
      <div className="flex items-center justify-between"><h4 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Timer className="w-4 h-4 text-indigo-600" /> Firma Mesai Saatleri</h4><span className="text-[11px] text-slate-500">Bitişten sonraki çıkış ve tatil günü çalışması otomatik fazla mesai</span></div>
      <ScheduleFields s={s} set={set} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <DaySchedule s={s} onChange={(ns) => setD({ ...d, schedule: ns })} />
        <div className="space-y-3">
          <div className="border border-slate-200 rounded-xl p-3 space-y-2" data-testid="overtime-settings">
            <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Banknote className="w-3.5 h-3.5 text-emerald-600" /> Fazla Mesai Ücreti (firma varsayılanı)</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <select value={s.overtime_method} onChange={(e) => set("overtime_method", e.target.value)} className={inp} data-testid="ws-ot-method">{Object.entries(d.overtime_methods || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <label className="flex items-center gap-1">Katsayı <input type="number" step="0.1" min="0.1" value={s.overtime_multiplier} onChange={(e) => set("overtime_multiplier", Number(e.target.value))} className={`${inp} w-16`} data-testid="ws-ot-mult" /></label>
              <label className="flex items-center gap-1">Tatil katsayısı <input type="number" step="0.1" min="0.1" value={s.holiday_multiplier} onChange={(e) => set("holiday_multiplier", Number(e.target.value))} className={`${inp} w-16`} data-testid="ws-hol-mult" /></label>
              <label className="flex items-center gap-1">Aylık saat <input type="number" min="1" value={s.monthly_hours_divisor} onChange={(e) => set("monthly_hours_divisor", Number(e.target.value))} className={`${inp} w-16`} data-testid="ws-divisor" /></label>
            </div>
            <p className="text-[10px] text-slate-500">Yasal: saatlik = bordro brüt maaşı / {s.monthly_hours_divisor}; hafta içi × {s.overtime_multiplier}, tatil günü × {s.holiday_multiplier}. Sabit yöntemde personel kartındaki saatlik ücret kullanılır. Personel kartından kişiye özel yöntem seçilebilir.</p>
          </div>
          <div className="border border-slate-200 rounded-xl p-3 space-y-1.5 text-xs" data-testid="notify-settings">
            <div className="font-bold text-slate-800 flex items-center gap-1.5"><Bell className="w-3.5 h-3.5 text-amber-500" /> Yönetici Bildirimleri</div>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={s.notify_missing_checkin !== false} onChange={(e) => set("notify_missing_checkin", e.target.checked)} data-testid="ws-notify-missing" /> Mesai başlangıcı + tolerans geçince giriş yapmayanları bildir (günde 1 kez)</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={s.notify_late_checkin !== false} onChange={(e) => set("notify_late_checkin", e.target.checked)} data-testid="ws-notify-late" /> Geç giriş yapan personeli anında bildir</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!s.count_early_as_overtime} onChange={(e) => set("count_early_as_overtime", e.target.checked)} data-testid="ws-early-ot" /> Erken gelişi de mesai say</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={s.require_geo !== false} onChange={(e) => set("require_geo", e.target.checked)} data-testid="ws-require-geo" /> Firma konumu tanımlıysa giriş için konum zorunlu (çıkış her yerden). Açık proje görevi varsa görev yeri iş yeri sayılır.</label>
            <p className="text-[10px] text-slate-500">Bildirimler uygulama içi zile düşer; İletişim Merkezi'nde SMTP hesabı tanımlıysa yöneticilere e-posta da gider.</p>
          </div>
        </div>
      </div>
      <div className="flex justify-end"><button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-xl font-semibold text-xs disabled:opacity-50" data-testid="ws-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button></div>
    </form>
  );
};

/* Personel: ücretler + kişiye özel mesai (Personel Kartı ve Puantaj'dan ortak kullanılır) */
export const EmployeeCompensationForm = ({ employee, companySchedule, onSaved, onClose }) => {
  const ws = employee.work_schedule || {};
  const [pay, setPay] = useState({ payroll_salary: employee.payroll_salary ?? "", salary: employee.salary ?? "", pay_type: isDailyWage(employee) ? "daily" : "monthly", daily_wage: employee.daily_wage ?? "", second_salary: employee.second_salary ?? 0, overtime_method: employee.overtime_method || "", overtime_hourly_rate: employee.overtime_hourly_rate ?? "", meal_allowance: employee.meal_allowance ?? 0, transport_allowance: employee.transport_allowance ?? 0 });
  const [s, setS] = useState({ start: ws.start || "", end: ws.end || "", break_minutes: ws.break_minutes ?? null, late_tolerance_minutes: ws.late_tolerance_minutes ?? null, overtime_tolerance_minutes: ws.overtime_tolerance_minutes ?? null, work_days: ws.work_days || [], days: ws.days || {} });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setS({ ...s, [k]: v });
  const grossForRate = Number(pay.payroll_salary) || Number(pay.salary) * 1.4 || 0;
  const legalRate = companySchedule ? (grossForRate / (companySchedule.monthly_hours_divisor || 225)) * (companySchedule.overtime_multiplier || 1.5) : 0;
  const save = async (mode) => {
    setBusy(true);
    try {
      const schedule = Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length) && !(k === "days" && !Object.keys(v || {}).length)));
      const daily = pay.pay_type === "daily";
      const dailyWage = daily ? Number(pay.daily_wage) || 0 : 0;
      const body = { payroll_salary: pay.payroll_salary === "" ? null : Number(pay.payroll_salary), pay_type: daily ? "daily" : "monthly", daily_wage: dailyWage, salary: daily ? monthlyLoad({ pay_type: "daily", daily_wage: dailyWage }) : Number(pay.salary) || 0, second_salary: Number(pay.second_salary) || 0, meal_allowance: Number(pay.meal_allowance) || 0, transport_allowance: Number(pay.transport_allowance) || 0, overtime_method: pay.overtime_method || null, overtime_hourly_rate: pay.overtime_hourly_rate === "" ? null : Number(pay.overtime_hourly_rate), work_schedule: mode === "clear" || !Object.keys(schedule).length ? null : schedule };
      await axios.put(`${API_URL}/personnel/employees/${employee.id || employee._id || employee.employee_id}`, body);
      toast.success(mode === "clear" ? "Personel firma mesai saatlerine döndü." : "Ücret ve mesai bilgileri kaydedildi."); onSaved?.(); onClose?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 text-xs" data-testid="employee-compensation-form">
      <div className="border border-slate-200 rounded-xl p-3 space-y-2">
        <div className="font-bold text-slate-800 flex items-center gap-1.5"><Banknote className="w-3.5 h-3.5 text-emerald-600" /> Ücretler</div>
        <div className="flex gap-1" data-testid="emp-pay-type">
          <button type="button" onClick={() => setPay({ ...pay, pay_type: "monthly" })} className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border ${pay.pay_type === "daily" ? "bg-white text-slate-600 border-slate-200" : "bg-emerald-600 text-white border-emerald-600"}`} data-testid="emp-pay-monthly">Aylık maaş</button>
          <button type="button" onClick={() => setPay({ ...pay, pay_type: "daily" })} className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border ${pay.pay_type === "daily" ? "bg-amber-500 text-white border-amber-500" : "bg-white text-slate-600 border-slate-200"}`} data-testid="emp-pay-daily">Günlük yevmiye</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Bordro maaşı (brüt, resmi)</label><input type="number" min="0" value={pay.payroll_salary} onChange={(e) => setPay({ ...pay, payroll_salary: e.target.value })} placeholder={`boş = net × 1,4`} className={`${inp} w-full`} data-testid="emp-payroll-salary" /></div>
          {pay.pay_type === "daily" ? (
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Günlük yevmiye (₺)</label>
              <input type="number" min="0" value={pay.daily_wage} onChange={(e) => setPay({ ...pay, daily_wage: e.target.value })} className={`${inp} w-full`} data-testid="emp-daily-wage" placeholder="Örn: 1500" />
              <p className="text-[10px] text-slate-400 mt-0.5">Bordro = yevmiye × gelen gün. Tahmini ay: {monthlyLoad({ pay_type: "daily", daily_wage: pay.daily_wage }).toLocaleString("tr-TR")} ₺ (26 gün).</p>
            </div>
          ) : (
            <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Net maaş (ele geçen)</label><input type="number" min="0" value={pay.salary} onChange={(e) => setPay({ ...pay, salary: e.target.value })} className={`${inp} w-full`} data-testid="emp-net-salary" /></div>
          )}
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">2. maaş (aylık, gayri resmi)</label><input type="number" min="0" value={pay.second_salary} onChange={(e) => setPay({ ...pay, second_salary: e.target.value })} className={`${inp} w-full`} data-testid="emp-second-salary" /></div>
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Yemek (aylık, ₺)</label><input type="number" min="0" value={pay.meal_allowance} onChange={(e) => setPay({ ...pay, meal_allowance: e.target.value })} className={`${inp} w-full`} data-testid="emp-meal-allowance" /></div>
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Yol / ulaşım (aylık, ₺)</label><input type="number" min="0" value={pay.transport_allowance} onChange={(e) => setPay({ ...pay, transport_allowance: e.target.value })} className={`${inp} w-full`} data-testid="emp-transport-allowance" /></div>
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Fazla mesai yöntemi</label><select value={pay.overtime_method} onChange={(e) => setPay({ ...pay, overtime_method: e.target.value })} className={`${inp} w-full`} data-testid="emp-ot-method"><option value="">{`Firma varsayılanı (${companySchedule?.overtime_method === "fixed" ? "sabit" : "yasal"})`}</option><option value="legal">Yasal (brüt/225 × katsayı)</option><option value="fixed">Sabit saatlik ücret</option></select></div>
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Sabit saatlik mesai ücreti (₺)</label><input type="number" min="0" value={pay.overtime_hourly_rate} onChange={(e) => setPay({ ...pay, overtime_hourly_rate: e.target.value })} className={`${inp} w-full`} data-testid="emp-ot-rate" /></div>
          <div className="text-[10px] text-slate-500 self-end pb-1">Yasal saatlik mesai: <b className="text-slate-800">{legalRate.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ₺</b> (brüt {grossForRate.toLocaleString("tr-TR")} / {companySchedule?.monthly_hours_divisor || 225} × {companySchedule?.overtime_multiplier || 1.5})</div>
        </div>
        <p className="text-[10px] text-slate-500">{pay.pay_type === "daily" || isDailyWage(employee) ? "Yevmiyeli bordro: gelen gün × günlük ücret + mesai + 2. maaş + prim − kesinti − avans." : "Bordro: net + mesai + 2. maaş + prim − kesinti − avans."} Yemek ve yol karttan belirlenir; ödenmemiş tutar kalan alacağa eklenir, masraf kaydında önerilir.</p>
      </div>
      <div className="border border-slate-200 rounded-xl p-3 space-y-2">
        <div className="font-bold text-slate-800 flex items-center gap-1.5"><Timer className="w-3.5 h-3.5 text-indigo-600" /> Kişiye Özel Mesai Saatleri <span className="font-normal text-slate-400">— boş bırakılan alanlar firma ayarından alınır ({companySchedule?.start}–{companySchedule?.end})</span></div>
        <ScheduleFields s={s} set={set} allowEmpty />
        <DaySchedule s={s} onChange={setS} fallback={companySchedule} />
      </div>
      <div className="flex justify-between pt-1"><button type="button" onClick={() => save("clear")} disabled={busy} className="px-3 py-1.5 border rounded-lg text-slate-600" data-testid="emp-ws-clear">Firma saatlerine dön</button><button type="button" onClick={() => save("save")} disabled={busy} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold flex items-center gap-1" data-testid="emp-ws-save">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Kaydet</button></div>
    </div>
  );
};

export const EmployeeScheduleModal = ({ employee, companySchedule, onClose, onSaved }) => {
  const [emp, setEmp] = useState(null);
  const id = employee.employee_id || employee.id || employee._id;
  useEffect(() => { axios.get(`${API_URL}/personnel/employees/${id}/card`).then((r) => setEmp(r.data.employee)).catch(() => toast.error("Personel yüklenemedi.")); }, [id]);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-5 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="employee-schedule-modal">
        <div className="flex items-center justify-between border-b pb-2"><h3 className="text-sm font-bold">{employee.employee_name || employee.full_name} — Ücret & Mesai</h3><button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button></div>
        {emp ? <EmployeeCompensationForm employee={emp} companySchedule={companySchedule} onSaved={onSaved} onClose={onClose} /> : <div className="text-xs text-slate-400">Yükleniyor…</div>}
      </div>
    </div>
  );
};
