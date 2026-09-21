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

export async function printBusinessForm(
  doc: Order,
  company?: PrintCompany | null,
  client?: ApiClient | null,
  docType: PrintDocType = "order",
  extras?: { paymentPlan?: PrintPaymentRow[] | null },
): Promise<boolean> {
  const printCompany = await enrichPrintCompany(client, company);
  const template = await loadPrintTemplate(client, printCompany, docType);
  const products = await loadPrintProducts(client, doc, printCompany);
  const contactBalance = isOrderQuoteType(docType)
    ? await loadContactBalance(client, printCompany, doc)
    : null;
  const paper = printPageSize(template.paper);
  const html = orderFormHtml(doc, printCompany, {
    template,
    products,
    mediaBase: client?.baseUrl ? normalizeApiBase(client.baseUrl) : undefined,
    docType,
    contactBalance,
    paymentPlan: extras?.paymentPlan,
  });
  const label = formTitle(docType, doc);
  const filename = `${safePrintFilename(printDocFileBase(docType, doc), docType)}.pdf`;
  if (await printHtmlDocument(label, html, "a4", filename, paper)) return true;
  const shared = await Share.share({ message: orderFormText(doc, printCompany), title: label }).catch(() => null);
  if (shared) return true;
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
