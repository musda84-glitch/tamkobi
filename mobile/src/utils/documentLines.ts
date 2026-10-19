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

function text(v: unknown): string {
  return String(v ?? "").trim();
}

export type ProductVariantRef = {
  name?: string;
  sku?: string | null;
  barcode?: string | null;
  price?: number | null;
  sale_price?: number | null;
};

/** İhracatta 0. Değilse karttaki oran; boş/null ise 20. Kartta yazan 0 korunur. */
export function productVatRate(prod: { vat_rate?: unknown } | null | undefined, exportInvoice = false): number {
  if (exportInvoice) return 0;
  const raw = prod?.vat_rate;
  if (raw == null) return 20;
  if (typeof raw === "string" && raw.trim() === "") return 20;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 20;
}

function nonzeroPrice(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

/** Alış satırı: önce son alış, yoksa kart alış fiyatı. */
export function purchaseCardPrice(prod: { last_purchase_price?: unknown; purchase_price?: unknown } | null | undefined): number {
  return nonzeroPrice(prod?.last_purchase_price) ?? nonzeroPrice(prod?.purchase_price) ?? num(prod?.purchase_price);
}

export function matchProductVariant(
  prod: { variants?: Array<ProductVariantRef | null> | null } | null | undefined,
  code: string,
): ProductVariantRef | undefined {
  const c = text(code);
  if (!c) return undefined;
  const variants = Array.isArray(prod?.variants) ? prod.variants : [];
  return variants.find((v) => !!v && (text(v.barcode) === c || text(v.sku) === c)) || undefined;
}

function cardUnitPrice(prod: Record<string, unknown>, invoiceType: string): number {
  return invoiceType === "purchase" ? purchaseCardPrice(prod) : num(prod.sale_price);
}

function variantUnitPrice(variant: ProductVariantRef | null | undefined, fallback: number): number {
  if (!variant) return fallback;
  return nonzeroPrice(variant.price) ?? nonzeroPrice(variant.sale_price) ?? fallback;
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
  {
    invoiceType = "sales",
    quantity = 1,
    exportInvoice = false,
    variant = null,
  }: {
    invoiceType?: string;
    quantity?: number;
    exportInvoice?: boolean;
    variant?: ProductVariantRef | null;
  } = {},
): InvoiceLine {
  if (!prod) return computeLine(emptyLine({ quantity, vat_rate: exportInvoice ? 0 : 20 }));
  const vatRate = productVatRate(prod, exportInvoice);
  const price = variantUnitPrice(variant, cardUnitPrice(prod, invoiceType));
  const includesVat = invoiceType !== "purchase" && !!prod.price_includes_vat;
  const editedField: LineEditField = includesVat ? "unit_price_incl" : "unit_price";
  const name = variant ? `${String(prod.name || "")} - ${String(variant.name || "")}` : String(prod.name || "");
  const sku = variant ? String(variant.sku || prod.sku || "") : String(prod.sku || "");
  const barcode = variant ? String(variant.barcode || prod.barcode || "") : (prod.barcode ? String(prod.barcode) : "");
  return computeLine(
    {
      ...emptyLine(),
      product_id: String(prod.id || prod._id || ""),
      name,
      product_name: name,
      sku,
      unit: String(prod.unit || "Adet"),
      quantity,
      unit_price: includesVat ? 0 : price,
      unit_price_incl: includesVat ? price : 0,
      vat_rate: vatRate,
      is_service: prod.type === "service",
      gtip: prod.gtip ? String(prod.gtip) : "",
      origin_country: prod.origin_country ? String(prod.origin_country) : "",
      barcode,
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

export type AddProductOptions = {
  exportInvoice?: boolean;
  variant?: ProductVariantRef | null;
  scanCode?: string;
};

export type ProductLineCommit = {
  items: InvoiceLine[];
  bumped: boolean;
  line: InvoiceLine;
};

function resolveAddOptions(arg?: number | AddProductOptions): AddProductOptions {
  if (typeof arg === "number") return { exportInvoice: arg === 0 };
  return arg || {};
}

function distinctVariantKeys(prod: Record<string, unknown>): Set<string> {
  const ownBarcode = text(prod.barcode);
  const ownSku = text(prod.sku);
  const keys = new Set<string>();
  const variants = Array.isArray(prod.variants) ? prod.variants as Array<ProductVariantRef | null> : [];
  for (const v of variants) {
    if (!v) continue;
    const barcode = text(v.barcode);
    const sku = text(v.sku);
    if (barcode && barcode !== ownBarcode) keys.add(barcode);
    if (sku && sku !== ownSku) keys.add(sku);
  }
  return keys;
}

function sameInvoiceProduct(
  it: InvoiceLine,
  incoming: InvoiceLine,
  prod: Record<string, unknown>,
  variant?: ProductVariantRef | null,
): boolean {
  if (!it.product_id || it.product_id !== incoming.product_id) return false;
  if (variant) {
    const keys = [text(variant.barcode), text(variant.sku)].filter(Boolean);
    if (!keys.length) return text(it.barcode) === text(incoming.barcode) && text(it.sku) === text(incoming.sku);
    const lineKeys = [text(it.barcode), text(it.sku)];
    return keys.some((key) => lineKeys.includes(key));
  }
  const variantKeys = distinctVariantKeys(prod);
  const lineKeys = [text(it.barcode), text(it.sku)].filter(Boolean);
  if (lineKeys.some((key) => variantKeys.has(key))) return false;
  return true;
}

export function commitProductLine(
  items: InvoiceLine[],
  prod: Record<string, unknown>,
  invoiceType: string,
  arg?: number | AddProductOptions,
): ProductLineCommit {
  const opts = resolveAddOptions(arg);
  const variant = opts.variant !== undefined
    ? opts.variant
    : (opts.scanCode ? matchProductVariant(prod, opts.scanCode) || null : null);
  const preview = lineFromProduct(prod, {
    invoiceType,
    quantity: 1,
    exportInvoice: !!opts.exportInvoice,
    variant,
  });
  const existing = items.findIndex((it) => sameInvoiceProduct(it, preview, prod, variant));
  if (existing >= 0) {
    const line = computeLine({ ...items[existing], quantity: num(items[existing].quantity) + 1 }, "quantity");
    return {
      items: items.map((it, i) => (i === existing ? line : it)),
      bumped: true,
      line,
    };
  }
  const emptyIdx = items.findIndex((it) => !it.product_id && !it.name && !it.product_name);
  const next = emptyIdx >= 0 ? items.map((it, i) => (i === emptyIdx ? preview : it)) : [...items, preview];
  return { items: next, bumped: false, line: preview };
}

export function addProductToItems(
  items: InvoiceLine[],
  prod: Record<string, unknown>,
  invoiceType: string,
  defaultVat?: number | AddProductOptions,
): InvoiceLine[] {
  return commitProductLine(items, prod, invoiceType, defaultVat).items;
}

export function invoiceBarcodeFeedback(result: {
  bumped: boolean;
  line: Pick<InvoiceLine, "name" | "product_name" | "quantity" | "unit">;
}): string {
  const name = result.line.name || result.line.product_name || "Ürün";
  if (!result.bumped) return `${name} eklendi`;
  const unit = text(result.line.unit) || "Adet";
  return `${name} +1 → faturada ${result.line.quantity} ${unit}`;
}

export function invoiceBarcodeMiss(code: string): string {
  return `Barkod eşleşmedi: ${text(code)}`;
}

/** Drops an invoice line; keeps one empty row so the editor stays usable. */
export function removeInvoiceItem(items: InvoiceLine[], index: number, defaultVat = 20): InvoiceLine[] {
  const next = items.filter((_, i) => i !== index);
  return next.length ? next : [computeLine(emptyLine({ vat_rate: defaultVat }))];
}
