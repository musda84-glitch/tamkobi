export const CURRENCIES = ["TRY", "USD", "EUR", "GBP"];
export const moneySuffix = (c) => (!c || c === "TRY" ? "₺" : c);
export const fmtMoney = (n, c) => `${(Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneySuffix(c)}`;
export const FX_DEFAULTS = { TRY: 1, USD: 42.5, EUR: 46.2, GBP: 54 };
