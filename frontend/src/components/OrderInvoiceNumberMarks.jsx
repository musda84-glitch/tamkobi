import { orderInvoiceNumberLines } from "../utils/orderMoreMenu";

/** Sipariş satırı: resmi no «GİB:», yerel TA no «Fatura:» (gri). */
export function OrderInvoiceNumberMarks({ ord }) {
  const lines = orderInvoiceNumberLines(ord);
  if (!lines.length) return null;
  const no = ord?.order_number || "ord";
  return (
    <>
      {lines.map((line) => (
        <div
          key={line.kind}
          className={
            line.kind === "gib"
              ? "text-[10px] text-emerald-700 font-mono font-semibold mt-0.5"
              : "text-[10px] text-slate-500 font-mono mt-0.5"
          }
          data-testid={`${line.testId}-${no}`}
          title={line.title}
        >
          {line.label}
        </div>
      ))}
    </>
  );
}
