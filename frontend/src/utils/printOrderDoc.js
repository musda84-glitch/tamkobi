/** Sipariş yazdırma belgesi: fatura kalemleri varsa onları kullan (güncel ad/fiyat). */

function _normName(s) {
  return String(s || "").trim().toLocaleLowerCase("tr-TR");
}

function _pickPrev(orderItems, invItem, index) {
  const byIndex = orderItems[index];
  const pid = invItem?.product_id;
  if (pid) {
    const hit = orderItems.find((o) => o.product_id && o.product_id === pid);
    if (hit) return hit;
  }
  const sku = String(invItem?.sku || "").trim();
  if (sku) {
    const hit = orderItems.find((o) => String(o.sku || "").trim() === sku);
    if (hit) return hit;
  }
  const name = _normName(invItem?.name || invItem?.product_name);
  if (name) {
    const hit = orderItems.find((o) => _normName(o.name || o.product_name) === name);
    if (hit) return hit;
  }
  return byIndex || {};
}

function _media(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    const u = v.url ?? v.image_url ?? v.thumbnail_url ?? v.src ?? "";
    return u == null ? "" : String(u).trim();
  }
  return String(v).trim();
}

/** Stok kartından satıra görsel alanlarını bas. */
export function stampProductImagesOnItem(item, product) {
  if (!item) return item;
  if (!product) return { ...item };
  const thumb = _media(product.thumbnail_url);
  const image = _media(product.image_url) || (Array.isArray(product.images) ? _media(product.images[0]) : "");
  return {
    ...item,
    product_id: item.product_id || product.id || product._id || "",
    sku: item.sku || product.sku || "",
    barcode: item.barcode || product.barcode || "",
    thumbnail_url: _media(item.thumbnail_url) || thumb || "",
    image_url: _media(item.image_url) || image || thumb || "",
    images: item.images || product.images || undefined,
  };
}

/**
 * Yazdırma öncesi: ürün listesinden görselleri satırlara yaz.
 * products: id/sku/name ile eşleşen stok kartları.
 */
export function hydratePrintItemImages(items, products = []) {
  const byId = {};
  const bySku = {};
  const byName = {};
  (products || []).forEach((p) => {
    const id = p.id || p._id;
    if (id) byId[id] = p;
    const sku = String(p.sku || "").trim();
    if (sku) bySku[sku] = p;
    const name = _normName(p.name);
    if (name) byName[name] = p;
  });
  return (items || []).map((it) => {
    const prod =
      (it.product_id && byId[it.product_id])
      || (it.sku && bySku[String(it.sku).trim()])
      || byName[_normName(it.name || it.product_name)]
      || null;
    return stampProductImagesOnItem(it, prod);
  });
}

export function mergeInvoiceItemsIntoOrder(order, invoice) {
  if (!order) return null;
  const invItems = Array.isArray(invoice?.items) ? invoice.items : [];
  if (!invItems.length) return { ...order };

  const orderItems = Array.isArray(order.items) ? order.items : [];
  const items = invItems.map((it, i) => {
    const prev = _pickPrev(orderItems, it, i);
    const name = it.name || it.product_name || prev.name || prev.product_name || "";
    return {
      ...prev,
      ...it,
      name,
      product_name: it.product_name || it.name || prev.product_name || name,
      product_id: it.product_id || prev.product_id || "",
      sku: it.sku || prev.sku || "",
      barcode: it.barcode || prev.barcode || "",
      image_url: _media(it.image_url) || _media(prev.image_url) || "",
      thumbnail_url: _media(it.thumbnail_url) || _media(prev.thumbnail_url) || "",
      images: it.images || prev.images || undefined,
    };
  });

  return {
    ...order,
    items,
    shipping_address: order.shipping_address || invoice.shipping_address || order.address || "",
    city: order.city || invoice.city || "",
    customer_phone: order.customer_phone || invoice.customer_phone || "",
  };
}
