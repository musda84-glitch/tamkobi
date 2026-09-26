import { formatTrAmount, moneySuffix } from "./money";

/** Stok kartı Etiketler listesinden ilk 3 değer → etiket şablonu alanları. */
export function productTagSlots(product) {
  const tags = Array.isArray(product?.tags) ? product.tags : [];
  return [0, 1, 2].map((i) => String(tags[i] ?? "").trim());
}

/** Öğe Ekle paletinden tek tıkla eklenecek stok kartı etiket alanları. */
export const LABEL_TAG_PALETTE = [
  ["label_1", "Etiket 1"],
  ["label_2", "Etiket 2"],
  ["label_3", "Etiket 3"],
];

/** Etiket şablonunda seçilebilir ürün veri alanları. */
export const LABEL_DESIGN_FIELDS = [
  ["name", "Ürün Adı"],
  ["price", "Fiyat"],
  ["sku", "SKU / Stok Kodu"],
  ["barcode_text", "Barkod No"],
  ["variant", "Varyant"],
  ["category", "Kategori"],
  ["company", "Firma Adı"],
  ...LABEL_TAG_PALETTE,
  ["text", "Serbest Metin"],
];

export function labelFieldValue(el, product, company) {
  if (!product) return el?.field === "text" ? el.text || "Metin" : `{${el?.field}}`;
  const vat = Number(product.vat_rate ?? 20);
  const base = Number(product.sale_price || 0);
  const price = el?.vat === "excl"
    ? (product.price_includes_vat ? base / (1 + vat / 100) : base)
    : (product.price_includes_vat ? base : base * (1 + vat / 100));
  const [tag1, tag2, tag3] = productTagSlots(product);
  const map = {
    name: product.name,
    price: `${el?.prefix || ""}${formatTrAmount(price)} ${el?.currency || moneySuffix(product.currency)}${el?.vat === "excl" ? " +KDV" : ""}`,
    sku: product.sku,
    barcode_text: product.barcode,
    variant: product.variant_name || (product.variants?.length ? `${product.variants.length} varyant` : ""),
    category: product.category,
    company: company?.name,
    label_1: tag1,
    label_2: tag2,
    label_3: tag3,
    text: el?.text || "",
  };
  return map[el?.field] ?? "";
}
