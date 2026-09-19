import { Linking, Platform, Share } from "react-native";
import type { ApiClient } from "../api/client";
import { get } from "../api/client";
import { API_BASE_HEADER, normalizeApiBase, requestTarget } from "../api/url";
import type { Company, Order, Product } from "../types";
import { idOf } from "./money";
import {
  cargoLabelHtml,
  cargoLabelText,
  mergePrintTemplate,
  openPrintHtml,
  orderFormHtml,
  orderFormText,
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

async function enrichPrintCompany(client: ApiClient | null | undefined, company?: PrintCompany | null): Promise<PrintCompany | null> {
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

async function loadOrderTemplate(client: ApiClient | null | undefined, company?: PrintCompany | null): Promise<PrintTemplate> {
  const cid = idOf(company || {});
  if (!client || !cid) return mergePrintTemplate();
  try {
    const all = await get<PrintTemplatesMap>(client, `/companies/${cid}/print-templates`);
    return mergePrintTemplate(all.order);
  } catch {
    return mergePrintTemplate();
  }
}

async function loadPrintProducts(client: ApiClient | null | undefined, order: Order, company?: PrintCompany | null): Promise<Record<string, PrintProduct>> {
  const ids = [...new Set((order.items || []).map((it) => String((it as { product_id?: string }).product_id || "")).filter(Boolean))];
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
  if (Platform.OS === "web" && openPrintHtml(title, html, { page: "a4" })) return true;
  await Share.share({ message: orderFormText(order, printCompany), title }).catch(() => null);
  return true;
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

export async function openOfficialLabel(url: string, title: string): Promise<boolean> {
  if (Platform.OS === "web" && openHref(url, title)) return true;
  const can = await Linking.canOpenURL(url).catch(() => false);
  if (can) {
    await Linking.openURL(url);
    return true;
  }
  await Share.share({ message: url, title }).catch(() => null);
  return true;
}

export async function fetchOfficialLabelBlob(client: ApiClient, orderId: string): Promise<Blob | null> {
  const { url, proxiedBase } = requestTarget(client.baseUrl, `/orders/${orderId}/cargo-label/file`);
  const headers: Record<string, string> = { Accept: "application/pdf,image/*,*/*" };
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  if (proxiedBase) headers[API_BASE_HEADER] = proxiedBase;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (type.includes("json") || type.includes("html") && !type.includes("pdf")) return null;
  const blob = await res.blob();
  if (!blob.size) return null;
  return blob;
}

export async function printCargoLabel(
  order: Order,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<CargoPrintKind> {
  const title = `Kargo ${order.order_number || ""}`.trim();
  const id = idOf(order);
  const printCompany = await enrichPrintCompany(client, company);
  if (client && id) {
    const blob = await fetchOfficialLabelBlob(client, id);
    if (blob && Platform.OS === "web" && typeof URL !== "undefined") {
      const href = URL.createObjectURL(blob);
      if (openHref(href, title)) return "official";
    }
    if (blob && Platform.OS !== "web") {
      await Share.share({ message: cargoLabelText(order, printCompany), title, url: order.cargo_label_url }).catch(() => null);
      return "official";
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
  if (Platform.OS === "web" && openPrintHtml(title, cargoLabelHtml(order, printCompany), { page: "thermal" })) return "thermal";
  await Share.share({ message: cargoLabelText(order, printCompany), title }).catch(() => null);
  return "thermal";
}
