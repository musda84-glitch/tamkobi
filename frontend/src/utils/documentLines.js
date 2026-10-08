import { formatTrAmount, fmtMoney as formatMoneyWithCurrency } from "./money";
export const VAT_OPTIONS = [20, 10, 1, 0];

/** Amount only (no currency). Prefer fmtMoney(n, currency) for UI. */
export const fmtAmount = (n) => formatTrAmount(Number(n) || 0);

/** Amount + currency suffix (TRY → ₺). Same as utils/money.fmtMoney. */
export const fmtMoney = (n, currency = "TRY") => formatMoneyWithCurrency(n, currency);

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
  if (v == null || v === "") return fallback;
  if (typeof v === "string") {
    let s = v.trim().replace(/\s/g, "");
    if (s.includes(",") && s.includes(".")) {
      // TR 1.250,50 → 1250.50 | EN 1,250.50 → 1250.50
      s = s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Stok kartından satış/alış birim fiyatı (ilk anlamlı değer). */
export function productCardPrice(prod, invoiceType = "sales") {
  if (!prod) return 0;
  if (invoiceType === "purchase") {
    for (const k of ["last_purchase_price", "purchase_price", "avg_purchase_price", "card_purchase_price"]) {
      const n = num(prod[k]);
      if (n > 0) return n;
    }
    return num(prod.purchase_price);
  }
  for (const k of ["sale_price", "list_price", "price", "last_sale_price"]) {
    const n = num(prod[k]);
    if (n > 0) return n;
  }
  return num(prod.sale_price);
}

function resolveLineNames(item, editedField) {
  // name / product_name düzenlenirken boş string korunur; aksi halde biri diğerine düşer
  // ve kullanıcı metni silemez ("" || eskiAd → eskiAd).
  if (editedField === "name") {
    const name = item.name == null ? "" : String(item.name);
    return { name, product_name: name };
  }
  if (editedField === "product_name") {
    const product_name = item.product_name == null ? "" : String(item.product_name);
    return { name: product_name, product_name };
  }
  const name = item.name || item.product_name || "";
  const product_name = item.product_name || item.name || "";
  return { name, product_name };
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
  const names = resolveLineNames(item, editedField);
  return {
    ...item,
    unit: item.unit || "Adet",
    discount_rate: disc,
    vat_rate: vat,
    unit_price: Math.round(excl * 10000) / 10000,
    unit_price_incl: Math.round(incl * 10000) / 10000,
    total,
    total_incl: Math.round((total + vatAmount) * 100) / 100,
    vat_amount: vatAmount,
    ...names,
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
  // Pazaryeri / ShopPHP: unit_price müşterinin ödediği KDV dahil tutarsa nete indir.
  if (item.price_includes_vat && !num(next.unit_price_incl) && num(next.unit_price)) {
    return computeLine({ ...next, unit_price_incl: next.unit_price }, "unit_price_incl");
  }
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
  const price = productCardPrice(prod, invoiceType);
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

export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Fatura belgesi: genel iskonto sonrası KDV satır kuruşlarının toplamıdır. */
export function invoiceMoneyTotals(items = [], {
  generalDiscountRate = 0,
  generalDiscountAmount = 0,
  discountMode = "amount",
  withholdingRate = 0,
} = {}) {
  const { subtotal: itemsNet, vat: lineVat, lineDiscount, rows } = documentLineTotals(items);
  const gdRaw = discountMode === "percent"
    ? itemsNet * num(generalDiscountRate) / 100
    : num(generalDiscountAmount);
  const gd = roundMoney(Math.min(Math.max(gdRaw, 0), itemsNet));
  const factor = itemsNet ? (itemsNet - gd) / itemsNet : 1;
  const subtotal = roundMoney(itemsNet - gd);
  const vat = roundMoney(rows.reduce((sum, item) => {
    const base = roundMoney(num(item.total) * factor);
    return sum + roundMoney(base * num(item.vat_rate) / 100);
  }, 0));
  const withholding = roundMoney(vat * num(withholdingRate));
  return {
    itemsSum: roundMoney(itemsNet + lineDiscount),
    lineDiscount,
    gd,
    subtotal,
    vat,
    withholding,
    grandTotal: roundMoney(subtotal + vat - withholding),
    lineVat,
  };
}

export function documentLineTotals(items = []) {
  const rows = items.map((it) => hydrateLine(it));
  const subtotal = Math.round(rows.reduce((s, it) => s + num(it.total), 0) * 100) / 100;
  const vat = Math.round(rows.reduce((s, it) => s + num(it.vat_amount), 0) * 100) / 100;
  const lineDiscount = Math.round(rows.reduce(
    (s, it) => s + num(it.quantity) * num(it.unit_price) * num(it.discount_rate) / 100,
    0
  ) * 100) / 100;
  return { rows, subtotal, vat, lineDiscount, grandTotal: Math.round((subtotal + vat) * 100) / 100 };
}
