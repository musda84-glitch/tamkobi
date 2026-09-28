const STATUS_LOCK = new Set(["cancelled", "returned", "delivered", "completed"]);
const MARKETPLACE = new Set(["trendyol", "hepsiburada", "n11", "amazon", "ciceksepeti", "pazarama", "pttavm", "shopify", "shopphp", "trendyol_market", "trendyol_yemek"]);
const E_ISSUED_STATES = new Set(["sent", "queued", "accepted"]);

/** Boş string: düzenlenebilir. Onay, taslak ve GİB'e gitmemiş fatura kilit değildir. */
export function orderEditBlockedReason(order) {
  if (!order) return "Sipariş bulunamadı.";
  const status = String(order.order_status || "");
  if (STATUS_LOCK.has(status)) return "Bu durumdaki sipariş düzenlenemez.";
  const eType = String(order.invoice_e_type || order.e_type || "").toLowerCase();
  if (eType === "paper" || eType === "expense_slip") return "";
  const state = String(order.einvoice_state || "").toLowerCase();
  if (E_ISSUED_STATES.has(state)) return "E-belge kesilmiş sipariş düzenlenemez.";
  // is_invoiced tek başına kilit değil — GİB'e kesilmemiş panel faturası düzenlenebilir.
  return "";
}

export function orderLinesLocked(order) {
  return MARKETPLACE.has(String(order?.channel || "").toLowerCase());
}
