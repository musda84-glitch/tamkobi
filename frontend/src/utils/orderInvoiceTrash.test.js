import {
  canStaffDeleteOrder,
  invoiceBulkDeleteConfirmMessage,
  invoiceDeleteConfirmMessage,
  orderBulkDeleteConfirmMessage,
  orderDeleteConfirmMessage,
} from "./orderInvoiceTrash";

describe("canStaffDeleteOrder", () => {
  test("allows orders without e-document, including draft invoice_id", () => {
    expect(canStaffDeleteOrder({ order_number: "B2B-1" })).toBe(true);
    expect(canStaffDeleteOrder({ invoice_id: "inv_1", is_invoiced: false, invoice_number: "TA20260001" })).toBe(true);
    expect(canStaffDeleteOrder({ is_invoiced: false })).toBe(true);
  });

  test("blocks GİB-issued e-documents", () => {
    expect(canStaffDeleteOrder({
      e_type: "e_invoice",
      einvoice_state: "accepted",
      invoice_number: "TA1",
    })).toBe(false);
    expect(canStaffDeleteOrder({
      e_type: "e_archive",
      invoice_gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    })).toBe(false);
  });
});

describe("order delete confirm", () => {
  test("includes linked draft invoice number", () => {
    expect(orderDeleteConfirmMessage({
      order_number: "B2B-2026-0014",
      invoice_number: "TA202600000069",
      is_invoiced: false,
    })).toContain("TA202600000069");
    expect(orderDeleteConfirmMessage({
      order_number: "B2B-2026-0014",
      invoice_number: "TA202600000069",
    })).toContain("Bağlı taslak fatura");
  });

  test("bulk includes document numbers", () => {
    const msg = orderBulkDeleteConfirmMessage([
      { order_number: "B2B-1", invoice_number: "TA1" },
      { order_number: "B2B-2", invoice_number: "TA2" },
    ]);
    expect(msg).toContain("TA1");
    expect(msg).toContain("TA2");
    expect(msg).toContain("Bağlı taslak fatura");
  });
});

describe("invoice delete confirm", () => {
  test("includes linked order number", () => {
    expect(invoiceDeleteConfirmMessage({
      invoice_number: "TA20260001",
      status: "draft",
      order_number: "B2B-2026-0014",
    })).toContain("B2B-2026-0014");
    expect(invoiceDeleteConfirmMessage({
      invoice_number: "TA20260001",
      status: "draft",
      order_number: "B2B-2026-0014",
    })).toContain("Bağlı sipariş");
  });

  test("bulk includes order numbers", () => {
    const msg = invoiceBulkDeleteConfirmMessage([
      { invoice_number: "TA1", status: "draft", order_number: "B2B-1" },
      { invoice_number: "TA2", status: "draft", order_number: "B2B-2" },
    ]);
    expect(msg).toContain("B2B-1");
    expect(msg).toContain("B2B-2");
  });
});
