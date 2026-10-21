import React from "react";
import { fmtMoney } from "../utils/money";

/**
 * Salt okunur fatura/irsaliye kalem tablosu.
 * prefix varsayılanı ana liste testid'lerini korur (inv-lines-*).
 */

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function positiveMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0.004 ? round2(n) : 0;
}

/** Belge iskontosu: general_discount_amount, yoksa discount_total. KDV hariç. */
function documentDiscount(inv) {
  return positiveMoney(inv?.general_discount_amount) || positiveMoney(inv?.discount_total);
}

function lineNet(it) {
  const net = Number(it?.total);
  if (Number.isFinite(net)) return net;
  const qty = Number(it?.quantity);
  const unit = Number(it?.unit_price);
  if (Number.isFinite(qty) && Number.isFinite(unit)) return qty * unit;
  return 0;
}

/**
 * Satır iskontolu brüt (KDV dahil). factor = (net toplam − iskonto) / net toplam.
 * Kuruş farkı son satıra yazılır; toplam inv.grand_total olur.
 */
function discountedGrosses(items, inv, discount) {
  const nets = items.map(lineNet);
  const netSum = nets.reduce((sum, n) => sum + n, 0);
  const factor = netSum > 0 ? (netSum - discount) / netSum : 1;
  const rows = items.map((it, i) => {
    const base = round2(nets[i] * factor);
    const vat = round2(base * (Number(it?.vat_rate) || 0) / 100);
    return round2(base + vat);
  });
  const grand = Number(inv?.grand_total);
  if (Number.isFinite(grand) && rows.length) {
    const prev = rows.slice(0, -1).reduce((sum, n) => sum + n, 0);
    rows[rows.length - 1] = round2(grand - prev);
  }
  return rows;
}

function SummaryRow({ label, amount, currency, colSpan, trail = 0, strong, testId, tone }) {
  return (
    <tr data-testid={testId || undefined} className={tone || ""}>
      <td colSpan={colSpan} className={`py-1 pr-3 text-right ${strong ? "font-semibold text-slate-800" : "text-slate-500"}`}>{label}</td>
      <td className={`py-1 px-2 text-right whitespace-nowrap ${strong ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>{fmtMoney(amount, currency)}</td>
      {Array.from({ length: trail }, (_, i) => <td key={i} />)}
    </tr>
  );
}

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
  const discount = documentDiscount(inv);
  const showDiscount = discount > 0;
  const discounted = showDiscount ? discountedGrosses(items, inv, discount) : [];
  const trail = (showDiscount ? 1 : 0) + (extraHeader || renderExtraCell ? 1 : 0);
  const subtotal = Number.isFinite(Number(inv?.subtotal)) ? Number(inv.subtotal) : null;
  const vatTotal = Number.isFinite(Number(inv?.vat_total)) ? Number(inv.vat_total) : null;
  const grand = Number.isFinite(Number(inv?.grand_total)) ? Number(inv.grand_total) : null;
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
            {showDiscount ? (
              <th className="py-1 px-2 text-right font-semibold w-32">İskontolu tutar</th>
            ) : null}
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
              {showDiscount ? (
                <td className="py-1.5 px-2 text-right font-semibold text-emerald-800 whitespace-nowrap" data-testid={`${prefix}-line-discounted-${num}-${i}`}>
                  {fmtMoney(discounted[i], currency)}
                </td>
              ) : null}
              {renderExtraCell ? renderExtraCell(it, i) : null}
            </tr>
          ))}
        </tbody>
        {showDiscount ? (
          <tfoot className="border-t border-slate-200">
            <SummaryRow
              label="Genel iskonto (havale indirimi)"
              amount={discount}
              currency={currency}
              colSpan={4}
              trail={trail}
              tone="text-rose-700"
              testId={`${prefix}-general-discount-${num}`}
            />
            {subtotal != null ? (
              <SummaryRow label="Ara toplam" amount={subtotal} currency={currency} colSpan={4} trail={trail} testId={`${prefix}-subtotal-${num}`} />
            ) : null}
            {vatTotal != null ? (
              <SummaryRow label="KDV" amount={vatTotal} currency={currency} colSpan={4} trail={trail} testId={`${prefix}-vat-total-${num}`} />
            ) : null}
            {grand != null ? (
              <SummaryRow
                label="Genel toplam"
                amount={grand}
                currency={currency}
                colSpan={4}
                trail={trail}
                strong
                testId={`${prefix}-grand-total-${num}`}
              />
            ) : null}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
