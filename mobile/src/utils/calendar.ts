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

/** RN-web date/time inputs sometimes emit ISO datetimes or HH:MM — keep only a real day. */
export function normalizeYmd(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const isoDay = raw.slice(0, 10);
  return parseYmd(isoDay) ? isoDay : "";
}

/** Boş veya geçersiz tarih → yerel bugün (UTC kayması olmasın). */
export function ymdOrToday(value?: string | null): string {
  return normalizeYmd(String(value || "")) || toYmd(new Date());
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

export function parseYm(value: string): { year: number; month0: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(value || "").trim().slice(0, 7));
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  if (month0 < 0 || month0 > 11) return null;
  return { year, month0 };
}

export function toYm(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

export function normalizeYm(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = parseYm(raw.slice(0, 7));
  return parsed ? toYm(parsed.year, parsed.month0) : "";
}

export function ymOrThisMonth(value?: string | null): string {
  const now = new Date();
  return normalizeYm(String(value || "")) || toYm(now.getFullYear(), now.getMonth());
}

export function ymTitle(year: number, month0: number): string {
  return monthTitle(year, month0);
}

export function shiftMonth(year: number, month0: number, delta: number): { year: number; month0: number } {
  const d = new Date(year, month0 + delta, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}
