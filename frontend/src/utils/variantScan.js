/** Barkod / SKU karşılaştırması: sayı olarak kayıtlı ve boşluklu kodlar da eşleşir. */
export function normalizeCode(v) {
  return String(v ?? "").trim();
}

function asList(products) {
  return Array.isArray(products) ? products : [];
}

function variantsOf(product) {
  return Array.isArray(product?.variants) ? product.variants.filter((v) => v && typeof v === "object") : [];
}

/**
 * Tam eşleşme sırası: varyant barkodu, ana barkod, varyant SKU, ana SKU.
 * Hiçbiri tutmazsa aynı sıra büyük/küçük harf duyarsız tekrarlanır.
 * Ana barkod bir varyant barkoduyla aynıysa varyant döner.
 */
function findScanMatch(products, equals) {
  for (const product of products) {
    if (!product || typeof product !== "object") continue;
    for (const variant of variantsOf(product)) {
      if (equals(variant.barcode)) return { product, variant };
    }
  }
  for (const product of products) {
    if (!product || typeof product !== "object") continue;
    if (equals(product.barcode)) return { product, variant: null };
  }
  for (const product of products) {
    if (!product || typeof product !== "object") continue;
    for (const variant of variantsOf(product)) {
      if (equals(variant.sku)) return { product, variant };
    }
  }
  for (const product of products) {
    if (!product || typeof product !== "object") continue;
    if (equals(product.sku)) return { product, variant: null };
  }
  return null;
}

export function resolveScanMatch(products, code) {
  const needle = normalizeCode(code);
  if (!needle) return null;
  const list = asList(products);
  const exact = (value) => {
    const current = normalizeCode(value);
    return current !== "" && current === needle;
  };
  const hit = findScanMatch(list, exact);
  if (hit) return hit;
  const folded = needle.toLowerCase();
  return findScanMatch(list, (value) => {
    const current = normalizeCode(value);
    return current !== "" && current.toLowerCase() === folded;
  });
}

/** Satır kimliği: product_id + varyant SKU (SKU boşsa varyant barkodu). */
export function scanLineKey(productId, { sku, barcode } = {}) {
  const id = productId == null ? "" : String(productId);
  const token = normalizeCode(sku) || normalizeCode(barcode);
  return token ? `${id}::${token}` : id;
}

/**
 * Varyantlı okutmada product_id + varyant SKU (yoksa barkod).
 * Varyantsız eşleşmede eski davranış: yalnız product_id.
 * Varyantsız satırın kendi sku/barkodu (ana ürün kodu) kimliğe karışmaz.
 */
export function isSameScanLine(item, productId, variant) {
  if (!item || item.product_id !== productId) return false;
  if (!variant) return true;
  const wanted = scanLineKey(productId, { sku: variant.sku, barcode: variant.barcode });
  if (wanted === scanLineKey(productId, {})) return true;
  const sku = normalizeCode(variant.sku);
  const actual = sku
    ? scanLineKey(item.product_id, { sku: item.sku })
    : scanLineKey(item.product_id, { barcode: item.barcode });
  return actual === wanted;
}

/** Saha satırı: birim fiyat variant.price ?? variant.sale_price ?? product.sale_price; ad `Ürün - Varyant`. */
export function fieldSaleScanProduct(product, variant) {
  if (!product || !variant) return product;
  const unitPrice = Number(variant.price ?? variant.sale_price ?? product.sale_price ?? 0) || 0;
  return {
    ...product,
    sale_price: unitPrice,
    name: `${product.name} - ${variant.name}`,
    sku: variant.sku || product.sku,
    barcode: variant.barcode || product.barcode,
  };
}
