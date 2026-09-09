export const CURRENCIES = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY"];
export const moneySuffix = (c) => (!c || c === "TRY" ? "₺" : c);
export const fmtMoney = (n, c) => `${(Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneySuffix(c)}`;
export const FX_DEFAULTS = { TRY: 1 };
