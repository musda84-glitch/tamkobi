/** GS1 / kamera öneklerini temizler. */
export function normalizeScanText(raw) {
  return String(raw || "")
    .trim()
    .replace(/^\]C1/i, "")
    .replace(/\u001d/g, "")
    .trim();
}

export function parseDraftQty(raw) {
  return Math.max(1, parseInt(String(raw ?? "1").replace(/\D/g, ""), 10) || 1);
}

function scanCodeOf(value) {
  return normalizeScanText(value).toLowerCase();
}

export function findCatalogByScan(products, code) {
  const c = scanCodeOf(code);
  if (!c) return null;
  return (products || []).find((p) => {
    if (scanCodeOf(p.barcode) === c || scanCodeOf(p.sku) === c) return true;
    return (p.variants || []).some((v) => scanCodeOf(v.barcode) === c || scanCodeOf(v.sku) === c);
  }) || null;
}

export function applyB2BScan({ products, code, qty, allowOrders = true, showStock = false } = {}) {
  const cleaned = normalizeScanText(code);
  const n = parseDraftQty(qty == null ? "1" : String(qty));
  const product = findCatalogByScan(products, cleaned);
  if (!product) {
    return { product: null, qty: n, action: "miss", message: cleaned ? `Barkod bulunamadı: ${cleaned}` : "Barkod okutun." };
  }
  if (allowOrders === false || (showStock && product.in_stock === false)) {
    return { product, qty: n, action: "filter", message: `${product.name || "Ürün"} bulundu` };
  }
  return { product, qty: n, action: "add", message: `${product.name || "Ürün"} sepete eklendi (${n})` };
}

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
