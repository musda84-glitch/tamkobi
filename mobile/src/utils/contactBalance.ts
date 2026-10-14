/** Cari seçici bakiyesi — web contactBalanceBadge ile aynı biçim. */

const EPS = 0.005;

export function formatTrBalanceAmount(n: unknown): string {
  const num = Number(n);
  const amount = Number.isFinite(num) ? Math.abs(num) : 0;
  const [whole, frac] = amount.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped},${frac}`;
}

export function balanceUnit(currency?: string | null): string {
  const code = String(currency || "TRY").trim().toUpperCase();
  return !code || code === "TRY" ? "₺" : code;
}

export type BalanceTone = "alacak" | "borc" | "zero";

export function contactBalanceBadge(contact?: { balance?: number; balance_display?: number; currency?: string; balance_currency?: string } | null): {
  text: string;
  side: "A" | "B" | "";
  tone: BalanceTone;
} {
  const raw = contact?.balance_display != null ? contact.balance_display : contact?.balance;
  const num = Number(raw);
  const amount = Number.isFinite(num) ? num : 0;
  const currency = contact?.balance_currency || contact?.currency || "TRY";
  const unit = balanceUnit(currency);
  const text = formatTrBalanceAmount(amount);
  if (amount > EPS) return { text: `${text} ${unit} A`, side: "A", tone: "alacak" };
  if (amount < -EPS) return { text: `${text} ${unit} B`, side: "B", tone: "borc" };
  return { text: `${text} ${unit}`, side: "", tone: "zero" };
}

export const BALANCE_TONE_COLOR: Record<BalanceTone, string> = {
  alacak: "#059669",
  borc: "#E11D48",
  zero: "#94A3B8",
};
