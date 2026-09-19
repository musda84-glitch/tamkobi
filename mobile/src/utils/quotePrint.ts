import type { Company } from "../types";
import { fmtDate, fmtMoney } from "./money";
import type { QuoteDoc, WorkItem } from "./workDocs";
import { namedItems, workItemLineGross, workItemTotals } from "./workDocs";

export type PrintCompany = Pick<Company, "name"> & { address?: string; city?: string; phone?: string; email?: string };

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4;margin:12mm}html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#fff}body{padding:8px}</style>
</head><body>${bodyHtml}</body></html>`;
}

export function quoteFormHtml(quote: QuoteDoc, company?: PrintCompany | null): string {
  const totals = workItemTotals(quote.items || []);
  const rows = linesOf(quote)
    .map((it) => {
      return `<tr><td>${esc(it.name)}</td><td style="text-align:right">${esc(it.quantity)} ${esc(it.unit || "")}</td><td style="text-align:right">${esc(fmtMoney(it.unit_price))}</td><td style="text-align:right">%${esc(it.vat_rate ?? 20)}</td><td style="text-align:right">${esc(fmtMoney(workItemLineGross(it)))}</td></tr>`;
    })
    .join("");
  return `
    <h1 style="margin:0 0 4px">FİYAT TEKLİFİ</h1>
    <div style="color:#64748b">${esc(company?.name || "")}</div>
    <div style="margin:12px 0"><b>${esc(quote.quote_number || "Teklif")}</b> · ${esc(fmtDate(quote.issue_date))}</div>
    <div><b>Müşteri:</b> ${esc(quote.contact_name || "—")}</div>
    ${quote.title ? `<div>${esc(quote.title)}</div>` : ""}
    ${quote.valid_until ? `<div><b>Geçerlilik:</b> ${esc(fmtDate(quote.valid_until))}</div>` : ""}
    <table style="width:100%;border-collapse:collapse;margin-top:16px" cellpadding="6">
      <thead><tr style="border-bottom:2px solid #0f172a;text-align:left"><th>Kalem</th><th style="text-align:right">Miktar</th><th style="text-align:right">Birim</th><th style="text-align:right">KDV</th><th style="text-align:right">Tutar</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='5'>Kalem yok</td></tr>"}</tbody>
    </table>
    <div style="margin-top:16px;font-size:18px;font-weight:800;text-align:right">Toplam ${esc(fmtMoney(quote.grand_total ?? totals.grandTotal))}</div>
    ${quote.notes ? `<div style="margin-top:12px"><b>Not:</b> ${esc(quote.notes)}</div>` : ""}
    ${quote.terms ? `<div style="margin-top:8px"><b>Şartlar:</b> ${esc(quote.terms)}</div>` : ""}
    <div style="margin-top:24px;color:#64748b;font-size:12px">Bu belge fiyat teklifidir; fatura yerine geçmez.</div>
  `;
}

export function quoteFormText(quote: QuoteDoc, company?: PrintCompany | null): string {
  const totals = workItemTotals(quote.items || []);
  const rows = linesOf(quote).map((it) => `  ${it.quantity} × ${it.name}  ${fmtMoney(Number(it.quantity || 0) * Number(it.unit_price || 0))}`);
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
  ].filter((x) => x !== "").join("\n");
}
