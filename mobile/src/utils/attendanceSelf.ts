export type SelfAttendanceAction = "check_in" | "check_out";
export type SelfAttendanceGeoMode = "required" | "attach" | "none";

/** Giriş: iş yeri/görev yakınında konum zorunlu. Çıkış: yalnız buton, her yerden; konum açıksa GPS eklenir, mesafe bloklamaz. Otomatik giriş-çıkış yok. */
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

export function validateAttendanceDispute(note: string): string | null {
  if ((note || "").trim().length < 3) return "Düzeltme açıklaması en az 3 karakter olmalı.";
  return null;
}

export function attendanceDisputePayload(note: string) {
  return { note: note.trim() };
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
