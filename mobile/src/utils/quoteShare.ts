import { File as CacheFile, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";
import type { ApiClient } from "../api/client";
import { ApiHttpError, apiErrorMessage } from "../api/errors";
import { API_BASE_HEADER, requestTarget } from "../api/url";
import { idOf } from "./money";
import { openPrintHtml, type PrintCompany } from "./orderPrint";
import {
  isPdfContentType,
  isPdfMagic,
  quoteFormHtml,
  quoteFormText,
  quotePdfFilename,
  quotePrintDocument,
} from "./quotePrint";
import type { QuoteDoc } from "./workDocs";

function triggerBlobDownload(blob: Blob, filename: string): boolean {
  if (typeof document === "undefined") return false;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
  return true;
}

async function sharePdfFile(bytes: Uint8Array, filename: string): Promise<boolean> {
  if (Platform.OS === "web") {
    const copy = Uint8Array.from(bytes);
    return triggerBlobDownload(new Blob([copy.buffer], { type: "application/pdf" }), filename);
  }
  const file = new CacheFile(Paths.cache, filename);
  file.create({ overwrite: true });
  await file.write(bytes);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: filename });
    return true;
  }
  await file.preview();
  return true;
}

async function printHtmlNative(html: string): Promise<boolean> {
  if (Platform.OS === "web") return false;
  await Print.printAsync({ html });
  return true;
}

export async function fetchQuotePdfBytes(client: ApiClient, quoteId: string): Promise<Uint8Array | null> {
  const { url, proxiedBase } = requestTarget(client.baseUrl, `/quotes/${quoteId}/pdf?download=1`);
  const headers: Record<string, string> = { Accept: "application/pdf" };
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  if (proxiedBase) headers[API_BASE_HEADER] = proxiedBase;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new ApiHttpError(0, null, apiErrorMessage(err, "PDF indirilemedi."));
  }
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "";
  if (isPdfContentType(type) || isPdfMagic(bytes)) return bytes;
  return null;
}

export async function printQuoteForm(quote: QuoteDoc, company?: PrintCompany | null): Promise<boolean> {
  const title = `Teklif ${quote.quote_number || ""}`.trim();
  const body = quoteFormHtml(quote, company);
  const html = quotePrintDocument(title, body);
  if (Platform.OS === "web" && openPrintHtml(title, body, { page: "a4" })) return true;
  try {
    if (await printHtmlNative(html)) return true;
  } catch {
    /* try share sheet */
  }
  const shared = await Share.share({ message: quoteFormText(quote, company), title }).catch(() => null);
  if (shared) return true;
  throw new Error("Yazdırılamadı.");
}

export async function downloadQuotePdf(client: ApiClient, quote: QuoteDoc): Promise<"file" | "print"> {
  const filename = quotePdfFilename(quote);
  const qid = idOf(quote);
  if (!qid) throw new Error("Teklif kaydı yok.");
  const bytes = await fetchQuotePdfBytes(client, qid);
  if (bytes && await sharePdfFile(bytes, filename)) return "file";
  const html = quotePrintDocument(filename, quoteFormHtml(quote));
  if (Platform.OS !== "web") {
    try {
      const printed = await Print.printToFileAsync({ html });
      if (printed.uri && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(printed.uri, { mimeType: "application/pdf", dialogTitle: filename });
        return "file";
      }
      if (printed.uri) {
        await Share.share({ url: printed.uri, title: filename }).catch(() => null);
        return "file";
      }
    } catch {
      /* fall through */
    }
  }
  if (Platform.OS === "web" && openPrintHtml(filename, quoteFormHtml(quote), { page: "a4" })) return "print";
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
