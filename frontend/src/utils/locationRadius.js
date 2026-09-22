/** Giriş/çıkış yarıçapı (metre). Boş/geçersiz → varsayılan 300. */
export const DEFAULT_LOCATION_RADIUS_M = 300;
export const LOCATION_RADIUS_OPTIONS = [50, 100, 150, 200, 300, 500, 750, 1000];

export function normalizeRadiusM(raw, fallback = DEFAULT_LOCATION_RADIUS_M) {
  const n = Math.trunc(Number(String(raw ?? "").replace(",", ".").trim()));
  if (!Number.isFinite(n) || n < 25) return fallback;
  return Math.min(5000, n);
}
