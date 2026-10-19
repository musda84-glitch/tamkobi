import { Linking, Platform, Share } from "react-native";
import type { ApiClient } from "../api/client";
import { get } from "../api/client";
import { API_BASE_HEADER, normalizeApiBase, requestTarget } from "../api/url";
import type { Company, Contact, Invoice, Order, Product } from "../types";
import { invoiceAsPrintOrder } from "./invoicePrint";
import { idOf } from "./money";
import {
  THERMAL_LABEL_PX,
  htmlToPdfFile,
  paperPrintSize,
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
  printPageSize,
  safePrintFilename,
  type PrintCompany,
  type PrintDocType,
  type PrintPaymentRow,
  type PrintProduct,
  type PrintTemplate,
} from "./orderPrint";
import { absolutizeLabelUrl } from "./labelMedia";
import { shouldUseIntegratorPdf } from "./printIntegratorPdf";

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

export async function fetchApiBlob(
  client: ApiClient,
  path: string,
  accept = "application/pdf,application/octet-stream,*/*",
): Promise<Blob | null> {
  const { url, proxiedBase } = requestTarget(client.baseUrl, path);
  const headers: Record<string, string> = { Accept: accept };
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  if (proxiedBase) headers[API_BASE_HEADER] = proxiedBase;
  return fetchLabelBlobFromUrl(url, headers);
}

export async function loadContactBalance(
  client: ApiClient | null | undefined,
  company?: PrintCompany | null,
  doc?: { contact_id?: string; contact_name?: string; customer_name?: string; contact_balance?: number | null },
): Promise<number | null> {
  if (doc?.contact_balance != null && doc.contact_balance !== ("" as unknown)) {
    const n = Number(doc.contact_balance);
    return Number.isFinite(n) ? n : null;
  }
  const cid = idOf(company || {});
  const contactId = String(doc?.contact_id || "").trim();
  const name = String(doc?.contact_name || doc?.customer_name || "").trim().toLocaleLowerCase("tr-TR");
  if (!client || !cid || (!contactId && !name)) return null;
  try {
    const rows = await get<Contact[]>(client, "/contacts", { company_id: cid, lite: 1 });
    const list = Array.isArray(rows) ? rows : [];
    const hit = (contactId && list.find((c) => idOf(c) === contactId))
      || list.find((c) => String(c.name || "").trim().toLocaleLowerCase("tr-TR") === name);
    return hit && hit.balance != null ? Number(hit.balance) : null;
  } catch {
    return null;
  }
}

export async function loadInvoicePaymentPlan(
  client: ApiClient | null | undefined,
  invoice?: Invoice | null,
): Promise<PrintPaymentRow[] | null> {
  const id = idOf(invoice || {});
  if (!client || !id) return Array.isArray(invoice?.payment_plan?.rows) ? invoice!.payment_plan!.rows : null;
  try {
    const rows = await get<PrintPaymentRow[] | { rows?: PrintPaymentRow[] }>(client, `/invoices/${id}/installments`);
    if (Array.isArray(rows)) return rows;
    if (Array.isArray(rows?.rows)) return rows.rows;
  } catch {
    /* local plan */
  }
  return Array.isArray(invoice?.payment_plan?.rows) ? invoice.payment_plan.rows : null;
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

const PRINT_IMAGE_LIMIT = 40;
const PRINT_IMAGE_TIMEOUT_MS = 4000;

export type EmbedPrintImagesOpts = {
  timeoutMs?: number;
  limit?: number;
};

const IMG_TAG = /<img\b[^>]*?\bsrc=(["'])([^"']+)\1[^>]*>/gi;

function imgTagPattern(): RegExp {
  return new RegExp(IMG_TAG.source, "gi");
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** /api/files önizlemesi. Sorgu varsa dokunulmaz. */
function withPrintFilePreview(abs: string): string {
  if (!/^https?:\/\//i.test(abs)) return abs;
  try {
    const u = new URL(abs);
    if (!u.pathname.includes("/api/files/")) return abs;
    if ([...u.searchParams.keys()].length > 0) return abs;
    u.searchParams.set("w", "128");
    u.searchParams.set("fmt", "jpg");
    return u.toString();
  } catch {
    return abs;
  }
}

function preparePrintImageUrl(raw: string, mediaBase?: string | null): string {
  const decoded = decodeHtmlAttr(String(raw || "").trim());
  const abs = absolutizeLabelUrl(decoded, mediaBase);
  if (!abs) return "";
  if (/^data:/i.test(abs)) return abs;
  return withPrintFilePreview(abs);
}

function printImageRequest(
  absUrl: string,
  mediaBase?: string | null,
  token?: string | null,
  signal?: AbortSignal,
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = { Accept: "image/jpeg,image/png,image/webp,image/*,*/*" };
  let url = absUrl;
  if (mediaBase && /^https?:\/\//i.test(absUrl)) {
    try {
      const parsed = new URL(absUrl);
      const origin = new URL(normalizeApiBase(mediaBase));
      if (parsed.host === origin.host && parsed.pathname.startsWith("/api/")) {
        if (token) headers.Authorization = `Bearer ${token}`;
        const path = `${parsed.pathname.slice(4)}${parsed.search}`;
        const target = requestTarget(mediaBase, path);
        url = target.url;
        if (target.proxiedBase) headers[API_BASE_HEADER] = target.proxiedBase;
      }
    } catch {
      /* keep absolute url */
    }
  }
  return { url, init: { headers, signal } };
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  return "";
}

function bytesToBase64(bytes: Uint8Array): string {
  const Buf = (globalThis as { Buffer?: { from: (b: Uint8Array) => { toString: (enc: string) => string } } }).Buffer;
  if (Buf) return Buf.from(bytes).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function imageMime(type: string, bytes: Uint8Array): string | null {
  const t = type.split(";")[0].trim().toLowerCase();
  if (t === "image/jpg") return "image/jpeg";
  if (t.startsWith("image/")) return t;
  const sniffed = sniffImageMime(bytes);
  if (sniffed) return sniffed;
  if (!t || t === "application/octet-stream") return "image/jpeg";
  return null;
}

async function blobToDataUrl(blob: Blob, headerType = ""): Promise<string | null> {
  if (blob.size === 0) return null;
  if (typeof FileReader !== "undefined") {
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === "string") resolve(reader.result);
          else reject(new Error("data"));
        };
        reader.onerror = () => reject(reader.error || new Error("read"));
        reader.readAsDataURL(blob);
      });
      if (data.startsWith("data:image/")) return data;
    } catch {
      /* arrayBuffer */
    }
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytes.byteLength) return null;
  const mime = imageMime(blob.type || headerType, bytes);
  if (!mime) return null;
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

async function fetchPrintImageDataUrl(
  absUrl: string,
  mediaBase: string | null | undefined,
  token: string | null | undefined,
  timeoutMs: number,
): Promise<string | null> {
  if (!/^https?:\/\//i.test(absUrl)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const { url, init } = printImageRequest(absUrl, mediaBase, token, ctrl.signal);
    const res = await fetch(url, init);
    if (!res.ok) return null;
    const headerType = res.headers?.get?.("content-type") || "";
    const blob = typeof res.blob === "function"
      ? await res.blob()
      : new Blob([new Uint8Array(await res.arrayBuffer())], { type: headerType });
    return await blobToDataUrl(blob, headerType);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Native HTML'de uzak görsel bırakmaz. Tekil src'ler data URL olur;
 * çevrilemeyen veya süre aşan <img> etiketi çıkarılır (hücre kalır).
 * En fazla `limit` görsel istenir; her biri `timeoutMs` ile kesilir.
 */
export async function embedPrintImages(
  html: string,
  mediaBase?: string | null,
  token?: string | null,
  opts?: EmbedPrintImagesOpts,
): Promise<string> {
  const src = String(html || "");
  if (!src.includes("<img")) return src;
  const matches = [...src.matchAll(imgTagPattern())];
  if (!matches.length) return src;
  const limit = Math.max(0, opts?.limit ?? PRINT_IMAGE_LIMIT);
  const timeoutMs = Math.max(0, opts?.timeoutMs ?? PRINT_IMAGE_TIMEOUT_MS);
  const mapped = new Map<string, string | null>();
  const pending: { raw: string; prepared: string }[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const raw = match[2];
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const prepared = preparePrintImageUrl(raw, mediaBase);
    if (/^data:image\//i.test(prepared)) {
      mapped.set(raw, prepared);
      continue;
    }
    pending.push({ raw, prepared });
  }
  await Promise.all(pending.slice(0, limit).map(async (job) => {
    mapped.set(job.raw, await fetchPrintImageDataUrl(job.prepared, mediaBase, token, timeoutMs));
  }));
  const out = src.replace(imgTagPattern(), (full, _quote, url: string) => {
    const data = mapped.get(url);
    if (data && data.startsWith("data:image/")) {
      const at = full.indexOf(url);
      if (at < 0) return "";
      return full.slice(0, at) + data + full.slice(at + url.length);
    }
    return "";
  });
  return out.replace(imgTagPattern(), (full, _quote, url: string) => (/^https?:/i.test(url) ? "" : full));
}

async function printHtmlDocument(
  title: string,
  bodyHtml: string,
  page: "a4" | "thermal",
  filename: string,
  paper?: string | null,
): Promise<boolean> {
  const document = printDocumentHtml(title, bodyHtml, page, paper);
  const size = page === "thermal" ? THERMAL_LABEL_PX : paperPrintSize(paper);
  if (Platform.OS === "web" && openPrintHtml(title, bodyHtml, { page, paper })) return true;
  // A4: PDF paylaşımı önce. Native HTML'de görseller data URL; uzak <img> printAsync'i bekletmesin.
  // Thermal etiket: yazıcı diyaloğu önce (küçük HTML).
  const preferPdf = Platform.OS !== "web" && page === "a4";
  if (preferPdf) {
    try {
      if (await htmlToPdfFile(document, filename, size)) return true;
    } catch {
      /* try printer dialog */
    }
  }
  try {
    if (await printHtmlNative(document, size)) return true;
  } catch {
    /* PDF fallback */
  }
  try {
    if (await htmlToPdfFile(document, filename, size)) return true;
  } catch {
    /* fail */
  }
  return false;
}

function imagelessBusinessHtml(
  doc: Order,
  printCompany: PrintCompany | null,
  template: PrintTemplate,
  docType: PrintDocType,
  contactBalance: number | null,
  paymentPlan?: PrintPaymentRow[] | null,
): string {
  return orderFormHtml(doc, printCompany, {
    template: { ...template, show_images: false },
    products: {},
    docType,
    contactBalance,
    paymentPlan,
    omitRemoteImages: true,
  });
}

export async function printBusinessForm(
  doc: Order,
  company?: PrintCompany | null,
  client?: ApiClient | null,
  docType: PrintDocType = "order",
  extras?: { paymentPlan?: PrintPaymentRow[] | null },
): Promise<boolean> {
  const printCompany = await enrichPrintCompany(client, company);
  const template = await loadPrintTemplate(client, printCompany, docType);
  const contactBalance = isOrderQuoteType(docType)
    ? await loadContactBalance(client, printCompany, doc)
    : null;
  const paper = printPageSize(template.paper);
  const mediaBase = client?.baseUrl ? normalizeApiBase(client.baseUrl) : undefined;
  const paymentPlan = extras?.paymentPlan;
  let html: string;
  if (Platform.OS === "web") {
    const products = await loadPrintProducts(client, doc, printCompany);
    html = orderFormHtml(doc, printCompany, {
      template,
      products,
      mediaBase,
      docType,
      contactBalance,
      paymentPlan,
    });
  } else {
    try {
      const products = await loadPrintProducts(client, doc, printCompany);
      const raw = orderFormHtml(doc, printCompany, {
        template,
        products,
        mediaBase,
        docType,
        contactBalance,
        paymentPlan,
        omitRemoteImages: false,
      });
      html = await embedPrintImages(raw, mediaBase, client?.token);
    } catch {
      html = imagelessBusinessHtml(doc, printCompany, template, docType, contactBalance, paymentPlan);
    }
  }
  const label = formTitle(docType, doc);
  const filename = `${safePrintFilename(printDocFileBase(docType, doc), docType)}.pdf`;
  if (await printHtmlDocument(label, html, "a4", filename, paper)) return true;
  throw new Error("Yazdırılamadı.");
}

function isOrderQuoteType(docType: PrintDocType): boolean {
  return docType === "order" || docType === "quote";
}

function formTitle(docType: PrintDocType, doc: Order & { invoice_number?: string; quote_number?: string }): string {
  if (docType === "quote") return `Teklif ${doc.quote_number || doc.order_number || ""}`.trim();
  if (docType === "invoice") return `Fatura ${doc.invoice_number || ""}`.trim();
  if (docType === "dispatch") return `İrsaliye ${doc.invoice_number || doc.order_number || ""}`.trim();
  return `Sipariş ${doc.order_number || ""}`.trim();
}

function printDocFileBase(docType: PrintDocType, doc: Order & { invoice_number?: string; quote_number?: string }): string {
  if (docType === "quote") return String(doc.quote_number || doc.order_number || "teklif");
  if (docType === "invoice" || docType === "dispatch") return String(doc.invoice_number || doc.order_number || docType);
  return String(doc.order_number || "siparis");
}

export async function printOrderForm(
  order: Order,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
  return printBusinessForm(order, company, client, "order");
}

export async function printInvoiceForm(
  invoice: Invoice,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
  if (client && shouldUseIntegratorPdf("invoice", invoice)) {
    const id = idOf(invoice);
    if (id) {
      try {
        const blob = await fetchApiBlob(client, `/invoices/${id}/pdf?require_integrator=1`);
        if (blob) {
          const ok = await printOfficialBlob(blob, safePrintFilename(String(invoice.invoice_number || id), "invoice"));
          if (ok) return true;
        }
      } catch {
        /* fall through to local HTML form */
      }
    }
  }
  const docType: PrintDocType = invoice.invoice_type === "dispatch" ? "dispatch" : "invoice";
  const paymentPlan = docType === "invoice" ? await loadInvoicePaymentPlan(client, invoice) : null;
  return printBusinessForm(invoiceAsPrintOrder(invoice), company, client, docType, { paymentPlan });
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
