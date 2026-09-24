import { fmtDmy } from "./calendar";

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

/** Yazım sırasında 2. / 2,10 gibi ara halleri koru; her tuşta toFixed yapma. */
export function sanitizeMoneyInput(raw: string): string {
  const s = String(raw ?? "");
  const minus = s.trim().startsWith("-") ? "-" : "";
  const body = s.replace(/[^\d.,]/g, "");
  const sepMatch = body.match(/[.,]/);
  if (!sepMatch) return minus + body;
  const sep = sepMatch[0];
  const [head, ...tail] = body.split(/[.,]/);
  return minus + (head || "") + sep + tail.join("").replace(/[^\d]/g, "");
}

export function parseMoneyInput(raw: string): number {
  const s = sanitizeMoneyInput(raw).replace(",", ".");
  if (!s || s === "-" || s === "." || s === "-.") return 0;
  const x = Number(s);
  return Number.isFinite(x) ? x : 0;
}

export function formatMoneyInput(v: unknown, decimals = getPriceDecimals()): string {
  const x = Number(v);
  if (!Number.isFinite(x)) return "";
  return x.toFixed(decimals);
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

/** Görünen tarihler gün.ay.yıl (21.09.2026). API hâlâ YYYY-MM-DD taşır. */
export function fmtDate(value?: string | null): string {
  return fmtDmy(value);
}

export function idOf(row: { id?: string; _id?: string } | null | undefined): string {
  return String(row?.id || row?._id || "");
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
