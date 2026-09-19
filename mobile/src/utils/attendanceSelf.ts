export function validateEarlyLeave(reason: string, plannedTime?: string): string | null {
  if ((reason || "").trim().length < 3) return "Erken çıkış nedeni en az 3 karakter olmalı.";
  const time = (plannedTime || "").trim();
  if (time && !/^\d{1,2}:\d{2}$/.test(time)) return "Planlanan saat HH:MM formatında olmalı.";
  return null;
}

export function earlyLeavePayload(reason: string, plannedTime?: string) {
  const planned = (plannedTime || "").trim();
  return {
    reason: reason.trim(),
    ...(planned ? { planned_time: planned } : {}),
  };
}
