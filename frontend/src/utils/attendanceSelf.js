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

export function selfCheckoutUnlocked({ checkedIn, checkedOut, nowHm, scheduleEnd, expectedEnd, earlyApproved, offDay } = {}) {
  if (!checkedIn || checkedOut) return false;
  if (earlyApproved || offDay) return true;
  const now = hmToMinutes(nowHm);
  const end = hmToMinutes(expectedEnd || scheduleEnd);
  if (now == null || end == null) return true;
  return now >= end;
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
