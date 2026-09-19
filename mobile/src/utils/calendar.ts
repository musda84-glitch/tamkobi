const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export function weekdayLabels(): string[] {
  return WEEKDAYS;
}

export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}

export function monthTitle(year: number, month0: number): string {
  return new Date(year, month0, 1).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
}

/** Pazartesi başlangıçlı ay ızgarası; boş hücreler null. */
export function monthGrid(year: number, month0: number): (number | null)[] {
  const first = new Date(year, month0, 1);
  const pad = (first.getDay() + 6) % 7;
  const last = new Date(year, month0 + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: pad }, () => null);
  for (let d = 1; d <= last; d += 1) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function shiftMonth(year: number, month0: number, delta: number): { year: number; month0: number } {
  const d = new Date(year, month0 + delta, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}
