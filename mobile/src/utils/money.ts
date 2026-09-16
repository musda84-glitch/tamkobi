export function fmtMoney(n: unknown, currency = "TRY"): string {
  const num = Number(n);
  const amount = Number.isFinite(num) ? num : 0;
  const formatted = amount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const suffix = !currency || currency === "TRY" ? "₺" : currency;
  return `${formatted} ${suffix}`;
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
