/** Sipariş listesi filtreleri (saf — UI bağımlılığı yok). */

import { orderGross } from "./orderMoney";
import { orderHasEInvoiceIssued } from "./orderMoreMenu";
import { ORDER_DOC_STATUS_ALL, orderMatchesDocStatus } from "./orderDocStatus";

export const ORDER_FILTER_DEFAULTS = {
  q: "",
  status: "all",
  channel: "all",
  invoiced: "all",
  cargo: "all",
  docStatus: [...ORDER_DOC_STATUS_ALL],
  from: "",
  to: "",
  sort: "date_desc",
};

export const ORDER_STATUS_OPTIONS = [
  ["all", "Tüm Durumlar"],
  ["incoming", "Yeni gelen"],
  ["pending", "Onay Bekliyor"],
  ["active_cart", "Aktif sepet"],
  ["held_cart", "Bekleyen sepet"],
  ["approved", "Onaylandı"],
  ["preparing", "Hazırlanıyor"],
  ["dispatched", "Sevk edilmiş"],
  ["shipped", "Kargoda"],
  ["delivered", "Teslim Edildi"],
  ["returned", "İade"],
  ["cancelled", "İptal"],
];

const INCOMING_STATUSES = new Set(["pending", "new", "approved", "held_cart", "active_cart"]);
const DISPATCHED_STATUSES = new Set(["shipped", "delivered", "completed"]);
export const CLOSED_STATUSES = new Set(["cancelled", "returned", "partially_returned"]);

export function isIncomingOrder(o) {
  return INCOMING_STATUSES.has(o?.order_status) && !o?.cargo_tracking_number;
}

export function isDispatchedOrder(o) {
  if (DISPATCHED_STATUSES.has(o?.order_status)) return true;
  return !!o?.cargo_tracking_number && !CLOSED_STATUSES.has(o?.order_status);
}

export function orderFiltersFromSearch(params) {
  const status = params?.get?.("status") || "";
  const q = params?.get?.("q") || "";
  const next = { ...ORDER_FILTER_DEFAULTS, docStatus: [...ORDER_DOC_STATUS_ALL] };
  if (ORDER_STATUS_OPTIONS.some(([k]) => k === status)) next.status = status;
  if (q) next.q = q;
  return next;
}

export const applyOrderFilters = (orders, f) => {
  const q = (f.q || "").trim().toLowerCase();
  const list = orders.filter((o) => {
    if (q && !`${o.order_number} ${o.customer_name} ${o.customer_phone || ""} ${o.cargo_tracking_number || ""} ${o.marketplace_order_id || ""} ${(o.items || []).map((i) => `${i.product_name} ${i.note || ""}`).join(" ")}`.toLowerCase().includes(q)) return false;
    // İptal / iade ana listede (Tüm Durumlar) görünmesin — İptaller sekmesi veya durum=İptal/İade ile açılır
    if ((f.status === "all" || f.status === "incoming") && CLOSED_STATUSES.has(o?.order_status)) return false;
    if (f.status === "incoming" && !isIncomingOrder(o)) return false;
    if (f.status === "dispatched" && !isDispatchedOrder(o)) return false;
    if (f.status !== "all" && f.status !== "incoming" && f.status !== "dispatched" && o.order_status !== f.status) return false;
    if (f.channel !== "all" && (o.channel || "b2b") !== f.channel) return false;
    if (f.invoiced === "yes" && !o.invoice_id) return false;
    if (f.invoiced === "einvoice" && !orderHasEInvoiceIssued(o)) return false;
    if (f.invoiced === "no" && o.invoice_id) return false;
    if (f.cargo === "yes" && !o.cargo_tracking_number) return false;
    if (f.cargo === "no" && o.cargo_tracking_number) return false;
    if (!orderMatchesDocStatus(o, f.docStatus)) return false;
    const d = (o.order_date || "").slice(0, 10);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    return true;
  });
  const cmp = {
    date_desc: (a, b) => (b.order_date || "").localeCompare(a.order_date || ""),
    date_asc: (a, b) => (a.order_date || "").localeCompare(b.order_date || ""),
    amount_desc: (a, b) => orderGross(b) - orderGross(a),
    amount_asc: (a, b) => orderGross(a) - orderGross(b),
    customer: (a, b) => (a.customer_name || "").localeCompare(b.customer_name || "", "tr"),
    number: (a, b) => (b.order_number || "").localeCompare(a.order_number || ""),
  }[f.sort];
  return cmp ? [...list].sort(cmp) : list;
};
