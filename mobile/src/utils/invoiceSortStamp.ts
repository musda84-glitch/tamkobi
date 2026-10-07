/** Fatura listesi sıralama damgası: son işlem veya fatura tarihi+saati. */
export function invoiceActivityStamp(inv?: {
  updated_at?: string | null;
  issued_at?: string | null;
  created_at?: string | null;
  queued_at?: string | null;
  issue_date?: string | null;
  issue_time?: string | null;
} | null): string {
  if (!inv) return "";
  const candidates: string[] = [];
  for (const k of ["updated_at", "issued_at", "created_at", "queued_at"] as const) {
    const v = inv[k];
    if (v) candidates.push(String(v));
  }
  const d = String(inv.issue_date || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    let t = String(inv.issue_time || "00:00:00").trim().slice(0, 8);
    if (/^\d{2}:\d{2}$/.test(t)) t = `${t}:00`;
    if (!/^\d{2}:\d{2}:\d{2}$/.test(t)) t = "00:00:00";
    candidates.push(`${d}T${t}`);
  }
  if (!candidates.length) return "";
  return candidates.sort().pop() || "";
}

export function compareInvoiceActivity(
  a: Parameters<typeof invoiceActivityStamp>[0],
  b: Parameters<typeof invoiceActivityStamp>[0],
  dir: "asc" | "desc" = "desc",
): number {
  const sa = invoiceActivityStamp(a);
  const sb = invoiceActivityStamp(b);
  const c = sa.localeCompare(sb);
  return dir === "asc" ? c : -c;
}
