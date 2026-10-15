/** Sipariş listesindeki yeşil faturasız fatura düğmesi. */

export const UNINVOICED_INVOICE_BUTTON_CLASS =
  "p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm";

export const INVOICE_MISSING_HINT = "bağlı fatura bulunamadı";

export function orderInvoiceLinkMissing(ord) {
  return !!ord?.invoice_missing;
}

/**
 * Yeşil «Fatura işlemleri» düğmesi.
 * invoice_missing, invoice_id kalsa bile faturasız sayılır.
 * Canlı taslak veya cariye işlenmiş faturada null (sarı / Faturalaştı kalır).
 */
export function orderUninvoicedInvoiceButton(ord) {
  if (!ord) return null;
  const missing = orderInvoiceLinkMissing(ord);
  if (!missing && (ord.is_invoiced || ord.invoice_id)) return null;
  return {
    className: UNINVOICED_INVOICE_BUTTON_CLASS,
    title: missing ? INVOICE_MISSING_HINT : "Fatura işlemleri",
    ariaLabel: "Fatura işlemleri",
  };
}
