import React, { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Eye, Printer, X, Package } from "lucide-react";
import { resolveImageUrl } from "../utils/imageUrl";
import { useEscape } from "../utils/useEscape";
import { Barcode } from "./BarcodeLabelPrint";
import { statusTr } from "../utils/labels";
import { formatTrAmount } from "../utils/money";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { pickLineNote } from "../utils/pickLineNote";
import { b2bPreviewHidePrices, b2bPreviewLineMeta, b2bPreviewPrintLabel, b2bPreviewStockBits, lineTotalIncl, printQtyTotalLabel } from "../utils/printFormLayout";

const fmt = (n) => formatTrAmount((Number(n) || 0));

const lineCode = (it, products) => {
  const p = (products || []).find((x) => x.id === it.product_id || x._id === it.product_id);
  return String(it.barcode || p?.barcode || it.sku || p?.sku || "").trim();
};

const lineImage = (it, products) => {
  const p = (products || []).find((x) => x.id === it.product_id || x._id === it.product_id);
  return it.image_url || p?.image_url || "";
};

export const B2BOrderPreview = ({ order, products, company, onClose }) => {
  useEscape(onClose);
  const [hidePrices, setHidePrices] = useState(false);
  useEffect(() => {
    const reset = () => setHidePrices(false);
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);
  const printPreview = (plain) => {
    flushSync(() => setHidePrices(!!plain));
    window.print();
  };
  if (!order) return null;
  const items = order.items || [];
  const custNo = (order.customer_order_number || "").trim();
  const orderNote = String(order.notes || order.note || "").trim();
  const qtyTotalLabel = printQtyTotalLabel(items);
  const plain = b2bPreviewHidePrices(hidePrices);
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/70 flex items-start justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static" {...backdropDismissProps(onClose)}>
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl print:shadow-none print:rounded-none my-6" onClick={(e) => e.stopPropagation()} data-testid="b2b-order-preview" data-hide-prices={plain ? "1" : "0"}>
        <div className="flex items-center justify-between px-5 py-3 border-b no-print print:hidden">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> Sipariş önizleme</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => printPreview(true)} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-slate-800 rounded-lg text-xs font-semibold" data-testid="b2b-order-preview-print-plain"><Printer className="w-3.5 h-3.5" /> {b2bPreviewPrintLabel(true)}</button>
            <button type="button" onClick={() => printPreview(false)} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="b2b-order-preview-print"><Printer className="w-3.5 h-3.5" /> {b2bPreviewPrintLabel(false)}</button>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="b2b-order-preview-close"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="p-6 space-y-4 text-xs" id="print-area">
          <div className="flex justify-between items-start gap-4">
            <div>
              {company?.name && <div className="text-sm font-black text-slate-900">{company.name}</div>}
              <div className="text-[10px] uppercase font-bold text-slate-400 mt-2">Sipariş{plain ? " · fiyatsız" : ""}</div>
              <div className="font-mono font-bold text-base text-slate-900" data-testid="b2b-preview-order-number">{order.order_number}</div>
              {custNo ? <div className="mt-1 text-slate-600">Sizin no: <b className="font-mono" data-testid="b2b-preview-customer-order-no">{custNo}</b></div> : null}
            </div>
            <div className="text-right text-slate-500">
              <div>{(order.order_date || "").slice(0, 10)}</div>
              <div className="font-semibold text-slate-700">{statusTr(order.order_status)}</div>
            </div>
          </div>
          <div className="divide-y border rounded-xl overflow-hidden">
            {items.map((it, i) => {
              const img = lineImage(it, products);
              const code = lineCode(it, products);
              const sku = String(it.sku || "").trim();
              const stockNote = pickLineNote(it);
              const prod = (products || []).find((x) => x.id === it.product_id || x._id === it.product_id) || {};
              const stockBits = b2bPreviewStockBits(it, prod);
              return (
                <div key={it.product_id || i} className="p-3 flex gap-3 items-start bg-white" data-testid={`b2b-preview-line-${i}`}>
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg border bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center">
                    {img ? <img src={resolveImageUrl(img)} alt="" className="w-full h-full object-contain" /> : <Package className="w-6 h-6 text-slate-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-900 leading-tight">{it.product_name}</div>
                    <div className="text-slate-500 mt-0.5" data-testid={`b2b-preview-line-meta-${i}`}>{b2bPreviewLineMeta(it, plain)}</div>
                    {sku && sku !== code && <div className="text-[10px] text-slate-400 font-mono mt-0.5">SKU {sku}</div>}
                    {stockBits.tags.length || stockBits.bits.length ? (
                      <div className="mt-1 space-y-1" data-testid={`b2b-preview-line-label-${i}`}>
                        {stockBits.tags.length ? (
                          <div className="flex flex-wrap gap-0.5">
                            {stockBits.tags.map((t) => (
                              <span key={t} className="text-[9px] px-1 py-0 rounded bg-slate-100 text-slate-600">{t}</span>
                            ))}
                          </div>
                        ) : null}
                        {stockBits.bits.length ? (
                          <div className="text-[10px] text-slate-500">{stockBits.bits.join(" · ")}</div>
                        ) : null}
                      </div>
                    ) : null}
                    {stockNote ? (
                      <div className="mt-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-snug whitespace-pre-wrap" data-testid={`b2b-preview-line-note-${i}`}>
                        <span className="font-semibold text-amber-700/80">Sipariş stok notu · </span>
                        {stockNote}
                      </div>
                    ) : null}
                    {plain ? null : <div className="mt-1 font-semibold" data-testid={`b2b-preview-line-total-${i}`}>{fmt(lineTotalIncl(it))} ₺</div>}
                  </div>
                  {code ? (
                    <div className="w-[150px] sm:w-[180px] shrink-0" data-testid={`b2b-preview-barcode-${i}`}>
                      <Barcode value={code} height={36} width={1.2} fontSize={10} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {orderNote ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-700 whitespace-pre-wrap" data-testid="b2b-preview-order-note">
              <b>Sipariş notu:</b> {orderNote}
            </div>
          ) : null}
          <div className="flex justify-end">
            <div className="text-right space-y-0.5" data-testid="b2b-preview-totals">
              <div className="text-slate-600 font-semibold" data-testid="b2b-preview-qty-total">{qtyTotalLabel}</div>
              {plain ? null : <div className="font-black text-sm" data-testid="b2b-preview-grand-total">Toplam {fmt(order.grand_total ?? order.total_amount)} ₺</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PreviewOrderBtn = ({ onClick, orderNumber }) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-slate-700 text-[11px] font-semibold hover:bg-slate-50" data-testid={`b2b-order-preview-btn-${orderNumber}`}><Eye className="w-3 h-3" /> Önizle</button>
);
