import { Platform } from "react-native";
import { get } from "../api/client";
import type { ApiClient } from "../api/client";
import { tryPrintLabelEthernet } from "./ethernetPrinter";
import { embedLabelHtmlImages } from "./labelMedia";
import { htmlToPdfFile, printHtmlNative } from "./nativePrint";
import { safePrintFilename } from "./orderPrint";
import type { PickLine } from "./orderPick";
import { labelCopyCount } from "./pickLabels";
import {
  builtinLabelTemplates,
  pickLineToLabelProduct,
  resolveLabelTemplate,
  type LabelTemplateLike,
} from "./resolveLabelTemplate";
import { templateLabelDocumentHtml } from "./labelTemplateHtml";

function mmToPx(mm: number): number {
  return Math.max(40, Math.round(mm * 3.78));
}

function printHtmlWeb(html: string): boolean {
  if (typeof document === "undefined") return false;
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

async function loadTemplates(client: ApiClient, companyId?: string): Promise<LabelTemplateLike[]> {
  try {
    const list = await get<LabelTemplateLike[]>(client, "/label-templates", {
      company_id: companyId || "comp_nexus_main_01",
    });
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export type PrintPickLabelCompany = {
  name?: string | null;
  logo_url?: string | null;
  id?: string;
  _id?: string;
} | null | undefined;

/** Stok kartı etiket şablonu (yoksa varsayılan) ile sevkiyat ürün etiketi yazdır. */
export async function printPickProductLabels(
  items: Array<PickLine | null | undefined> | null | undefined,
  company?: PrintPickLabelCompany | string,
  orderNumber?: string,
  opts?: { client?: ApiClient; companyId?: string },
): Promise<{ count: number; ok: boolean }> {
  const lines = (items || []).filter(Boolean) as PickLine[];
  if (!lines.length) return { count: 0, ok: false };

  const companyObj: PrintPickLabelCompany = typeof company === "string"
    ? { name: company }
    : company;
  const builtins = builtinLabelTemplates();
  const saved = opts?.client
    ? await loadTemplates(opts.client, opts.companyId || companyObj?.id || companyObj?._id || undefined)
    : [];
  const mediaBase = opts?.client?.baseUrl || "";
  const token = opts?.client?.token || null;

  const jobs: Array<{ tpl: LabelTemplateLike; product: NonNullable<ReturnType<typeof pickLineToLabelProduct>> }> = [];
  for (const line of lines) {
    const product = pickLineToLabelProduct(line as Record<string, unknown>);
    if (!product) continue;
    const tpl = resolveLabelTemplate(saved, product, builtins);
    if (!tpl) continue;
    const copies = labelCopyCount(line);
    for (let i = 0; i < copies; i += 1) jobs.push({ tpl, product });
  }
  if (!jobs.length) return { count: 0, ok: false };

  // Ethernet / IP yazıcı yapılandırıldıysa tarayıcı diyaloğu olmadan TSPL gönder
  try {
    let ethOk = 0;
    for (const job of jobs) {
      const sent = await tryPrintLabelEthernet({
        product: {
          name: job.product.name,
          sku: job.product.sku,
          barcode: job.product.barcode,
          sale_price: Number(job.product.sale_price) || null,
        },
        companyName: companyObj?.name || undefined,
        tpl: job.tpl,
        copies: 1,
        client: opts?.client,
      });
      if (sent) ethOk += 1;
      else break;
    }
    if (ethOk === jobs.length) return { count: jobs.length, ok: true };
  } catch {
    /* sistem yazıcısına düş */
  }

  // Aynı boyutta grupla (termal @page tek boyut)
  const bySize = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const key = `${Number(job.tpl.width_mm) || 50}x${Number(job.tpl.height_mm) || 30}`;
    if (!bySize.has(key)) bySize.set(key, []);
    bySize.get(key)!.push(job);
  }

  const title = `Ürün etiketleri ${orderNumber || ""}`.trim();
  const filename = `etiket-${safePrintFilename(orderNumber, "urun")}.pdf`;
  const printCompany = companyObj?.name || companyObj?.logo_url
    ? { name: companyObj?.name || undefined, logo_url: companyObj?.logo_url || undefined }
    : undefined;
  let anyOk = false;

  for (const group of bySize.values()) {
    let { html, widthMm, heightMm } = templateLabelDocumentHtml(
      title,
      group,
      printCompany,
      Platform.OS === "web",
      { mediaBase },
    );
    try {
      html = await embedLabelHtmlImages(html, mediaBase, token);
    } catch {
      /* absolute URL fallback */
    }
    const px = { width: mmToPx(widthMm), height: mmToPx(heightMm) };
    if (Platform.OS === "web") {
      if (printHtmlWeb(html)) anyOk = true;
      continue;
    }
    try {
      if (await printHtmlNative(html, px)) {
        anyOk = true;
        continue;
      }
    } catch {
      /* PDF */
    }
    try {
      if (await htmlToPdfFile(html, filename, px)) anyOk = true;
    } catch {
      /* fail */
    }
  }

  return { count: jobs.length, ok: anyOk };
}
