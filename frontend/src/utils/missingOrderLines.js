/** Eksik ürün planı: kaynak siparişten satırları çıkar. */

export function missingLinesForOrder(missingItems = [], orderRef = {}) {
  const oid = orderRef.order_id;
  const ono = orderRef.order_number;
  if (!oid && !ono) return [];
  return (missingItems || [])
    .map((it) => {
      const src = (it.sources || []).find((s) =>
        (oid && s.order_id === oid) || (ono && s.order_number === ono)
      );
      if (!src) return null;
      const n = String(it.product_name || "").trim().toLowerCase();
      if (!n || n.startsWith("depo eksik")) return null;
      return {
        key: it.key,
        product_id: it.product_id,
        product_name: it.product_name || src.product_name || "Ürün",
        sku: it.sku,
        missing_qty: src.missing_qty != null ? Number(src.missing_qty) : Number(it.missing_qty) || 0,
        unit: it.unit || "Adet",
        has_recipe: it.has_recipe,
        stock_quantity: it.stock_quantity,
      };
    })
    .filter(Boolean);
}

export function filterMissingByOrder(missingItems = [], orderId = "") {
  if (!orderId) {
    return (missingItems || []).filter((it) => {
      const n = String(it.product_name || "").trim().toLowerCase();
      return n && !n.startsWith("depo eksik");
    });
  }
  return (missingItems || []).filter((it) => {
    const n = String(it.product_name || "").trim().toLowerCase();
    if (!n || n.startsWith("depo eksik")) return false;
    return (it.order_ids || []).includes(orderId)
      || (it.sources || []).some((s) => s.order_id === orderId);
  });
}
