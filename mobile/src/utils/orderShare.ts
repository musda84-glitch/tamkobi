import { Linking, Platform, Share } from "react-native";
import type { ApiClient } from "../api/client";
import { get } from "../api/client";
import { API_BASE_HEADER, normalizeApiBase, requestTarget } from "../api/url";
import type { Company, Order, Product } from "../types";
import { idOf } from "./money";
import {
  A4_PRINT_PX,
  THERMAL_LABEL_PX,
  htmlToPdfFile,
  printHtmlNative,
  printOfficialBlob,
} from "./nativePrint";
import {
  cargoLabelFilename,
  cargoLabelHtml,
  cargoLabelText,
  mergePrintTemplate,
  openPrintHtml,
  orderFormHtml,
  orderFormText,
  orderPdfFilename,
  printDocumentHtml,
  safePrintFilename,
  type PrintCompany,
  type PrintProduct,
  type PrintTemplate,
} from "./orderPrint";

export type CargoLabelMeta = {
  label_url?: string | null;
  has_file?: boolean;
  source?: string;
};

export type CargoPrintKind = "official" | "thermal";

type PrintTemplatesMap = Partial<Record<"invoice" | "order" | "quote" | "dispatch", PrintTemplate>>;

export async function enrichPrintCompany(client: ApiClient | null | undefined, company?: PrintCompany | null): Promise<PrintCompany | null> {
  if (!company) return null;
  const cid = idOf(company);
  if (!client || !cid) return company;
  try {
    const full = await get<Company>(client, `/companies/${cid}`);
    return { ...company, ...full };
  } catch {
    return company;
  }
}

export async function loadPrintTemplate(
  client: ApiClient | null | undefined,
  company?: PrintCompany | null,
  docType: keyof PrintTemplatesMap = "order",
): Promise<PrintTemplate> {
  const cid = idOf(company || {});
  if (!client || !cid) return mergePrintTemplate();
  try {
    const all = await get<PrintTemplatesMap>(client, `/companies/${cid}/print-templates`);
    return mergePrintTemplate(all[docType]);
  } catch {
    return mergePrintTemplate();
  }
}

async function loadOrderTemplate(client: ApiClient | null | undefined, company?: PrintCompany | null): Promise<PrintTemplate> {
  return loadPrintTemplate(client, company, "order");
}

export async function loadPrintProducts(
  client: ApiClient | null | undefined,
  doc: { items?: Array<{ product_id?: string } | Record<string, unknown>> },
  company?: PrintCompany | null,
): Promise<Record<string, PrintProduct>> {
  const ids = [...new Set((doc.items || []).map((it) => String((it as { product_id?: string }).product_id || "")).filter(Boolean))];
  const cid = idOf(company || {});
  if (!client || !ids.length || !cid) return {};
  try {
    const rows = await get<Product[]>(client, "/products", { company_id: cid, lite: 1, ids: ids.join(",") });
    const map: Record<string, PrintProduct> = {};
    for (const p of rows || []) {
      const id = idOf(p);
      if (id) map[id] = p;
    }
    return map;
  } catch {
    return {};
  }
}

async function printHtmlDocument(title: string, bodyHtml: string, page: "a4" | "thermal", filename: string): Promise<boolean> {
  const document = printDocumentHtml(title, bodyHtml, page);
  const size = page === "thermal" ? THERMAL_LABEL_PX : A4_PRINT_PX;
  if (Platform.OS === "web" && openPrintHtml(title, bodyHtml, { page })) return true;
  try {
    if (await printHtmlNative(document, size)) return true;
  } catch {
    /* PDF file */
  }
  try {
    if (await htmlToPdfFile(document, filename, size)) return true;
  } catch {
    /* last resort */
  }
  return false;
}

export async function printOrderForm(
  order: Order,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
  const title = `Sipariş ${order.order_number || ""}`.trim();
  const printCompany = await enrichPrintCompany(client, company);
  const template = await loadOrderTemplate(client, printCompany);
  const products = await loadPrintProducts(client, order, printCompany);
  const html = orderFormHtml(order, printCompany, {
    template,
    products,
    mediaBase: client?.baseUrl ? normalizeApiBase(client.baseUrl) : undefined,
  });
  if (await printHtmlDocument(title, html, "a4", orderPdfFilename(order))) return true;
  const shared = await Share.share({ message: orderFormText(order, printCompany), title }).catch(() => null);
  if (shared) return true;
  throw new Error("Yazdırılamadı.");
}

function openHref(href: string, title: string): boolean {
  if (typeof window === "undefined" || typeof window.open !== "function") return false;
  const w = window.open(href, "_blank", "width=800,height=900");
  if (!w) return false;
  w.addEventListener("load", () => {
    setTimeout(() => {
      try { w.print(); } catch { /* ignore */ }
    }, 350);
  });
  if (title) w.document.title = title;
  return true;
}

export async function fetchLabelBlobFromUrl(url: string, headers?: Record<string, string>): Promise<Blob | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (type.includes("json") || (type.includes("html") && !type.includes("pdf"))) return null;
  const blob = await res.blob();
  if (!blob.size) return null;
  return blob;
}

export async function openOfficialLabel(url: string, title: string): Promise<boolean> {
  if (Platform.OS === "web" && openHref(url, title)) return true;
  const blob = await fetchLabelBlobFromUrl(url);
  if (blob && await printOfficialBlob(blob, `kargo-${safePrintFilename(title, "etiket")}`)) {
    return true;
  }
  const can = await Linking.canOpenURL(url).catch(() => false);
  if (can) {
    await Linking.openURL(url);
    return true;
  }
  return false;
}

export async function fetchOfficialLabelBlob(client: ApiClient, orderId: string): Promise<Blob | null> {
  const { url, proxiedBase } = requestTarget(client.baseUrl, `/orders/${orderId}/cargo-label/file`);
  const headers: Record<string, string> = { Accept: "application/pdf,image/*,*/*" };
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  if (proxiedBase) headers[API_BASE_HEADER] = proxiedBase;
  return fetchLabelBlobFromUrl(url, headers);
}

export async function printCargoLabel(
  order: Order,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<CargoPrintKind> {
  const title = `Kargo ${order.order_number || ""}`.trim();
  const id = idOf(order);
  const printCompany = await enrichPrintCompany(client, company);
  const fileBase = `kargo-${safePrintFilename(order.order_number, "etiket")}`;
  if (client && id) {
    const blob = await fetchOfficialLabelBlob(client, id);
    if (blob && Platform.OS === "web" && typeof URL !== "undefined") {
      const href = URL.createObjectURL(blob);
      if (openHref(href, title)) return "official";
    }
    if (blob) {
      try {
        if (await printOfficialBlob(blob, fileBase)) return "official";
      } catch {
        /* URL / thermal */
      }
    }
    try {
      const meta = await get<CargoLabelMeta>(client, `/orders/${id}/cargo-label`);
      if (meta.label_url && await openOfficialLabel(meta.label_url, title)) return "official";
    } catch {
      /* thermal fallback */
    }
  } else if (order.cargo_label_url && await openOfficialLabel(order.cargo_label_url, title)) {
    return "official";
  }
  const thermalBody = cargoLabelHtml(order, printCompany);
  if (await printHtmlDocument(title, thermalBody, "thermal", cargoLabelFilename(order))) return "thermal";
  const shared = await Share.share({ message: cargoLabelText(order, printCompany), title }).catch(() => null);
  if (shared) return "thermal";
  throw new Error("Etiket yazdırılamadı.");
}
