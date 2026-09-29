/** B2B / panel sipariş: sevk sonrası Teslim edildi butonu. */

export const DELIVERABLE_PICK_CHANNELS = new Set(["b2b", "manual", "saha", ""]);

export function canMarkDeliveredFromPick(order) {
  if (!order) return false;
  if (order.can_mark_delivered === true) return true;
  if (order.can_mark_delivered === false) return false;
  const ch = String(order.channel || "manual").trim().toLowerCase();
  if (!DELIVERABLE_PICK_CHANNELS.has(ch)) return false;
  return String(order.order_status || "").toLowerCase() === "shipped";
}
