/** Same company price precision as the web panel (0–4, default 2 kuruş). */
let priceDecimals = 2;

export function clampPriceDecimals(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2;
  const i = Math.trunc(n);
  if (i < 0) return 0;
  if (i > 4) return 4;
  return i;
}

export function setPriceDecimals(value: unknown): number {
  priceDecimals = clampPriceDecimals(value == null || value === "" ? 2 : value);
  return priceDecimals;
}

export function getPriceDecimals(): number {
  return priceDecimals;
}

export function formatTrAmount(n: unknown): string {
  const num = Number(n);
  const amount = Number.isFinite(num) ? num : 0;
  const d = priceDecimals;
  return amount.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtMoney(n: unknown, currency = "TRY"): string {
  const suffix = !currency || currency === "TRY" ? "₺" : currency;
  return `${formatTrAmount(n)} ${suffix}`;
}

export function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
}

export function idOf(row: { id?: string; _id?: string } | null | undefined): string {
  return String(row?.id || row?._id || "");
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
