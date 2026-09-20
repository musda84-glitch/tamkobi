const MARKETPLACE_CHANNELS = new Set([
  "trendyol", "hepsiburada", "n11", "amazon", "ciceksepeti", "pazarama",
  "pttavm", "shopify", "shopphp", "trendyol_market", "trendyol_yemek",
]);

const CLOSED = new Set(["cancelled", "canceled", "returned", "partially_returned"]);
const ALREADY_APPROVED = new Set(["approved", "delivered", "shipped", "completed"]);
const CREATED = new Set(["Created", "WaitingInAction", "UnPacked"]);
const MP_ALREADY_APPROVED = new Set(["Picking", "Invoiced", "Shipped", "Delivered", "AtCollectionPoint"]);

export function isMarketplaceChannel(channel) {
  return MARKETPLACE_CHANNELS.has(String(channel || "").toLowerCase());
}

export function canChangeMarketplaceCargo(order) {
  const st = String(order?.order_status || "").toLowerCase();
  return isMarketplaceChannel(order?.channel) && !CLOSED.has(st);
}

export function canShowMarketplaceApprove(order) {
  if (!isMarketplaceChannel(order?.channel)) {
    return ["pending", "new"].includes(String(order?.order_status || ""));
  }
  const st = String(order?.order_status || "").toLowerCase();
  const mp = String(order?.marketplace_status || "");
  if (CLOSED.has(st) || ALREADY_APPROVED.has(st) || MP_ALREADY_APPROVED.has(mp)) return false;
  return ["pending", "new"].includes(st) || CREATED.has(mp);
}
