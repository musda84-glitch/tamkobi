import { Alert, Platform } from "react-native";
import { get } from "../api/client";
import type { ApiClient } from "../api/client";
import { tryPrintLabelEthernet } from "./ethernetPrinter";
import { printTemplateLabel, resolveLabelPrinter } from "./labelPrinter";
import { embedLabelHtmlImages } from "./labelMedia";
import { htmlToPdfFile, printHtmlNative } from "./nativePrint";
import { safePrintFilename } from "./orderPrint";
import type { PickLine } from "./orderPick";
import { labelCopyCount } from "./pickLabels";
import { templateLabelDocumentHtml } from "./labelTemplateHtml";
import {
  builtinLabelTemplates,
  pickLineToLabelProduct,
  resolveLabelTemplateInfo,
  type LabelTemplateLike,
} from "./resolveLabelTemplate";

const TEMPLATE_FETCH_CONFIRM = "Etiket şablonları alınamadı (oturum/firma). Hazır şablonla basılsın mı?";

export function mmToPx(mm: number): number {
  return Math.max(40, Math.round(mm * 3.78));
}

export type TemplateLabelJob = {
  tpl: LabelTemplateLike;
  product: {
    name?: string;
    sku?: string;
    barcode?: string;
    sale_price?: number;
    vat_rate?: number;
    currency?: string;
    price_includes_vat?: boolean;
    tags?: string[];
    category?: string;
    variant_name?: string;
    image_url?: string;
    label_image_url?: string;
  };
};

/** Şablon HTML'ini sistem yazdırma ekranına, olmazsa PDF paylaşımına gönderir. */
export async function deliverTemplateLabelHtml(opts: {
  title: string;
  filename: string;
  jobs: TemplateLabelJob[];
  company?: { name?: string; logo_url?: string } | null;
  mediaBase?: string;
  token?: string | null;
  mode?: "print" | "pdf";
}): Promise<boolean> {
  const jobs = opts.jobs || [];
  if (!jobs.length) return false;
  const mode = opts.mode === "pdf" ? "pdf" : "print";
  const bySize = new Map<string, TemplateLabelJob[]>();
  for (const job of jobs) {
    const key = `${Number(job.tpl.width_mm) || 50}x${Number(job.tpl.height_mm) || 30}`;
    const group = bySize.get(key);
    if (group) group.push(job);
    else bySize.set(key, [job]);
  }
  const company = opts.company?.name || opts.company?.logo_url
    ? { name: opts.company?.name || undefined, logo_url: opts.company?.logo_url || undefined }
    : undefined;
  let anyOk = false;
  for (const group of bySize.values()) {
    let { html, widthMm, heightMm } = templateLabelDocumentHtml(
      opts.title,
      group,
      company,
      mode === "print" && Platform.OS === "web",
      { mediaBase: opts.mediaBase },
    );
    try {
      html = await embedLabelHtmlImages(html, opts.mediaBase, opts.token);
    } catch {
      /* absolute URL fallback */
    }
    const px = { width: mmToPx(widthMm), height: mmToPx(heightMm) };
    if (mode === "pdf") {
      try {
        if (await htmlToPdfFile(html, opts.filename, px)) anyOk = true;
      } catch {
        /* fail */
      }
      continue;
    }
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
      if (await htmlToPdfFile(html, opts.filename, px)) anyOk = true;
    } catch {
      /* fail */
    }
  }
  return anyOk;
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

export async function loadTemplates(
  client: ApiClient,
  companyId?: string,
): Promise<{ list: LabelTemplateLike[]; error: unknown }> {
  try {
    const cid = (companyId || "").trim();
    const list = await get<LabelTemplateLike[]>(client, "/label-templates", cid ? { company_id: cid } : {});
    return { list: Array.isArray(list) ? list : [], error: null };
  } catch (error) {
    return { list: [], error };
  }
}

function confirmBuiltinFallback(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    Alert.alert(
      TEMPLATE_FETCH_CONFIRM,
      undefined,
      [
        { text: "Vazgeç", style: "cancel", onPress: () => finish(false) },
        { text: "Bas", onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    );
  });
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
  const loaded = opts?.client
    ? await loadTemplates(opts.client, opts.companyId || companyObj?.id || companyObj?._id || undefined)
    : { list: [] as LabelTemplateLike[], error: null as unknown };
  if (loaded.error) {
    const ok = await confirmBuiltinFallback();
    if (!ok) return { count: 0, ok: false };
  }
  const saved = loaded.list;
  const mediaBase = opts?.client?.baseUrl || "";
  const token = opts?.client?.token || null;

  const jobs: Array<{ tpl: LabelTemplateLike; product: NonNullable<ReturnType<typeof pickLineToLabelProduct>> }> = [];
  const warned = new Set<string>();
  for (const line of lines) {
    const product = pickLineToLabelProduct(line as Record<string, unknown>);
    if (!product) continue;
    const info = resolveLabelTemplateInfo(saved, product, builtins);
    if (info.missingAssigned) {
      const key = String(product.id || product.name);
      if (!warned.has(key)) {
        warned.add(key);
        Alert.alert(`${product.name}: atanan etiket şablonu bulunamadı, varsayılan kullanıldı`);
      }
    }
    const tpl = info.tpl;
    if (!tpl) continue;
    const copies = labelCopyCount(line);
    for (let i = 0; i < copies; i += 1) jobs.push({ tpl, product });
  }
  if (!jobs.length) return { count: 0, ok: false };

  // Yazıcılar ekranındaki IP (LABEL_PRINTER_KEY). Host varsa her grubun çözülmüş
  // şablonu (atanan → varsayılan → ilk → hazır) boyut ve öğeleriyle TSPL gider.
  // Hata olursa sistem yazıcısına düşülmez. Koli etiketi bu yola girmez.
  if (opts?.client) {
    const settings = await resolveLabelPrinter(
      opts.client,
      opts.companyId || companyObj?.id || companyObj?._id,
    );
    if (String(settings.host || "").trim()) {
      const groups = new Map<string, {
        tpl: LabelTemplateLike;
        product: (typeof jobs)[number]["product"];
        copies: number;
      }>();
      for (const job of jobs) {
        const product = job.product;
        const tplId = String(job.tpl.id || job.tpl._id || `${job.tpl.width_mm || ""}x${job.tpl.height_mm || ""}`);
        const key = [
          tplId,
          product.id || product._id || "",
          product.sku || "",
          product.barcode || "",
          product.name || "",
          String(product.sale_price ?? ""),
        ].join("\u0001");
        const group = groups.get(key);
        if (group) group.copies += 1;
        else groups.set(key, { tpl: job.tpl, product, copies: 1 });
      }
      for (const group of groups.values()) {
        await printTemplateLabel({
          settings,
          copies: group.copies,
          tpl: group.tpl,
          companyName: companyObj?.name || undefined,
          product: group.product,
        });
      }
      return { count: jobs.length, ok: true };
    }
  }

  // Eski Ethernet anahtarı; host yoksa tarayıcı / PDF yolu aynı kalır.
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

  const title = `Ürün etiketleri ${orderNumber || ""}`.trim();
  const filename = `etiket-${safePrintFilename(orderNumber, "urun")}.pdf`;
  const printCompany = companyObj?.name || companyObj?.logo_url
    ? { name: companyObj?.name || undefined, logo_url: companyObj?.logo_url || undefined }
    : undefined;
  const ok = await deliverTemplateLabelHtml({
    title,
    filename,
    jobs,
    company: printCompany,
    mediaBase,
    token,
    mode: "print",
  });
  return { count: jobs.length, ok };
}
