/** Dış görev talimatları işlenirken tek seferlik görev yeri varlık bildirimi. */

const reported = new Set();

export function taskSitePresenceKey(taskId, day) {
  const tid = String(taskId || "").trim();
  const d = String(day || "").trim() || "today";
  return tid ? `${tid}:${d}` : "";
}

export function shouldReportTaskSitePresence(opts = {}) {
  if (!opts.field || !opts.consented || !opts.hasCoords) return false;
  const key = taskSitePresenceKey(opts.taskId);
  if (!key) return false;
  if (opts.alreadyKey && reported.has(opts.alreadyKey)) return false;
  if (reported.has(key)) return false;
  return true;
}

export function markTaskSitePresenceReported(taskId, day) {
  const key = taskSitePresenceKey(taskId, day);
  if (key) reported.add(key);
  return key;
}

export function dutyHasTaskSiteCoords(duty) {
  if (duty?.latitude === "" || duty?.longitude === "" || duty?.latitude == null || duty?.longitude == null) {
    return false;
  }
  const lat = Number(duty.latitude);
  const lng = Number(duty.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

export function taskSitePresencePayload(taskId, coords) {
  const body = {
    task_id: String(taskId).trim(),
    latitude: coords.latitude,
    longitude: coords.longitude,
  };
  const acc = Number(coords.accuracy_m);
  if (Number.isFinite(acc)) body.accuracy_m = acc;
  return body;
}

export function resetTaskSitePresenceMemory() {
  reported.clear();
}
