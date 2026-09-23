import {
  canCreateOrderDraftInvoice,
  canIssueOrderEBelge,
  canPostOrderDraftInvoice,
  convertToDraftBody,
  eBelgeCreateBody,
  faturalaActionLabel,
  hasOrderDraftInvoice,
  isOrderFullyInvoiced,
  orderInvoiceBadgeLabel,
  orderInvoiceBadgeTone,
} from "./orderInvoice";

describe("orderInvoice draft / post / e-belge", () => {
  it("treats invoice_id without is_invoiced as draft only", () => {
    expect(isOrderFullyInvoiced({ invoice_id: "inv1" })).toBe(false);
    expect(hasOrderDraftInvoice({ invoice_id: "inv1" })).toBe(true);
    expect(canCreateOrderDraftInvoice({ invoice_id: "inv1" })).toBe(false);
    expect(canPostOrderDraftInvoice({ invoice_id: "inv1" })).toBe(true);
    expect(canIssueOrderEBelge({ invoice_id: "inv1" })).toBe(true);
  });

  it("gates Faturala create vs post", () => {
    expect(canCreateOrderDraftInvoice({})).toBe(true);
    expect(canPostOrderDraftInvoice({})).toBe(false);
    expect(canCreateOrderDraftInvoice({ is_invoiced: true, invoice_id: "x" })).toBe(false);
    expect(faturalaActionLabel({})).toBe("Faturala");
    expect(faturalaActionLabel({ invoice_id: "d" })).toBe("Cariye işle");
  });

  it("builds draft convert and e-belge payloads", () => {
    expect(convertToDraftBody("e_invoice")).toEqual({ e_type: "e_invoice", as_draft: true });
    expect(eBelgeCreateBody({ orderId: "o1", invoiceId: "i1", companyId: "c1", eType: "e_archive" })).toEqual({
      invoice_id: "i1",
      order_id: "o1",
      company_id: "c1",
      e_type: "e_archive",
      scenario: undefined,
    });
    expect(eBelgeCreateBody({ orderId: "o1", companyId: "c1", eType: "e_invoice" }).scenario).toBe("TICARI");
  });

  it("badge label/tone for draft vs posted", () => {
    expect(orderInvoiceBadgeTone({ invoice_id: "d" })).toBe("amber");
    expect(orderInvoiceBadgeLabel({ invoice_id: "d", invoice_number: "SF-1" })).toMatch(/Taslak/);
    expect(orderInvoiceBadgeTone({ is_invoiced: true, invoice_number: "SF-2" })).toBe("green");
    expect(orderInvoiceBadgeLabel(null)).toBeNull();
  });

  it("e-belge defaults to e-archive unless mükellef", () => {
    const { orderEBelgeTypeFromContact, canShowEFaturaOption } = require("./orderInvoice");
    expect(orderEBelgeTypeFromContact(null)).toBe("e_archive");
    expect(orderEBelgeTypeFromContact({ is_e_invoice_user: false })).toBe("e_archive");
    expect(orderEBelgeTypeFromContact({ is_e_invoice_user: true })).toBe("e_invoice");
    expect(canShowEFaturaOption({})).toBe(false);
  });
});
