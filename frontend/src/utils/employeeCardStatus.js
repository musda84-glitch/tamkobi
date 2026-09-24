export function locationTrackingEnabled(lt) {
  if (!lt || typeof lt !== "object") return true;
  return lt.enabled !== false || lt.field?.enabled !== false;
}

export function locationControllerLabel(on) {
  return on ? "Konum açık" : "Konum kapalı";
}

export function locationCellCaption(on) {
  return on ? "Açık" : "Kapalı";
}

export function requestsDetailsToggleLabel(open) {
  return open ? "Gizle" : "Büyüt";
}

export function locationTrackingTogglePayload(raw, enabled) {
  const src = raw && typeof raw === "object" ? raw : {};
  const field = src.field && typeof src.field === "object" ? src.field : src;
  const copy = (mode, on) => ({
    enabled: on,
    continuous: !!mode.continuous,
    interval_minutes: Number(mode.interval_minutes) || 0,
    exit_tolerance_hours: Number(mode.exit_tolerance_hours) || 0,
  });
  return { ...copy(src, enabled), field: copy(field, enabled) };
}

export function todayAttendanceParts(today) {
  const empty = !today || (!today.check_in && !today.check_out && today.status !== "present");
  return {
    checkIn: today?.check_in || "--:--",
    checkOut: today?.check_out || "--:--",
    late: Number(today?.late_minutes) || 0,
    empty,
  };
}

export function cardPunchConfirmMessage(action, name) {
  const who = String(name || "").trim();
  const prefix = who ? `${who} için ` : "";
  if (action === "check_in") return `${prefix}giriş saati personel onayına gönderilsin mi?`;
  return `${prefix}çıkış saati personel onayına gönderilsin mi?`;
}

export function cardPunchDraftTime(action, today) {
  const raw = action === "check_in" ? today?.check_in : today?.check_out;
  const t = String(raw || "").trim();
  return /^\d{1,2}:\d{2}$/.test(t) ? t.slice(0, 5) : "";
}

export function cardPunchAttempts(today, action) {
  const row = today?.manager_time_edit_rounds?.[action];
  const n = Number(row?.attempts);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function cardPunchTimeHint(attempts) {
  if (Number(attempts) >= 2) return "3. deneme: personel onayı atlanır.";
  return "Onaylayınca değişiklik personelin teyidine düşer.";
}

export function cardPunchRequiresTime(time) {
  return /^\d{1,2}:\d{2}$/.test(String(time || "").trim()) ? null : "Saat seçin.";
}

export function cardPunchPayload(action, time) {
  const t = String(time || "").trim().slice(0, 5);
  return t ? { action, [action]: t } : { action };
}
