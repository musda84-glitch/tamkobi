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
    expect(canIssueOrderEBelge({ invoice_id: "inv1" })).toBe(false);
    expect(canIssueOrderEBelge({ is_invoiced: true, invoice_id: "inv1" })).toBe(true);
  });

  it("treats a missing linked invoice as uninvoiced", () => {
    const missing = {
      invoice_id: "inv_gone",
      is_invoiced: true,
      invoice_missing: true,
      e_type: "e_archive",
      einvoice_state: "sent",
    };
    expect(isOrderFullyInvoiced(missing)).toBe(false);
    expect(hasOrderDraftInvoice(missing)).toBe(false);
    expect(canCreateOrderDraftInvoice(missing)).toBe(true);
    expect(canPostOrderDraftInvoice(missing)).toBe(false);
    expect(canIssueOrderEBelge(missing)).toBe(false);
    expect(faturalaActionLabel(missing)).toBe("Faturala");
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
    expect(eBelgeCreateBody({ orderId: "o1", companyId: "c1", eType: "e_invoice", scenario: "TEMEL" }).scenario).toBe("TEMEL");
    expect(
      eBelgeCreateBody({
        orderId: "o1",
        invoiceId: "i1",
        companyId: "c1",
        eType: "e_invoice",
        scenario: "TEMEL",
        stampNow: true,
        issueDate: "2026-10-09",
        issueTime: "22:56:00",
      }),
    ).toEqual({
      invoice_id: "i1",
      order_id: "o1",
      company_id: "c1",
      e_type: "e_invoice",
      scenario: "TEMEL",
      stamp_now: true,
      issue_date: "2026-10-09",
      issue_time: "22:56:00",
    });
  });

  it("badge label/tone for draft vs posted vs GİB e-belge", () => {
    expect(orderInvoiceBadgeTone({ invoice_id: "d" })).toBe("amber");
    expect(orderInvoiceBadgeLabel({ invoice_id: "d", invoice_number: "SF-1" })).toMatch(/Taslak/);
    expect(orderInvoiceBadgeTone({ is_invoiced: true, invoice_number: "SF-2", e_type: "e_archive" })).toBe("green");
    expect(orderInvoiceBadgeLabel({ is_invoiced: true, invoice_number: "SF-2" })).toMatch(/Faturalaştı/);
    expect(orderInvoiceBadgeTone({
      is_invoiced: true,
      e_type: "e_archive",
      einvoice_state: "sent",
      gib_invoice_id: "U052026000000090",
    })).toBe("red");
    expect(orderInvoiceBadgeLabel({
      is_invoiced: true,
      e_type: "e_archive",
      einvoice_state: "sent",
      gib_invoice_id: "U052026000000090",
    })).toMatch(/Faturalaşmış/);
    expect(orderInvoiceBadgeTone({
      is_invoiced: true,
      e_type: "paper",
      einvoice_state: "paper",
      invoice_number: "TA2026000000069",
    })).toBe("green");
    expect(orderInvoiceBadgeLabel({
      is_invoiced: true,
      e_type: "paper",
      einvoice_state: "paper",
      invoice_number: "TA2026000000069",
    })).toBe("Faturalaştı (Kağıt)");
    expect(orderInvoiceBadgeLabel({
      is_invoiced: true,
      e_type: "e_invoice",
      einvoice_state: "queued",
    })).toBe("Gönderiliyor");
    expect(orderInvoiceBadgeTone({
      is_invoiced: true,
      e_type: "e_archive",
      einvoice_state: "error",
    })).toBe("red");
    expect(orderInvoiceBadgeLabel(null)).toBeNull();
  });

  it("e-belge ignores the cari mükellef flag", () => {
    const { orderEBelgeTypeFromContact, canShowEFaturaOption } = require("./orderInvoice");
    expect(orderEBelgeTypeFromContact(null)).toBe("e_archive");
    expect(orderEBelgeTypeFromContact({ is_e_invoice_user: false })).toBe("e_archive");
    expect(orderEBelgeTypeFromContact({ is_e_invoice_user: true })).toBe("e_archive");
    expect(canShowEFaturaOption({ is_e_invoice_user: true })).toBe(false);
  });
});
