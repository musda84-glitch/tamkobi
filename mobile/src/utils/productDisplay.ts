import type { Product } from "../types";

/** Liste küçük resmi: thumbnail → ana görsel → ilk galeri görseli. */
export function productImage(p: Pick<Product, "thumbnail_url" | "image_url" | "images">): string {
  const first = Array.isArray(p.images) ? p.images.find((x) => String(x || "").trim()) : "";
  return String(p.thumbnail_url || p.image_url || first || "").trim();
}

export type StockBadge = { label: string; tone: "danger" | "warning" | "muted" };

/** Takip kapalı / hizmet olsa da kayıtlı adet okunur. */
export function stockQuantity(p: Pick<Product, "stock_quantity">): number {
  const qty = Number(p.stock_quantity);
  return Number.isFinite(qty) ? qty : 0;
}

export function stockQtyLabel(p: Pick<Product, "stock_quantity" | "unit" | "track_stock" | "type">): string {
  return `${stockQuantity(p).toLocaleString("tr-TR")} ${p.unit || "Adet"}`;
}

/** Liste sağı: SKU/barkod yok, "Takip yok" yok — yalnız stok adedi. */
export function stockRightLabel(p: Pick<Product, "stock_quantity" | "unit" | "track_stock" | "type">): string {
  return `Stok ${stockQtyLabel(p)}`;
}

export function stockBarcodeLabel(p: Pick<Product, "barcode">): string {
  const code = String(p.barcode || "").trim();
  return code || "Barkod yok";
}

export function stockRowSubtitle(
  p: Pick<Product, "sku" | "barcode" | "type" | "sale_price" | "is_active" | "category">,
  typeLabel: string,
  priceLabel: string,
): string {
  return [p.category, typeLabel, priceLabel, p.is_active === false ? "Pasif" : ""].filter(Boolean).join(" · ");
}

export type ProductCategory = { name?: string; count?: number };

/** API kategorileri varsa onları, yoksa listedeki benzersiz kategorileri kullan. */
export function productCategoryGroups(
  saved?: ProductCategory[] | null,
  products?: Array<{ category?: string }> | null,
): { label: string; options: { value: string; label: string }[] }[] {
  const names = new Map<string, number>();
  for (const c of saved || []) {
    const name = String(c.name || "").trim();
    if (name) names.set(name, Number(c.count) || 0);
  }
  if (!names.size) {
    for (const p of products || []) {
      const name = String(p.category || "").trim();
      if (name) names.set(name, (names.get(name) || 0) + 1);
    }
  }
  const options = [...names.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"))
    .map(([name, count]) => ({ value: name, label: count ? `${name} (${count})` : name }));
  return [
    { label: "Filtre", options: [{ value: "all", label: "Tüm Kategoriler" }] },
    ...(options.length ? [{ label: "Kategoriler", options }] : []),
  ];
}

export function matchesProductCategory(category: string | undefined, filter: string): boolean {
  if (!filter || filter === "all") return true;
  return String(category || "") === filter;
}

export function matchesProductSearch(
  p: Pick<Product, "name" | "sku" | "barcode" | "category">,
  query: string,
): boolean {
  const s = query.trim().toLowerCase();
  if (!s) return true;
  return [p.name, p.sku, p.barcode, p.category].some((v) => String(v || "").toLowerCase().includes(s));
}

export function filterProducts<T extends Pick<Product, "name" | "sku" | "barcode" | "category">>(
  rows: T[] | null | undefined,
  query: string,
  category = "all",
  limit = 100,
): T[] {
  return (rows || [])
    .filter((p) => matchesProductCategory(p.category, category) && matchesProductSearch(p, query))
    .slice(0, limit);
}

/** Negatif stok hatalı sayım demek; min_stock_alert altı sipariş uyarısı. Takip kapalı olsa da adet yazılır. */
export function stockBadge(p: Pick<Product, "stock_quantity" | "unit" | "min_stock_alert" | "track_stock" | "type">): StockBadge | null {
  const n = stockQuantity(p);
  const unit = p.unit || "Adet";
  const min = Number(p.min_stock_alert) || 0;
  const label = `${n.toLocaleString("tr-TR")} ${unit}`;
  if (n < 0) return { label, tone: "danger" };
  if (min > 0 && n <= min) return { label, tone: "warning" };
  return { label, tone: "muted" };
}
