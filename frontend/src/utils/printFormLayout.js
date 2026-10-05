import { formatTrAmount, moneySuffix } from "./money";
/** Order and quote print forms share one line table (shelf, barcode, discount, VAT-incl.). */

export const isOrderQuotePrint = (docType) => docType === "order" || docType === "quote";

const SHELF_KEYS = ["shelf", "shelf_location", "raf_yeri", "raf", "bin", "bin_location", "location_code", "slot"];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const printQtyLabel = (quantity, unit) => {
  const q = quantity == null || quantity === "" ? "" : String(quantity);
  const raw = String(unit || "").trim();
  const u = !raw || /^adet$/i.test(raw) ? "ad" : raw;
  return `${q} ${u}`.trim();
};

/** Sum of line quantities; if all lines share one unit, include it in the label. */
export const printQtyTotal = (items = []) => {
  const list = Array.isArray(items) ? items : [];
  const total = round2(list.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0));
  const units = [
    ...new Set(
      list.map((it) => {
        const raw = String(it?.unit || "").trim();
        return !raw || /^adet$/i.test(raw) ? "ad" : raw;
      }),
    ),
  ];
  return { total, unit: units.length === 1 ? units[0] : "" };
};

export const printQtyTotalLabel = (items = []) => {
  const { total, unit } = printQtyTotal(items);
  const qty = Number.isInteger(total) ? String(total) : formatTrAmount(total);
  return unit ? `Toplam Miktar: ${qty} ${unit}` : `Toplam Miktar: ${qty}`;
};

export const printShelfLabel = (it = {}, prod = {}) => {
  for (const src of [it, prod]) {
    if (!src || typeof src !== "object") continue;
    for (const key of SHELF_KEYS) {
      const value = src[key];
      if (value != null && String(value).trim()) return String(value).trim();
    }
  }
  return "";
};

export const printDiscountLabel = (rate) => {
  const n = Number(rate || 0);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
};

export const lineTotalIncl = (it = {}) => {
  if (it.total_incl != null && it.total_incl !== "") return round2(it.total_incl);
  const net = Number(it.total || 0);
  return round2(net * (1 + Number(it.vat_rate || 0) / 100));
};

/** Birim fiyat KDV dahil. */
export const lineUnitIncl = (it = {}) => {
  if (it.unit_price_incl != null && it.unit_price_incl !== "") return round2(it.unit_price_incl);
  const qty = Number(it.quantity) || 0;
  if (qty > 0 && it.total_incl != null && it.total_incl !== "") return round2(Number(it.total_incl) / qty);
  const net = Number(it.unit_price || 0);
  return round2(net * (1 + Number(it.vat_rate || 0) / 100));
};

export const lineVatAmount = (it = {}) => {
  if (it.vat_amount != null && it.vat_amount !== "") return round2(it.vat_amount);
  const net = Number(it.total || 0);
  if (it.total_incl != null && it.total_incl !== "") return round2(Number(it.total_incl) - net);
  return round2(net * Number(it.vat_rate || 0) / 100);
};

export const printVatLines = (doc = {}, items = []) => {
  const buckets = new Map();
  items.forEach((it) => {
    const rate = Number(it.vat_rate ?? 0);
    buckets.set(rate, (buckets.get(rate) || 0) + lineVatAmount(it));
  });
  const groups = [...buckets.entries()]
    .map(([rate, amount]) => ({ rate, amount: round2(amount) }))
    .sort((a, b) => a.rate - b.rate);
  if (groups.length === 1 && doc.vat_total != null && doc.vat_total !== "") {
    return [{ rate: groups[0].rate, amount: round2(doc.vat_total) }];
  }
  if (!groups.length && doc.vat_total != null && doc.vat_total !== "") {
    return [{ rate: null, amount: round2(doc.vat_total) }];
  }
  return groups;
};

export const vatRateLabel = (rate) => {
  if (rate == null || Number.isNaN(Number(rate))) return "KDV";
  const n = Number(rate);
  const text = Number.isInteger(n) ? String(n) : n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  return `KDV (%${text})`;
};

export const printNetAmount = (doc = {}, items = []) => {
  if (doc.subtotal != null && doc.subtotal !== "") return round2(doc.subtotal);
  return round2(items.reduce((sum, it) => sum + Number(it.total || 0), 0));
};

export const balanceSentence = (amount, currency = "TRY") => {
  if (amount == null || amount === "" || Number.isNaN(Number(amount))) return "";
  const formatted = formatTrAmount(Number(amount));
  return `Güncel bakiyeniz: ${formatted} ${moneySuffix(currency)}`;
};

/** B2B sipariş önizleme: fiyatsız yazdırma. */
export const b2bPreviewHidePrices = (mode) => mode === "plain" || mode === true || mode === "no-price";

export const b2bPreviewLineQtyText = (it = {}) => {
  const qty = it.quantity == null || it.quantity === "" ? "" : String(it.quantity);
  const unit = String(it.unit || "Adet").trim() || "Adet";
  return `${qty} ${unit}`.trim();
};

export const b2bPreviewLineMeta = (it = {}, hidePrices = false, formatAmount = formatTrAmount) => {
  const qty = b2bPreviewLineQtyText(it);
  if (b2bPreviewHidePrices(hidePrices) || it.unit_price == null) return qty;
  return `${qty} · ${formatAmount(lineUnitIncl(it))} ₺`;
};

/** Stok etiketi alanları: etiket 1–3, kategori, GTIP, menşe, raf. */
export const b2bPreviewStockBits = (it = {}, product = {}) => {
  const tags = (Array.isArray(product?.tags) ? product.tags : Array.isArray(it?.tags) ? it.tags : [])
    .map((t) => String(t || "").trim())
    .filter(Boolean);
  const bits = [];
  const variant = String(it.variant_name || product.variant_name || "").trim();
  const category = String(it.category || product.category || "").trim();
  const gtip = String(it.gtip || product.gtip || "").trim();
  const origin = String(it.origin_country || product.origin_country || "").trim();
  const shelf = printShelfLabel(it, product);
  if (variant) bits.push(variant);
  if (category) bits.push(category);
  if (gtip) bits.push(`GTIP ${gtip}`);
  if (origin) bits.push(origin);
  if (shelf) bits.push(`Raf ${shelf}`);
  return { tags, bits };
};

export const b2bPreviewPrintLabel = (hidePrices = false) => (
  b2bPreviewHidePrices(hidePrices) ? "Fiyatsız yazdır" : "Yazdır"
);
