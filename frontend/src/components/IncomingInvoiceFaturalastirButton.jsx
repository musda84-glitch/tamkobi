import React from "react";
import { FileText } from "lucide-react";
import { incomingPurchaseLedgerPosted, isIncomingPurchaseInvoice } from "./InvoiceContextMenu";

/**
 * Gelen fatura: sipariş taslağını faturalaştır gibi tek tık.
 * e-Fatura / e-Arşiv / kağıt listesi yok — belge zaten GİB'den geldi.
 */
export function IncomingInvoiceFaturalastirButton({
  inv,
  disabled = false,
  onPress,
  testId,
}) {
  if (!isIncomingPurchaseInvoice(inv)) return null;
  const posted = incomingPurchaseLedgerPosted(inv);
  const no = inv.invoice_number || inv.id || inv._id || "inv";
  return (
    <button
      type="button"
      disabled={posted || disabled}
      onClick={() => { if (!posted && !disabled) onPress?.(inv); }}
      className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      title={posted ? "Cariye işlendi" : "Alış faturası olarak cariye ve stoğa işle"}
      aria-label={posted ? "Cariye işlendi" : "Faturalaştır"}
      data-testid={testId || `incoming-faturalastir-${no}`}
      data-posted={posted ? "1" : "0"}
    >
      <FileText className="w-3.5 h-3.5" />
      {posted ? "Cariye işlendi" : "Faturalaştır"}
    </button>
  );
}

export default IncomingInvoiceFaturalastirButton;
