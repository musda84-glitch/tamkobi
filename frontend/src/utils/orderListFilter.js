/** Mobil orderListFilter ile aynı kovalar. Sipariş listesi personel ekranı. */

export const ORDER_LIST_FILTERS = [
  { key: "new", label: "Yeni" },
  { key: "all", label: "Tümü" },
  { key: "cancelled", label: "İptal" },
  { key: "returned", label: "İade" },
  { key: "shipped", label: "Kargolandı" },
];

export const ORDER_LIST_FILTER_DEFAULT = "new";

const CANCELLED = new Set(["cancelled", "canceled"]);
const RETURNED = new Set(["returned", "partially_returned"]);
const SHIPPED = new Set(["shipped", "delivered", "completed"]);
const CANCELLED_MP = new Set(["cancelled", "canceled", "iptal"]);
const RETURNED_MP = new Set(["returned", "iade", "iade edildi"]);
const SHIPPED_MP = new Set(["shipped", "delivered", "intransit", "in_transit", "atcollectionpoint", "kargolandi", "kargoda"]);

function orderStatusOf(o) {
  return String(o?.order_status || o?.status || "");
}

function fold(raw) {
  return String(raw || "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .trim();
}

function marketplaceOf(o) {
  return fold(o?.marketplace_status);
}

/** Kargolandı: sipariş durumu veya pazaryeri durumu. Takip no tek başına yetmez. */
export function isShippedOrder(o) {
  const st = fold(orderStatusOf(o));
  if (SHIPPED.has(st)) return true;
  return SHIPPED_MP.has(marketplaceOf(o));
}

/** İptal / iade / kargo / yeni — öncelik: iptal → iade → kargolandı → yeni. */
export function orderListBucket(o) {
  const st = fold(orderStatusOf(o));
  const mp = marketplaceOf(o);
  if (CANCELLED.has(st) || CANCELLED_MP.has(mp)) {
    return "cancelled";
  }
  if (RETURNED.has(st) || RETURNED_MP.has(mp)) {
    return "returned";
  }
  if (isShippedOrder(o)) {
    return "shipped";
  }
  return "new";
}

export function matchesOrderListFilter(o, filter) {
  if (filter === "all") return true;
  return orderListBucket(o) === filter;
}

export function filterOrders(rows, filter = ORDER_LIST_FILTER_DEFAULT, q = "", limit = 80) {
  const s = q.trim().toLowerCase();
  const list = (rows || []).filter((o) => {
    if (!matchesOrderListFilter(o, filter)) return false;
    if (!s) return true;
    return [o.order_number, o.customer_name].some((v) => String(v || "").toLowerCase().includes(s));
  });
  return list.slice(0, limit);
}

export function orderListFilterCounts(rows) {
  const counts = { new: 0, all: 0, cancelled: 0, returned: 0, shipped: 0 };
  for (const o of rows || []) {
    counts.all += 1;
    counts[orderListBucket(o)] += 1;
  }
  return counts;
}

export function orderListEmptyTitle(filter) {
  if (filter === "new") return "Yeni sipariş yok";
  if (filter === "cancelled") return "İptal sipariş yok";
  if (filter === "returned") return "İade sipariş yok";
  if (filter === "shipped") return "Kargolanan sipariş yok";
  return "Sipariş yok";
}
