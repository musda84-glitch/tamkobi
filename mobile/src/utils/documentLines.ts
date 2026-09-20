export const VAT_OPTIONS = [20, 10, 1, 0];

export type LineEditField =
  | "unit_price"
  | "unit_price_incl"
  | "quantity"
  | "vat_rate"
  | "discount_rate"
  | "name"
  | "product_name"
  | "unit"
  | "gtip"
  | "origin_country"
  | string;

export type InvoiceLine = {
  product_id: string;
  name: string;
  product_name: string;
  sku: string;
  barcode?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  unit_price_incl: number;
  vat_rate: number;
  discount_rate: number;
  total: number;
  total_incl: number;
  vat_amount: number;
  is_service: boolean;
  gtip?: string;
  origin_country?: string;
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function emptyLine(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    product_id: "",
    name: "",
    product_name: "",
    sku: "",
    quantity: 1,
    unit: "Adet",
    unit_price: 0,
    unit_price_incl: 0,
    vat_rate: 20,
    discount_rate: 0,
    total: 0,
    total_incl: 0,
    vat_amount: 0,
    is_service: false,
    ...overrides,
  };
}

export function computeLine(item: Partial<InvoiceLine>, editedField?: LineEditField): InvoiceLine {
  const base = { ...emptyLine(), ...item };
  const qty = num(base.quantity);
  const vat = num(base.vat_rate, 20);
  const disc = Math.min(Math.max(num(base.discount_rate), 0), 100);
  let excl = num(base.unit_price);
  let incl = num(base.unit_price_incl);
  if (editedField === "unit_price_incl") {
    excl = vat === -100 ? incl : incl / (1 + vat / 100);
  } else {
    incl = excl * (1 + vat / 100);
  }
  const factor = 1 - disc / 100;
  const total = Math.round(qty * excl * factor * 100) / 100;
  const vatAmount = Math.round(((total * vat) / 100) * 100) / 100;
  return {
    ...base,
    discount_rate: disc,
    vat_rate: vat,
    quantity: qty,
    unit_price: Math.round(excl * 10000) / 10000,
    unit_price_incl: Math.round(incl * 10000) / 10000,
    total,
    total_incl: Math.round((total + vatAmount) * 100) / 100,
    vat_amount: vatAmount,
    name: base.name || base.product_name || "",
    product_name: base.product_name || base.name || "",
  };
}

export function hydrateLine(item?: Partial<InvoiceLine> & { discount_percent?: number } | null): InvoiceLine {
  if (!item) return computeLine(emptyLine());
  const next = {
    ...emptyLine(),
    ...item,
    name: item.name || item.product_name || "",
    product_name: item.product_name || item.name || "",
    discount_rate: item.discount_rate ?? item.discount_percent ?? 0,
  };
  if (!num(next.unit_price_incl) && num(next.unit_price)) {
    return computeLine(next, "unit_price");
  }
  if (!num(next.unit_price) && num(next.unit_price_incl)) {
    return computeLine(next, "unit_price_incl");
  }
  return computeLine(next, "unit_price");
}

export function lineFromProduct(
  prod: Record<string, unknown> | null | undefined,
  { invoiceType = "sales", quantity = 1 }: { invoiceType?: string; quantity?: number } = {},
): InvoiceLine {
  if (!prod) return computeLine(emptyLine({ quantity }));
  const vatRate = num(prod.vat_rate, 20);
  const price = invoiceType === "purchase" ? num(prod.purchase_price) : num(prod.sale_price);
  const includesVat = invoiceType !== "purchase" && !!prod.price_includes_vat;
  const editedField: LineEditField = includesVat ? "unit_price_incl" : "unit_price";
  return computeLine(
    {
      ...emptyLine(),
      product_id: String(prod.id || prod._id || ""),
      name: String(prod.name || ""),
      product_name: String(prod.name || ""),
      sku: String(prod.sku || ""),
      unit: String(prod.unit || "Adet"),
      quantity,
      unit_price: includesVat ? 0 : price,
      unit_price_incl: includesVat ? price : 0,
      vat_rate: vatRate,
      is_service: prod.type === "service",
      gtip: prod.gtip ? String(prod.gtip) : "",
      origin_country: prod.origin_country ? String(prod.origin_country) : "",
      barcode: prod.barcode ? String(prod.barcode) : "",
    },
    editedField,
  );
}

export function documentLineTotals(items: Partial<InvoiceLine>[] = []) {
  const rows = items.map((it) => computeLine(it));
  const subtotal = Math.round(rows.reduce((s, it) => s + num(it.total), 0) * 100) / 100;
  const vat = Math.round(rows.reduce((s, it) => s + num(it.vat_amount), 0) * 100) / 100;
  const lineDiscount =
    Math.round(
      rows.reduce((s, it) => s + num(it.quantity) * num(it.unit_price) * num(it.discount_rate) / 100, 0) * 100,
    ) / 100;
  return { rows, subtotal, vat, lineDiscount, grandTotal: Math.round((subtotal + vat) * 100) / 100 };
}

export function addProductToItems(
  items: InvoiceLine[],
  prod: Record<string, unknown>,
  invoiceType: string,
  defaultVat?: number,
): InvoiceLine[] {
  const pid = String(prod.id || prod._id || "");
  const existing = items.findIndex((it) => it.product_id && it.product_id === pid);
  if (existing >= 0) {
    return items.map((it, i) => (i === existing ? computeLine({ ...it, quantity: num(it.quantity) + 1 }, "quantity") : it));
  }
  const vat = defaultVat != null ? defaultVat : num(prod.vat_rate, 20);
  const line = computeLine({ ...lineFromProduct(prod, { invoiceType, quantity: 1 }), vat_rate: vat }, "vat_rate");
  const emptyIdx = items.findIndex((it) => !it.product_id && !it.name && !it.product_name);
  if (emptyIdx >= 0) return items.map((it, i) => (i === emptyIdx ? line : it));
  return [...items, line];
}

/** Drops an invoice line; keeps one empty row so the editor stays usable. */
export function removeInvoiceItem(items: InvoiceLine[], index: number, defaultVat = 20): InvoiceLine[] {
  const next = items.filter((_, i) => i !== index);
  return next.length ? next : [computeLine(emptyLine({ vat_rate: defaultVat }))];
}
