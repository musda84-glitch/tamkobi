
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Clock, LogIn, LogOut, Loader2, MapPin, CheckCircle2, AlertTriangle, Timer, Moon, ShieldCheck, MessageSquareWarning, DoorOpen, ArrowLeftRight } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { getPos } from "../components/GeoAttendanceCard";
import { MyLeavePanel } from "../components/MyLeavePanel";
import { ATTENDANCE_DAY_WATCH_MS, CHECKOUT_UNLOCK_WATCH_MS, attendanceCalendarMonth, checkInAlreadyDone, checkInOnceHint, geoConfirmHint, habitLabel, managerTimeEditHint, mesaimDateHolidaySuffix, mesaimEarlyArrivalLine, mesaimInSubtitle, mesaimLongDate, mesaimOutInfoLines, mesaimScheduleLine, mesaimShowsDayLeaveInsteadOfIntraday, resolveMesaimTodayHours, resolveNowHm, selfAttendanceGeoMode, shouldReloadAttendanceDay, shouldWatchCheckoutUnlock } from "../utils/attendanceSelf";
import { intradayLeaveMinutes, intradayLeavePayload, validateIntradayLeave } from "../utils/intradayLeave";
import { mesaimGeoHeaderLine, workplaceHasCoords } from "../utils/workplace";
import { yevmiyeStatusLine } from "../utils/personnelWage";
import { fmtDmy } from "../utils/dateFormat";
import { LocationConsentCard } from "../components/LocationConsentCard";
import { LocationSignal } from "../components/LocationSignal";
import { locationConsentAccepted, locationUnavailablePayload } from "../utils/locationConsent";
import { useMesaimGate } from "../context/MesaimGateContext";

const DAY_LEAVE_TYPES = { annual: "Yıllık İzin", sick: "Hastalık", unpaid: "Ücretsiz", other: "Diğer" };
const dayLeaveDays = (start, end) => {
  if (!start || !end) return 0;
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
};

const Stat = ({ label, value, sub, tone = "slate", testId }) => (
  <div className={`rounded-2xl border p-4 bg-white ${tone === "indigo" ? "border-indigo-200" : tone === "rose" ? "border-rose-200" : "border-slate-200"}`} data-testid={testId}>
    <div className="text-[10px] uppercase font-semibold text-slate-400">{label}</div>
    <div className={`text-xl font-bold tracking-tight ${tone === "indigo" ? "text-indigo-700" : tone === "rose" ? "text-rose-600" : "text-slate-900"}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
  </div>
);

const RecordRow = ({ r, onConfirm, onRejectTimeEdit, onDispute }) => {
  const [note, setNote] = useState("");
  const [fixIn, setFixIn] = useState(r.check_in || "");
  const [fixOut, setFixOut] = useState(r.check_out || "");
  const [open, setOpen] = useState(false);
  const d = new Date(r.date + "T00:00:00");
  return (
    <div className={`px-4 py-2.5 text-xs ${r.is_off_day ? "bg-amber-50/40" : ""}`} data-testid={`my-att-${r.id}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-slate-700 w-28">{fmtDmy(r.date)} <span className="text-slate-400">{d.toLocaleDateString("tr-TR", { weekday: "short" })}</span></span>
        {r.status === "present" ? <span className="font-mono">{r.check_in || "--:--"} → {r.check_out || "--:--"}</span> : <span className={`font-semibold ${r.status === "absent" ? "text-rose-600" : "text-amber-600"}`}>{r.status === "absent" ? "Devamsız" : "İzinli"}</span>}
        {r.status === "present" && <span className="text-slate-500">{r.hours || 0} sa</span>}
        {r.overtime_hours > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">+{r.overtime_hours} sa mesai{r.is_off_day ? " (tatil günü)" : ""}</span>}
        {r.late_minutes > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">{r.late_minutes} dk geç</span>}
        {r.early_leave_minutes > 0 && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${r.early_leave_approved || r.early_leave_request?.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{r.early_leave_minutes} dk erken çıkış{r.early_leave_approved || r.early_leave_request?.status === "approved" ? " (onaylı)" : ""}</span>}{r.early_leave_request?.status === "pending" && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">erken çıkış talebi</span>}
        {(r.intraday_leave_minutes > 0 || r.intraday_leave_request?.status === "approved" || r.intraday_leave_approved) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">{r.intraday_leave_minutes || 0} dk gün içi izin{(r.intraday_leave_request?.out_time && r.intraday_leave_request?.return_time) ? ` · ${r.intraday_leave_request.out_time}–${r.intraday_leave_request.return_time}` : ""}</span>}
        {r.intraday_leave_request?.status === "pending" && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">gün içi izin talebi</span>}
        {yevmiyeStatusLine(r) ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" data-testid={`my-att-yevmiye-${r.id}`}>{yevmiyeStatusLine(r)}</span> : null}
        <span className="ml-auto flex items-center gap-2">
          {r.manager_time_edit?.pending_employee ? <span className="text-[10px] font-bold text-amber-800" data-testid={`my-att-edit-${r.id}`}>{managerTimeEditHint(r.manager_time_edit)}</span> : null}
          {r.employee_confirmed ? <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Onaylandı</span>
            : <>
              {r.dispute_note && !r.dispute_resolved && <span className="inline-flex items-center gap-1 text-rose-600 font-semibold" title={r.dispute_note}><MessageSquareWarning className="w-3.5 h-3.5" /> Düzeltme talebi iletildi</span>}
              {r.dispute_note && r.dispute_resolved && <span className="inline-flex items-center gap-1 text-slate-500 font-semibold" title={r.dispute_note}><MessageSquareWarning className="w-3.5 h-3.5" /> Düzeltme kapatıldı{r.dispute_resolution === "rejected" ? " (red)" : ""}</span>}
              <button onClick={() => onConfirm(r)} className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700" data-testid={`my-att-confirm-${r.id}`}>{r.dispute_note && !r.dispute_resolved ? "Yine de Onayla" : "Onayla"}</button>
              {r.manager_time_edit?.pending_employee ? <button onClick={() => onRejectTimeEdit(r)} className="px-2.5 py-1 bg-rose-600 text-white rounded-lg font-semibold hover:bg-rose-700" data-testid={`my-att-reject-${r.id}`}>Reddet</button> : null}
              {(!r.dispute_note || r.dispute_resolved) && <button onClick={() => setOpen(!open)} className="px-2.5 py-1 border rounded-lg font-semibold hover:bg-slate-50" data-testid={`my-att-dispute-toggle-${r.id}`}>Düzeltme talep et</button>}
            </>}
        </span>
      </div>
      {open && <form onSubmit={(e) => { e.preventDefault(); const bits = [fixIn && `giriş ${fixIn} olmalı`, fixOut && `çıkış ${fixOut} olmalı`, note.trim()].filter(Boolean); if (!bits.length) return; onDispute(r, bits.join(" · ")); setOpen(false); }} className="mt-2 flex flex-wrap items-end gap-2"><label className="text-[10px] font-bold text-slate-500">Doğru giriş<input type="time" value={fixIn} onChange={(e) => setFixIn(e.target.value)} className="block border rounded-lg p-1.5 bg-slate-50" data-testid={`my-att-dispute-in-${r.id}`} /></label><label className="text-[10px] font-bold text-slate-500">Doğru çıkış<input type="time" value={fixOut} onChange={(e) => setFixOut(e.target.value)} className="block border rounded-lg p-1.5 bg-slate-50" data-testid={`my-att-dispute-note-${r.id}`} /></label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opsiyonel açıklama" className="flex-1 min-w-[140px] border rounded-lg p-1.5 bg-slate-50" data-testid={`my-att-dispute-extra-${r.id}`} /><button className="px-3 py-1.5 bg-rose-600 text-white rounded-lg font-semibold" data-testid={`my-att-dispute-send-${r.id}`}>Gönder</button></form>}
      {r.note && <div className="text-[10px] text-slate-400 mt-0.5">{r.note}</div>}
    </div>
  );
};

export default function MyAttendancePage() {
  const { user } = useAuth();
  const { refresh: refreshMesaimGate } = useMesaimGate();
  const [month, setMonth] = useState(() => attendanceCalendarMonth());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [earlyReason, setEarlyReason] = useState("");
  const [earlyTime, setEarlyTime] = useState("");
  const [intraOpen, setIntraOpen] = useState(false);
  const [intraReason, setIntraReason] = useState("");
  const [intraOut, setIntraOut] = useState("");
  const [intraReturn, setIntraReturn] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveType, setLeaveType] = useState("annual");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [consentBusy, setConsentBusy] = useState(false);
  const [signal, setSignal] = useState(null);
  const load = useCallback(() => axios.get(`${API_URL}/personnel/attendance/me?month=${month}`, { withCredentials: true }).then(async (r) => {
    setData(r.data);
    setSignal(r.data.location_signal || null);
    await refreshMesaimGate();
  }).catch(() => toast.error("Puantaj yüklenemedi.")), [month, refreshMesaimGate]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => {
      if (shouldReloadAttendanceDay(data?.today_date)) load();
    }, ATTENDANCE_DAY_WATCH_MS);
    return () => clearInterval(id);
  }, [data?.today_date, load]);

  const reportLocationUnavailable = useCallback(async (reason) => {
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/self/location-unavailable`, locationUnavailablePayload(reason || "Konum alınamadı"), { withCredentials: true });
      if (r.data.location_signal) setSignal(r.data.location_signal);
      if (r.data.message) toast.message(r.data.message);
    } catch {
      /* yönetici bildirimi gönderilemedi */
    }
  }, []);

  useEffect(() => {
    const t = data?.today;
    if (!shouldWatchCheckoutUnlock({
      earlyPending: t?.early_leave_request?.status === "pending",
      checkedIn: !!t?.check_in,
      checkedOut: !!t?.check_out,
      checkoutUnlocked: data?.checkout_unlocked,
    })) return undefined;
    const id = setInterval(() => { load(); }, CHECKOUT_UNLOCK_WATCH_MS);
    return () => clearInterval(id);
  }, [load, data?.today?.check_in, data?.today?.check_out, data?.today?.early_leave_request?.status, data?.checkout_unlocked]);
  const act = async (action, time) => {
    setBusy(action);
    try {
      let coords = {};
      const hasTarget = workplaceHasCoords(data?.workplace) || workplaceHasCoords(data?.location);
      const geoMode = selfAttendanceGeoMode(action, {
        hasTarget,
        requireGeo: data?.workplace?.kind === "task" || data?.schedule?.require_geo !== false,
      });
      if (geoMode === "required" || geoMode === "attach") {
        toast.message("Konum alınıyor…");
        try {
          const c = await getPos();
          coords = { latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy };
        } catch (geoErr) {
          await reportLocationUnavailable(geoErr?.message || (geoMode === "required" ? "Konum izni verilmedi." : "Konum alınamadı"));
          if (geoMode === "required") throw geoErr;
        }
      }
      const r = await axios.post(`${API_URL}/personnel/attendance/self`, { action, ...(time ? { time } : {}), ...coords }, { withCredentials: true });
      toast.success(r.data.message, { duration: 6000 });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || err.message || "İşlem başarısız."); } finally { setBusy(null); }
  };
  const checkedIn = checkInAlreadyDone(data?.today?.check_in);
  const checkInOnceMsg = checkInOnceHint(data?.today?.check_in);
  const onCheckInClick = () => {
    if (checkedIn) { toast.message(checkInOnceMsg); return; }
    act("check_in", resolveNowHm(data?.now));
  };
  const confirm = async (r) => { try { await axios.post(`${API_URL}/personnel/attendance/${r.id}/confirm`, {}, { withCredentials: true }); toast.success("Kayıt onaylandı."); load(); } catch (err) { toast.error(err.response?.data?.detail || "Onaylanamadı."); } };
  const rejectTimeEdit = async (r) => { try { const res = await axios.post(`${API_URL}/personnel/attendance/${r.id}/time-edit-decision`, { decision: "reject" }, { withCredentials: true }); toast.success(res.data?.message || "Saat düzeltmesi reddedildi."); load(); } catch (err) { toast.error(err.response?.data?.detail || "Reddedilemedi."); } };
  const dispute = async (r, note) => { try { await axios.post(`${API_URL}/personnel/attendance/${r.id}/dispute`, { note }, { withCredentials: true }); toast.success("Düzeltme talebi yöneticiye iletildi."); load(); } catch (err) { toast.error(err.response?.data?.detail || "Gönderilemedi."); } };
  const requestEarly = async (e) => {
    e.preventDefault();
    setBusy("early");
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/early-leave-request`, { reason: earlyReason, planned_time: earlyTime || undefined }, { withCredentials: true });
      toast.success(r.data.message || "Erken çıkış talebi gönderildi.");
      setEarlyOpen(false); setEarlyReason(""); setEarlyTime("");
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Talep gönderilemedi."); }
    finally { setBusy(null); }
  };
  const cancelEarly = async () => {
    setBusy("early-cancel");
    try {
      const r = await axios.delete(`${API_URL}/personnel/attendance/early-leave-request`, { withCredentials: true });
      toast.success(r.data.message || "Talep iptal edildi."); load();
    } catch (err) { toast.error(err.response?.data?.detail || "İptal edilemedi."); }
    finally { setBusy(null); }
  };
  const requestIntra = async (e) => {
    e.preventDefault();
    const errMsg = validateIntradayLeave(intraReason, intraOut, intraReturn);
    if (errMsg) { toast.error(errMsg); return; }
    setBusy("intra");
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/intraday-leave-request`, intradayLeavePayload(intraReason, intraOut, intraReturn), { withCredentials: true });
      toast.success(r.data.message || "Gün içi izin talebi gönderildi.");
      setIntraOpen(false); setIntraReason(""); setIntraOut(""); setIntraReturn("");
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Talep gönderilemedi."); }
    finally { setBusy(null); }
  };
  const cancelIntra = async () => {
    setBusy("intra-cancel");
    try {
      const r = await axios.delete(`${API_URL}/personnel/attendance/intraday-leave-request`, { withCredentials: true });
      toast.success(r.data.message || "Talep iptal edildi."); load();
    } catch (err) { toast.error(err.response?.data?.detail || "İptal edilemedi."); }
    finally { setBusy(null); }
  };
  const openDayLeave = () => {
    const today = String(data?.today_date || "").slice(0, 10);
    setLeaveStart((prev) => prev || today);
    setLeaveEnd((prev) => prev || today);
    setLeaveOpen(true);
  };
  const requestDayLeave = async (e) => {
    e.preventDefault();
    const start = leaveStart;
    const end = leaveEnd || leaveStart;
    const days = dayLeaveDays(start, end);
    if (!days) { toast.error("Geçerli başlangıç ve bitiş tarihi seçin."); return; }
    setBusy("leave");
    try {
      const r = await axios.post(`${API_URL}/personnel/leaves/self`, {
        type: leaveType,
        start_date: start,
        end_date: end,
        days,
        reason: leaveReason.trim().slice(0, 300),
      }, { withCredentials: true });
      toast.success(r.data?.message || "İzin talebi gönderildi.");
      setLeaveOpen(false);
      setLeaveReason("");
      setLeaveStart("");
      setLeaveEnd("");
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "İzin talebi gönderilemedi."); }
    finally { setBusy(null); }
  };
  const acceptConsent = async ({ accept_kvkk, accept_share }) => {
    setConsentBusy(true);
    try {
      const r = await axios.post(`${API_URL}/personnel/me/location-consent`, { accept_kvkk, accept_share }, { withCredentials: true });
      toast.success(r.data.message || "Sözleşmeler kabul edildi. Personel paneli kullanıma açıldı.");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Sözleşme kaydedilemedi.");
    } finally {
      setConsentBusy(false);
    }
  };

  if (!data) return <div className="p-8 text-sm text-slate-400">Yükleniyor…</div>;
  const s = data.summary, t = data.today, sch = data.schedule;
  const todayWin = data.today_window || {};
  const hours = resolveMesaimTodayHours({ todayWindow: todayWin, today: t, schedule: sch });
  const mesaiStart = hours.start;
  const mesaiEnd = hours.end;
  const mesaiBreak = hours.breakMinutes;
  const scheduleLine = mesaimScheduleLine(
    mesaiStart && mesaiEnd ? { start: mesaiStart, end: mesaiEnd, break_minutes: mesaiBreak ?? undefined } : sch,
    { label: "Bugün" },
  );
  const dateLine = mesaimLongDate(data.today_date);
  const holidaySuffix = mesaimDateHolidaySuffix({
    todayDate: data.today_date,
    isWorkDay: todayWin.is_work_day,
    workDays: sch?.work_days,
  });
  const earlyArrivalLine = mesaimEarlyArrivalLine({
    checkIn: t?.check_in,
    earlyMinutes: t?.early_arrival_minutes,
    mesaiStart,
  });
  const consentOk = locationConsentAccepted(data.location_consent);
  const liveSignal = signal || data.location_signal;
  const workDayNums = sch?.work_days || [];
  const geoHeader = mesaimGeoHeaderLine({
    workplace: data.workplace || data.location,
    location: data.location,
    requireGeo: data.workplace?.kind === "task" || sch?.require_geo !== false,
  });
  const outInfo = mesaimOutInfoLines({
    checkIn: t?.check_in,
    checkOut: t?.check_out,
    scheduledEnd: hours.end || t?.scheduled_end || sch?.end,
    expectedEnd: t?.expected_end || mesaiEnd,
    assignedOvertimeHours: t?.assigned_overtime_hours,
    assignedOvertimeStart: t?.assigned_overtime_start,
    assignedOvertimeEnd: t?.assigned_overtime_end,
    workplace: data.workplace,
  });
  const habitText = habitLabel(data.habit, data.habit_label);
  const dayLabs = data.day_labels || ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-5" data-testid="my-attendance-page">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2 flex-wrap" data-testid="my-att-title">
            <Clock className="w-7 h-7 text-emerald-600 shrink-0" /> Mesaim
          </h1>
          <p className="text-xs sm:text-sm text-slate-500" data-testid="my-att-header-geo">
            {data.employee
              ? `${data.employee.full_name}${data.employee.department || data.employee.position ? ` · ${[data.employee.position, data.employee.department].filter(Boolean).join(" · ")}` : ""}`
              : `${user?.name || ""} — kullanıcınız bir personel kartına bağlı değil`}
          </p>
          {data.employee ? (
            <p className={`mt-1 text-[11px] font-semibold inline-flex items-center gap-1 ${geoHeader.on ? "text-emerald-700" : "text-slate-500"}`} data-testid="my-att-geo-in">
              <MapPin className="w-3.5 h-3.5" />
              {[geoHeader.place, geoHeader.status].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Aylık dönem<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-white border rounded-xl p-2 text-xs font-semibold text-slate-800 normal-case tracking-normal" data-testid="my-att-month" /></label>
      </div>
      {!data.employee && <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800 space-y-1" data-testid="my-att-no-employee"><p>Giriş/çıkış, <b>erken çıkış</b> ve <b>gün içi izin</b> talebi için yöneticinizin Personel → Personel Kartı → <b>Sistem Kullanıcısı</b> bölümünden hesabınızı personel kartınıza bağlaması gerekir.</p><p className="text-amber-700/80">Bağlantı sonrası bugün kartta “Gün içi izin talep et” görünür (çıkış yapılmış olsa da).</p></div>}
      {data.employee && (
        <LocationConsentCard
          consent={data.location_consent}
          signal={liveSignal}
          onAccept={acceptConsent}
          busy={consentBusy}
          testId="my-att-consent"
        />
      )}
      {data.employee && !consentOk && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 text-xs text-slate-600" data-testid="my-att-consent-lock">
          KVKK (K) ve konum paylaşımı (KK) sözleşmelerini işaretleyip kabul edince giriş / çıkış paneli açılır.
        </div>
      )}
      {data.employee && consentOk && (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-5 sm:p-6 shadow-lg space-y-4" data-testid="my-att-today">
          <div className="rounded-xl bg-white/[0.07] border border-white/10 px-3.5 py-3 space-y-2" data-testid="my-att-today-window">
            <div className="flex items-center gap-3">
              <div className="text-3xl sm:text-[34px] font-black font-mono tracking-tight leading-none" data-testid="my-att-clock">{data.now || "--:--"}</div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <LocationSignal signal={liveSignal} className="text-white/90" testId="my-att-signal" />
                {dateLine ? (
                  <div className="text-[11px] font-semibold text-slate-300 truncate">{dateLine}{holidaySuffix}</div>
                ) : null}
              </div>
            </div>
            {(scheduleLine || workDayNums.length > 0) ? (
              <div className="border-t border-white/10 pt-2 space-y-1.5">
                {scheduleLine ? (
                  <div className="flex items-center gap-2 text-[13px] font-extrabold text-slate-50">
                    <Timer className="w-3.5 h-3.5 text-sky-200 shrink-0" />
                    <span className="min-w-0">{scheduleLine}</span>
                  </div>
                ) : null}
                {workDayNums.length > 0 ? (
                  <div className="flex flex-wrap gap-1" data-testid="my-att-work-days">
                    {workDayNums.map((n) => {
                      const lab = dayLabs[Number(n)] || "";
                      if (!lab) return null;
                      return (
                        <span key={`wd-${n}`} className="px-1.5 py-0.5 rounded-md bg-white/10 text-[10px] font-bold text-slate-200">{lab}</span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={onCheckInClick}
              disabled={!!busy || checkedIn}
              className="w-full flex flex-col items-center justify-center gap-1 py-5 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] disabled:bg-slate-700 disabled:text-slate-300 disabled:active:scale-100 rounded-2xl font-bold transition"
              data-testid="my-att-checkin"
            >
              {busy === "check_in" ? <Loader2 className="w-7 h-7 animate-spin" /> : <LogIn className="w-7 h-7" />}
              <span className="text-base">{checkedIn ? "Giriş yapıldı" : "Giriş Yap"}</span>
              <span className="text-[11px] font-semibold opacity-90" data-testid="my-att-today-in">
                {checkedIn ? mesaimInSubtitle(t?.check_in) : "basınca o anki saat yazılır"}
              </span>
            </button>

            <div className="rounded-2xl bg-rose-500/15 border border-rose-200/20 px-3.5 py-4 space-y-3" data-testid="my-att-checkout-info">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-rose-500/30 flex items-center justify-center shrink-0">
                  <LogOut className="w-6 h-6 text-rose-200" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-black tracking-tight truncate" data-testid="my-att-today-out">{outInfo.headline}</div>
                </div>
              </div>
              <p className="text-xs text-slate-300/90 leading-snug" data-testid="my-att-out-base">{outInfo.baseNote}</p>
              {(outInfo.scheduleLine || outInfo.fieldDutyLine) ? (
                <div className="border-t border-white/10 pt-2.5 space-y-2">
                  {outInfo.scheduleLine ? (
                    <div className="flex items-center gap-2 rounded-lg bg-slate-950/35 px-2.5 py-2 text-xs font-bold text-slate-100" data-testid="my-att-out-schedule">
                      <Timer className="w-3.5 h-3.5 text-sky-200 shrink-0" />
                      <span>{outInfo.scheduleLine}</span>
                    </div>
                  ) : null}
                  {outInfo.fieldDutyLine ? (
                    <div className="flex items-center gap-2 rounded-lg bg-indigo-500/20 px-2.5 py-2 text-xs font-bold text-indigo-100" data-testid="my-att-out-duty">
                      <MapPin className="w-3.5 h-3.5 text-indigo-200 shrink-0" />
                      <span>{outInfo.fieldDutyLine}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {earlyArrivalLine ? (
            <div className="text-[11px] text-sky-200 font-semibold" data-testid="my-att-early-arrival">{earlyArrivalLine}</div>
          ) : null}
          {habitText ? <div className="text-[11px] text-emerald-200" data-testid="my-att-habit">{habitText}</div> : null}
          {checkedIn && checkInOnceMsg ? (
            <div className="rounded-xl bg-emerald-500/15 border border-emerald-300/20 px-3 py-2 text-xs text-emerald-100 font-semibold" data-testid="my-att-checkin-once">{checkInOnceMsg}</div>
          ) : null}
          {geoConfirmHint(t) ? (
            <div className="rounded-xl bg-amber-500/20 border border-amber-300/30 px-3 py-2 text-xs text-amber-100 font-semibold" data-testid="my-att-geo-confirm-pending">{geoConfirmHint(t)}</div>
          ) : null}
          {(t?.hours || t?.late_minutes || t?.assigned_overtime_hours || t?.intraday_leave_minutes || t?.yevmiye_full_amount || t?.yevmiye_adjustment_request || t?.time_order_invalid) ? (
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs">
              {t?.time_order_invalid ? <span className="px-2.5 py-1 rounded-lg bg-rose-500/40 text-rose-100 font-bold" data-testid="my-att-time-order-invalid">Çıkış girişten önce — süre hesaplanmadı (kayıt düzeltilmeli)</span> : null}
              {t?.hours ? <span className="px-2.5 py-1 rounded-lg bg-white/10">Bugün <b>{t.hours} sa</b> çalışıldı</span> : null}
              {t?.assigned_overtime_hours ? <span className="px-2.5 py-1 rounded-lg bg-violet-500/30 text-violet-100 font-bold" data-testid="my-att-assigned-ot">Atanan +{t.assigned_overtime_hours} sa · beklenen çıkış {t.expected_end || mesaiEnd}</span> : null}
              {t?.overtime_hours ? <span className="px-2.5 py-1 rounded-lg bg-indigo-500/30 text-indigo-200 font-bold">+{t.overtime_hours} sa fazla mesai</span> : null}
              {t?.late_minutes ? <span className="px-2.5 py-1 rounded-lg bg-rose-500/30 text-rose-200 font-bold">{t.late_minutes} dk geç</span> : null}
              {t?.intraday_leave_minutes ? <span className="px-2.5 py-1 rounded-lg bg-sky-500/30 text-sky-100 font-bold" data-testid="my-att-intraday-mins">{t.intraday_leave_minutes} dk gün içi izin düşüldü</span> : null}
              {yevmiyeStatusLine(t) ? <span className="px-2.5 py-1 rounded-lg bg-amber-500/30 text-amber-100 font-bold" data-testid="my-att-yevmiye">{yevmiyeStatusLine(t)}</span> : null}
            </div>
          ) : null}
          {!t?.check_out && (
            <div className="rounded-xl bg-white/10 border border-white/10 p-3 space-y-2" data-testid="my-att-early-leave">
              {!t?.check_in ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300" data-testid="my-att-early-need-checkin">
                  <DoorOpen className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>Erken çıkış talep etmek için önce <b className="text-white">Giriş Yap</b>ın; ardından neden ve planlanan saati gönderebilirsiniz.</span>
                </div>
              ) : (
              (() => {
                const elr = t.early_leave_request || {};
                if (elr.status === "pending") {
                  return (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-amber-200"><DoorOpen className="w-3.5 h-3.5" /> Erken çıkış talebi bekliyor</span>
                      {elr.planned_time && <span className="font-mono text-slate-300">plan: {elr.planned_time}</span>}
                      <span className="text-slate-300 truncate max-w-[280px]">{elr.reason}</span>
                      <button type="button" onClick={cancelEarly} disabled={!!busy} className="ml-auto px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 font-semibold" data-testid="my-att-early-cancel">İptal</button>
                    </div>
                  );
                }
                if (elr.status === "approved" || t.early_leave_approved) {
                  return <div className="text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5" data-testid="my-att-early-approved"><DoorOpen className="w-3.5 h-3.5" /> Erken çıkış onaylandı — yönetici puantajdan çıkış yazar{elr.planned_time ? ` (plan ${elr.planned_time})` : ""}{elr.wage_deduction === false ? " · ücretten düşülmez" : elr.wage_deduction ? " · ücretten düşülür" : ""}</div>;
                }
                if (elr.status === "rejected") {
                  return <div className="text-xs text-rose-200" data-testid="my-att-early-rejected">Erken çıkış talebi reddedildi{elr.decision_note ? `: ${elr.decision_note}` : ""}. Yeniden talep edebilirsiniz.</div>;
                }
                return !earlyOpen ? (
                  <button type="button" onClick={() => setEarlyOpen(true)} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-amber-500/90 hover:bg-amber-400 text-slate-900 font-bold text-sm" data-testid="my-att-early-open"><DoorOpen className="w-4 h-4" /> Erken çıkış talep et</button>
                ) : (
                  <form onSubmit={requestEarly} className="grid grid-cols-1 sm:grid-cols-6 gap-2 text-xs" data-testid="my-att-early-form">
                    <div className="sm:col-span-3"><label className="block text-[10px] text-slate-300 mb-0.5">Neden</label><input required minLength={3} value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)} placeholder="Örn. doktor randevusu" className="w-full bg-slate-950/40 border border-white/10 rounded-lg p-2 text-white" data-testid="my-att-early-reason" /></div>
                    <div className="sm:col-span-1"><label className="block text-[10px] text-slate-300 mb-0.5">Planlanan saat</label><input type="time" value={earlyTime} onChange={(e) => setEarlyTime(e.target.value)} className="w-full bg-slate-950/40 border border-white/10 rounded-lg p-2 text-white" data-testid="my-att-early-time" /></div>
                    <div className="sm:col-span-2 flex items-end gap-2">
                      <button type="button" onClick={() => setEarlyOpen(false)} className="flex-1 px-3 py-2 rounded-lg border border-white/20 font-semibold" data-testid="my-att-early-dismiss">Vazgeç</button>
                      <button type="submit" disabled={busy === "early" || earlyReason.trim().length < 3} className="flex-1 px-3 py-2 rounded-lg bg-amber-400 text-slate-900 font-bold disabled:opacity-50" data-testid="my-att-early-submit">{busy === "early" ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : null} Gönder</button>
                    </div>
                  </form>
                );
              })()
              )}
            </div>
          )}

          <div className="rounded-xl bg-white/10 border border-white/10 p-3 space-y-2" data-testid={mesaimShowsDayLeaveInsteadOfIntraday(t?.check_in) ? "my-att-day-leave" : "my-att-intraday-leave"}>
            {mesaimShowsDayLeaveInsteadOfIntraday(t?.check_in) ? (
              !leaveOpen ? (
                <button type="button" onClick={openDayLeave} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-sky-500/90 hover:bg-sky-400 text-slate-900 font-bold text-sm" data-testid="my-att-day-leave-open">İzin talep et</button>
              ) : (
                <form onSubmit={requestDayLeave} className="grid grid-cols-1 sm:grid-cols-6 gap-2 text-xs" data-testid="my-att-day-leave-form">
                  <div className="sm:col-span-6 text-[10px] text-slate-300">Giriş yapmadan günlük izin talebi oluşturabilirsiniz. Gün içi izin için önce giriş yapın.</div>
                  <div className="sm:col-span-2"><label className="block text-[10px] text-slate-300 mb-0.5">Tür</label><select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="w-full bg-slate-950/40 border border-white/10 rounded-lg p-2 text-white" data-testid="my-att-day-leave-type">{Object.entries(DAY_LEAVE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div className="sm:col-span-1"><label className="block text-[10px] text-slate-300 mb-0.5">Başlangıç</label><input type="date" required value={leaveStart} onChange={(e) => { setLeaveStart(e.target.value); if (!leaveEnd || leaveEnd < e.target.value) setLeaveEnd(e.target.value); }} className="w-full bg-slate-950/40 border border-white/10 rounded-lg p-2 text-white" data-testid="my-att-day-leave-start" /></div>
                  <div className="sm:col-span-1"><label className="block text-[10px] text-slate-300 mb-0.5">Bitiş</label><input type="date" required min={leaveStart} value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} className="w-full bg-slate-950/40 border border-white/10 rounded-lg p-2 text-white" data-testid="my-att-day-leave-end" /></div>
                  <div className="sm:col-span-2"><label className="block text-[10px] text-slate-300 mb-0.5">Açıklama</label><input value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="İsteğe bağlı" className="w-full bg-slate-950/40 border border-white/10 rounded-lg p-2 text-white" data-testid="my-att-day-leave-reason" /></div>
                  <div className="sm:col-span-6 flex items-end gap-2">
                    <button type="button" onClick={() => setLeaveOpen(false)} className="flex-1 px-3 py-2 rounded-lg border border-white/20 font-semibold" data-testid="my-att-day-leave-dismiss">Vazgeç</button>
                    <button type="submit" disabled={busy === "leave" || !dayLeaveDays(leaveStart, leaveEnd || leaveStart)} className="flex-1 px-3 py-2 rounded-lg bg-sky-400 text-slate-900 font-bold disabled:opacity-50" data-testid="my-att-day-leave-submit">{busy === "leave" ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : null} İzin talep et{dayLeaveDays(leaveStart, leaveEnd || leaveStart) ? ` (${dayLeaveDays(leaveStart, leaveEnd || leaveStart)} gün)` : ""}</button>
                  </div>
                </form>
              )
            ) : (() => {
              const ilr = t?.intraday_leave_request || {};
              const dur = intradayLeaveMinutes(intraOut, intraReturn);
              if (ilr.status === "pending") {
                return (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-sky-200"><ArrowLeftRight className="w-3.5 h-3.5" /> Gün içi izin talebi bekliyor</span>
                    <span className="font-mono text-slate-300">{ilr.out_time}–{ilr.return_time}</span>
                    <span className="text-slate-300 truncate max-w-[280px]">{ilr.reason}</span>
                    <button type="button" onClick={cancelIntra} disabled={!!busy} className="ml-auto px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 font-semibold" data-testid="my-att-intraday-cancel">İptal</button>
                  </div>
                );
              }
              if (ilr.status === "approved" || t?.intraday_leave_approved) {
                return (
                  <div className="text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5" data-testid="my-att-intraday-approved">
                    <ArrowLeftRight className="w-3.5 h-3.5" /> Gün içi izin onaylandı · {ilr.out_time}–{ilr.return_time}
                    {t?.intraday_leave_minutes ? ` (${t.intraday_leave_minutes} dk düşüldü)` : ""}
                  </div>
                );
              }
              return (
                <>
                  {ilr.status === "rejected" && (
                    <div className="text-xs text-rose-200" data-testid="my-att-intraday-rejected">Gün içi izin talebi reddedildi{ilr.decision_note ? `: ${ilr.decision_note}` : ""}. Yeniden talep edebilirsiniz.</div>
                  )}
                  {!intraOpen ? (
                    <button type="button" onClick={() => setIntraOpen(true)} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-sky-500/90 hover:bg-sky-400 text-slate-900 font-bold text-sm" data-testid="my-att-intraday-open"><ArrowLeftRight className="w-4 h-4" /> Gün içi izin talep et</button>
                  ) : (
                    <form onSubmit={requestIntra} className="grid grid-cols-1 sm:grid-cols-8 gap-2 text-xs" data-testid="my-att-intraday-form">
                      <div className="sm:col-span-3"><label className="block text-[10px] text-slate-300 mb-0.5">Neden</label><input required minLength={3} value={intraReason} onChange={(e) => setIntraReason(e.target.value)} placeholder="Örn. banka / doktor" className="w-full bg-slate-950/40 border border-white/10 rounded-lg p-2 text-white" data-testid="my-att-intraday-reason" /></div>
                      <div className="sm:col-span-1"><label className="block text-[10px] text-slate-300 mb-0.5">Çıkış saati</label><input type="time" required value={intraOut} onChange={(e) => setIntraOut(e.target.value)} className="w-full bg-slate-950/40 border border-white/10 rounded-lg p-2 text-white" data-testid="my-att-intraday-out" /></div>
                      <div className="sm:col-span-1"><label className="block text-[10px] text-slate-300 mb-0.5">Dönüş (giriş)</label><input type="time" required value={intraReturn} onChange={(e) => setIntraReturn(e.target.value)} className="w-full bg-slate-950/40 border border-white/10 rounded-lg p-2 text-white" data-testid="my-att-intraday-return" /></div>
                      <div className="sm:col-span-3 flex items-end gap-2">
                        <button type="button" onClick={() => setIntraOpen(false)} className="flex-1 px-3 py-2 rounded-lg border border-white/20 font-semibold" data-testid="my-att-intraday-dismiss">Vazgeç</button>
                        <button type="submit" disabled={busy === "intra" || !!validateIntradayLeave(intraReason, intraOut, intraReturn)} className="flex-1 px-3 py-2 rounded-lg bg-sky-400 text-slate-900 font-bold disabled:opacity-50" data-testid="my-att-intraday-submit">{busy === "intra" ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : null} Gönder</button>
                      </div>
                      {dur ? <div className="sm:col-span-8 text-[10px] text-sky-200" data-testid="my-att-intraday-hint">{dur} dk — onaylanınca çalışılan süreden düşülür. Çıkış yapılmış olsa da talep edebilirsiniz.</div> : <div className="sm:col-span-8 text-[10px] text-slate-400">Çıkış ve dönüş saatini yazın (aynı gün). Onaylanan aralık puantajdan düşülür.</div>}
                    </form>
                  )}
                </>
              );
            })()}
          </div>

          <div className="text-[11px] text-slate-400 text-center sm:text-left">Giriş butonuna basınca konum alınır; iş/görev yeri toleransı sunucuda kontrol edilir. Günde bir kez giriş. Canlı konum otomatik giriş yazmaz. Çıkış puantaj / beklenen mesai bitişinden ({mesaiEnd}) işlenir. Gün içinde çıkıp dönecekseniz gün içi izin kullanın.</div>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3">
        <Stat label="Çalışılan gün" value={s.days_present} sub={`${s.days_absent} devamsız · ${s.days_leave} izin`} testId="my-att-stat-days" />
        <Stat label="Toplam saat" value={`${s.total_hours} sa`} sub={`${s.normal_hours} sa normal`} testId="my-att-stat-hours" />
        <Stat label="Fazla mesai" value={`${s.overtime_hours} sa`} sub={s.off_day_count ? `${s.off_day_count} tatil günü çalışma` : "mesai saati dışı"} tone="indigo" testId="my-att-stat-overtime" />
        <Stat label="Geç kalma" value={s.late_count} sub={`${s.late_minutes} dk toplam`} tone={s.late_count ? "rose" : "slate"} testId="my-att-stat-late" />
        <Stat label="Onay bekleyen" value={s.unconfirmed} sub="kayıtlarınızı onaylayın" tone={s.unconfirmed ? "rose" : "slate"} testId="my-att-stat-unconfirmed" />
      </div>
      <MyLeavePanel enabled={!!data.employee} />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b flex items-center justify-between"><span className="font-bold text-slate-900 text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Giriş / Çıkış Kayıtlarım ({data.records.length})</span><span className="text-[11px] text-slate-400 flex items-center gap-1"><Moon className="w-3 h-3" /> Sarı satır: tatil günü</span></div>
        <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {data.records.length === 0 && <div className="p-8 text-center text-xs text-slate-400">Bu ay kayıt yok.</div>}
          {data.records.map((r) => <RecordRow key={r.id} r={r} onConfirm={confirm} onRejectTimeEdit={rejectTimeEdit} onDispute={dispute} />)}
        </div>
      </div>
      {s.unconfirmed > 0 && <div className="text-[11px] text-slate-500 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Yönetici tarafından girilen kayıtları "Onayla" ile doğrulayın; yanlışsa "Düzeltme talep et" ile açıklama gönderin.</div>}
    </div>
  );
}
