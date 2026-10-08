/** Pazaryeri / e-ticaret kanallarında müşteri fiyatı KDV dahildir. */
const VAT_INCL_CHANNELS = new Set([
  "shopphp",
  "trendyol",
  "hepsiburada",
  "n11",
  "amazon",
  "ciceksepeti",
  "shopify",
  "woocommerce",
]);

export function marketplacePriceIncludesVat(channel) {
  return VAT_INCL_CHANNELS.has(String(channel || "").toLowerCase());
}

/** Eski senkron kayıtlarında bayrak yoksa satırı KDV dahil say. */
export function withMarketplaceVatFlag(item, channel) {
  if (!item || typeof item !== "object") return item;
  if (!marketplacePriceIncludesVat(channel)) return item;
  if (item.price_includes_vat === false) return item;
  if (item.unit_price_incl != null && item.unit_price_incl !== "" && Number(item.unit_price_incl) > 0) {
    return item;
  }
  return { ...item, price_includes_vat: true };
}
