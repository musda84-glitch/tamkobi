/** Fazla mesai başlangıç–bitiş (HH:MM) → saat. Geceye sarkan aralık desteklenir. */
export function hoursFromTimeRange(start?: string | null, end?: string | null): number | null {
  const parse = (t?: string | null) => {
    const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const a = parse(start);
  const b = parse(end);
  if (a == null || b == null) return null;
  let mins = b - a;
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

/** Ondalık saat → HH:MM (saat seçici için). */
export function hoursToHm(hours?: string | number | null): string {
  const raw = String(hours ?? "").trim();
  if (!raw) return "";
  if (/^\d{1,2}:\d{2}$/.test(raw)) return raw;
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return "";
  const h = Math.min(23, Math.floor(n));
  const m = Math.min(59, Math.round((n - Math.floor(n)) * 60));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
