import type { B2BInstallment, B2BInvoice, Order } from "../types";

export function isPendingOrder(status?: string | null): boolean {
  return ["pending", "new"].includes(String(status || ""));
}

export function isApprovedOrder(status?: string | null): boolean {
  return ["approved", "preparing"].includes(String(status || ""));
}

export function canEditOrder(o: Pick<Order, "order_status"> | null | undefined): boolean {
  return isPendingOrder(o?.order_status);
}

export function canCancelOrder(o: Pick<Order, "order_status" | "cancel_request"> | null | undefined): boolean {
  return isApprovedOrder(o?.order_status) && o?.cancel_request?.status !== "pending";
}

export function cancelBadge(o: Pick<Order, "cancel_request"> | null | undefined): string | null {
  const s = o?.cancel_request?.status;
  if (s === "pending") return "İptal talebi iletildi";
  if (s === "rejected") return "İptal talebi reddedildi";
  return null;
}

export const TRACK_STEP_TR: Record<string, string> = {
  created: "Hazırlanıyor",
  picked_up: "Kargoya Verildi",
  in_transit: "Yolda",
  out_for_delivery: "Dağıtımda",
  delivered: "Teslim Edildi",
  returned: "İade",
};

export function trackingLabel(status?: string | null): string {
  const s = String(status || "");
  return TRACK_STEP_TR[s] || s || "Kargo bekleniyor";
}

export function invoiceRemaining(i: Pick<B2BInvoice, "grand_total" | "paid_amount">): number {
  return Math.max(0, Number(i.grand_total || 0) - Number(i.paid_amount || 0));
}

export function installmentRemaining(i: Pick<B2BInstallment, "amount" | "paid_amount">): number {
  return Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0));
}

export function installmentTitle(i: Pick<B2BInstallment, "invoice_number" | "label">): string {
  return [i.invoice_number, i.label].filter(Boolean).join(" • ") || "Taksit";
}

export function payStatus(v?: string | null): string {
  return ["paid", "partially_paid", "unpaid", "overdue"].includes(String(v || "")) ? String(v) : "unpaid";
}

export function installmentDueText(row: { due_date?: string; is_overdue?: boolean; days_left?: number | null }): string {
  const due = String(row.due_date || "").slice(0, 10);
  if (!due) return "Vade belirsiz";
  if (row.is_overdue) return `Vade ${due} — ${Math.abs(Number(row.days_left) || 0)} gün gecikti`;
  if (row.days_left != null) return `Vade ${due} — ${row.days_left} gün kaldı`;
  return `Vade ${due}`;
}

export type EditLine = { product_id: string; product_name: string; sku?: string; quantity: number; unit_price?: number };

export function editLinesFromOrder(items?: Array<Record<string, unknown>> | null): EditLine[] {
  return (items || []).map((i) => ({
    product_id: String(i.product_id || i.id || ""),
    product_name: String(i.product_name || i.name || ""),
    sku: i.sku ? String(i.sku) : undefined,
    quantity: Number(i.quantity) || 0,
    unit_price: Number(i.unit_price) || 0,
  })).filter((l) => l.product_id && l.quantity > 0);
}

export function setEditQty(lines: EditLine[], productId: string, qty: number): EditLine[] {
  const q = Number(qty) || 0;
  return lines.map((l) => (l.product_id === productId ? { ...l, quantity: q } : l)).filter((l) => l.quantity > 0);
}

export function addEditProduct(
  lines: EditLine[],
  p: { id: string; name: string; sku?: string; price?: number | null }
): EditLine[] {
  const hit = lines.find((l) => l.product_id === p.id);
  if (hit) return lines.map((l) => (l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
  return [...lines, { product_id: p.id, product_name: p.name, sku: p.sku, quantity: 1, unit_price: Number(p.price) || 0 }];
}

export function previewLineCode(
  it: { barcode?: string; sku?: string; product_id?: string },
  products: Array<{ id: string; barcode?: string; sku?: string }>
): string {
  const p = products.find((x) => x.id === it.product_id);
  return String(it.barcode || p?.barcode || it.sku || p?.sku || "").trim();
}

export function previewLineImage(
  it: { image_url?: string | null; product_id?: string },
  products: Array<{ id: string; image_url?: string | null }>
): string {
  const p = products.find((x) => x.id === it.product_id);
  return String(it.image_url || p?.image_url || "");
}
