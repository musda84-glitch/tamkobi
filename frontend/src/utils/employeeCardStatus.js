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
  if (action === "check_in") return `${prefix}giriş kaydı şimdi yazılsın mı?`;
  return `${prefix}çıkış kaydı şimdi yazılsın mı? Yanlışlıkla bastıysanız vazgeçin.`;
}
