/** Mobil sipariş faturalama: taslak (#476) + cari onay + e-belge. */

export type OrderInvoiceFlags = {
  is_invoiced?: boolean;
  invoice_id?: string;
  invoice_number?: string;
};

/** Resmi / cariye işlenmiş fatura (taslak sayılmaz). */
export function isOrderFullyInvoiced(o: OrderInvoiceFlags | null | undefined): boolean {
  return !!o?.is_invoiced;
}

/** Taslak fatura var, henüz cariye işlenmemiş. */
export function hasOrderDraftInvoice(o: OrderInvoiceFlags | null | undefined): boolean {
  return !!o?.invoice_id && !o?.is_invoiced;
}

export function canCreateOrderDraftInvoice(o: OrderInvoiceFlags | null | undefined): boolean {
  return !!o && !o.is_invoiced && !o.invoice_id;
}

export function canPostOrderDraftInvoice(o: OrderInvoiceFlags | null | undefined): boolean {
  return hasOrderDraftInvoice(o);
}

export function canIssueOrderEBelge(o: OrderInvoiceFlags | null | undefined): boolean {
  return !!o && !o.is_invoiced;
}

export function orderInvoiceBadgeLabel(o: OrderInvoiceFlags | null | undefined): string | null {
  if (!o) return null;
  if (o.is_invoiced) return o.invoice_number ? `Faturalandı · ${o.invoice_number}` : "Faturalandı";
  if (o.invoice_id) return o.invoice_number ? `Taslak · ${o.invoice_number}` : "Taslak fatura";
  return null;
}

export function orderInvoiceBadgeTone(o: OrderInvoiceFlags | null | undefined): "amber" | "green" | null {
  if (!o) return null;
  if (o.is_invoiced) return "green";
  if (o.invoice_id) return "amber";
  return null;
}

export type DraftInvoiceEType = "e_invoice" | "e_archive" | "paper";

export function convertToDraftBody(eType: DraftInvoiceEType = "e_archive") {
  return { e_type: eType, as_draft: true as const };
}

export function eBelgeCreateBody(opts: {
  orderId: string;
  invoiceId?: string;
  companyId: string;
  eType: "e_invoice" | "e_archive";
}) {
  return {
    invoice_id: opts.invoiceId || undefined,
    order_id: opts.orderId,
    company_id: opts.companyId,
    e_type: opts.eType,
    scenario: opts.eType === "e_invoice" ? "TICARI" : undefined,
  };
}

export function faturalaActionLabel(o: OrderInvoiceFlags | null | undefined): string {
  if (hasOrderDraftInvoice(o)) return "Cariye işle";
  if (isOrderFullyInvoiced(o)) return "Faturalandı";
  return "Faturala";
}

/** Cari e-fatura mükellefi değilse / bilinmiyorsa → e-arşiv. */
export function orderEBelgeTypeFromContact(contact?: { is_e_invoice_user?: boolean } | null): "e_invoice" | "e_archive" {
  return contact?.is_e_invoice_user ? "e_invoice" : "e_archive";
}

export function canShowEFaturaOption(contact?: { is_e_invoice_user?: boolean } | null): boolean {
  return orderEBelgeTypeFromContact(contact) === "e_invoice";
}
