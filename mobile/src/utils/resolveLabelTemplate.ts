/** Pick / quick-print: stok kartına atanmış şablon, yoksa varsayılan / ilk / hazır. */

export type LabelTemplateLike = {
  id?: string;
  _id?: string;
  name?: string;
  is_default?: boolean;
  width_mm?: number;
  height_mm?: number;
  page?: { mode?: string; cols?: number; rows?: number; gap_mm?: number };
  elements?: Array<Record<string, unknown>>;
  is_builtin?: boolean;
};

export function resolveLabelTemplate(
  templates: LabelTemplateLike[] | null | undefined,
  product: { label_template_id?: string | null } | null | undefined,
  builtins: LabelTemplateLike[] = [],
): LabelTemplateLike | null {
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

export function pickLineToLabelProduct(line: Record<string, unknown> | null | undefined) {
  if (!line) return null;
  const name = String(line.product_name || line.name || "Ürün").trim() || "Ürün";
  const id = String(line.product_id || line.id || line._id || name);
  const image = String(line.label_image_url || line.image_url || "");
  return {
    id,
    _id: id,
    name,
    sku: String(line.sku || "").trim(),
    barcode: String(line.barcode || line.sku || "").trim(),
    sale_price: line.sale_price as number | undefined,
    vat_rate: line.vat_rate as number | undefined,
    currency: line.currency as string | undefined,
    price_includes_vat: line.price_includes_vat as boolean | undefined,
    tags: line.tags as string[] | undefined,
    category: line.category as string | undefined,
    unit: line.unit as string | undefined,
    image_url: image,
    label_image_url: String(line.label_image_url || image),
    label_template_id: (line.label_template_id as string) || null,
  };
}

export function builtinLabelTemplates(): LabelTemplateLike[] {
  const sizes: Array<[number, number]> = [[40, 20], [50, 30], [60, 40], [100, 30], [100, 50]];
  return sizes.map(([w, h]) => ({
    id: `builtin-${w}x${h}`,
    name: `Hazır ${w}×${h} mm`,
    width_mm: w,
    height_mm: h,
    is_builtin: true,
    page: { mode: "thermal", cols: 1, rows: 1, gap_mm: 2 },
    elements: defaultElements(w, h),
  }));
}

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function defaultElements(w: number, h: number) {
  const compact = h <= 22;
  if (compact) {
    return [
      { id: uid(), type: "field", field: "name", x: 1.5, y: 0.6, w: w - 3, h: 4, font: 7, bold: true, align: "left" },
      { id: uid(), type: "barcode", x: 1.5, y: 5, w: Math.max(18, w - 18), h: h - 7.5, showText: true },
      { id: uid(), type: "field", field: "price", x: w - 15, y: 5, w: 13.5, h: 6, font: 9, bold: true, align: "right", vat: "incl" },
      { id: uid(), type: "field", field: "sku", x: w - 15, y: 11.5, w: 13.5, h: 4, font: 5, align: "right" },
    ];
  }
  return [
    { id: uid(), type: "field", field: "name", x: 2, y: 1.5, w: w - 4, h: 7, font: 10, bold: true, align: "left" },
    { id: uid(), type: "barcode", x: 2, y: 9, w: Math.min(60, w - 4), h: h - 12, showText: true },
    { id: uid(), type: "field", field: "price", x: w - 36, y: 10, w: 34, h: 9, font: 16, bold: true, align: "right", vat: "incl" },
    { id: uid(), type: "field", field: "sku", x: w - 36, y: 20, w: 34, h: 5, font: 7, align: "right" },
  ];
}
