import type { Product } from "../types";

/** String, {url} / {image_url} galeri öğesi veya boş. */
export function mediaRef(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return mediaRef(o.url ?? o.image_url ?? o.thumbnail_url ?? o.src ?? o.path ?? o.file);
  }
  return "";
}

/** Liste küçük resmi: thumbnail → ana görsel → ilk galeri görseli. */
export function productImage(p: Pick<Product, "thumbnail_url" | "image_url" | "images"> & {
  image?: unknown;
  photo?: unknown;
}): string {
  const gallery = Array.isArray(p.images)
    ? p.images.map(mediaRef).find(Boolean) || ""
    : mediaRef(p.images);
  return mediaRef(p.thumbnail_url) || mediaRef(p.image_url) || mediaRef(p.image) || mediaRef(p.photo) || gallery;
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

export function productSkuLabel(p: Pick<Product, "sku">): string {
  const sku = String(p.sku || "").trim();
  return sku ? `SKU ${sku}` : "SKU —";
}

/** Teklif / keşif ürün seçici: SKU + barkod her zaman yazılır. */
export function productPickSubtitle(p: Pick<Product, "sku" | "barcode">): string {
  const barcode = String(p.barcode || "").trim();
  return `${productSkuLabel(p)} · Barkod ${barcode || "—"}`;
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
