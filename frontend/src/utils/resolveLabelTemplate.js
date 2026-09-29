/** Pick / quick-print: stok kartına atanmış şablon, yoksa varsayılan / ilk / hazır. */

export function resolveLabelTemplate(templates = [], product, builtins = []) {
  const list = Array.isArray(templates) ? templates : [];
  const builtinList = Array.isArray(builtins) ? builtins : [];
  const assignedId = String(product?.label_template_id || "").trim();
  if (assignedId) {
    const assigned = list.find((t) => String(t?.id || t?._id || "") === assignedId);
    if (assigned) return assigned;
  }
  const def = list.find((t) => t?.is_default);
  if (def) return def;
  if (list[0]) return list[0];
  return (
    builtinList.find((t) => t?.id === "builtin-50x30")
    || builtinList[0]
    || null
  );
}

/** Pick satırından LabelCanvas / LabelQuickPrint ürün nesnesi. */
export function pickLineToLabelProduct(line) {
  if (!line) return null;
  const name = String(line.product_name || line.name || "Ürün").trim() || "Ürün";
  const id = line.product_id || line.id || line._id || name;
  const image = line.label_image_url || line.image_url || "";
  return {
    id,
    _id: id,
    name,
    sku: String(line.sku || "").trim(),
    barcode: String(line.barcode || line.sku || "").trim(),
    sale_price: line.sale_price,
    vat_rate: line.vat_rate,
    currency: line.currency,
    price_includes_vat: line.price_includes_vat,
    tags: line.tags,
    category: line.category,
    unit: line.unit,
    image_url: image,
    label_image_url: line.label_image_url || image,
    label_template_id: line.label_template_id || null,
  };
}
