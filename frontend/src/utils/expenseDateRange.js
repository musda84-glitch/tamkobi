/** Yerel takvim günü (UTC kayması olmasın). */
export function localIso(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymd(now, yearDelta, monthIndex, day) {
  return localIso(new Date(now.getFullYear() + yearDelta, monthIndex, day));
}

/**
 * Masraf listesi tarih aralığı.
 * "Bu ay" ayın 1–son günü (vadesi ileriki günlerde olan vergi/SGK satırları da görünsün).
 */
export function expenseDateRange(preset, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (preset === "month") return [ymd(now, 0, m, 1), ymd(now, 0, m + 1, 0)];
  if (preset === "last_month") return [ymd(now, 0, m - 1, 1), ymd(now, 0, m, 0)];
  if (preset === "quarter") {
    const q = Math.floor(m / 3) * 3;
    return [ymd(now, 0, q, 1), ymd(now, 0, q + 3, 0)];
  }
  if (preset === "year") return [ymd(now, 0, 0, 1), ymd(now, 0, 11, 31)];
  return ["", ""];
}
