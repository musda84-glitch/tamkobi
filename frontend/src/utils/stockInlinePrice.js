/** Stok listesi satır içi fiyat: TR/EN ondalık parse + değişim kontrolü. */

export function parseStockPriceInput(raw, fallback = 0) {
  if (raw == null || raw === "") return fallback;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : fallback;
  let s = String(raw).trim().replace(/\s/g, "").replace(/[₺$€£]/g, "");
  if (!s) return fallback;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Kayda değer: negatif olmasın, 4 hane. */
export function normalizeStockPrice(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.round(x * 10000) / 10000;
}

export function stockPriceChanged(prev, next) {
  const a = normalizeStockPrice(typeof prev === "string" ? parseStockPriceInput(prev) : prev);
  const b = normalizeStockPrice(typeof next === "string" ? parseStockPriceInput(next) : next);
  return a !== b;
}

/** Input’ta gösterim: odak/edit için sade sayı (TR virgül). */
export function stockPriceDraftValue(n) {
  const x = normalizeStockPrice(n);
  if (x === 0) return "";
  return String(x).replace(".", ",");
}
