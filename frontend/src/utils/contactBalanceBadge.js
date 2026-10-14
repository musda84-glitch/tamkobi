/** Cari seçici bakiyesi: 12.450,00 ₺ B / 3.200,00 ₺ A. Artı = alacak, eksi = borç. */

const EPS = 0.005;

export function formatTrBalanceAmount(n) {
  const num = Number(n);
  const amount = Number.isFinite(num) ? Math.abs(num) : 0;
  const [whole, frac] = amount.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped},${frac}`;
}

export function balanceUnit(currency) {
  const code = String(currency || "TRY").trim().toUpperCase();
  return !code || code === "TRY" ? "₺" : code;
}

/**
 * @returns {{ text: string, side: "A"|"B"|"", tone: "alacak"|"borc"|"zero" }}
 */
export function contactBalanceBadge(contact) {
  const raw = contact?.balance_display != null ? contact.balance_display : contact?.balance;
  const num = Number(raw);
  const amount = Number.isFinite(num) ? num : 0;
  const currency = contact?.balance_currency || contact?.currency || "TRY";
  const unit = balanceUnit(currency);
  const text = formatTrBalanceAmount(amount);
  if (amount > EPS) {
    return { text: `${text} ${unit} A`, side: "A", tone: "alacak" };
  }
  if (amount < -EPS) {
    return { text: `${text} ${unit} B`, side: "B", tone: "borc" };
  }
  return { text: `${text} ${unit}`, side: "", tone: "zero" };
}

export const BALANCE_TONE_CLASS = {
  alacak: "text-emerald-600",
  borc: "text-rose-600",
  zero: "text-slate-400",
};
