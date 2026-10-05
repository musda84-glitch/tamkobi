export const WAREHOUSE_SHIP_CODE = "warehouse";
export const WAREHOUSE_SHIP_NAME = "Depodan sevk edildi";
export const WAREHOUSE_SHIP_STATUS_LABEL = "Depo sevk edildi";
export const WAREHOUSE_SHIP_HINT = "Kargo firması olmadan depodan teslim veya kendi araç ile sevk. Sipariş sevk edildi durumuna geçer.";

/** Teslim/tamamlandı ve iptal/iade — depodan sevk "shipped"e geri almaz. */
export const WAREHOUSE_SHIP_CLOSED = new Set([
  "cancelled",
  "canceled",
  "returned",
  "partially_returned",
  "delivered",
  "completed",
]);

export function isWarehouseShipClosed(ord = {}) {
  return WAREHOUSE_SHIP_CLOSED.has(String(ord.order_status || "").toLowerCase());
}

export function isWarehouseShipped(ord = {}) {
  if (ord.warehouse_shipped || String(ord.ship_method || "") === WAREHOUSE_SHIP_CODE) return true;
  if (String(ord.cargo_carrier || "").toLowerCase() === WAREHOUSE_SHIP_CODE) return true;
  return String(ord.cargo_tracking_number || "").toUpperCase().startsWith("DEPO-");
}

const SHIPPED_LIKE = new Set(["shipped", "in_transit"]);

/** Durum seçicisinde shipped seçeneği: depodan sevk ise "Depo sevk edildi". */
export function warehouseShippedOptionLabel(ord = {}) {
  return isWarehouseShipped(ord) ? WAREHOUSE_SHIP_STATUS_LABEL : "Kargolandı";
}

/** Sipariş durum rozeti: sevk/kargo durumunda depodan sevk etiketi. */
export function orderStatusLabel(ord = {}, fallback = "") {
  const st = String(ord.order_status || "").toLowerCase();
  if (isWarehouseShipped(ord) && SHIPPED_LIKE.has(st)) return WAREHOUSE_SHIP_STATUS_LABEL;
  return fallback;
}

export const ORDER_STATUS_SELECT_OPTIONS = [
  ["pending", "Beklemede"],
  ["approved", "Onaylandı"],
  ["preparing", "Hazırlanıyor"],
  ["shipped", "Kargolandı"],
  ["completed", "Teslim edildi"],
  ["returned", "İade Edildi"],
  ["partially_returned", "Kısmi İade"],
];

export function orderStatusSelectOptions(ord = {}) {
  return ORDER_STATUS_SELECT_OPTIONS.map(([k, l]) => [k, k === "shipped" ? warehouseShippedOptionLabel(ord) : l]);
}

/** UI: buton aktif mi (backend can_warehouse_ship ile uyumlu). */
export function canWarehouseShip(ord = {}) {
  if (isWarehouseShipClosed(ord)) return false;
  if (isWarehouseShipped(ord)) return false;
  return true;
}

export function warehouseShipConfirm(order = {}) {
  return [
    `${order.order_number || "Sipariş"} depodan sevk edildi olarak işaretlensin mi?`,
    [order.customer_name, order.city].filter(Boolean).join(" • "),
    "Kargo kaydı oluşturulmaz; sipariş sevk edildi durumuna geçer.",
  ].filter(Boolean).join("\n");
}

export function warehouseShipPath(orderId) {
  return `/orders/${orderId}/warehouse-ship`;
}
