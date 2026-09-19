import type { Product } from "../types";

/** Liste küçük resmi: thumbnail → ana görsel → ilk galeri görseli. */
export function productImage(p: Pick<Product, "thumbnail_url" | "image_url" | "images">): string {
  const first = Array.isArray(p.images) ? p.images.find((x) => String(x || "").trim()) : "";
  return String(p.thumbnail_url || p.image_url || first || "").trim();
}

export type StockBadge = { label: string; tone: "danger" | "warning" | "muted" };

export function stockQtyLabel(p: Pick<Product, "stock_quantity" | "unit" | "track_stock" | "type">): string {
  const qty = Number(p.stock_quantity);
  const n = Number.isFinite(qty) ? qty : 0;
  return `${n.toLocaleString("tr-TR")} ${p.unit || "Adet"}`;
}

/** Liste sağ sütunu: takip kapalı olsa da adet yazılır, eksi adet de yazılır. */
export function stockRightLabel(p: Pick<Product, "stock_quantity" | "unit" | "track_stock" | "type">): string {
  return `Stok ${stockQtyLabel(p)}`;
}

export function stockBarcodeLabel(p: Pick<Product, "barcode">): string {
  const code = String(p.barcode || "").trim();
  return code || "Barkod yok";
}

export function stockRowSubtitle(
  p: Pick<Product, "sku" | "barcode" | "type" | "sale_price" | "is_active">,
  typeLabel: string,
  priceLabel: string,
): string {
  const barcode = String(p.barcode || "").trim();
  return [
    p.sku || "SKU yok",
    barcode ? `Barkod ${barcode}` : "Barkod yok",
    typeLabel,
    priceLabel,
    p.is_active === false ? "Pasif" : "",
  ].filter(Boolean).join(" · ");
}

/** Negatif stok hatalı sayım demek; min_stock_alert altı sipariş uyarısı. Takip kapalı olsa da adet yazılır. */
export function stockBadge(p: Pick<Product, "stock_quantity" | "unit" | "min_stock_alert" | "track_stock" | "type">): StockBadge | null {
  const qty = Number(p.stock_quantity);
  const n = Number.isFinite(qty) ? qty : 0;
  const unit = p.unit || "Adet";
  const min = Number(p.min_stock_alert) || 0;
  const label = `${n.toLocaleString("tr-TR")} ${unit}`;
  if (n < 0) return { label, tone: "danger" };
  if (min > 0 && n <= min) return { label, tone: "warning" };
  return { label, tone: "muted" };
}
