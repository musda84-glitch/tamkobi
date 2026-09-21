import * as Print from "expo-print";
import { Platform, Share } from "react-native";
import type { ApiClient } from "../api/client";
import { normalizeApiBase } from "../api/url";
import { htmlToPdfFile, paperPrintSize, printHtmlNative, printOfficialBlob, sharePdfFile } from "./nativePrint";
import { openPrintHtml, printPageSize, type PrintCompany } from "./orderPrint";
import {
  enrichPrintCompany,
  fetchApiBlob,
  loadContactBalance,
  loadPrintProducts,
  loadPrintTemplate,
} from "./orderShare";
import {
  isPdfContentType,
  isPdfMagic,
  quoteFormHtml,
  quoteFormText,
  quotePdfFilename,
  quotePrintDocument,
} from "./quotePrint";
import { idOf } from "./money";
import type { QuoteDoc } from "./workDocs";

async function quotePrintParts(quote: QuoteDoc, company?: PrintCompany | null, client?: ApiClient | null) {
  const printCompany = await enrichPrintCompany(client, company);
  const template = await loadPrintTemplate(client, printCompany, "quote");
  const products = await loadPrintProducts(client, quote, printCompany);
  const contactBalance = await loadContactBalance(client, printCompany, quote);
  const paper = printPageSize(template.paper);
  const body = quoteFormHtml(quote, printCompany, {
    template,
    products,
    mediaBase: client?.baseUrl ? normalizeApiBase(client.baseUrl) : undefined,
    contactBalance,
  });
  const title = `Teklif ${quote.quote_number || ""}`.trim();
  return { printCompany, body, title, paper, html: quotePrintDocument(title, body, paper) };
}

export async function printQuoteForm(
  quote: QuoteDoc,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
  const { printCompany, body, title, html, paper } = await quotePrintParts(quote, company, client);
  if (Platform.OS === "web" && openPrintHtml(title, body, { page: "a4", paper })) return true;
  try {
    if (await printHtmlNative(html, paperPrintSize(paper))) return true;
  } catch {
    /* try share sheet */
  }
  const shared = await Share.share({ message: quoteFormText(quote, printCompany), title }).catch(() => null);
  if (shared) return true;
  throw new Error("Yazdırılamadı.");
}

async function downloadServerQuotePdf(client: ApiClient, quote: QuoteDoc): Promise<boolean> {
  const id = idOf(quote);
  if (!id) return false;
  const blob = await fetchApiBlob(client, `/quotes/${id}/pdf?download=1`);
  if (!blob) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isPdfMagic(bytes) && !isPdfContentType(blob.type)) return false;
  return printOfficialBlob(blob, quotePdfFilename(quote).replace(/\.pdf$/i, ""));
}

export async function downloadQuotePdf(
  client: ApiClient,
  quote: QuoteDoc,
  company?: PrintCompany | null,
): Promise<"file" | "print"> {
  const filename = quotePdfFilename(quote);
  try {
    if (await downloadServerQuotePdf(client, quote)) return "file";
  } catch {
    /* local HTML fallback uses the same web print-template */
  }
  const { body, html, paper } = await quotePrintParts(quote, company, client);
  try {
    if (await htmlToPdfFile(html, filename, paperPrintSize(paper))) return "file";
  } catch {
    /* web / print fallback */
  }
  if (Platform.OS === "web") {
    try {
      const printed = await Print.printToFileAsync({ html });
      if (printed.uri) {
        const res = await fetch(printed.uri);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (await sharePdfFile(bytes, filename)) return "file";
      }
    } catch {
      /* print window */
    }
    if (openPrintHtml(filename, body, { page: "a4", paper })) return "print";
  }
  throw new Error("PDF indirilemedi.");
}

export async function shareApprovalLink(link: string, title?: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(link);
    return true;
  }
  await Share.share({ message: link, title: title || "Teklif onay linki" }).catch(() => null);
  return true;
}
