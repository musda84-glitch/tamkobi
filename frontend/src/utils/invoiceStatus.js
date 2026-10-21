/** İptal / void faturalar aktif listelerde gizlenir. */

export const CANCELLED_INVOICE_STATUSES = new Set(["cancelled", "canceled", "cancelling", "void"]);

function fold(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/i̇/g, "i");
}

/** Cari seviyesindeki ödeme faturayı kapatmışsa true. Alan yoksa payment_status kalır. */
export function contactPaymentSettled(inv) {
  if (!inv || inv.effective_open == null || inv.effective_open === "") return false;
  if (inv.status === "draft" || isCancelledInvoice(inv)) return false;
  if (inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch") return false;
  const open = Number(inv.effective_open);
  return Number.isFinite(open) && open <= 0.009;
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

export const APPROVING_INVOICE_BADGE = "Faturalaştırılıyor…";

export function isApprovingInvoice(inv) {
  return Boolean(inv) && inv.status === "approving";
}

/** Faturalaştır claim sırasında satır aksiyonları kapalı. */
export function invoiceRowActionsDisabled(inv) {
  return isApprovingInvoice(inv);
}
