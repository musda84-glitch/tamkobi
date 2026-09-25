/** Shared invoice-copy modes (no UI imports — safe for Jest). */

export const INVOICE_COPY_MODES = [
  { key: "same_contact", label: "Aynı müşteri için", needsContact: false },
  { key: "different_contact", label: "Farklı bir müşteri için", needsContact: true },
  { key: "to_supplier_order", label: "Tedarikçi siparişine çevir", needsContact: true, preferSupplier: true },
];

export function canCopyInvoice(inv) {
  if (!inv) return false;
  if (inv.status === "cancelled") return false;
  // Liste/özet satırlarında items gelmeyebilir; sunucu kopyada kalemleri yükler.
  return true;
}
