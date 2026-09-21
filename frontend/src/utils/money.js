export const CURRENCIES = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY"];
export const moneySuffix = (c) => (!c || c === "TRY" ? "₺" : c);
export const FX_DEFAULTS = { TRY: 1 };

/** Logo / Mikro birim fiyatı çoğu kurulumda 2–4 hane; Paraşüt ve Bizimhesap varsayılanı 2 (kuruş). */
export const PRICE_DECIMAL_OPTIONS = [0, 2, 3, 4];

let priceDecimals = 2;

export function clampPriceDecimals(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2;
  const i = Math.trunc(n);
  if (i < 0) return 0;
  if (i > 4) return 4;
  return i;
}

export function setPriceDecimals(value) {
  priceDecimals = clampPriceDecimals(value == null || value === "" ? 2 : value);
  return priceDecimals;
}

export function getPriceDecimals() {
  return priceDecimals;
}

/** Screen prices and amounts. Stored totals and GİB XML stay at kuruş. */
export function formatTrAmount(n) {
  const d = priceDecimals;
  const num = Number(n);
  const amount = Number.isFinite(num) ? num : 0;
  return amount.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export const fmtMoney = (n, c) => `${formatTrAmount(n)} ${moneySuffix(c)}`;

export function priceInputStep() {
  const d = priceDecimals;
  if (d <= 0) return "1";
  return (1 / 10 ** d).toFixed(d);
}

/**
 * Manuel giriş firma adımını kullanır. KDV dahil fiyattan gelen net birim
 * (ör. 260 / 1,10 = 236,3636) bu adıma oturmuyorsa step=any; aksi halde
 * tarayıcı kaydı "236 veya 237 girin" diye keser.
 */
export function inputStepForPrice(value) {
  const step = priceInputStep();
  const n = Number(value);
  const stepNum = Number(step);
  if (!Number.isFinite(n) || !Number.isFinite(stepNum) || stepNum <= 0) return step;
  const q = n / stepNum;
  if (Math.abs(q - Math.round(q)) < 1e-8) return step;
  return "any";
}
