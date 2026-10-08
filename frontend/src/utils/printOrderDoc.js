/** Sipariş yazdırma belgesi: fatura kalemleri varsa onları kullan (güncel ad/fiyat). */

export function mergeInvoiceItemsIntoOrder(order, invoice) {
  if (!order) return null;
  const invItems = Array.isArray(invoice?.items) ? invoice.items : [];
  if (!invItems.length) return { ...order };

  const orderItems = Array.isArray(order.items) ? order.items : [];
  const items = invItems.map((it, i) => {
    const prev = orderItems[i] || {};
    const name = it.name || it.product_name || prev.name || prev.product_name || "";
    return {
      ...prev,
      ...it,
      name,
      product_name: it.product_name || it.name || prev.product_name || name,
      product_id: it.product_id || prev.product_id || "",
      sku: it.sku || prev.sku || "",
      barcode: it.barcode || prev.barcode || "",
      image_url: it.image_url || prev.image_url || "",
      thumbnail_url: it.thumbnail_url || prev.thumbnail_url || "",
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
