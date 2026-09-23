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
  return `Yönetici saati düzeltti (${prev} → ${next}). Onaylamanız gerekir.`;
}

export const CHECKOUT_UNLOCK_WATCH_MS = 12_000;

export function shouldWatchCheckoutUnlock({ earlyPending, checkedIn, checkedOut, checkoutUnlocked } = {}) {
  if (checkedOut) return false;
  if (earlyPending) return true;
  return Boolean(checkedIn && !checkoutUnlocked);
}

/** Giriş: iş yeri/görev yakınında konum zorunlu. Çıkış: yalnız buton, her yerden; konum açıksa GPS eklenir. */
export function selfAttendanceGeoMode(action, opts = {}) {
  if (action === "check_in") {
    if (opts.hasTarget && opts.requireGeo !== false && opts.trackingEnabled !== false) return "required";
    return "none";
  }
  return opts.trackingEnabled ? "attach" : "none";
}
