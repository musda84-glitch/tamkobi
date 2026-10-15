import { orderHasEInvoiceIssued } from "./orderMoreMenu";

/** Silinebilirlik: GİB e-belge yoksa UI silmeye izin verir; kesin karar backend'de. */
export function canStaffDeleteOrder(o) {
  if (!o) return false;
  if (orderHasEInvoiceIssued(o)) return false;
  return true;
}

export function orderDraftInvoiceNumber(order) {
  if (!order || orderHasEInvoiceIssued(order)) return "";
  const no = String(order.invoice_number || order.local_invoice_number || "").trim();
  if (!no) return "";
  const orderNo = String(order.order_number || "").trim();
  if (no === orderNo) return "";
  return no;
}

export function invoiceLinkedOrderNumber(inv) {
  if (!inv) return "";
  return String(inv.order_number || inv.source_order_number || "").trim();
}

export function orderDeleteConfirmMessage(order) {
  const no = String(order?.order_number || "Sipariş").trim() || "Sipariş";
  const invNo = orderDraftInvoiceNumber(order);
  const base = `${no} silinsin mi?`;
  if (!invNo) return base;
  return `${base}\nBağlı taslak fatura ${invNo} da çöp kutusuna taşınacak.`;
}

export function orderBulkDeleteConfirmMessage(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const n = list.length;
  const base = `${n} sipariş silinsin mi? (Çöp Kutusu'ndan 30 gün içinde geri getirebilirsiniz.)`;
  const invNos = [...new Set(list.map(orderDraftInvoiceNumber).filter(Boolean))];
  if (!invNos.length) return base;
  const shown = invNos.slice(0, 5).join(", ");
  const extra = invNos.length > 5 ? ` +${invNos.length - 5}` : "";
  return `${base}\nBağlı taslak fatura ${shown}${extra} da çöp kutusuna taşınacak.`;
}

export function invoiceDeleteKindLabel(inv) {
  const isDisp = inv?.invoice_type === "dispatch" || inv?.e_type === "e_dispatch";
  if (isDisp) return inv?.status === "draft" ? "taslak irsaliye" : "irsaliye";
  return inv?.status === "draft" ? "taslak fatura" : "kağıt fatura";
}

export function invoiceDeleteConfirmMessage(inv) {
  const no = String(inv?.invoice_number || "").trim() || "Belge";
  const kind = invoiceDeleteKindLabel(inv);
  const base = `${no} numaralı ${kind} çöp kutusuna taşınsın mı?`;
  const orderNo = invoiceLinkedOrderNumber(inv);
  if (!orderNo) return base;
  return `${base}\nBağlı sipariş ${orderNo} da çöp kutusuna taşınacak.`;
}

export function invoiceBulkDeleteConfirmMessage(invoices) {
  const list = Array.isArray(invoices) ? invoices : [];
  const n = list.length;
  const base = `${n} fatura çöp kutusuna taşınsın mı?`;
  const orderNos = [...new Set(list.map(invoiceLinkedOrderNumber).filter(Boolean))];
  if (!orderNos.length) return base;
  const shown = orderNos.slice(0, 5).join(", ");
  const extra = orderNos.length > 5 ? ` +${orderNos.length - 5}` : "";
  return `${base}\nBağlı sipariş ${shown}${extra} da çöp kutusuna taşınacak.`;
}
