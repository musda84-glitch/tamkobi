/** B2B katalog araması: ad, SKU, barkod ve etiketler (tags). */
export function matchesB2BQuery(product, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const name = String(product?.name || "").toLowerCase();
  const sku = String(product?.sku || "").toLowerCase();
  const barcode = String(product?.barcode || "").toLowerCase();
  if (name.includes(q) || sku.includes(q) || barcode.includes(q)) return true;
  const tags = Array.isArray(product?.tags) ? product.tags : [];
  return tags.some((t) => String(t || "").toLowerCase().includes(q));
}
