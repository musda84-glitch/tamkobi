/** YYYY-MM-DD → 23.09.2026 (gün.ay.yıl). */
export function fmtDmy(value) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw.slice(0, 10);
  return `${m[3]}.${m[2]}.${m[1]}`;
}
