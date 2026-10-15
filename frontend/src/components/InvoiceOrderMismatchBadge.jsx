/** Sipariş tutarı bağlı faturadan 0,01 TL'den fazla ayrıldığında. */
export function InvoiceOrderMismatchBadge({ ord }) {
  const text = String(ord?.invoice_mismatch_warning || "").trim();
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
