import type { Order } from "../types";
import { computeLine, type CartLine } from "./cart";
import { isMarketplaceChannel } from "./orderApprove";
import { orderHasEInvoiceIssued } from "./orderMoreMenu";

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
  if (!o) return false;
  if (orderHasEInvoiceIssued(o as Parameters<typeof orderHasEInvoiceIssued>[0])) return false;
  return true;
}

export function orderDraftInvoiceNumber(order: { invoice_number?: string; local_invoice_number?: string; order_number?: string; [key: string]: unknown } | null | undefined): string {
  if (!order || orderHasEInvoiceIssued(order as Parameters<typeof orderHasEInvoiceIssued>[0])) return "";
  const no = String(order.invoice_number || order.local_invoice_number || "").trim();
  if (!no) return "";
  const orderNo = String(order.order_number || "").trim();
  if (no === orderNo) return "";
  return no;
}

export function orderDeleteConfirmMessage(order: { order_number?: string; invoice_number?: string; [key: string]: unknown } | null | undefined): string {
  const no = String(order?.order_number || "Sipariş").trim() || "Sipariş";
  const invNo = orderDraftInvoiceNumber(order);
  const base = `${no} silinsin mi?`;
  if (!invNo) return base;
  return `${base}\nBağlı taslak fatura ${invNo} da çöp kutusuna taşınacak.`;
}

export function invoiceDeleteConfirmMessage(inv: { invoice_number?: string; status?: string; invoice_type?: string; e_type?: string; order_number?: string; source_order_number?: string } | null | undefined): string {
  const no = String(inv?.invoice_number || "").trim() || "Belge";
  const isDisp = inv?.invoice_type === "dispatch" || inv?.e_type === "e_dispatch";
  const kind = isDisp ? (inv?.status === "draft" ? "taslak irsaliye" : "irsaliye") : (inv?.status === "draft" ? "taslak fatura" : "kağıt fatura");
  const base = `${no} numaralı ${kind} çöp kutusuna taşınsın mı?`;
  const orderNo = String(inv?.order_number || inv?.source_order_number || "").trim();
  if (!orderNo) return base;
  return `${base}\nBağlı sipariş ${orderNo} da çöp kutusuna taşınacak.`;
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

/** Son kalem silinemez; aksi halde kalan satırlar. */
export function removeOrderLine<T>(items: T[] | null | undefined, index: number): T[] | null {
  const rows = items || [];
  if (index < 0 || index >= rows.length) return rows;
  if (rows.length <= 1) return null;
  return rows.filter((_, i) => i !== index);
}
