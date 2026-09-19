import { Linking, Platform, Share } from "react-native";
import type { ApiClient } from "../api/client";
import { get } from "../api/client";
import { API_BASE_HEADER, requestTarget } from "../api/url";
import type { Order } from "../types";
import { idOf } from "./money";
import {
  cargoLabelHtml,
  cargoLabelText,
  openPrintHtml,
  orderFormHtml,
  orderFormText,
  type PrintCompany,
} from "./orderPrint";

export type CargoLabelMeta = {
  label_url?: string | null;
  has_file?: boolean;
  source?: string;
};

export type CargoPrintKind = "official" | "thermal";

export async function printOrderForm(order: Order, company?: PrintCompany | null): Promise<boolean> {
  const title = `Sipariş ${order.order_number || ""}`.trim();
  if (Platform.OS === "web" && openPrintHtml(title, orderFormHtml(order, company))) return true;
  await Share.share({ message: orderFormText(order, company), title }).catch(() => null);
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
  if (client && id) {
    const blob = await fetchOfficialLabelBlob(client, id);
    if (blob && Platform.OS === "web" && typeof URL !== "undefined") {
      const href = URL.createObjectURL(blob);
      if (openHref(href, title)) return "official";
    }
    if (blob && Platform.OS !== "web") {
      await Share.share({ message: cargoLabelText(order, company), title, url: order.cargo_label_url }).catch(() => null);
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
  if (Platform.OS === "web" && openPrintHtml(title, cargoLabelHtml(order, company))) return "thermal";
  await Share.share({ message: cargoLabelText(order, company), title }).catch(() => null);
  return "thermal";
}
