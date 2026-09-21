import { describe, expect, test } from "@jest/globals";
import {
  canCancelInvoice,
  canIssueExpenseSlip,
  invoiceHasPayment,
  placeContextMenu,
} from "./InvoiceContextMenu";

describe("placeContextMenu", () => {
  test("shifts a menu opened at the bottom of the screen fully into view", () => {
    const placed = placeContextMenu({
      x: 1494,
      y: 856,
      height: 425,
      viewportWidth: 1680,
      viewportHeight: 1000,
    });
    expect(placed.top + 425).toBeLessThanOrEqual(1000 - 8);
    expect(placed.top).toBeGreaterThanOrEqual(8);
    expect(placed.left + 256).toBeLessThanOrEqual(1680 - 8);
    expect(placed.maxHeight).toBe(1000 - 16);
  });

  test("keeps a menu that already fits where it was opened", () => {
    const placed = placeContextMenu({
      x: 400,
      y: 120,
      height: 425,
      viewportWidth: 1680,
      viewportHeight: 1000,
    });
    expect(placed.top).toBe(120);
    expect(placed.left).toBe(400);
  });

  test("caps a menu taller than the viewport and pins it to the top margin", () => {
    const placed = placeContextMenu({
      x: 40,
      y: 700,
      height: 900,
      viewportWidth: 800,
      viewportHeight: 720,
    });
    expect(placed.top).toBe(8);
    expect(placed.maxHeight).toBe(720 - 16);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(720 - 8);
  });
});

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
