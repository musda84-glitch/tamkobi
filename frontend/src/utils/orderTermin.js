/** Sipariş tarihi / termin kalan süre gösterimi (pazaryeri estimated_delivery). */

/** Panel saat dilimi. İleride firma ayarı: company.timezone veya company.settings.timezone. */
export const DEFAULT_ORDER_TIMEZONE = "Europe/Istanbul";

export function orderDisplayTimeZone(company) {
  if (typeof company === "string" && company.trim()) return company.trim();
  const tz = company?.timezone || company?.settings?.timezone;
  if (tz && String(tz).trim()) return String(tz).trim();
  return DEFAULT_ORDER_TIMEZONE;
}

export function parseOrderInstant(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Kısa tarih+saat (tr-TR), firma saat diliminde. Varsayılan Europe/Istanbul. */
export function formatOrderDateTime(value, company) {
  const raw = value instanceof Date ? "" : String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}.${m}.${y}`;
  }
  const d = parseOrderInstant(value);
  if (!d) return "";
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: orderDisplayTimeZone(company),
  });
}

/** Siparişin firma takvim günü (YYYY-MM-DD). Filtre aralığı bu güne bakar. */
export function orderCalendarDay(value, company) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = parseOrderInstant(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: orderDisplayTimeZone(company),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Termin kalan süre etiketi.
 * @returns {{ label: string, overdue: boolean, title: string } | null}
 */
export function orderTerminRemaining(estimatedDelivery, now = new Date()) {
  const end = parseOrderInstant(estimatedDelivery);
  if (!end) return null;
  const ms = end.getTime() - (now instanceof Date ? now : new Date(now)).getTime();
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  let span;
  if (days >= 1) span = hours > 0 ? `${days}g ${hours}s` : `${days}g`;
  else if (hours >= 1) span = `${hours}s`;
  else span = `${Math.max(1, Math.ceil(abs / 60000))}dk`;
  const overdue = ms < 0;
  return {
    label: overdue ? `Termin geçti · ${span}` : `Termin ${span}`,
    overdue,
    title: `Termin: ${formatOrderDateTime(end)}`,
  };
}
