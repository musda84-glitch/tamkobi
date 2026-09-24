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

export function selfCheckoutUnlocked({ checkedIn, checkedOut } = {}) {
  return Boolean(checkedIn && !checkedOut);
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

export function shouldWatchCheckoutUnlock({ earlyPending, checkedIn, checkedOut, checkoutUnlocked } = {}) {
  if (checkedOut) return false;
  if (earlyPending) return true;
  return Boolean(checkedIn && !checkoutUnlocked);
}

/** Giriş/çıkış butonu konum yüzünden kapanmaz. GPS varsa eklenir; yoksa veya uzaktaysa yönetici teyidi. */
export function selfAttendanceGeoMode(action, opts = {}) {
  if (opts.hasTarget || opts.trackingEnabled) return "attach";
  return "none";
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

export function mesaimPunchOpensEditor({ action, checkIn, checkOut } = {}) {
  return action === "check_in" ? Boolean(checkIn) : Boolean(checkOut);
}

export function mesaimPunchEditHint(action) {
  if (action === "check_in") return "Kayıtlı giriş saatini düzeltin. Onaylayınca yönetici teyidine düşer.";
  return "Kayıtlı çıkış saatini düzeltin. Onaylayınca yönetici teyidine düşer.";
}

export function mesaimPunchNowLabel(action) {
  return action === "check_out" ? "Şimdiki saat ile çıkış" : "Şimdiki saat ile giriş";
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
