/** Sipariş satırından üretim emri için stok kartı çözümle. */
export function resolveOrderLineProduct(item, catalog = []) {
  if (!item || !Array.isArray(catalog) || !catalog.length) return null;
  const pid = item.product_id || item.productId;
  const sku = String(item.sku || "").trim();
  return (
    catalog.find((x) => {
      const id = x.id || x._id;
      if (pid && id && String(id) === String(pid)) return true;
      if (sku && x.sku && String(x.sku) === sku) return true;
      return false;
    }) || null
  );
}

/** Mamul / yarı mamul için üretim emri verilebilir. */
export function orderLineCanProduce(product) {
  if (!product) return false;
  const t = String(product.type || "product");
  return t !== "service" && t !== "raw_material";
}

export function buildProduceFromOrderPayload(ord, item, product) {
  if (!orderLineCanProduce(product)) return null;
  const qty = Number(item?.quantity);
  return {
    ...product,
    id: product.id || product._id,
    _planQty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    _planNotes: `Sipariş ${ord?.order_number || ""}${ord?.customer_name ? ` · ${ord.customer_name}` : ""}`.trim(),
  };
}
