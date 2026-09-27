export type SelfAttendanceAction = "check_in" | "check_out";
export type SelfAttendanceGeoMode = "required" | "attach" | "none";

/** Giriş: basınca konum çekilir (hedef varsa zorunlu). Çıkış Mesaim'de yok. */
export function selfAttendanceGeoMode(
  action: SelfAttendanceAction,
  opts?: { hasTarget?: boolean; trackingEnabled?: boolean; requireGeo?: boolean },
): SelfAttendanceGeoMode {
  if (action === "check_out") return "none";
  if (opts?.hasTarget) return "required";
  return "attach";
}

export type GeoConfirmRequest = {
  status?: string;
  action?: SelfAttendanceAction | string;
  reason?: string;
  proposed_time?: string;
  place?: string;
  distance_m?: number | null;
};

/** Önceden konum durumuna göre butonu kilitleme; yalnızca günün girişi yapılmışsa pasif. */
export function checkInOffsiteBlocked(_opts?: {
  checkedIn?: boolean;
  hasTarget?: boolean;
  outside?: boolean | null;
  locationMissing?: boolean;
} | null): boolean {
  return false;
}

export function checkInBlockedHint(opts?: { outside?: boolean | null; locationMissing?: boolean } | null): string {
  if (opts?.outside === true) return "İş yeri veya görev yerinde değilsiniz. Giriş yapılamaz.";
  if (opts?.locationMissing) return "Konum alınamadı. İş yeri veya görev yerinde giriş yapın.";
  return "";
}

export function checkInAlreadyDone(checkIn?: string | null): boolean {
  return Boolean(checkIn);
}

/** Bugün açık mesai: giriş var, çıkış yok. */
export function hasOpenMesaimSession(today?: { check_in?: string | null; check_out?: string | null } | null): boolean {
  const inn = String(today?.check_in || "").trim();
  const out = String(today?.check_out || "").trim();
  return Boolean(inn) && !out;
}

/**
 * Çıkış yapıldıysa (veya henüz giriş yoksa) bir sonraki girişe kadar yalnızca Mesaim.
 * Yönetici / admin kilitlenmez.
 */
export function mesaimExclusiveUntilCheckIn(
  user?: { role?: string | null; employee_id?: string | null } | null,
  today?: { check_in?: string | null; check_out?: string | null } | null,
): boolean {
  if (!user?.employee_id) return false;
  const role = String(user.role || "");
  if (role === "admin" || role === "manager") return false;
  return !hasOpenMesaimSession(today);
}

export function checkInOnceHint(checkIn?: string | null): string {
  const t = String(checkIn || "").trim().slice(0, 5);
  if (!t) return "";
  return `Bugün ${t} saatinde giriş yapılmış. Günde bir kez giriş yapılır.`;
}

export function geoConfirmPending(rec?: { geo_confirm_request?: GeoConfirmRequest | null } | null): boolean {
  return rec?.geo_confirm_request?.status === "pending";
}

export function geoConfirmReasonTr(reason?: string | null): string {
  if (reason === "location_off") return "konum kapalı";
  if (reason === "offsite") return "iş yerinde değil";
  if (reason === "time_edit") return "saat düzeltme";
  return (reason || "").trim() || "konum doğrulanamadı";
}

export function mesaimPunchOpensEditor(_opts?: {
  action?: "check_in" | "check_out";
  checkIn?: string | null;
  checkOut?: string | null;
}): boolean {
  return false;
}

export function mesaimPunchEditHint(action: "check_in" | "check_out"): string {
  if (action === "check_in") return "Kayıtlı giriş saatini düzeltin. Onaylayınca yönetici teyidine düşer.";
  return "Kayıtlı çıkış saatini düzeltin. Onaylayınca yönetici teyidine düşer.";
}

export function mesaimPunchNowLabel(action: "check_in" | "check_out"): string {
  return action === "check_out" ? "Şimdiki saat ile çıkış" : "Şimdiki saat ile giriş";
}

export function mesaimLongDate(ymd?: string | null): string {
  const raw = String(ymd || "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
}

export function mesaimWorkDaysLine(workDays?: number[] | null, labels?: string[] | null): string {
  const labs = labels && labels.length ? labels : ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  return (workDays || []).map((n) => labs[Number(n)] || "").filter(Boolean).join(", ");
}

export type MesaimTodayWindow = {
  start?: string | null;
  end?: string | null;
  break_minutes?: number | null;
  is_work_day?: boolean | null;
  weekday?: number | null;
  weekday_label?: string | null;
};

/** Bugünkü kişiye özel pencere + kayıtlı mesai alanlarından start/end/mola. */
export function resolveMesaimTodayHours(opts?: {
  todayWindow?: MesaimTodayWindow | null;
  today?: { scheduled_start?: string | null; scheduled_end?: string | null; expected_end?: string | null } | null;
  schedule?: { start?: string | null; end?: string | null; break_minutes?: number | null } | null;
} | null): { start: string; end: string; breakMinutes: number | null } {
  const win = opts?.todayWindow || {};
  const today = opts?.today || {};
  const sch = opts?.schedule || {};
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

export function mesaimScheduleLine(
  sch?: { start?: string; end?: string; break_minutes?: number } | null,
  opts?: { label?: string } | null,
): string {
  if (!sch?.start || !sch?.end) return "";
  const br = sch.break_minutes != null && sch.break_minutes !== undefined ? ` · mola ${sch.break_minutes} dk` : "";
  const label = opts?.label || "Mesai";
  return `${label} ${sch.start}–${sch.end}${br}`;
}

export function mesaimEarlyArrivalLine(opts?: {
  checkIn?: string | null;
  earlyMinutes?: number | null;
  mesaiStart?: string | null;
} | null): string {
  const mins = Number(opts?.earlyMinutes) || 0;
  if (mins <= 0 || !opts?.checkIn) return "";
  const start = opts.mesaiStart ? ` ${opts.mesaiStart}` : "";
  return `Erken giriş ${opts.checkIn} kaydedildi · çalışma saati${start} başlangıcından sayılır (${mins} dk erken)`;
}

export function mesaimDateHolidaySuffix(opts?: {
  todayDate?: string | null;
  isWorkDay?: boolean | null;
  workDays?: number[] | null;
} | null): string {
  if (opts?.isWorkDay === false) return " · tatil günü (çalışma = fazla mesai)";
  if (opts?.isWorkDay === true) return "";
  const raw = String(opts?.todayDate || "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m || !Array.isArray(opts?.workDays)) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return "";
  const weekday = (d.getDay() + 6) % 7;
  return opts.workDays.includes(weekday) ? "" : " · tatil günü (çalışma = fazla mesai)";
}

export function mesaimInSubtitle(checkIn?: string | null): string {
  return checkIn ? `Giriş ${checkIn}` : "henüz giriş yok";
}

export function mesaimOutSubtitle(opts?: { checkIn?: string | null; checkOut?: string | null; confirming?: boolean } | null): string {
  if (opts?.checkOut) return `Çıkış ${opts.checkOut}`;
  if (!opts?.checkIn) return "önce giriş yapın";
  return "puantaj / beklenen mesai bitişinden";
}

export type MesaimOutInfoLines = {
  headline: string;
  baseNote: string;
  scheduleLine: string;
  fieldDutyLine: string;
};

/** Mesaim çıkış kartı: kayıtlı saat + atanmış mesai bitiş + dış görev (varsa). */
export function mesaimOutInfoLines(opts?: {
  checkIn?: string | null;
  checkOut?: string | null;
  scheduledEnd?: string | null;
  expectedEnd?: string | null;
  assignedOvertimeHours?: number | null;
  workplace?: {
    kind?: string;
    task_title?: string;
    project_name?: string;
    project_number?: string;
    label?: string;
    duration_days?: number | null;
  } | null;
} | null): MesaimOutInfoLines {
  const checkOut = String(opts?.checkOut || "").trim();
  const checkIn = String(opts?.checkIn || "").trim();
  const end = String(opts?.expectedEnd || opts?.scheduledEnd || "").trim().slice(0, 5);
  const ot = Number(opts?.assignedOvertimeHours) || 0;
  const headline = checkOut
    ? `Çıkış ${checkOut}`
    : checkIn
      ? (end ? `Beklenen çıkış ${end}` : "puantaj / beklenen mesai bitişinden")
      : "önce giriş yapın";
  const baseNote = "Mesaim’den çıkış yok. Çıkış saati personel puantajından yazılır.";
  let scheduleLine = "";
  if (end || ot > 0) {
    const bits = [end ? `Atanan mesai çıkış ${end}` : null];
    if (ot > 0) bits.push(`+${ot} sa fazla mesai`);
    scheduleLine = bits.filter(Boolean).join(" · ");
  }
  let fieldDutyLine = "";
  const wp = opts?.workplace;
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

export function geoConfirmHint(rec?: { geo_confirm_request?: GeoConfirmRequest | null } | null): string {
  const g = rec?.geo_confirm_request;
  if (!g || g.status !== "pending") return "";
  const label = g.action === "check_out" ? "Çıkış" : "Giriş";
  const when = g.proposed_time ? ` ${g.proposed_time}` : "";
  const why = geoConfirmReasonTr(g.reason);
  const place = g.place ? ` · ${g.place}` : "";
  const dist = g.distance_m != null ? ` · ${g.distance_m} m` : "";
  return `${label}${when} yönetici onayında (${why}${place}${dist}). Onaylanınca yönetici teyitli kayıt yazılır.`;
}

export function validateEarlyLeave(reason: string, plannedTime?: string): string | null {
  if ((reason || "").trim().length < 3) return "Erken çıkış nedeni en az 3 karakter olmalı.";
  const time = (plannedTime || "").trim();
  if (time && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(time)) return "Planlanan saat HH:MM formatında olmalı.";
  return null;
}

/** @deprecated Mesaim'de çıkış butonu yok. */
export function checkoutConfirmMessage(checkIn?: string | null): string {
  const giris = String(checkIn || "").trim();
  return giris
    ? `Çıkış Mesaim'den yapılamaz (giriş ${giris}). Puantajdan işlenir.`
    : "Çıkış Mesaim'den yapılamaz. Puantajdan işlenir.";
}

export function hmToMinutes(value?: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function earlyLeaveApproved(rec?: { early_leave_approved?: boolean; early_leave_request?: { status?: string } | null } | null): boolean {
  if (!rec) return false;
  if (rec.early_leave_approved) return true;
  return rec.early_leave_request?.status === "approved";
}

export function hmReachedEnd(now: number, end: number, start?: number | null): boolean {
  if (start != null && end < start) return now < start && now >= end;
  return now >= end;
}

export function selfCheckoutUnlocked(_opts?: {
  checkedIn?: boolean;
  checkedOut?: boolean;
  nowHm?: string;
  scheduleStart?: string;
  scheduleEnd?: string;
  expectedEnd?: string;
  checkIn?: string;
  earlyApproved?: boolean;
  offDay?: boolean;
}): boolean {
  return false;
}

export function selfCheckoutLockedHint(opts: { checkedIn?: boolean; earlyPending?: boolean }): string {
  if (!opts.checkedIn) return "Önce iş yeri veya görev yerinde giriş yapın. Çıkış Mesaim'den yapılamaz.";
  return "Çıkış Mesaim'den yapılamaz; personel puantajından (atanan fazla mesai dahil) işlenir.";
}

export type AttendanceHabit = {
  typical_in?: string | null;
  typical_out?: string | null;
  sample_days?: number;
};

export function habitLabel(habit?: AttendanceHabit | null, fallback?: string | null): string {
  if (fallback) return fallback;
  if (!habit?.typical_in) return "";
  if (habit.typical_out) return `Alışkanlık: genelde ${habit.typical_in} giriş · ${habit.typical_out} çıkış (${habit.sample_days || 0} gün)`;
  return `Alışkanlık: genelde ${habit.typical_in} giriş (${habit.sample_days || 0} gün)`;
}

export function managerTimeEditHint(edit?: {
  prev_check_in?: string | null;
  prev_check_out?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  pending_employee?: boolean;
  attempt?: number | null;
} | null): string {
  if (!edit?.pending_employee) return "";
  const prev = edit.prev_check_out || edit.prev_check_in || "—";
  const next = edit.check_out || edit.check_in || "—";
  const attempt = Number(edit.attempt) || 0;
  const extra = attempt ? ` (${attempt}/3)` : "";
  return `Yönetici saati düzeltti (${prev} → ${next}). Onaylamanız gerekir${extra}.`;
}

/** Bekleyen erken çıkış veya mesai sonu için /me yenile — onay gelince çıkış açılır. */
export const CHECKOUT_UNLOCK_WATCH_MS = 12_000;
export const ATTENDANCE_DAY_WATCH_MS = 30_000;
export const ATTENDANCE_TZ = "Europe/Istanbul";

export function attendanceCalendarDate(now?: Date, timeZone = ATTENDANCE_TZ): string {
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

export function attendanceCalendarMonth(now?: Date, timeZone = ATTENDANCE_TZ): string {
  return attendanceCalendarDate(now, timeZone).slice(0, 7);
}

export function shouldReloadAttendanceDay(todayDate?: string | null, now?: Date, timeZone = ATTENDANCE_TZ): boolean {
  if (!todayDate) return true;
  return attendanceCalendarDate(now, timeZone) !== String(todayDate).slice(0, 10);
}

export function shouldWatchCheckoutUnlock(opts: {
  earlyPending?: boolean;
  checkedIn?: boolean;
  checkedOut?: boolean;
  checkoutUnlocked?: boolean;
}): boolean {
  if (opts.checkedOut) return false;
  return Boolean(opts.earlyPending);
}

export function earlyLeavePayload(reason: string, plannedTime?: string) {
  const planned = (plannedTime || "").trim();
  const hm = /^(\d{1,2}):(\d{2})/.exec(planned);
  return {
    reason: reason.trim(),
    ...(hm ? { planned_time: `${hm[1].padStart(2, "0")}:${hm[2]}` } : {}),
  };
}

export function validateIntradayLeave(reason: string, outTime?: string, returnTime?: string): string | null {
  if ((reason || "").trim().length < 3) return "Gün içi izin nedeni en az 3 karakter olmalı.";
  const out = (outTime || "").trim();
  const ret = (returnTime || "").trim();
  const hm = /^\d{1,2}:\d{2}(?::\d{2})?$/;
  if (!hm.test(out)) return "Çıkış saati HH:MM formatında olmalı.";
  if (!hm.test(ret)) return "Dönüş (giriş) saati HH:MM formatında olmalı.";
  const toMin = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };
  if (toMin(ret) <= toMin(out)) return "Dönüş saati çıkış saatinden sonra olmalı.";
  return null;
}

export function attendanceDisputeNote(opts: { checkIn?: string; checkOut?: string; note?: string }): string {
  const bits: string[] = [];
  const inn = String(opts.checkIn || "").trim();
  const out = String(opts.checkOut || "").trim();
  if (inn) bits.push(`giriş ${inn} olmalı`);
  if (out) bits.push(`çıkış ${out} olmalı`);
  if (String(opts.note || "").trim()) bits.push(String(opts.note).trim());
  return bits.join(" · ");
}

export function validateAttendanceDispute(note: string, checkIn?: string, checkOut?: string): string | null {
  const inn = String(checkIn || "").trim();
  const out = String(checkOut || "").trim();
  const hm = /^\d{1,2}:\d{2}(?::\d{2})?$/;
  if (inn && !hm.test(inn)) return "Giriş saati HH:MM formatında olmalı.";
  if (out && !hm.test(out)) return "Çıkış saati HH:MM formatında olmalı.";
  const composed = attendanceDisputeNote({ checkIn: inn, checkOut: out, note });
  if (composed.length < 3) return "Düzeltilecek giriş veya çıkış saatini seçin.";
  return null;
}

export function attendanceDisputePayload(note: string, checkIn?: string, checkOut?: string) {
  return { note: attendanceDisputeNote({ checkIn, checkOut, note }) };
}

export function canRequestAttendanceFix(r?: {
  id?: string;
  _id?: string;
  employee_confirmed?: boolean;
  dispute_note?: string;
  dispute_resolved?: boolean;
} | null): boolean {
  if (!r || !(r.id || r._id)) return false;
  if (r.employee_confirmed) return false;
  if (r.dispute_note && !r.dispute_resolved) return false;
  return true;
}

export function attendanceDisputeStatus(r?: {
  employee_confirmed?: boolean;
  dispute_note?: string;
  dispute_resolved?: boolean;
  dispute_resolution?: string;
} | null): string {
  if (!r) return "";
  if (r.employee_confirmed) return "Onaylandı";
  if (r.dispute_note && !r.dispute_resolved) return "Düzeltme talebi iletildi";
  if (r.dispute_note && r.dispute_resolved) {
    return r.dispute_resolution === "rejected" ? "Düzeltme talebi reddedildi" : "Düzeltme kapatıldı";
  }
  return "";
}

export function intradayLeavePayload(reason: string, outTime: string, returnTime: string) {
  const norm = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec((t || "").trim());
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : t;
  };
  return { reason: reason.trim(), out_time: norm(outTime), return_time: norm(returnTime) };
}
