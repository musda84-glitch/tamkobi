import type { Order } from "../types";
import { fmtDate, fmtMoney } from "./money";
import {
  mergePrintTemplate,
  orderFormHtml,
  type OrderFormOptions,
  type PrintCompany,
} from "./orderPrint";
import type { QuoteDoc, WorkItem } from "./workDocs";
import { namedItems, workItemLineGross, workItemTotals } from "./workDocs";

export type { PrintCompany };
export type QuoteFormOptions = OrderFormOptions;

function linesOf(quote: QuoteDoc): WorkItem[] {
  return namedItems(quote.items || []);
}

export function quotePdfFilename(quote: QuoteDoc): string {
  const raw = String(quote.quote_number || "teklif").replace(/[^\w.-]+/g, "_");
  return `${raw || "teklif"}.pdf`;
}

export function isPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function isPdfContentType(type: string | null | undefined): boolean {
  return /pdf/i.test(String(type || ""));
}

export function quotePrintDocument(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${String(title || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")}</title>
<style>@page{size:A4;margin:8mm}html,body{margin:0;padding:0;font-family:-apple-system,Roboto,'Segoe UI','Noto Sans','Liberation Sans',Arial,Helvetica,sans-serif;color:#0f172a;background:#fff}</style>
</head><body>${bodyHtml}</body></html>`;
}

function quoteAsPrintOrder(quote: QuoteDoc): Order {
  const totals = workItemTotals(quote.items || []);
  return {
    order_number: quote.quote_number,
    contact_name: quote.contact_name,
    customer_name: quote.contact_name,
    order_date: quote.issue_date,
    notes: quote.notes,
    subtotal: quote.subtotal ?? totals.subtotal,
    vat_total: quote.vat_total ?? totals.vat,
    grand_total: quote.grand_total ?? totals.grandTotal,
    items: linesOf(quote).map((it) => {
      const extra = it as WorkItem & Record<string, unknown>;
      const qty = Number(it.quantity || 0);
      const price = Number(it.unit_price || 0);
      const vat = Number(it.vat_rate ?? 20);
      const total = Number(extra.total ?? qty * price);
      return {
        ...extra,
        product_id: it.product_id,
        product_name: it.name,
        name: it.name,
        quantity: qty,
        unit_price: price,
        vat_rate: vat,
        unit: it.unit,
        unit_price_incl: Number(extra.unit_price_incl ?? price * (1 + vat / 100)),
        total,
        total_incl: Number(extra.total_incl ?? workItemLineGross(it)),
      };
    }),
    title: quote.title,
    valid_until: quote.valid_until,
    terms: quote.terms,
    issue_date: quote.issue_date,
  } as Order & { title?: string; valid_until?: string; terms?: string; issue_date?: string };
}

/** Web PrintDocument (quote) ile aynı şablon: layout, logo, barkod, resim, KDV kolonları. */
export function quoteFormHtml(quote: QuoteDoc, company?: PrintCompany | null, options?: QuoteFormOptions): string {
  return orderFormHtml(quoteAsPrintOrder(quote), company, {
    ...options,
    template: mergePrintTemplate(options?.template),
    docType: "quote",
  });
}

export function quoteFormText(quote: QuoteDoc, company?: PrintCompany | null): string {
  const totals = workItemTotals(quote.items || []);
  const rows = linesOf(quote).map((it) => `  ${it.quantity} × ${it.name}  ${fmtMoney(workItemLineGross(it))}`);
  return [
    "FİYAT TEKLİFİ",
    company?.name || "",
    `${quote.quote_number || "Teklif"} · ${fmtDate(quote.issue_date)}`,
    `Müşteri: ${quote.contact_name || "—"}`,
    quote.title || "",
    quote.valid_until ? `Geçerlilik: ${fmtDate(quote.valid_until)}` : "",
    "",
    ...rows,
    "",
    `Toplam ${fmtMoney(quote.grand_total ?? totals.grandTotal)}`,
    quote.notes ? `Not: ${quote.notes}` : "",
    quote.terms ? `Şartlar: ${quote.terms}` : "",
  ].filter((x) => x !== "").join("\n");
}
