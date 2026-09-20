import * as Print from "expo-print";
import { Platform, Share } from "react-native";
import type { ApiClient } from "../api/client";
import { normalizeApiBase } from "../api/url";
import { htmlToPdfFile, printHtmlNative, sharePdfFile } from "./nativePrint";
import { openPrintHtml, type PrintCompany } from "./orderPrint";
import { enrichPrintCompany, loadPrintProducts, loadPrintTemplate } from "./orderShare";
import {
  quoteFormHtml,
  quoteFormText,
  quotePdfFilename,
  quotePrintDocument,
} from "./quotePrint";
import type { QuoteDoc } from "./workDocs";

async function quotePrintParts(quote: QuoteDoc, company?: PrintCompany | null, client?: ApiClient | null) {
  const printCompany = await enrichPrintCompany(client, company);
  const template = await loadPrintTemplate(client, printCompany, "quote");
  const products = await loadPrintProducts(client, quote, printCompany);
  const body = quoteFormHtml(quote, printCompany, {
    template,
    products,
    mediaBase: client?.baseUrl ? normalizeApiBase(client.baseUrl) : undefined,
  });
  const title = `Teklif ${quote.quote_number || ""}`.trim();
  return { printCompany, body, title, html: quotePrintDocument(title, body) };
}

export async function printQuoteForm(
  quote: QuoteDoc,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
  const { printCompany, body, title, html } = await quotePrintParts(quote, company, client);
  if (Platform.OS === "web" && openPrintHtml(title, body, { page: "a4" })) return true;
  try {
    if (await printHtmlNative(html)) return true;
  } catch {
    /* try share sheet */
  }
  const shared = await Share.share({ message: quoteFormText(quote, printCompany), title }).catch(() => null);
  if (shared) return true;
  throw new Error("Yazdırılamadı.");
}

export async function downloadQuotePdf(
  client: ApiClient,
  quote: QuoteDoc,
  company?: PrintCompany | null,
): Promise<"file" | "print"> {
  const filename = quotePdfFilename(quote);
  const { body, html } = await quotePrintParts(quote, company, client);
  try {
    if (await htmlToPdfFile(html, filename)) return "file";
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
    if (openPrintHtml(filename, body, { page: "a4" })) return "print";
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
