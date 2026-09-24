import type { Order } from "../types";
import { orderStatusOf } from "./orderEdit";

export type OrderListFilter = "new" | "all" | "cancelled" | "returned" | "shipped";

export const ORDER_LIST_FILTERS: Array<{
  key: OrderListFilter;
  label: string;
  icon: "sparkles" | "apps" | "close-circle" | "return-down-back" | "car";
}> = [
  { key: "new", label: "Yeni", icon: "sparkles" },
  { key: "all", label: "Tümü", icon: "apps" },
  { key: "cancelled", label: "İptal", icon: "close-circle" },
  { key: "returned", label: "İade", icon: "return-down-back" },
  { key: "shipped", label: "Kargolandı", icon: "car" },
];

export const ORDER_LIST_FILTER_DEFAULT: OrderListFilter = "new";

const CANCELLED = new Set(["cancelled", "canceled"]);
const RETURNED = new Set(["returned", "partially_returned"]);
const SHIPPED = new Set(["shipped", "delivered", "completed"]);
const CANCELLED_MP = new Set(["cancelled", "canceled", "iptal"]);
const RETURNED_MP = new Set(["returned", "iade", "iade edildi"]);
const SHIPPED_MP = new Set(["shipped", "delivered", "intransit", "in_transit", "kargolandi", "kargoda"]);

function fold(raw: unknown): string {
  return String(raw || "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .trim();
}

function marketplaceOf(o: Pick<Order, "marketplace_status"> | null | undefined): string {
  return fold(o?.marketplace_status);
}

function hasCargo(o: Pick<Order, "cargo_tracking_number" | "tracking"> | null | undefined): boolean {
  return !!(
    String(o?.cargo_tracking_number || "").trim()
    || String(o?.tracking?.tracking_number || "").trim()
  );
}

/** İptal / iade / kargo / yeni — öncelik: iptal → iade → kargolandı → yeni. */
export function orderListBucket(o: Pick<Order, "order_status" | "status" | "marketplace_status" | "cargo_tracking_number" | "tracking"> | null | undefined): Exclude<OrderListFilter, "all"> {
  const st = fold(orderStatusOf(o));
  const mp = marketplaceOf(o);
  if (CANCELLED.has(st) || CANCELLED_MP.has(mp)) {
    return "cancelled";
  }
  if (RETURNED.has(st) || RETURNED_MP.has(mp)) {
    return "returned";
  }
  if (SHIPPED.has(st) || SHIPPED_MP.has(mp) || hasCargo(o)) {
    return "shipped";
  }
  return "new";
}

export function matchesOrderListFilter(
  o: Pick<Order, "order_status" | "status" | "marketplace_status" | "cargo_tracking_number" | "tracking"> | null | undefined,
  filter: OrderListFilter,
): boolean {
  if (filter === "all") return true;
  return orderListBucket(o) === filter;
}

export function filterOrders<T extends Pick<Order, "order_number" | "customer_name" | "order_status" | "status" | "marketplace_status" | "cargo_tracking_number" | "tracking">>(
  rows: T[] | null | undefined,
  filter: OrderListFilter = ORDER_LIST_FILTER_DEFAULT,
  q = "",
  limit = 80,
): T[] {
  const s = q.trim().toLowerCase();
  const list = (rows || []).filter((o) => {
    if (!matchesOrderListFilter(o, filter)) return false;
    if (!s) return true;
    return [o.order_number, o.customer_name].some((v) => String(v || "").toLowerCase().includes(s));
  });
  return list.slice(0, limit);
}

export function orderListFilterCounts(rows: Array<Pick<Order, "order_status" | "status" | "marketplace_status" | "cargo_tracking_number" | "tracking">> | null | undefined) {
  const counts: Record<OrderListFilter, number> = { new: 0, all: 0, cancelled: 0, returned: 0, shipped: 0 };
  for (const o of rows || []) {
    counts.all += 1;
    counts[orderListBucket(o)] += 1;
  }
  return counts;
}

export function orderListEmptyTitle(filter: OrderListFilter): string {
  if (filter === "new") return "Yeni sipariş yok";
  if (filter === "cancelled") return "İptal sipariş yok";
  if (filter === "returned") return "İade sipariş yok";
  if (filter === "shipped") return "Kargolanan sipariş yok";
  return "Sipariş yok";
}
