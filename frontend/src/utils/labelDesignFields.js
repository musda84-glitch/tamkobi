import { formatTrAmount, moneySuffix } from "./money";

/** Etiket şablonunda seçilebilir ürün veri alanları (sıra: ek alanlar 1–3). */
export const LABEL_DESIGN_FIELDS = [
  ["name", "Ürün Adı"],
  ["price", "Fiyat"],
  ["sku", "SKU / Stok Kodu"],
  ["barcode_text", "Barkod No"],
  ["variant", "Varyant"],
  ["category", "Kategori"],
  ["company", "Firma Adı"],
  ["label_1", "Etiket Alanı 1"],
  ["label_2", "Etiket Alanı 2"],
  ["label_3", "Etiket Alanı 3"],
  ["text", "Serbest Metin"],
];

export function labelFieldValue(el, product, company) {
  if (!product) return el?.field === "text" ? el.text || "Metin" : `{${el?.field}}`;
  const vat = Number(product.vat_rate ?? 20);
  const base = Number(product.sale_price || 0);
  const price = el?.vat === "excl"
    ? (product.price_includes_vat ? base / (1 + vat / 100) : base)
    : (product.price_includes_vat ? base : base * (1 + vat / 100));
  const map = {
    name: product.name,
    price: `${el?.prefix || ""}${formatTrAmount(price)} ${el?.currency || moneySuffix(product.currency)}${el?.vat === "excl" ? " +KDV" : ""}`,
    sku: product.sku,
    barcode_text: product.barcode,
    variant: product.variant_name || (product.variants?.length ? `${product.variants.length} varyant` : ""),
    category: product.category,
    company: company?.name,
    label_1: product.label_text_1 || "",
    label_2: product.label_text_2 || "",
    label_3: product.label_text_3 || "",
    text: el?.text || "",
  };
  return map[el?.field] ?? "";
}

/** Stok kartı kaydı için etiket alanlarını temizle. */
export function normalizeLabelTexts(raw = {}) {
  const out = {};
  for (const key of ["label_text_1", "label_text_2", "label_text_3"]) {
    const t = String(raw[key] ?? "").trim().slice(0, 120);
    out[key] = t || null;
  }
  return out;
}
