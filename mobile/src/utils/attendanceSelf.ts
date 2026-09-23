export type SelfAttendanceAction = "check_in" | "check_out";
export type SelfAttendanceGeoMode = "required" | "attach" | "none";

/** Giriş: iş yeri/görev yakınında konum zorunlu. Çıkış: buton her yerden; konum açıksa GPS eklenir. Konum ping otomatik basabilir. */
export function selfAttendanceGeoMode(
  action: SelfAttendanceAction,
  opts?: { hasTarget?: boolean; trackingEnabled?: boolean; requireGeo?: boolean },
): SelfAttendanceGeoMode {
  if (action === "check_in") {
    if (opts?.hasTarget && opts?.requireGeo !== false && opts?.trackingEnabled !== false) return "required";
    return "none";
  }
  return opts?.trackingEnabled ? "attach" : "none";
}

export function validateEarlyLeave(reason: string, plannedTime?: string): string | null {
  if ((reason || "").trim().length < 3) return "Erken çıkış nedeni en az 3 karakter olmalı.";
  const time = (plannedTime || "").trim();
  if (time && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(time)) return "Planlanan saat HH:MM formatında olmalı.";
  return null;
}

/** Mesaim çıkış butonu: yanlışlıkla basılmasın diye ikinci adım metni. */
export function checkoutConfirmMessage(checkIn?: string | null): string {
  const giris = String(checkIn || "").trim();
  return giris
    ? `Bugünkü mesai kapatılacak (giriş ${giris}). Yanlışlıkla bastıysanız vazgeçin; çıkış geri alınamaz.`
    : "Bugünkü mesai kapatılacak. Yanlışlıkla bastıysanız vazgeçin; çıkış geri alınamaz.";
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

export function selfCheckoutUnlocked(opts: {
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
  return Boolean(opts.checkedIn && !opts.checkedOut);
}

export function selfCheckoutLockedHint(opts: { checkedIn?: boolean; earlyPending?: boolean }): string {
  if (!opts.checkedIn) return "Çıkış için önce giriş yapın. Konum açıksa iş yerine yaklaşınca giriş otomatik yazılır.";
  return "Çıkış butonu açık. Konumla da çıkış yazılabilir; yönetici saati düzeltirse personel onayı gerekir.";
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
} | null): string {
  if (!edit?.pending_employee) return "";
  const prev = edit.prev_check_out || edit.prev_check_in || "—";
  const next = edit.check_out || edit.check_in || "—";
  return `Yönetici saati düzeltti (${prev} → ${next}). Onaylamanız gerekir.`;
}

/** Bekleyen erken çıkış veya mesai sonu için /me yenile — onay gelince çıkış açılır. */
export const CHECKOUT_UNLOCK_WATCH_MS = 12_000;

export function shouldWatchCheckoutUnlock(opts: {
  earlyPending?: boolean;
  checkedIn?: boolean;
  checkedOut?: boolean;
  checkoutUnlocked?: boolean;
}): boolean {
  if (opts.checkedOut) return false;
  if (opts.earlyPending) return true;
  return Boolean(opts.checkedIn && !opts.checkoutUnlocked);
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
