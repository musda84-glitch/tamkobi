import type { Order } from "../types";
import { computeLine, type CartLine } from "./cart";
import { isMarketplaceChannel } from "./orderApprove";

const LOCKED_STATUSES = new Set(["cancelled", "returned", "delivered", "completed"]);

export function orderStatusOf(o: { order_status?: string; status?: string } | null | undefined): string {
  return String(o?.order_status || o?.status || "");
}

export function isOrderInvoiced(o: { is_invoiced?: boolean; invoice_id?: string } | null | undefined): boolean {
  // Yalnızca cariye işlenmiş / e-belge kesilmiş fatura; taslak (invoice_id) kilit değildir.
  return !!o?.is_invoiced;
}

export function canStaffEditOrder(o: Pick<Order, "channel" | "order_status" | "is_invoiced" | "invoice_id"> & { status?: string } | null | undefined): boolean {
  if (!o || isOrderInvoiced(o)) return false;
  if (isMarketplaceChannel(o.channel)) return false;
  return !LOCKED_STATUSES.has(orderStatusOf(o));
}

export function canStaffDeleteOrder(o: { is_invoiced?: boolean; invoice_id?: string; [key: string]: unknown } | null | undefined): boolean {
  // Taslak faturalı sipariş de silinmez (web ile aynı).
  return !!o && !o.is_invoiced && !o.invoice_id;
}

export function cartFromOrderItems(items?: Array<Record<string, unknown>> | null): CartLine[] {
  return (items || []).map((it) => computeLine({
    product_id: String(it.product_id || it.id || ""),
    product_name: String(it.product_name || it.name || "Kalem"),
    sku: String(it.sku || ""),
    barcode: it.barcode ? String(it.barcode) : undefined,
    quantity: Number(it.quantity) || 1,
    unit_price: Number(it.unit_price) || 0,
    unit_price_incl: Number(it.unit_price_incl) || 0,
    vat_rate: it.vat_rate == null ? 0 : Number(it.vat_rate),
    total: 0,
    vat_amount: 0,
    total_incl: 0,
  })).filter((l) => l.quantity > 0);
}

export function orderUpdatePayload(cart: CartLine[], notes: string, customerOrderNumber?: string) {
  return {
    items: cart.map((it) => ({
      product_id: it.product_id,
      product_name: it.product_name,
      sku: it.sku,
      barcode: it.barcode || "",
      quantity: it.quantity,
      unit_price: it.unit_price,
      unit_price_incl: it.unit_price_incl,
      vat_rate: it.vat_rate,
      total: it.total,
      vat_amount: it.vat_amount,
      total_incl: it.total_incl,
    })),
    notes,
    customer_order_number: customerOrderNumber || "",
  };
}

export function setCartLineQty(cart: CartLine[], index: number, qty: number): CartLine[] {
  if (qty <= 0) return cart.filter((_, i) => i !== index);
  const next = [...cart];
  next[index] = computeLine({ ...next[index], quantity: qty });
  return next;
}
