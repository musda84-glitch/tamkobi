export function parseHm(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function formatHm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function hourOptions(): number[] {
  return Array.from({ length: 24 }, (_, i) => i);
}

export function minuteOptions(step = 5): number[] {
  const out: number[] = [];
  for (let m = 0; m < 60; m += step) out.push(m);
  return out;
}

/** Cihaz saati; tekerlek 5 dk adımlı olsa da şimdiki dakika korunur. */
export function nowHm(now: Date = new Date()): string {
  return formatHm(now.getHours(), now.getMinutes());
}

/** Karttaki canlı saat varsa onu kullan; yoksa cihaz saati. */
export function resolveNowHm(clockNow?: string | null, now: Date = new Date()): string {
  const parsed = parseHm(String(clockNow || "").trim().slice(0, 8));
  return parsed ? formatHm(parsed.hour, parsed.minute) : nowHm(now);
}
