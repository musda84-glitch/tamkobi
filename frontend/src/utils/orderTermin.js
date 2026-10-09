/** Sipariş tarihi / termin kalan süre gösterimi (pazaryeri estimated_delivery). */

export function parseOrderInstant(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Kısa tarih+saat (tr-TR). */
export function formatOrderDateTime(value) {
  const d = parseOrderInstant(value);
  if (!d) return "";
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
