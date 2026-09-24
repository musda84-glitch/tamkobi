/** Sipariş belge durumu (taslak / irsaliye / fatura / iptal). */

export const ORDER_DOC_STATUS_ALL = ["draft", "dispatched", "invoiced", "cancelled"];

export const ORDER_DOC_STATUS_LABELS = {
  draft: "Taslak",
  dispatched: "İrsaliyeleşmiş",
  invoiced: "Faturalaşmış",
  cancelled: "İptal",
};

/**
 * Siparişin belge durum kodu.
 * Öncelik: iptal → faturalaşmış → irsaliyeleşmiş → taslak.
 */
export function orderDocStatus(o) {
  const st = String(o?.order_status || "").toLowerCase();
  if (st === "cancelled" || st === "canceled") return "cancelled";
  if (o?.is_invoiced) return "invoiced";
  if (o?.dispatch_number || o?.dispatch_id || o?.e_type === "e_dispatch") return "dispatched";
  return "draft";
}

/** Seçili belge durumları boş veya hepsi → filtre yok. */
export function docStatusFilterActive(selected) {
  if (!Array.isArray(selected) || !selected.length) return false;
  if (selected.length >= ORDER_DOC_STATUS_ALL.length
    && ORDER_DOC_STATUS_ALL.every((k) => selected.includes(k))) return false;
  return true;
}

export function orderMatchesDocStatus(o, selected) {
  if (!docStatusFilterActive(selected)) return true;
  return selected.includes(orderDocStatus(o));
}
