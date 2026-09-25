export const LOCATION_BG_TASK = "tamkobi-location-bg";
export const LOCATION_BG_STORE_KEY = "tamkobi.locationBg";

export type LocationBgConfig = {
  enabled: boolean;
  consented: boolean;
  continuous: boolean;
  interval_minutes: number;
  checkedOut: boolean;
};

export const LOCATION_BG_NOTIFICATION = {
  notificationTitle: "TamKobi konum takibi",
  notificationBody: "Uygulama kapalıyken de mesai konumunuz kaydedilir.",
};

export function locationBgIntervalMs(cfg?: { continuous?: boolean; interval_minutes?: number } | null): number {
  const mins = Number(cfg?.interval_minutes);
  if (cfg?.continuous || mins === 0) return 60_000;
  const n = Number.isFinite(mins) && mins > 0 ? mins : 15;
  return Math.max(1, n) * 60_000;
}

export function shouldRunLocationBackground(opts: {
  consented?: boolean;
  enabled?: boolean;
  checkedOut?: boolean;
  token?: string | null;
  platform?: string;
}): boolean {
  if (opts.platform === "web") return false;
  if (!opts.consented || !opts.enabled || opts.checkedOut) return false;
  return Boolean(String(opts.token || "").trim());
}

export function locationBgDistanceM(cfg?: { continuous?: boolean; interval_minutes?: number } | null): number {
  return cfg?.continuous || Number(cfg?.interval_minutes) === 0 ? 25 : 80;
}

export function locationBgUpdatesOptions(cfg?: { continuous?: boolean; interval_minutes?: number } | null): {
  timeInterval: number;
  distanceInterval: number;
  deferredUpdatesInterval: number;
  pausesUpdatesAutomatically: boolean;
  showsBackgroundLocationIndicator: boolean;
  foregroundService: { notificationTitle: string; notificationBody: string };
} {
  const ms = locationBgIntervalMs(cfg);
  return {
    timeInterval: ms,
    distanceInterval: locationBgDistanceM(cfg),
    deferredUpdatesInterval: ms,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: { ...LOCATION_BG_NOTIFICATION },
  };
}

export function locationFromTaskData(data: unknown): { latitude: number; longitude: number; accuracy_m?: number } | null {
  const locs = (data as { locations?: Array<{ coords?: { latitude?: number; longitude?: number; accuracy?: number | null } }> } | null)?.locations;
  const c = locs?.[locs.length - 1]?.coords;
  const lat = Number(c?.latitude);
  const lng = Number(c?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const acc = Number(c?.accuracy);
  return { latitude: lat, longitude: lng, accuracy_m: Number.isFinite(acc) ? acc : undefined };
}

export function parseLocationBgConfig(raw?: string | null): LocationBgConfig | null {
  if (!raw) return null;
  try {
    const row = JSON.parse(raw) as LocationBgConfig;
    if (!row || typeof row !== "object") return null;
    return {
      enabled: Boolean(row.enabled),
      consented: Boolean(row.consented),
      continuous: Boolean(row.continuous),
      interval_minutes: Number(row.interval_minutes) || 0,
      checkedOut: Boolean(row.checkedOut),
    };
  } catch {
    return null;
  }
}

export function serializeLocationBgConfig(cfg: LocationBgConfig): string {
  return JSON.stringify({
    enabled: Boolean(cfg.enabled),
    consented: Boolean(cfg.consented),
    continuous: Boolean(cfg.continuous),
    interval_minutes: Number(cfg.interval_minutes) || 0,
    checkedOut: Boolean(cfg.checkedOut),
  });
}
