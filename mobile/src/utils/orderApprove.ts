import type { Order } from "../types";
import { channelTr } from "./labels";

const MARKETPLACE_CHANNELS = new Set([
  "trendyol", "hepsiburada", "n11", "amazon", "ciceksepeti", "pazarama",
  "pttavm", "shopify", "shopphp", "trendyol_market", "trendyol_yemek",
]);

export function isMarketplaceChannel(channel?: string | null): boolean {
  return MARKETPLACE_CHANNELS.has(String(channel || "").toLowerCase());
}

export function canApproveOrder(order: Pick<Order, "order_status">): boolean {
  return ["pending", "new"].includes(String(order.order_status || ""));
}

export function approveOrderCarrier(order: Pick<Order, "cargo_carrier">): string {
  return String(order.cargo_carrier || "geliver").trim() || "geliver";
}

export function approveOrderBody(order: Pick<Order, "cargo_carrier">): { cargo_carrier: string } {
  return { cargo_carrier: approveOrderCarrier(order) };
}

/** Onay kutusunda kanal, pazaryeri durumu ve kargo entegrasyonu. */
export function approveOrderConfirm(order: Pick<Order, "order_number" | "channel" | "marketplace_status" | "cargo_carrier" | "cargo_carrier_name">): string {
  const cargo = order.cargo_carrier_name || order.cargo_carrier;
  const mp = String(order.marketplace_status || "").trim();
  return [
    `${order.order_number || "Sipariş"} onaylansın mı?`,
    `${channelTr(order.channel)}${mp ? ` · ${mp}` : ""}`,
    cargo ? `Kargo: ${cargo}` : "",
    isMarketplaceChannel(order.channel)
      ? "Onay pazaryeri entegrasyonuna iletilir."
      : "Onay kaydedilir; bağlı kargo entegrasyonu varsa yansır.",
  ].filter(Boolean).join("\n");
}
