import { describe, expect, test } from "@jest/globals";
import {
  canCopyInvoice,
  INVOICE_COPY_MODES,
  invoiceToOpenAfterCopy,
  normalizeContactOptions,
} from "./invoiceCopyModes";

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

describe("invoiceToOpenAfterCopy", () => {
  test("returns same_contact draft with contact_id for form hydrate", () => {
    const inv = {
      id: "inv_copy_1",
      contact_id: "cnt_abc",
      contact_name: "Acme A.Ş.",
      status: "draft",
      items: [{ name: "Kalem", quantity: 1 }],
    };
    const opened = invoiceToOpenAfterCopy({ kind: "invoice", invoice: inv });
    expect(opened).toBe(inv);
    expect(opened.contact_id).toBe("cnt_abc");
    expect(opened.contact_name).toBe("Acme A.Ş.");
  });

  test("purchase_order copy does not open invoice form", () => {
    expect(invoiceToOpenAfterCopy({ kind: "purchase_order", purchase_order: { id: "po1" } })).toBeNull();
    expect(invoiceToOpenAfterCopy(null)).toBeNull();
    expect(invoiceToOpenAfterCopy({})).toBeNull();
  });
});

describe("normalizeContactOptions", () => {
  test("maps _id to id and drops invalid rows", () => {
    const rows = normalizeContactOptions([
      { _id: "c1", name: "A" },
      { id: "c2", name: "B" },
      { name: "no-id" },
      null,
    ]);
    expect(rows.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(rows[0].name).toBe("A");
  });

  test("accepts { contacts: [] } envelope", () => {
    expect(normalizeContactOptions({ contacts: [{ id: "x", name: "X" }] })).toHaveLength(1);
  });
});
