import { describe, expect, test } from "@jest/globals";
import { canCopyInvoice, INVOICE_COPY_MODES } from "./invoiceCopyModes";

describe("canCopyInvoice", () => {
  test("allows invoices with items", () => {
    expect(canCopyInvoice({ status: "approved", items: [{ name: "A" }] })).toBe(true);
    expect(canCopyInvoice({ status: "draft", items: [{ name: "A" }] })).toBe(true);
  });

  test("blocks cancelled or empty", () => {
    expect(canCopyInvoice({ status: "cancelled", items: [{ name: "A" }] })).toBe(false);
    expect(canCopyInvoice({ status: "draft", items: [] })).toBe(false);
    expect(canCopyInvoice(null)).toBe(false);
  });
});

describe("INVOICE_COPY_MODES", () => {
  test("exposes the three Kopyala options", () => {
    expect(INVOICE_COPY_MODES.map((m) => m.key)).toEqual([
      "same_contact",
      "different_contact",
      "to_supplier_order",
    ]);
    expect(INVOICE_COPY_MODES.map((m) => m.label)).toEqual([
      "Aynı müşteri için",
      "Farklı bir müşteri için",
      "Tedarikçi siparişine çevir",
    ]);
  });
});
