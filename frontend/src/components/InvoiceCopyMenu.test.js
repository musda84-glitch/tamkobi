import { describe, expect, test } from "@jest/globals";
import { canCopyInvoice, INVOICE_COPY_MODES } from "./invoiceCopyModes";

describe("canCopyInvoice", () => {
  test("allows invoices with or without items loaded", () => {
    expect(canCopyInvoice({ status: "approved", items: [{ name: "A" }] })).toBe(true);
    expect(canCopyInvoice({ status: "draft", items: [{ name: "A" }] })).toBe(true);
    expect(canCopyInvoice({ status: "approved", invoice_number: "GP-1" })).toBe(true);
    expect(canCopyInvoice({ status: "draft", items: [] })).toBe(true);
  });

  test("blocks cancelled or missing", () => {
    expect(canCopyInvoice({ status: "cancelled", items: [{ name: "A" }] })).toBe(false);
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
