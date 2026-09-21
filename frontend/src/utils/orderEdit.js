const STATUS_LOCK = new Set(["cancelled", "returned", "delivered", "completed"]);
const MARKETPLACE = new Set(["trendyol", "hepsiburada", "n11", "amazon", "ciceksepeti", "pazarama", "pttavm", "shopify", "shopphp", "trendyol_market", "trendyol_yemek"]);

/** Boş string: düzenlenebilir. Onay ve taslak fatura kilit değildir. */
export function orderEditBlockedReason(order) {
  if (!order) return "Sipariş bulunamadı.";
  const status = String(order.order_status || "");
  if (STATUS_LOCK.has(status)) return "Bu durumdaki sipariş düzenlenemez.";
  if (order.is_invoiced) {
    const eType = order.invoice_e_type || order.e_type;
    if (eType === "paper") return "";
    return "E-belge kesilmiş sipariş düzenlenemez.";
  }
  return "";
}

export function orderLinesLocked(order) {
  return MARKETPLACE.has(String(order?.channel || "").toLowerCase());
}
