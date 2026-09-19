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
