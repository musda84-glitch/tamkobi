import { Platform, Share } from "react-native";
import type { ApiClient } from "../api/client";
import { ApiHttpError, apiErrorMessage } from "../api/errors";
import { API_BASE_HEADER, requestTarget } from "../api/url";
import { openPrintHtml, type PrintCompany } from "./orderPrint";
import { quoteFormHtml, quoteFormText, quotePdfFilename } from "./quotePrint";
import type { QuoteDoc } from "./workDocs";

export async function printQuoteForm(quote: QuoteDoc, company?: PrintCompany | null): Promise<boolean> {
  const title = `Teklif ${quote.quote_number || ""}`.trim();
  if (Platform.OS === "web" && openPrintHtml(title, quoteFormHtml(quote, company))) return true;
  await Share.share({ message: quoteFormText(quote, company), title }).catch(() => null);
  return true;
}

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

export async function downloadQuotePdf(client: ApiClient, quote: QuoteDoc): Promise<"file" | "print"> {
  const filename = quotePdfFilename(quote);
  const id = quote.id || quote._id;
  if (!id) throw new Error("Teklif kaydı yok.");
  const { url, proxiedBase } = requestTarget(client.baseUrl, `/quotes/${id}/pdf?download=1`);
  const headers: Record<string, string> = { Accept: "application/pdf" };
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  if (proxiedBase) headers[API_BASE_HEADER] = proxiedBase;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new ApiHttpError(0, null, apiErrorMessage(err, "PDF indirilemedi."));
  }
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("pdf")) {
    if (Platform.OS === "web" && openPrintHtml(filename, quoteFormHtml(quote))) return "print";
    await Share.share({ message: quoteFormText(quote), title: filename }).catch(() => null);
    return "print";
  }
  const blob = await res.blob();
  if (Platform.OS === "web" && triggerBlobDownload(blob, filename)) return "file";
  await Share.share({ message: quoteFormText(quote), title: filename }).catch(() => null);
  return "print";
}

export async function shareApprovalLink(link: string, title?: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(link);
    return true;
  }
  await Share.share({ message: link, title: title || "Teklif onay linki" }).catch(() => null);
  return true;
}
