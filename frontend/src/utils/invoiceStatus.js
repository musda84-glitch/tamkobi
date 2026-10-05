/** İptal / void faturalar aktif listelerde gizlenir. */

export const CANCELLED_INVOICE_STATUSES = new Set(["cancelled", "canceled", "void"]);

function fold(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/i̇/g, "i");
}

export function isCancelledInvoice(inv) {
  if (!inv) return false;
  if (CANCELLED_INVOICE_STATUSES.has(fold(inv.status))) return true;
  if (CANCELLED_INVOICE_STATUSES.has(fold(inv.payment_status))) return true;
  return fold(inv.gib_status).includes("iptal");
}

export function withoutCancelledInvoices(rows) {
  return (Array.isArray(rows) ? rows : []).filter((inv) => !isCancelledInvoice(inv));
}

/** Liste: iptaller varsayılan gizli; showCancelled ile görünür. */
export function invoicesForDisplay(rows, showCancelled = false) {
  const list = Array.isArray(rows) ? rows : [];
  return showCancelled ? list : withoutCancelledInvoices(list);
}
