import type { B2BProduct } from "../types";
import { matchesB2BQuery } from "./b2bSearch";
import { b2bGross } from "./b2bPricing";

export function catalogCategories(products: B2BProduct[] | null | undefined): string[] {
  const seen = new Set<string>();
  for (const p of products || []) {
    const c = String(p.category || "").trim();
    if (c) seen.add(c);
  }
  return ["all", ...Array.from(seen)];
}

/** Tümü + kategori grupları; chip yerine GroupedSelect için. */
export function categorySelectGroups(products: B2BProduct[] | null | undefined): { label: string; options: { value: string; label: string }[] }[] {
  const names = catalogCategories(products).filter((c) => c !== "all");
  return [
    { label: "Filtre", options: [{ value: "all", label: "Tümü" }] },
    ...(names.length ? [{ label: "Kategoriler", options: names.map((c) => ({ value: c, label: c })) }] : []),
  ];
}

/** GS1 / kamera öneklerini temizler; arama kutusuna ham kod düşmesin. */
export function normalizeScanText(raw?: string | null): string {
  return String(raw || "")
    .trim()
    .replace(/^\]C1/i, "")
    .replace(/\u001d/g, "")
    .trim();
}

export function filterCatalog(
  products: B2BProduct[] | null | undefined,
  query?: string | null,
  category = "all"
): B2BProduct[] {
  return (products || []).filter((p) => (category === "all" || p.category === category) && matchesB2BQuery(p, query));
}

export function parseDraftQty(raw?: string | null): number {
  return Math.max(1, parseInt(String(raw ?? "1").replace(/\D/g, ""), 10) || 1);
}

/** Unset keys show 1; "" stays empty so focus-to-type can clear the field. */
export function qtyDraftShown(map: Record<string, string> | null | undefined, id: string): string {
  if (!map || !Object.prototype.hasOwnProperty.call(map, id)) return "1";
  return String(map[id] ?? "");
}

export function qtyDraftOnFocus(): string {
  return "";
}

export function qtyDraftOnBlur(raw?: string | null): string {
  return String(parseDraftQty(raw));
}

function scanCodeOf(value?: string | null): string {
  return normalizeScanText(value).toLowerCase();
}

/** Exact barcode or SKU match (variants included). */
export function findCatalogByScan<T extends { barcode?: string | null; sku?: string | null; variants?: Array<{ barcode?: string | null; sku?: string | null }> }>(
  products: T[] | null | undefined,
  code?: string | null,
): T | null {
  const c = scanCodeOf(code);
  if (!c) return null;
  return (products || []).find((p) => {
    if (scanCodeOf(p.barcode) === c || scanCodeOf(p.sku) === c) return true;
    return (p.variants || []).some((v) => scanCodeOf(v.barcode) === c || scanCodeOf(v.sku) === c);
  }) || null;
}

export type B2BScanResult<T> = {
  product: T | null;
  qty: number;
  action: "add" | "filter" | "miss";
  message: string;
};

/** Seri okutma: çarpan kadar sepete ekle; bulunamazsa arama, sipariş kapalıysa filtre. */
export function applyB2BScan<T extends { name?: string | null; barcode?: string | null; sku?: string | null; in_stock?: boolean; variants?: Array<{ barcode?: string | null; sku?: string | null }> }>(opts: {
  products: T[] | null | undefined;
  code?: string | null;
  qty?: string | number | null;
  allowOrders?: boolean;
  showStock?: boolean;
}): B2BScanResult<T> {
  const code = normalizeScanText(opts.code);
  const qty = parseDraftQty(opts.qty == null ? "1" : String(opts.qty));
  const product = findCatalogByScan(opts.products, code);
  if (!product) {
    return { product: null, qty, action: "miss", message: code ? `Barkod bulunamadı: ${code}` : "Barkod okutun." };
  }
  const ordersOn = opts.allowOrders !== false;
  const blocked = !ordersOn || (Boolean(opts.showStock) && product.in_stock === false);
  if (blocked) {
    return { product, qty, action: "filter", message: `${product.name || "Ürün"} bulundu` };
  }
  return { product, qty, action: "add", message: `${product.name || "Ürün"} sepete eklendi (${qty})` };
}

export function canAddProduct(p: B2BProduct, showStock: boolean, allowOrders: boolean): boolean {
  if (!allowOrders) return false;
  if (showStock && p.in_stock === false) return false;
  return true;
}

export function hasListDiscount(p: B2BProduct): boolean {
  const sale = b2bGross(p);
  const list = b2bGross(p, "list_price");
  return list > 0 && sale > 0 && sale + 1e-9 < list;
}
