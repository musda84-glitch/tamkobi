export const WAREHOUSE_SHIP_CODE = "warehouse";
export const WAREHOUSE_SHIP_NAME = "Depodan sevk edildi";
export const WAREHOUSE_SHIP_HINT = "Kargo firması olmadan depodan teslim veya kendi araç ile sevk. Sipariş sevk edildi durumuna geçer.";

export function isWarehouseShipped(ord = {}) {
  if (ord.warehouse_shipped || String(ord.ship_method || "") === WAREHOUSE_SHIP_CODE) return true;
  if (String(ord.cargo_carrier || "").toLowerCase() === WAREHOUSE_SHIP_CODE) return true;
  return String(ord.cargo_tracking_number || "").toUpperCase().startsWith("DEPO-");
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
