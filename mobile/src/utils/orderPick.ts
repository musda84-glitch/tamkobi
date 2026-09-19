export type PickLine = {
  line_index?: number;
  product_id?: string;
  product_name?: string;
  sku?: string;
  barcode?: string;
  ordered_qty?: number;
  picked_qty?: number;
  image_url?: string;
};

export type PickProgress = { ordered?: number; picked?: number; missing_lines?: number; complete?: boolean };

export type PickRow = {
  id?: string;
  _id?: string;
  order_number?: string;
  customer_name?: string;
  city?: string;
  order_status?: string;
  pick_status?: string;
  item_count?: number;
  progress?: PickProgress;
  order_date?: string;
};

export type PickSession = {
  id?: string;
  _id?: string;
  order_id?: string;
  order_number?: string;
  customer_name?: string;
  city?: string;
  status?: string;
  items?: PickLine[];
  progress?: PickProgress;
  order_status?: string;
  shipping_address?: string;
  customer_phone?: string;
  message?: string;
  matched?: string;
  draft_invoice_number?: string;
  draft_invoice_error?: string;
};

/** Web OrderPickKioskPage'deki durum etiketleri. */
export const PICK_STATUS_TR: Record<string, string> = {
  idle: "Bekliyor",
  open: "Açık",
  picking: "Toplanıyor",
  ready: "Hazır",
  partial: "Kısmi",
  shipped: "Sevk edildi",
};

export function pickStatusTr(v?: string | null): string {
  if (!v) return "Bekliyor";
  return PICK_STATUS_TR[v] || v;
}

export function pickStatusTone(v?: string | null): "slate" | "amber" | "green" | "indigo" {
  if (v === "shipped") return "green";
  if (v === "ready") return "indigo";
  if (v === "picking" || v === "partial") return "amber";
  return "slate";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function lineRemaining(line: PickLine): number {
  return Math.max(0, Math.round((num(line.ordered_qty) - num(line.picked_qty)) * 1000) / 1000);
}

/** 0–100 arası tam sayı; sipariş miktarı yoksa 0. */
export function pickPercent(progress?: PickProgress | null): number {
  const ordered = num(progress?.ordered);
  if (ordered <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((num(progress?.picked) / ordered) * 100)));
}

export function pickSummaryText(progress?: PickProgress | null, itemCount?: number): string {
  const ordered = num(progress?.ordered);
  const picked = num(progress?.picked);
  const parts = [`${picked.toLocaleString("tr-TR")}/${ordered.toLocaleString("tr-TR")} adet`];
  if (itemCount) parts.push(`${itemCount} kalem`);
  const missing = num(progress?.missing_lines);
  if (missing) parts.push(`${missing} eksik satır`);
  return parts.join(" · ");
}

export function canShip(progress?: PickProgress | null): boolean {
  return !!progress?.complete;
}

const DONE_SEVK = new Set(["shipped", "completed", "cancelled", "returned", "partially_returned", "delivered"]);

/** Toplanmamış / sevk edilmemiş sipariş. */
export function isPendingSevk(row?: { pick_status?: string; order_status?: string } | null): boolean {
  if (!row) return false;
  const pick = String(row.pick_status || "").toLowerCase();
  const order = String(row.order_status || "").toLowerCase();
  if (DONE_SEVK.has(pick) || DONE_SEVK.has(order)) return false;
  return true;
}

export function pendingPickCount(rows?: Array<{ pick_status?: string; order_status?: string }> | null): number {
  return (rows || []).filter(isPendingSevk).length;
}

/** Ana ekran Depo Sevkiyat rozeti: bekleyen toplama + depo bildirimleri. */
export function pendingSevkCount(input: {
  picks?: Array<{ pick_status?: string; order_status?: string }> | null;
  tasks?: Array<{ key?: string; path?: string; count?: number }> | null;
  ops?: Array<{ key?: string; path?: string; count?: number }> | null;
}): number {
  const picks = pendingPickCount(input.picks);
  const fromPath = (rows?: Array<{ key?: string; path?: string; count?: number }> | null) =>
    (rows || [])
      .filter((t) => t.key === "pick_missing" || String(t.path || "").includes("/sevk"))
      .reduce((sum, t) => sum + (Number(t.count) || 0), 0);
  return Math.max(picks, fromPath(input.tasks), fromPath(input.ops));
}

export function adjustPayload(line: PickLine, nextQty: number) {
  const ordered = num(line.ordered_qty);
  return {
    line_index: line.line_index,
    product_id: line.product_id,
    product_name: line.product_name,
    picked_qty: Math.max(0, Math.min(nextQty, ordered)),
  };
}

type OverscanDetail = { code?: string; message?: string; product_name?: string; ordered_qty?: number; picked_qty?: number };

/** Sunucu fazla okutmayı 409 + detay nesnesiyle bildirir; kullanıcıya tek satır mesaj gösterilir. */
export function scanErrorMessage(err: unknown, fallback = "Barkod okunamadı."): string {
  const detail = (err as { detail?: unknown })?.detail;
  if (detail && typeof detail === "object") {
    const d = detail as OverscanDetail;
    if (d.message) return d.message;
    if (d.code === "overscan" && d.product_name) {
      return `${d.product_name}: siparişte ${num(d.ordered_qty)} adet var, ${num(d.picked_qty)} okutuldu.`;
    }
  }
  if (typeof detail === "string" && detail.trim()) return detail;
  const message = (err as { message?: string })?.message;
  return message || fallback;
}
