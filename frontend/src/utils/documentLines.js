export const VAT_OPTIONS = [20, 10, 1, 0];

export const fmtMoney = (n) =>
  (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function emptyLine(overrides = {}) {
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

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function computeLine(item, editedField) {
  const qty = num(item.quantity);
  const vat = num(item.vat_rate, 20);
  const disc = Math.min(Math.max(num(item.discount_rate), 0), 100);
  let excl = num(item.unit_price);
  let incl = num(item.unit_price_incl);
  if (editedField === "unit_price_incl") {
    excl = vat === -100 ? incl : incl / (1 + vat / 100);
  } else {
    incl = excl * (1 + vat / 100);
  }
  const factor = 1 - disc / 100;
  // Backend enrich_line ile aynı: satır tutarları 2 haneye yuvarlanır.
  const total = Math.round(qty * excl * factor * 100) / 100;
  const vatAmount = Math.round(total * vat / 100 * 100) / 100;
  return {
    ...item,
    discount_rate: disc,
    vat_rate: vat,
    unit_price: Math.round(excl * 10000) / 10000,
    unit_price_incl: Math.round(incl * 10000) / 10000,
    total,
    total_incl: Math.round((total + vatAmount) * 100) / 100,
    vat_amount: vatAmount,
    name: item.name || item.product_name || "",
    product_name: item.product_name || item.name || "",
  };
}

export function hydrateLine(item) {
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

export function lineFromProduct(prod, { invoiceType = "sales", quantity = 1 } = {}) {
  if (!prod) return computeLine(emptyLine({ quantity }));
  const vatRate = prod.vat_rate ?? 20;
  let price = invoiceType === "purchase" ? num(prod.purchase_price) : num(prod.sale_price);
  // Satış fiyatı KDV dahil ise net birim fiyata indir; computeLine tekrar KDV eklemesin.
  const includesVat = invoiceType !== "purchase" && !!prod.price_includes_vat;
  const editedField = includesVat ? "unit_price_incl" : "unit_price";
  return computeLine({
    ...emptyLine(),
    product_id: prod.id || prod._id || "",
    name: prod.name || "",
    product_name: prod.name || "",
    sku: prod.sku || "",
    unit: prod.unit || "Adet",
    quantity,
    unit_price: includesVat ? 0 : price,
    unit_price_incl: includesVat ? price : 0,
    vat_rate: vatRate,
    is_service: prod.type === "service",
    gtip: prod.gtip || "",
    origin_country: prod.origin_country || "",
    barcode: prod.barcode || "",
  }, editedField);
}

export function documentLineTotals(items = []) {
  const rows = items.map((it) => computeLine(it));
  const subtotal = Math.round(rows.reduce((s, it) => s + num(it.total), 0) * 100) / 100;
  const vat = Math.round(rows.reduce((s, it) => s + num(it.vat_amount), 0) * 100) / 100;
  const lineDiscount = Math.round(rows.reduce(
    (s, it) => s + num(it.quantity) * num(it.unit_price) * num(it.discount_rate) / 100,
    0
  ) * 100) / 100;
  return { rows, subtotal, vat, lineDiscount, grandTotal: Math.round((subtotal + vat) * 100) / 100 };
}
