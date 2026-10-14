/** Sipariş listesi filtreleri (saf — UI bağımlılığı yok). */

import { orderGross } from "./orderMoney";
import { orderHasEInvoiceIssued } from "./orderMoreMenu";
import { ORDER_DOC_STATUS_ALL, docStatusFilterActive, orderMatchesDocStatus } from "./orderDocStatus";

/** GET /orders varsayılanı: B2B aktif sepet satırları listede yok. */
export function isActiveCartOrder(o) {
  if (!o) return false;
  return o.order_status === "active_cart" || o.is_active_cart === true || o.source === "b2b_active_cart";
}

/** IndexedDB / sync → panel: aktif sepet hariç. */
export const orderPanelFilter = (o) => !isActiveCartOrder(o);

/** Portal / panel: bekleyen sepet satırlarını işaretle (sunucu _decorate_b2b_held_order ile aynı). */
export function decorateB2bHeldOrder(o) {
  if (!o) return o;
  const row = { ...o };
  if (isActiveCartOrder(row)) {
    row.is_active_cart = true;
    row.is_held_cart = false;
    row.view_only = true;
    row.held_label = row.held_label || "Aktif sepet";
    row.order_status = "active_cart";
    return row;
  }
  if (row.order_status === "held_cart" || row.is_held_cart || row.source === "b2b_held_cart") {
    const seq = Number(row.held_seq) || 1;
    row.is_held_cart = true;
    row.is_active_cart = false;
    row.view_only = true;
    row.held_seq = seq;
    row.held_label = row.held_label || `Bekleyen sepet #${seq}`;
    row.order_status = "held_cart";
  }
  return row;
}

/** Aktif sepet → bekleyen sepet → diğer siparişler. */
export function sortB2bCartOrders(docs) {
  const list = Array.isArray(docs) ? docs : [];
  const active = [];
  const held = [];
  const rest = [];
  for (const o of list) {
    if (o?.is_active_cart || o?.order_status === "active_cart") active.push(o);
    else if (o?.is_held_cart || o?.order_status === "held_cart") held.push(o);
    else rest.push(o);
  }
  return active.concat(held, rest);
}

/** Sync/cache satırlarını panel listesine hazırla. */
export function prepareOrdersForPanel(rows) {
  const decorated = (Array.isArray(rows) ? rows : []).filter(orderPanelFilter).map(decorateB2bHeldOrder);
  return sortB2bCartOrders(decorated);
}

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

/** Kanal listesi sayfadaki satırlara bağlı kalmasın. */
export const ORDER_CHANNELS = [
  "b2b", "manual", "saha", "trendyol", "hepsiburada", "n11", "amazon",
  "shopify", "woocommerce", "ciceksepeti", "pazarama", "shopphp",
];

export const ORDER_SORT_KEYS = [
  "date_desc", "date_asc", "amount_desc", "amount_asc", "customer", "customer_desc",
  "number", "number_asc", "status_asc", "status_desc", "items_asc", "items_desc",
];

const TR_FOLD = { ş: "s", Ş: "s", ı: "i", İ: "i", I: "i", ğ: "g", Ğ: "g", ü: "u", Ü: "u", ö: "o", Ö: "o", ç: "c", Ç: "c" };

/** ş=s, ı=i, ğ=g, ü=u, ö=o, ç=c */
export function foldTr(value) {
  return String(value || "").replace(/[şŞıİIğĞüÜöÖçÇ]/g, (ch) => TR_FOLD[ch] || ch).toLowerCase();
}

const IST_OFFSET = "+03:00";

export function orderInstantMs(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const ms = new Date(`${text}T00:00:00${IST_OFFSET}`).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const naive = /^\d{4}-\d{2}-\d{2}T/.test(text) && !/[zZ]$/.test(text) && !/[+-]\d{2}:?\d{2}$/.test(text);
  const ms = new Date(naive ? `${text}Z` : text).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function istanbulDayStartMs(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const ms = new Date(`${ymd}T00:00:00${IST_OFFSET}`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function istanbulDayEndExclusiveMs(ymd) {
  const start = istanbulDayStartMs(ymd);
  if (start == null) return null;
  return start + 24 * 60 * 60 * 1000;
}

export function columnSortFromOrderSort(sort) {
  const map = {
    date_desc: ["order_date", "desc"],
    date_asc: ["order_date", "asc"],
    amount_desc: ["total_amount", "desc"],
    amount_asc: ["total_amount", "asc"],
    customer: ["customer_name", "asc"],
    customer_desc: ["customer_name", "desc"],
    number: ["order_number", "desc"],
    number_asc: ["order_number", "asc"],
    status_asc: ["order_status", "asc"],
    status_desc: ["order_status", "desc"],
    items_asc: ["items", "asc"],
    items_desc: ["items", "desc"],
  };
  const pair = map[sort] || map.date_desc;
  return { key: pair[0], dir: pair[1] };
}

export function toggleColumnSort(currentSort, columnKey) {
  const pairs = {
    order_number: ["number", "number_asc"],
    customer_name: ["customer", "customer_desc"],
    total_amount: ["amount_desc", "amount_asc"],
    order_status: ["status_desc", "status_asc"],
    items: ["items_desc", "items_asc"],
    order_date: ["date_desc", "date_asc"],
  };
  const [desc, asc] = pairs[columnKey] || ["date_desc", "date_asc"];
  const cur = columnSortFromOrderSort(currentSort);
  if (cur.key !== columnKey) return desc;
  return cur.dir === "desc" ? asc : desc;
}

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
const SHIPPED_MARKETPLACE = new Set([
  "shipped", "delivered", "intransit", "in_transit",
  "atcollectionpoint", "kargolandi", "kargoda",
]);
export const CLOSED_STATUSES = new Set(["cancelled", "returned", "partially_returned"]);

/** Kargolandı: sipariş durumu veya pazaryeri durumu. Takip no tek başına yetmez. */
export function isShippedOrder(o) {
  if (DISPATCHED_STATUSES.has(o?.order_status)) return true;
  return SHIPPED_MARKETPLACE.has(foldTr(o?.marketplace_status).trim());
}

export function isIncomingOrder(o) {
  return INCOMING_STATUSES.has(o?.order_status) && !isShippedOrder(o);
}

export function isDispatchedOrder(o) {
  return isShippedOrder(o);
}

export function orderFiltersFromSearch(params) {
  const get = (key) => params?.get?.(key) || "";
  const next = { ...ORDER_FILTER_DEFAULTS, docStatus: [...ORDER_DOC_STATUS_ALL] };
  const status = get("status");
  if (ORDER_STATUS_OPTIONS.some(([k]) => k === status)) next.status = status;
  next.q = get("q");
  const channel = get("channel");
  if (channel) next.channel = channel;
  const invoiced = get("invoiced");
  if (["all", "yes", "no", "einvoice", "einvoice_unsent"].includes(invoiced)) next.invoiced = invoiced;
  const cargo = get("cargo");
  if (["all", "yes", "no"].includes(cargo)) next.cargo = cargo;
  const doc = get("doc");
  if (doc) {
    next.docStatus = doc.split(",").map((s) => s.trim()).filter((k) => ORDER_DOC_STATUS_ALL.includes(k));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(get("from"))) next.from = get("from");
  if (/^\d{4}-\d{2}-\d{2}$/.test(get("to"))) next.to = get("to");
  const sort = get("sort");
  if (ORDER_SORT_KEYS.includes(sort)) next.sort = sort;
  return next;
}

/** Seçili filtreleri URL'de tutar. Filtre yazımı sayfayı 1'e döndürmek için page paramını siler. */
export function writeOrderFiltersToParams(current, filters) {
  const params = new URLSearchParams(typeof current?.toString === "function" ? current.toString() : "");
  const setOrDel = (key, value, empty) => {
    if (value == null || value === "" || value === empty) params.delete(key);
    else params.set(key, String(value));
  };
  setOrDel("q", (filters?.q || "").trim(), "");
  setOrDel("status", filters?.status, "all");
  setOrDel("channel", filters?.channel, "all");
  setOrDel("invoiced", filters?.invoiced, "all");
  setOrDel("cargo", filters?.cargo, "all");
  if (!docStatusFilterActive(filters?.docStatus)) params.delete("doc");
  else params.set("doc", filters.docStatus.join(","));
  setOrDel("from", filters?.from, "");
  setOrDel("to", filters?.to, "");
  setOrDel("sort", filters?.sort, "date_desc");
  params.delete("page");
  return params;
}

export function orderFiltersRestChanged(a, b) {
  const keys = ["status", "channel", "invoiced", "cargo", "from", "to", "sort"];
  if (keys.some((k) => (a?.[k] || "") !== (b?.[k] || ""))) return true;
  const left = [...(a?.docStatus || [])].sort().join(",");
  const right = [...(b?.docStatus || [])].sort().join(",");
  return left !== right;
}

export function buildOrderListParams(f, { companyId, page = 1, pageSize = 50, customer = "", exportAll = false, scope = "" } = {}) {
  const params = {
    company_id: companyId,
    paged: 1,
    page: exportAll ? 1 : page,
    page_size: exportAll ? 5000 : pageSize,
    sort: f?.sort || "date_desc",
  };
  if (f?.q) params.q = f.q;
  if (f?.status && f.status !== "all") params.status = f.status;
  if (f?.channel && f.channel !== "all") params.channel = f.channel;
  if (f?.invoiced && f.invoiced !== "all") params.invoiced = f.invoiced;
  if (f?.cargo && f.cargo !== "all") params.cargo = f.cargo;
  if (docStatusFilterActive(f?.docStatus)) params.doc_status = f.docStatus.join(",");
  if (f?.from) params.date_from = f.from;
  if (f?.to) params.date_to = f.to;
  if (customer) params.customer = customer;
  if (exportAll) params.export = 1;
  if (scope) params.scope = scope;
  return params;
}

const GIB_ERR = /^\s*hata\s*:/i;

/** Fatura oluşmuş; e-Fatura/e-Arşiv entegratöre/GİB'e gitmemiş (taslak, hata, hiç gönderilmemiş). */
export function orderInvoiceNotSentToGib(o) {
  if (!o?.invoice_id) return false;
  const state = String(o.einvoice_state || "").toLowerCase();
  const gs = String(o.invoice_gib_status || o.gib_status || "");
  if (state === "error" || GIB_ERR.test(gs)) return true;
  return !orderHasEInvoiceIssued(o);
}

function orderSearchBlob(o) {
  const parts = [
    o?.order_number,
    o?.customer_name,
    o?.customer_phone,
    o?.cargo_tracking_number,
    o?.marketplace_order_id,
  ];
  for (const item of o?.items || []) {
    parts.push(item?.product_name, item?.sku, item?.product_sku, item?.barcode, item?.note);
  }
  return foldTr(parts.filter(Boolean).join(" "));
}

export const applyOrderFilters = (orders, f) => {
  const q = foldTr((f.q || "").trim());
  const list = orders.filter((o) => {
    if (q && !orderSearchBlob(o).includes(q)) return false;
    // İptal / iade ana listede (Tüm Durumlar) görünmesin — İptaller sekmesi veya durum=İptal/İade ile açılır
    if ((f.status === "all" || f.status === "incoming") && CLOSED_STATUSES.has(o?.order_status)) return false;
    if (f.status === "incoming" && !isIncomingOrder(o)) return false;
    if (f.status === "dispatched" && !isDispatchedOrder(o)) return false;
    if (f.status === "active_cart" && !isActiveCartOrder(o)) return false;
    if (f.status !== "all" && f.status !== "incoming" && f.status !== "dispatched" && f.status !== "active_cart" && o.order_status !== f.status) return false;
    if (f.channel !== "all" && (o.channel || "b2b") !== f.channel) return false;
    if (f.invoiced === "yes" && !o.invoice_id) return false;
    if (f.invoiced === "einvoice" && !orderHasEInvoiceIssued(o)) return false;
    if (f.invoiced === "einvoice_unsent" && !orderInvoiceNotSentToGib(o)) return false;
    if (f.invoiced === "no" && o.invoice_id) return false;
    if (f.cargo === "yes" && !isShippedOrder(o)) return false;
    if (f.cargo === "no" && isShippedOrder(o)) return false;
    if (!orderMatchesDocStatus(o, f.docStatus)) return false;
    if (f.from || f.to) {
      const ms = orderInstantMs(o.order_date || o.created_at);
      if (ms == null) return false;
      if (f.from && ms < istanbulDayStartMs(f.from)) return false;
      if (f.to && ms >= istanbulDayEndExclusiveMs(f.to)) return false;
    }
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
