/** Fazla mesai başlangıç–bitiş (HH:MM) → saat. Geceye sarkan aralık desteklenir. */
export function hoursFromTimeRange(start, end) {
  const parse = (t) => {
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
