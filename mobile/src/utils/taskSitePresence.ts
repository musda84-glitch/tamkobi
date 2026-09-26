/** Dış görev talimatları işlenirken tek seferlik görev yeri varlık bildirimi. */

export type TaskSitePresenceResult = {
  status?: string;
  onsite?: boolean | null;
  recorded?: boolean;
  distance_m?: number | null;
  message?: string;
};

const reported = new Set<string>();

export function taskSitePresenceKey(taskId?: string | null, day?: string | null): string {
  const tid = String(taskId || "").trim();
  const d = String(day || "").trim() || "today";
  return tid ? `${tid}:${d}` : "";
}

export function shouldReportTaskSitePresence(opts?: {
  field?: boolean;
  taskId?: string | null;
  hasCoords?: boolean;
  consented?: boolean;
  alreadyKey?: string | null;
} | null): boolean {
  if (!opts?.field || !opts?.consented || !opts?.hasCoords) return false;
  const key = taskSitePresenceKey(opts.taskId);
  if (!key) return false;
  if (opts.alreadyKey && reported.has(opts.alreadyKey)) return false;
  if (reported.has(key)) return false;
  return true;
}

export function markTaskSitePresenceReported(taskId?: string | null, day?: string | null): string {
  const key = taskSitePresenceKey(taskId, day);
  if (key) reported.add(key);
  return key;
}

export function dutyHasTaskSiteCoords(duty?: {
  latitude?: number | string | null;
  longitude?: number | string | null;
} | null): boolean {
  if (duty?.latitude === "" || duty?.longitude === "" || duty?.latitude == null || duty?.longitude == null) {
    return false;
  }
  const lat = Number(duty.latitude);
  const lng = Number(duty.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

export function taskSitePresencePayload(
  taskId: string,
  coords: { latitude: number; longitude: number; accuracy_m?: number | null },
): { task_id: string; latitude: number; longitude: number; accuracy_m?: number } {
  const body: { task_id: string; latitude: number; longitude: number; accuracy_m?: number } = {
    task_id: String(taskId).trim(),
    latitude: coords.latitude,
    longitude: coords.longitude,
  };
  const acc = Number(coords.accuracy_m);
  if (Number.isFinite(acc)) body.accuracy_m = acc;
  return body;
}

/** Test / StrictMode için bellek anahtarlarını sıfırla. */
export function resetTaskSitePresenceMemory(): void {
  reported.clear();
}
