/** Fatura listesi sıralama damgası: son işlem (updated/issued/created) veya fatura tarihi+saati. */
export function invoiceActivityStamp(inv) {
  if (!inv) return "";
  const candidates = [];
  for (const k of ["updated_at", "issued_at", "created_at", "queued_at"]) {
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
  return candidates.sort().pop();
}

export function compareInvoiceActivity(a, b, dir = "desc") {
  const sa = invoiceActivityStamp(a);
  const sb = invoiceActivityStamp(b);
  const c = sa.localeCompare(sb);
  return dir === "asc" ? c : -c;
}
