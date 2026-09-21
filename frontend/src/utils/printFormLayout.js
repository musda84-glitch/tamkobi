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

export const balanceSentence = (amount) => {
  if (amount == null || amount === "" || Number.isNaN(Number(amount))) return "";
  const formatted = Number(amount).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Güncel bakiyeniz: ${formatted} TL`;
};
