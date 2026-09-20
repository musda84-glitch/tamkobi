import type { SelectGroup } from "../components/GroupedSelect";
import type { Order } from "../types";
import { channelTr } from "./labels";
import { canApproveOrder, isMarketplaceChannel } from "./orderApprove";

export type CargoCatalogItem = {
  carrier_code: string;
  carrier_name: string;
  kind?: string;
  installed?: boolean;
};

export const FALLBACK_CARGO_CATALOG: CargoCatalogItem[] = [
  { carrier_code: "yurtici", carrier_name: "Yurtiçi Kargo", kind: "carrier" },
  { carrier_code: "aras", carrier_name: "Aras Kargo", kind: "carrier" },
  { carrier_code: "mng", carrier_name: "MNG Kargo", kind: "carrier" },
  { carrier_code: "ptt", carrier_name: "PTT Kargo", kind: "carrier" },
  { carrier_code: "surat", carrier_name: "Sürat Kargo", kind: "carrier" },
  { carrier_code: "trendyolexpress", carrier_name: "Trendyol Express", kind: "carrier" },
  { carrier_code: "hepsijet", carrier_name: "HepsiJet", kind: "carrier" },
  { carrier_code: "kolaygelsin", carrier_name: "Kolay Gelsin", kind: "carrier" },
  { carrier_code: "ups", carrier_name: "UPS", kind: "carrier" },
  { carrier_code: "horoz", carrier_name: "Horoz Lojistik", kind: "carrier" },
  { carrier_code: "geliver", carrier_name: "Geliver", kind: "marketplace" },
  { carrier_code: "navlungo", carrier_name: "Navlungo", kind: "marketplace" },
];

const CLOSED = new Set(["cancelled", "canceled", "returned", "partially_returned"]);
const ALREADY_APPROVED = new Set(["approved", "delivered", "shipped", "completed"]);
const CREATED = new Set(["Created", "WaitingInAction", "UnPacked"]);
const MP_ALREADY_APPROVED = new Set(["Picking", "Invoiced", "Shipped", "Delivered", "AtCollectionPoint"]);

export function canChangeMarketplaceCargo(order: Pick<Order, "channel" | "order_status">): boolean {
  const st = String(order.order_status || "").toLowerCase();
  return isMarketplaceChannel(order.channel) && !CLOSED.has(st);
}

/** Onaylanmış / teslim siparişte buton kaybolur. */
export function canShowMarketplaceApprove(order: Pick<Order, "channel" | "order_status" | "marketplace_status">): boolean {
  return canApproveMarketplaceOrder(order);
}

export function canApproveMarketplaceOrder(order: Pick<Order, "channel" | "order_status" | "marketplace_status">): boolean {
  if (!isMarketplaceChannel(order.channel)) return canApproveOrder(order);
  const st = String(order.order_status || "").toLowerCase();
  const mp = String(order.marketplace_status || "");
  if (CLOSED.has(st) || ALREADY_APPROVED.has(st) || MP_ALREADY_APPROVED.has(mp)) return false;
  return canApproveOrder(order) || CREATED.has(mp);
}

export function approveActionLabel(order: Pick<Order, "channel">): string {
  return isMarketplaceChannel(order.channel) ? "Pazaryeri onayla" : "Onayla";
}

export function cargoChangeBody(code: string): { cargo_carrier: string } {
  return { cargo_carrier: String(code || "").trim() };
}

export function cargoChangeConfirm(
  order: Pick<Order, "order_number" | "channel" | "cargo_carrier" | "cargo_carrier_name">,
  carrierName: string,
): string {
  const prev = order.cargo_carrier_name || order.cargo_carrier || "—";
  return [
    `${order.order_number || "Sipariş"} kargo firması değiştirilsin mi?`,
    channelTr(order.channel),
    `${prev} → ${carrierName}`,
    "Değişiklik pazaryeri entegrasyonuna iletilir.",
  ].filter(Boolean).join("\n");
}

export function cargoNameOf(items: CargoCatalogItem[], code: string, fallback?: string): string {
  const hit = items.find((i) => i.carrier_code === code);
  return hit?.carrier_name || fallback || code;
}

export function cargoSelectGroups(
  items: CargoCatalogItem[],
  current?: string,
  currentName?: string,
): SelectGroup[] {
  const seen = new Set<string>();
  const installed: CargoCatalogItem[] = [];
  const marketplace: CargoCatalogItem[] = [];
  const carriers: CargoCatalogItem[] = [];
  for (const it of items) {
    const code = String(it.carrier_code || "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    if (it.installed) installed.push(it);
    else if (it.kind === "marketplace") marketplace.push(it);
    else carriers.push(it);
  }
  const cur = String(current || "").trim();
  if (cur && !seen.has(cur)) {
    installed.unshift({ carrier_code: cur, carrier_name: currentName || cur, installed: true });
  }
  const groups: SelectGroup[] = [];
  const toOpts = (rows: CargoCatalogItem[]) => rows.map((o) => ({ value: o.carrier_code, label: o.carrier_name }));
  if (installed.length) groups.push({ label: "Kayıtlı", options: toOpts(installed) });
  if (marketplace.length) groups.push({ label: "Pazaryeri kargo", options: toOpts(marketplace) });
  if (carriers.length) groups.push({ label: "Kargo firmaları", options: toOpts(carriers) });
  return groups;
}
