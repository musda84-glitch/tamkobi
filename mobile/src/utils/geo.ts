export type Coords = { lat: number; lng: number };

/** Web ContactLocationModal ile aynı ayrıştırma: @lat,lng · ?q=lat,lng · düz "lat, lng". */
export function parseMapsUrl(url: string): Coords | null {
  const text = String(url || "");
  const m =
    text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
    text.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
    text.match(/(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function mapsUrlFor(lat: number | string, lng: number | string): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function mapEmbedUrl(lat: number | string, lng: number | string): string {
  return `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`;
}

/** Adres metninden Google Maps arama linki. */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`;
}

/** Kayıtta link yoksa koordinat, o da yoksa adres araması. */
export function mapsLink(row: {
  location_url?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  address?: string | null;
} | null | undefined): string | null {
  if (!row) return null;
  if (row.location_url) return String(row.location_url);
  if (row.latitude != null && row.latitude !== "" && row.longitude != null && row.longitude !== "") {
    return mapsUrlFor(row.latitude, row.longitude);
  }
  const addr = String(row.address || "").trim();
  return addr ? mapsSearchUrl(addr) : null;
}

export function locationPickerSummary(value: { url?: string; lat?: string; lng?: string; radius_m?: number | string } | null | undefined): string {
  if (!value) return "Kapalı";
  const radius = normalizeRadiusM(value.radius_m);
  const radiusPart = radius ? ` · ${radius} m` : "";
  if (value.lat && value.lng) return `${value.lat}, ${value.lng}${radiusPart}`;
  if (String(value.url || "").trim()) return `Konum linki var${radiusPart}`;
  return "Kapalı";
}

/** Giriş/çıkış yarıçapı (metre). Boş/geçersiz → varsayılan 300. */
export const DEFAULT_LOCATION_RADIUS_M = 300;
export const LOCATION_RADIUS_OPTIONS = [50, 100, 150, 200, 300, 500, 750, 1000] as const;

export function normalizeRadiusM(raw: unknown, fallback = DEFAULT_LOCATION_RADIUS_M): number {
  const n = Math.trunc(Number(String(raw ?? "").replace(",", ".").trim()));
  if (!Number.isFinite(n) || n < 25) return fallback;
  return Math.min(5000, n);
}

export function coordText(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v);
}

/** Boş metin null döner; backend "" yerine null bekliyor. */
export function coordValue(v: string): number | null {
  const text = String(v || "").replace(",", ".").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
