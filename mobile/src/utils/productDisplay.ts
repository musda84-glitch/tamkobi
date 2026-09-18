import type { Product } from "../types";

/** Liste küçük resmi: thumbnail → ana görsel → ilk galeri görseli. */
export function productImage(p: Pick<Product, "thumbnail_url" | "image_url" | "images">): string {
  const first = Array.isArray(p.images) ? p.images.find((x) => String(x || "").trim()) : "";
  return String(p.thumbnail_url || p.image_url || first || "").trim();
}

export type StockBadge = { label: string; tone: "danger" | "warning" | "muted" };

/** Negatif stok hatalı sayım demek; min_stock_alert altı sipariş uyarısı. */
export function stockBadge(p: Pick<Product, "stock_quantity" | "unit" | "min_stock_alert" | "track_stock" | "type">): StockBadge | null {
  if (p.track_stock === false || p.type === "service") return null;
  if (p.stock_quantity == null) return null;
  const qty = Number(p.stock_quantity);
  if (!Number.isFinite(qty)) return null;
  const unit = p.unit || "Adet";
  const min = Number(p.min_stock_alert) || 0;
  const label = `${qty.toLocaleString("tr-TR")} ${unit}`;
  if (qty < 0) return { label, tone: "danger" };
  if (min > 0 && qty <= min) return { label, tone: "warning" };
  return { label, tone: "muted" };
}
