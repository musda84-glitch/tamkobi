import React from "react";
import { FileText } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { canFaturalastirDraftInvoice, INVOICE_ISSUE_TYPE_OPTIONS } from "./InvoiceContextMenu";

/**
 * Taslak fatura listesi: siparişteki Faturalaştır tür seçici.
 * Seçilen tür e-belgeyse parent ElektronikFaturaOnayModal açar (tarih/saat + not).
 */
export function DraftInvoiceFaturalastirButton({
  inv,
  onIssue,
  disabled = false,
  testId,
  chooserTestId,
}) {
  if (!canFaturalastirDraftInvoice(inv)) return null;
  const no = inv.invoice_number || inv.id || inv._id || "inv";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 whitespace-nowrap"
          title="Taslağı faturalaştır — belge türü seç"
          aria-label="Taslağı faturalaştır"
          data-testid={testId || `draft-faturalastir-btn-${no}`}
        >
          <FileText className="w-3.5 h-3.5" />
          Taslağı faturalaştır
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        collisionPadding={24}
        className="z-[80] w-56 rounded-xl p-1.5 shadow-lg"
        data-testid={chooserTestId || `draft-faturalastir-chooser-${no}`}
      >
        <div className="px-2 py-1 text-[10px] font-bold text-emerald-700 uppercase">Belge türü</div>
        {INVOICE_ISSUE_TYPE_OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.key}
            onSelect={() => onIssue?.(inv, o.key)}
            className="flex-col items-start gap-0 py-1.5"
            data-testid={`draft-faturalastir-type-${o.key}`}
          >
            <span className="text-xs font-semibold text-slate-800">{o.label}</span>
            {o.sub ? <span className="text-[10px] text-slate-400">{o.sub}</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default DraftInvoiceFaturalastirButton;
