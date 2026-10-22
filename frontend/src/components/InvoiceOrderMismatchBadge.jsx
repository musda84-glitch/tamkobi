/** Sipariş tutarı bağlı faturadan 0,01 TL'den fazla ayrıldığında. */
export function mismatchWarningText(warning, hideAmount) {
  const text = String(warning || "").trim();
  if (!text) return "";
  if (!hideAmount) return text;
  const stripped = text
    .replace(/\s*\([^)]*\d[^)]*\)/g, "")
    .replace(/\d[\d.]*,\d{2}\s*TL/gi, "")
    .trim();
  return stripped || "Fatura siparişten farklı";
}

export function InvoiceOrderMismatchBadge({ ord, hideAmount = false }) {
  const text = mismatchWarningText(ord?.invoice_mismatch_warning, hideAmount);
  if (!text) return null;
  const no = ord?.order_number || ord?.id || "ord";
  return (
    <div
      className="mt-1 inline-block max-w-[16rem] text-left text-[10px] font-semibold leading-tight text-amber-900 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
      data-testid={`invoice-order-mismatch-${no}`}
      title={text}
    >
      {text}
    </div>
  );
}
