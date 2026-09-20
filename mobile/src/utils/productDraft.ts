import type { Product } from "../types";

export type ProductDraft = {
  name: string;
  sku: string;
  barcode: string;
  type: string;
  category: string;
  unit: string;
  vat_rate: string;
  purchase_vat_rate: string;
  purchase_price: string;
  sale_price: string;
  stock_quantity: string;
  min_stock_alert: string;
  vat_exemption_code: string;
  price_includes_vat: boolean;
  show_in_b2b: boolean;
  track_stock: boolean;
  is_active: boolean;
  desi: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  package_count: string;
};

export const PRODUCT_TYPES = [
  { key: "product", label: "Ticari Mal" },
  { key: "raw_material", label: "Hammadde" },
  { key: "finished_good", label: "Mamul" },
  { key: "service", label: "Hizmet" },
];

export const VAT_RATES = [20, 10, 1, 0];

function num(v: string, fallback = 0): number {
  if (v === "" || v == null) return fallback;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function optNum(v: string): number | null {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v);
}

export function emptyProductDraft(): ProductDraft {
  return {
    name: "",
    sku: "",
    barcode: "",
    type: "product",
    category: "Genel",
    unit: "Adet",
    vat_rate: "20",
    purchase_vat_rate: "20",
    purchase_price: "0",
    sale_price: "0",
    stock_quantity: "0",
    min_stock_alert: "5",
    vat_exemption_code: "",
    price_includes_vat: false,
    show_in_b2b: true,
    track_stock: true,
    is_active: true,
    desi: "",
    weight: "",
    length: "",
    width: "",
    height: "",
    package_count: "1",
  };
}

export function draftFromProduct(p: Product | null | undefined): ProductDraft {
  const base = emptyProductDraft();
  if (!p) return base;
  return {
    ...base,
    name: str(p.name),
    sku: str(p.sku),
    barcode: str(p.barcode),
    type: p.type || "product",
    category: str(p.category) || "Genel",
    unit: str(p.unit) || "Adet",
    vat_rate: str(p.vat_rate ?? 20),
    purchase_vat_rate: str(p.purchase_vat_rate ?? p.vat_rate ?? 20),
    purchase_price: str(p.purchase_price ?? 0),
    sale_price: str(p.sale_price ?? 0),
    stock_quantity: str(p.stock_quantity ?? 0),
    min_stock_alert: str(p.min_stock_alert ?? 5),
    vat_exemption_code: str(p.vat_exemption_code),
    price_includes_vat: p.price_includes_vat === true,
    show_in_b2b: p.show_in_b2b !== false,
    track_stock: p.track_stock !== false,
    is_active: p.is_active !== false,
    desi: str(p.desi),
    weight: str(p.weight),
    length: str(p.length),
    width: str(p.width),
    height: str(p.height),
    package_count: str(p.package_count ?? 1),
  };
}

export function generateBarcode(): string {
  let n = "";
  for (let i = 0; i < 10; i += 1) n += String(Math.floor(Math.random() * 10));
  return `868${n}`;
}

/** Yanlışlıkla basmayı önlemek için onay metni. */
export function generateBarcodeConfirm(existing?: string | null): string {
  const current = String(existing || "").trim();
  if (current) return `Mevcut barkod (${current}) yeni bir barkodla değişecek. Üretmek istiyor musunuz?`;
  return "Yeni bir barkod üretilsin mi?";
}

export function validateProductDraft(draft: ProductDraft): string | null {
  if (!draft.name.trim()) return "Ürün adı gerekli.";
  if (!draft.sku.trim()) return "SKU kodu gerekli.";
  return null;
}

export function productPayload(draft: ProductDraft, companyId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    sku: draft.sku.trim(),
    barcode: draft.barcode.trim(),
    type: draft.type || "product",
    category: draft.category.trim() || "Genel",
    unit: draft.unit.trim() || "Adet",
    vat_rate: num(draft.vat_rate, 20),
    purchase_vat_rate: num(draft.purchase_vat_rate, 20),
    purchase_price: num(draft.purchase_price),
    sale_price: num(draft.sale_price),
    stock_quantity: num(draft.stock_quantity),
    min_stock_alert: num(draft.min_stock_alert, 5),
    price_includes_vat: !!draft.price_includes_vat,
    vat_exemption_code: draft.vat_exemption_code.trim() || null,
    show_in_b2b: !!draft.show_in_b2b,
    track_stock: !!draft.track_stock,
    is_active: !!draft.is_active,
    desi: optNum(draft.desi),
    weight: optNum(draft.weight),
    length: optNum(draft.length),
    width: optNum(draft.width),
    height: optNum(draft.height),
    package_count: Math.max(1, Math.min(50, Math.round(num(draft.package_count, 1)) || 1)),
  };
  if (companyId) body.company_id = companyId;
  return body;
}
