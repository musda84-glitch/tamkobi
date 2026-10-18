/** Takvim günü farkı: bugün − verilen tarih. Geçmiş tarihler pozitiftir. */

function parts(value) {
  const raw = String(value || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(raw);
  if (dmy) return { y: Number(dmy[3]), m: Number(dmy[2]), d: Number(dmy[1]) };
  return null;
}

export function daysSince(value, now = new Date()) {
  const p = parts(value);
  if (!p) return 0;
  const target = Date.UTC(p.y, p.m - 1, p.d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - target) / 86400000);
}
