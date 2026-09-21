import type { Invoice, Order } from "../types";
import { safePrintFilename } from "./orderPrint";

export function invoiceAsPrintOrder(invoice: Invoice): Order {
  return {
    ...(invoice as Invoice & Order),
    order_number: invoice.invoice_number,
    contact_name: invoice.contact_name,
    customer_name: invoice.contact_name,
    order_date: invoice.issue_date,
    items: invoice.items,
    notes: invoice.notes,
    subtotal: invoice.subtotal,
    vat_total: invoice.vat_total,
    grand_total: invoice.grand_total,
    invoice_number: invoice.invoice_number,
    due_date: invoice.due_date,
    issue_date: invoice.issue_date,
    e_type: invoice.e_type,
    trade_kind: invoice.trade_kind,
    images: invoice.images,
    withholding_amount: invoice.withholding_amount,
    incoterm: invoice.incoterm,
    country: invoice.country,
    customs_office: invoice.customs_office,
    regime_code: invoice.regime_code,
    declaration_no: invoice.declaration_no,
    bl_awb: invoice.bl_awb,
    dab_no: invoice.dab_no,
    certificate: invoice.certificate,
    trade_file_number: invoice.trade_file_number,
    contact_id: invoice.contact_id,
  } as Order & Invoice;
}

export function invoicePdfFilename(invoice: Invoice): string {
  return `${safePrintFilename(invoice.invoice_number, invoice.invoice_type === "dispatch" ? "irsaliye" : "fatura")}.pdf`;
}

export function invoicePrintDocType(invoice: Invoice): "invoice" | "dispatch" {
  return invoice.invoice_type === "dispatch" ? "dispatch" : "invoice";
}
