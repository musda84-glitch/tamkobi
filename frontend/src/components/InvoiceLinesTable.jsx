import React from "react";
import { fmtMoney } from "../utils/money";

/**
 * Salt okunur fatura/irsaliye kalem tablosu.
 * prefix varsayılanı ana liste testid'lerini korur (inv-lines-*).
 */
export function InvoiceLinesTable({
  inv,
  items = [],
  loading = false,
  prefix = "inv",
  extraHeader = null,
  renderExtraCell,
  topSlot = null,
}) {
  const num = inv?.invoice_number || "";
  const currency = inv?.currency || "TRY";
  if (loading) {
    return <div className="text-[11px] text-slate-400 pl-6">Kalemler yükleniyor…</div>;
  }
  if (!items.length) {
    return (
      <div className="text-[11px] text-slate-400 pl-6" data-testid={`${prefix}-lines-empty-${num}`}>
        Bu belgede kalem yok.
      </div>
    );
  }
  return (
    <div className="pl-6 space-y-2 overflow-x-auto">
      {topSlot}
      <table className="w-full text-[11px] text-slate-600" data-testid={`${prefix}-lines-table-${num}`}>
        <thead>
          <tr className="text-slate-400 uppercase text-[10px]">
            <th className="py-1 pr-3 text-left font-semibold">Ürün / Hizmet</th>
            <th className="py-1 px-2 text-center font-semibold w-20">Miktar</th>
            <th className="py-1 px-2 text-right font-semibold w-28">Birim</th>
            <th className="py-1 px-2 text-center font-semibold w-14">KDV</th>
            <th className="py-1 px-2 text-right font-semibold w-28">Tutar</th>
            {extraHeader}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((it, i) => (
            <tr key={i} data-testid={`${prefix}-line-${num}-${i}`}>
              <td className="py-1.5 pr-3 font-medium text-slate-800">
                {it.name || it.description || "—"}
                {it.sku ? <span className="ml-1.5 font-mono text-[10px] text-slate-400">{it.sku}</span> : null}
              </td>
              <td className="py-1.5 px-2 text-center whitespace-nowrap">{it.quantity} {it.unit || ""}</td>
              <td className="py-1.5 px-2 text-right whitespace-nowrap">{fmtMoney(it.unit_price, currency)}</td>
              <td className="py-1.5 px-2 text-center">%{it.vat_rate ?? 0}</td>
              <td className="py-1.5 px-2 text-right font-semibold text-slate-900 whitespace-nowrap">{fmtMoney(it.total_incl ?? it.total, currency)}</td>
              {renderExtraCell ? renderExtraCell(it, i) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
