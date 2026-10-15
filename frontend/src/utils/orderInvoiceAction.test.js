import {
  INVOICE_MISSING_HINT,
  orderInvoiceLinkMissing,
  orderUninvoicedInvoiceButton,
} from "./orderInvoiceAction";

describe("orderUninvoicedInvoiceButton", () => {
  it("shows the green uninvoiced action when the linked invoice is missing", () => {
    const ord = {
      order_number: "B2B-9",
      invoice_id: "inv_gone",
      invoice_number: "TA1",
      is_invoiced: true,
      invoice_missing: true,
      e_type: "e_archive",
      einvoice_state: "sent",
      gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    };
    expect(orderInvoiceLinkMissing(ord)).toBe(true);
    const btn = orderUninvoicedInvoiceButton(ord);
    expect(btn.className).toContain("bg-emerald-600");
    expect(btn.title).toBe(INVOICE_MISSING_HINT);
    expect(btn.title).toBe("bağlı fatura bulunamadı");
    expect(btn.ariaLabel).toBe("Fatura işlemleri");
  });

  it("keeps a live draft or posted invoice off the green uninvoiced button", () => {
    expect(orderUninvoicedInvoiceButton({ invoice_id: "inv_live", is_invoiced: false })).toBeNull();
    expect(orderUninvoicedInvoiceButton({ is_invoiced: true, invoice_id: "inv_live" })).toBeNull();
    const plain = orderUninvoicedInvoiceButton({ order_number: "B2B-1" });
    expect(plain.className).toContain("bg-emerald-600");
    expect(plain.title).toBe("Fatura işlemleri");
    expect(plain.ariaLabel).toBe("Fatura işlemleri");
  });
});
