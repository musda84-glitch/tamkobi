/** Mobil sipariş faturalama: taslak (#476) + cari onay + e-belge. */

import { orderInvoiceBadge, type OrderMoreOrder } from "./orderMoreMenu";

export type OrderInvoiceFlags = OrderMoreOrder & {
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

/** GİB e-Fatura/e-Arşiv: yalnızca cariye faturalaşmış sipariş. */
export function canIssueOrderEBelge(o: OrderInvoiceFlags | null | undefined): boolean {
  return !!o?.is_invoiced;
}

export function orderInvoiceBadgeLabel(o: OrderInvoiceFlags | null | undefined): string | null {
  const badge = orderInvoiceBadge(o);
  if (!badge) return null;
  if (badge.testId === "invoiced" && o?.invoice_number) return `Faturalaştı · ${o.invoice_number}`;
  if (badge.testId === "draft" && o?.invoice_number) return `Taslak · ${o.invoice_number}`;
  return badge.label;
}

export function orderInvoiceBadgeTone(o: OrderInvoiceFlags | null | undefined): "amber" | "green" | "red" | null {
  const badge = orderInvoiceBadge(o);
  if (!badge) return null;
  if (badge.tone === "rose") return "red";
  if (badge.tone === "green") return "green";
  return "amber";
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
  scenario?: "TEMEL" | "TICARI";
  stampNow?: boolean;
  issueDate?: string;
  issueTime?: string;
}) {
  const body: Record<string, unknown> = {
    invoice_id: opts.invoiceId || undefined,
    order_id: opts.orderId,
    company_id: opts.companyId,
    e_type: opts.eType,
    scenario: opts.eType === "e_invoice"
      ? (opts.scenario || "TICARI")
      : undefined,
  };
  if (opts.stampNow) {
    body.stamp_now = true;
    if (opts.issueDate) body.issue_date = opts.issueDate;
    if (opts.issueTime) body.issue_time = opts.issueTime;
  }
  return body;
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
