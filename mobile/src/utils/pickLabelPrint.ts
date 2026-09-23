import { Platform } from "react-native";
import { htmlToPdfFile, printHtmlNative } from "./nativePrint";
import { safePrintFilename } from "./orderPrint";
import {
  PRODUCT_LABEL_PX,
  expandPickLabelJobs,
  productLabelDocumentHtml,
  type PickLabelJob,
} from "./pickLabels";
import type { PickLine } from "./orderPick";

function printProductLabelWeb(title: string, jobs: PickLabelJob[], companyName?: string): boolean {
  if (typeof document === "undefined") return false;
  const html = productLabelDocumentHtml(title, jobs, companyName, true);
  if (typeof window !== "undefined" && typeof window.open === "function") {
    try {
      const w = window.open("", "_blank", "width=520,height=420");
      if (w) {
        w.document.write(html);
        w.document.close();
        return true;
      }
    } catch {
      /* iframe */
    }
  }
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  const cleanup = () => { try { iframe.remove(); } catch { /* gone */ } };
  win.addEventListener("afterprint", cleanup);
  setTimeout(cleanup, 60_000);
  return true;
}

export async function printPickProductLabels(
  items: Array<PickLine | null | undefined> | null | undefined,
  companyName?: string,
  orderNumber?: string,
): Promise<{ count: number; ok: boolean }> {
  const jobs = expandPickLabelJobs(items);
  if (!jobs.length) return { count: 0, ok: false };
  const title = `Ürün etiketleri ${orderNumber || ""}`.trim();
  const filename = `etiket-${safePrintFilename(orderNumber, "urun")}.pdf`;
  if (Platform.OS === "web") {
    return { count: jobs.length, ok: printProductLabelWeb(title, jobs, companyName) };
  }
  const document = productLabelDocumentHtml(title, jobs, companyName);
  try {
    if (await printHtmlNative(document, PRODUCT_LABEL_PX)) return { count: jobs.length, ok: true };
  } catch {
    /* PDF */
  }
  try {
    if (await htmlToPdfFile(document, filename, PRODUCT_LABEL_PX)) return { count: jobs.length, ok: true };
  } catch {
    /* fail */
  }
  return { count: jobs.length, ok: false };
}
