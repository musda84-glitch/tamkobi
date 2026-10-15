import React from "react";
import { FileText } from "lucide-react";
import { canFaturalastirDraftInvoice } from "./InvoiceContextMenu";
import { FATURALASTIR_CONFIRM_DETAIL } from "../utils/gibMukellef";

/**
 * Taslak fatura listesi: POST /invoices/{id}/approve (cari + stok).
 * E-belge gönderimi ayrı adımdır.
 */
export function DraftInvoiceFaturalastirButton({
  inv,
  onApprove,
  onIssue,
  disabled = false,
  testId,
}) {
  if (!canFaturalastirDraftInvoice(inv)) return null;
  const no = inv.invoice_number || inv.id || inv._id || "inv";
  const handle = () => (onApprove || onIssue)?.(inv);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handle}
      className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 whitespace-nowrap"
      title={FATURALASTIR_CONFIRM_DETAIL}
      aria-label="Taslağı Faturalaştır"
      data-testid={testId || `draft-faturalastir-btn-${no}`}
    >
      <FileText className="w-3.5 h-3.5" />
      Taslağı Faturalaştır
    </button>
  );
}

export default DraftInvoiceFaturalastirButton;
