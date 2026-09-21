import { describe, expect, test } from "@jest/globals";
import { canCancelInvoice, canIssueExpenseSlip, invoiceHasPayment } from "./InvoiceContextMenu";

const issued = {
  status: "approved",
  e_type: "e_invoice",
  invoice_type: "sales",
  contact_id: "c1",
  contact_name: "ERSAY",
  gib_status: "Başarıyla İletildi (GİB Onaylı)",
  payment_status: "unpaid",
  paid_amount: 0,
};

describe("issued invoice menu actions", () => {
  test("paid e-invoice can still be cancelled from the menu", () => {
    const paid = { ...issued, payment_status: "paid", paid_amount: 100 };
    expect(invoiceHasPayment(paid)).toBe(true);
    expect(canCancelInvoice(paid)).toBe(true);
    expect(canIssueExpenseSlip(paid)).toBe(true);
  });

  test("unpaid issued sales invoice offers cancel and expense slip", () => {
    expect(canCancelInvoice(issued)).toBe(true);
    expect(canIssueExpenseSlip(issued)).toBe(true);
  });

  test("drafts, slips, dispatches and incoming e-invoices do not offer a new slip", () => {
    expect(canCancelInvoice({ ...issued, status: "draft" })).toBe(false);
    expect(canIssueExpenseSlip({ ...issued, status: "draft" })).toBe(false);
    expect(canIssueExpenseSlip({ ...issued, e_type: "expense_slip" })).toBe(false);
    expect(canIssueExpenseSlip({ ...issued, invoice_type: "dispatch" })).toBe(false);
    expect(canIssueExpenseSlip({
      ...issued,
      invoice_type: "purchase",
      direction: "incoming",
    })).toBe(false);
  });
});
