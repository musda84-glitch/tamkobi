export function hmToMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function earlyLeaveApproved(rec) {
  if (!rec) return false;
  if (rec.early_leave_approved) return true;
  return rec.early_leave_request?.status === "approved";
}

export function hmReachedEnd(now, end, start) {
  if (start != null && end < start) return now < start && now >= end;
  return now >= end;
}

export function selfCheckoutUnlocked() {
  return false;
}

export function habitLabel(habit, fallback) {
  if (fallback) return fallback;
  if (!habit?.typical_in) return "";
  if (habit.typical_out) return `Alışkanlık: genelde ${habit.typical_in} giriş · ${habit.typical_out} çıkış (${habit.sample_days || 0} gün)`;
  return `Alışkanlık: genelde ${habit.typical_in} giriş (${habit.sample_days || 0} gün)`;
}

export function managerTimeEditHint(edit) {
  if (!edit?.pending_employee) return "";
  const prev = edit.prev_check_out || edit.prev_check_in || "—";
  const next = edit.check_out || edit.check_in || "—";
  const attempt = Number(edit.attempt) || 0;
  const extra = attempt ? ` (${attempt}/3)` : "";
  return `Yönetici saati düzeltti (${prev} → ${next}). Onaylamanız gerekir${extra}.`;
}

export const CHECKOUT_UNLOCK_WATCH_MS = 12_000;
export const ATTENDANCE_DAY_WATCH_MS = 30_000;
export const ATTENDANCE_TZ = "Europe/Istanbul";

export function attendanceCalendarDate(now, timeZone = ATTENDANCE_TZ) {
  const d = now || new Date();
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

export function attendanceCalendarMonth(now, timeZone = ATTENDANCE_TZ) {
  return attendanceCalendarDate(now, timeZone).slice(0, 7);
}

export function shouldReloadAttendanceDay(todayDate, now, timeZone = ATTENDANCE_TZ) {
  if (!todayDate) return true;
  return attendanceCalendarDate(now, timeZone) !== String(todayDate).slice(0, 10);
}

export function shouldWatchCheckoutUnlock({ earlyPending, checkedOut } = {}) {
  if (checkedOut) return false;
  return Boolean(earlyPending);
}

/** Giriş: basınca konum çekilir (hedef varsa zorunlu). Çıkış Mesaim'de yok. */
export function selfAttendanceGeoMode(action, opts = {}) {
  if (action === "check_out") return "none";
  if (opts.hasTarget) return "required";
  // Hedef yoksa da girişte konum dene — sunucu/alışkanlık için eklenir.
  return "attach";
}

/** Önceden konum durumuna göre butonu kilitleme; yalnızca günün girişi yapılmışsa pasif. */
export function checkInOffsiteBlocked() {
  return false;
}

export function checkInBlockedHint({ outside, locationMissing } = {}) {
  if (outside === true) return "İş yeri veya görev yerinde değilsiniz. Giriş yapılamaz.";
  if (locationMissing) return "Konum alınamadı. İş yeri veya görev yerinde giriş yapın.";
  return "";
}

/** Günde bir giriş: kayıt varsa buton pasif. */
export function checkInAlreadyDone(checkIn) {
  return Boolean(checkIn);
}

/** Bugün açık mesai: giriş var, çıkış yok. */
export function hasOpenMesaimSession(today) {
  const inn = String(today?.check_in || "").trim();
  const out = String(today?.check_out || "").trim();
  return Boolean(inn) && !out;
}

/**
 * Çıkış yapıldıysa (veya henüz giriş yoksa) bir sonraki girişe kadar yalnızca Mesaim.
 * Yönetici / admin kilitlenmez.
 */
export function mesaimExclusiveUntilCheckIn(user, today) {
  if (!user?.employee_id) return false;
  const role = String(user.role || "");
  if (role === "admin" || role === "manager") return false;
  return !hasOpenMesaimSession(today);
}

/** Kilitliyken yalnızca Mesaim + hesap (şifre/sözleşme iptali). */
export function mesaimExclusivePathAllowed(path) {
  const p = String(path || "");
  if (p === "/mesai" || p.startsWith("/mesai/")) return true;
  if (p === "/hesap" || p.startsWith("/hesap")) return true;
  if (p === "/login") return true;
  return false;
}

export function checkInOnceHint(checkIn) {
  const t = String(checkIn || "").trim().slice(0, 5);
  if (!t) return "";
  return `Bugün ${t} saatinde giriş yapılmış. Günde bir kez giriş yapılır.`;
}

export function geoConfirmPending(rec) {
  return rec?.geo_confirm_request?.status === "pending";
}

export function geoConfirmReasonTr(reason) {
  if (reason === "location_off") return "konum kapalı";
  if (reason === "offsite") return "iş yerinde değil";
  if (reason === "time_edit") return "saat düzeltme";
  return String(reason || "").trim() || "konum doğrulanamadı";
}

/** Mesaim girişte saat düzeltme paneli yok — basınca o anki saat yazılır. */
export function mesaimPunchOpensEditor(_opts = {}) {
  return false;
}

export function mesaimPunchEditHint(action) {
  if (action === "check_in") return "Kayıtlı giriş saatini düzeltin. Onaylayınca yönetici teyidine düşer.";
  return "Kayıtlı çıkış saatini düzeltin. Onaylayınca yönetici teyidine düşer.";
}

export function mesaimPunchNowLabel(action) {
  return action === "check_out" ? "Şimdiki saat ile çıkış" : "Şimdiki saat ile giriş";
}

export function mesaimLongDate(ymd) {
  const raw = String(ymd || "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
}

export function mesaimWorkDaysLine(workDays, labels) {
  const labs = labels && labels.length ? labels : ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  return (workDays || []).map((n) => labs[Number(n)] || "").filter(Boolean).join(", ");
}

export function resolveMesaimTodayHours(opts = {}) {
  const win = opts.todayWindow || {};
  const today = opts.today || {};
  const sch = opts.schedule || {};
  const start = String(win.start || today.scheduled_start || sch.start || "").slice(0, 5);
  const end = String(win.end || today.scheduled_end || today.expected_end || sch.end || "").slice(0, 5);
  const brRaw = win.break_minutes ?? sch.break_minutes;
  if (brRaw == null || brRaw === undefined) {
    return { start, end, breakMinutes: null };
  }
  const breakMinutes = Number(brRaw);
  return {
    start,
    end,
    breakMinutes: Number.isFinite(breakMinutes) ? breakMinutes : null,
  };
}

export function mesaimScheduleLine(sch, opts = {}) {
  if (!sch?.start || !sch?.end) return "";
  const br = sch.break_minutes != null && sch.break_minutes !== undefined ? ` · mola ${sch.break_minutes} dk` : "";
  const label = opts.label || "Mesai";
  return `${label} ${sch.start}–${sch.end}${br}`;
}

export function mesaimEarlyArrivalLine(opts = {}) {
  const mins = Number(opts.earlyMinutes) || 0;
  if (mins <= 0 || !opts.checkIn) return "";
  const start = opts.mesaiStart ? ` ${opts.mesaiStart}` : "";
  return `Erken giriş ${opts.checkIn} kaydedildi · çalışma saati${start} başlangıcından sayılır (${mins} dk erken)`;
}

export function mesaimDateHolidaySuffix(opts = {}) {
  if (opts.isWorkDay === false) return " · tatil günü (çalışma = fazla mesai)";
  if (opts.isWorkDay === true) return "";
  const raw = String(opts.todayDate || "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m || !Array.isArray(opts.workDays)) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return "";
  const weekday = (d.getDay() + 6) % 7;
  return opts.workDays.includes(weekday) ? "" : " · tatil günü (çalışma = fazla mesai)";
}

export function mesaimInSubtitle(checkIn) {
  return checkIn ? `Giriş ${checkIn}` : "henüz giriş yok";
}

/** Giriş yokken gün içi izin yerine günlük izin talebi gösterilir. */
export function mesaimShowsDayLeaveInsteadOfIntraday(checkIn) {
  return !String(checkIn || "").trim();
}

export function mesaimOutSubtitle(opts = {}) {
  if (opts.checkOut) return `Çıkış ${opts.checkOut}`;
  if (!opts.checkIn) return "önce giriş yapın";
  return "puantaj / beklenen mesai bitişinden";
}

/** Mesaim çıkış kartı: kayıtlı saat + atanmış fazla mesai aralığı + dış görev (varsa). */
export function mesaimOutInfoLines(opts = {}) {
  const hm = (v) => String(v || "").trim().slice(0, 5);
  const checkOut = hm(opts.checkOut);
  const checkIn = hm(opts.checkIn);
  const scheduledEnd = hm(opts.scheduledEnd);
  const expectedEnd = hm(opts.expectedEnd) || scheduledEnd;
  const ot = Number(opts.assignedOvertimeHours) || 0;
  const headline = checkOut
    ? `Çıkış ${checkOut}`
    : checkIn
      ? (expectedEnd ? `Beklenen çıkış ${expectedEnd}` : "puantaj / beklenen mesai bitişinden")
      : "önce giriş yapın";
  const baseNote = "Çıkış Saati Yazan Saattir.";
  const otStart = hm(opts.assignedOvertimeStart) || (ot > 0 || (scheduledEnd && expectedEnd && scheduledEnd !== expectedEnd) ? scheduledEnd : "");
  const otEnd = hm(opts.assignedOvertimeEnd) || expectedEnd;
  let scheduleLine = "";
  if (otStart && otEnd) {
    scheduleLine = `Atanan fazla mesai ${otStart}–${otEnd}`;
  } else if (otEnd) {
    scheduleLine = `Atanan fazla mesai çıkış ${otEnd}`;
  } else if (ot > 0) {
    scheduleLine = `+${ot} sa fazla mesai`;
  }
  let fieldDutyLine = "";
  const wp = opts.workplace;
  if (wp && String(wp.kind || "") === "task") {
    const title = String(wp.task_title || "Dış görev").trim();
    const proj = String(wp.project_number || wp.project_name || wp.label || "").trim();
    const days = Math.trunc(Number(wp.duration_days) || 0);
    const parts = [proj ? `${title} · ${proj}` : title];
    if (days > 0) parts.push(`${days} gün`);
    fieldDutyLine = `Dış görev: ${parts.join(" · ")}`;
  }
  return { headline, baseNote, scheduleLine, fieldDutyLine };
}

/** Karttaki canlı saat varsa onu kullan; yoksa cihaz saati. */
export function resolveNowHm(clockNow, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(clockNow || "").trim().slice(0, 8));
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }
  const d = now instanceof Date ? now : new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function geoConfirmHint(rec) {
  const g = rec?.geo_confirm_request;
  if (!g || g.status !== "pending") return "";
  const label = g.action === "check_out" ? "Çıkış" : "Giriş";
  const when = g.proposed_time ? ` ${g.proposed_time}` : "";
  const why = geoConfirmReasonTr(g.reason);
  const place = g.place ? ` · ${g.place}` : "";
  const dist = g.distance_m != null ? ` · ${g.distance_m} m` : "";
  return `${label}${when} yönetici onayında (${why}${place}${dist}). Onaylanınca yönetici teyitli kayıt yazılır.`;
}
