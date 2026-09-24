import {
  applyTradeKind,
  canCancelInvoice,
  canDeleteInvoice,
  invoiceRowDangerAction,
  canEditInvoiceItems,
  createInvoiceButtonLabel,
  invoiceDetailTotals,
  invoiceDipPayload,
  invoiceItemsPayload,
  invoiceListSubtitle,
  invoiceListTitle,
  draftFromInvoice,
  eTypeForContact,
  emptyInvoiceDraft,
  invoicePayload,
  invoiceProjectSelectGroups,
  invoiceTotals,
  invoiceUpdateBody,
  isIncomingPurchasePending,
  parseWithholding,
  plusDaysIso,
  remainingAmount,
  validateInvoiceDraft,
  WITHHOLDING,
  withholdingSelectGroups,
} from "./invoiceDraft";
import { computeLine, emptyLine } from "./documentLines";

describe("invoiceDraft", () => {
  it("requires a contact and named lines", () => {
    const d = emptyInvoiceDraft();
    expect(validateInvoiceDraft(d)).toBe("Lütfen bir cari seçiniz.");
    d.contact_id = "c1";
    expect(validateInvoiceDraft(d)).toBe("Her satır için ürün seçin ya da hizmet adı yazın.");
    d.items = [computeLine({ ...emptyLine(), name: "Hizmet", unit_price: 100 })];
    expect(validateInvoiceDraft(d)).toBeNull();
  });

  it("builds create payload like web Yeni Fatura Kes", () => {
    const d = emptyInvoiceDraft();
    d.contact_id = "c1";
    d.contact_name = "Acme";
    d.status = "approved";
    d.items = [computeLine({ ...emptyLine(), name: "Kalem", quantity: 2, unit_price: 100, vat_rate: 20, discount_rate: 10 })];
    d.gdMode = "percent";
    d.general_discount_rate = 10;
    d.withholding_rate = 0.5;
    d.withholding_code = "602";
    const body = invoicePayload(d, "comp_1");
    expect(body.company_id).toBe("comp_1");
    expect(body.contact_id).toBe("c1");
    expect(body.price_mode).toBe("excl");
    expect(body.status).toBe("approved");
    expect(body.gib_status).toBe("Onaylandı");
    expect(body.items[0].unit_price).toBe(100);
    expect(body.items[0].name).toBe("Kalem");
    expect(body.withholding_code).toBe("602");
    expect(body.general_discount_rate).toBe(10);
    expect(body.general_discount_amount).toBeCloseTo(18);
  });

  it("forces dispatch drafts and strips company on update", () => {
    const d = emptyInvoiceDraft();
    d.invoice_type = "dispatch";
    d.status = "approved";
    d.contact_id = "c1";
    d.items = [computeLine({ ...emptyLine(), name: "Sevk", unit_price: 10 })];
    const create = invoicePayload(d, "comp");
    expect(create.status).toBe("draft");
    expect(create.e_type).toBe("e_dispatch");
    const upd = invoiceUpdateBody(d);
    expect("company_id" in upd).toBe(false);
    expect("gib_status" in upd).toBe(false);
    expect(upd.invoice_type).toBe("dispatch");
  });

  it("applies export trade: sales + e-export + 0 VAT", () => {
    const d = emptyInvoiceDraft();
    d.e_type = "e_archive";
    d.items = [computeLine({ ...emptyLine(), name: "X", unit_price: 50, vat_rate: 20 })];
    const next = applyTradeKind(d, "export");
    expect(next.trade_kind).toBe("export");
    expect(next.invoice_type).toBe("sales");
    expect(next.e_type).toBe("e_export");
    expect(next.items[0].vat_rate).toBe(0);
    d.e_type = "paper";
    expect(applyTradeKind(d, "export").e_type).toBe("paper");
  });

  it("picks e-fatura vs e-arşiv from cari for sales", () => {
    const d = emptyInvoiceDraft();
    d.invoice_type = "sales";
    d.e_type = "e_archive";
    expect(eTypeForContact(d, true)).toBe("e_invoice");
    expect(eTypeForContact(d, false)).toBe("e_archive");
    d.e_type = "paper";
    expect(eTypeForContact(d, true)).toBe("paper");
  });

  it("maps an existing draft invoice into the form", () => {
    const d = draftFromInvoice({
      invoice_type: "purchase",
      e_type: "paper",
      contact_id: "c9",
      contact_name: "Tedarikçi",
      issue_date: "2026-04-01",
      due_date: "2026-04-20",
      notes: "not",
      general_discount_rate: 5,
      items: [{ product_name: "Hammadde", quantity: 1, unit_price: 40, vat_rate: 10 }],
    });
    expect(d.invoice_type).toBe("purchase");
    expect(d.contact_id).toBe("c9");
    expect(d.gdMode).toBe("percent");
    expect(d.items[0].name).toBe("Hammadde");
    expect(d.notes).toBe("not");
  });

  it("labels the create button like web", () => {
    expect(createInvoiceButtonLabel("all")).toBe("Yeni Fatura Kes");
    expect(createInvoiceButtonLabel("purchase")).toBe("Alış Faturası Gir");
    expect(createInvoiceButtonLabel("dispatch")).toBe("Yeni İrsaliye");
  });

  it("puts the contact name on the invoice list title and the number below", () => {
    expect(invoiceListTitle({ contact_name: "Mustafa BAL" })).toBe("Mustafa BAL");
    expect(invoiceListTitle({})).toBe("Cari yok");
    expect(invoiceListSubtitle({
      invoice_number: "NX202600000017",
      invoice_type: "sales",
      e_type: "e_archive",
      status: "draft",
      issue_date: "2026-09-21",
    })).toBe("NX202600000017 · Satış · E-Arşiv · Taslak · 21.09.2026");
    expect(invoiceListSubtitle({ invoice_type: "sales" })).toMatch(/^Fatura · Satış/);
  });

  it("allows item edits only on drafts and maps lines for PUT", () => {
    expect(canEditInvoiceItems({ status: "draft" })).toBe(true);
    expect(canEditInvoiceItems({ status: "approved" })).toBe(false);
    const body = invoiceItemsPayload([
      { product_id: "p1", name: "Raf", product_name: "Raf", sku: "", quantity: 2, unit: "Adet", unit_price: 10, unit_price_incl: 12, vat_rate: 20, discount_rate: 0, total: 20, total_incl: 24, vat_amount: 4, is_service: false },
    ]);
    expect(body.items[0].name).toBe("Raf");
    expect(body.items[0].quantity).toBe(2);
  });

  it("invoiceDipPayload keeps amount-mode discount and live-updates detail totals", () => {
    const lines = [
      { product_id: "p1", name: "Raf", product_name: "Raf", sku: "", quantity: 1, unit: "Adet", unit_price: 200, unit_price_incl: 220, vat_rate: 10, discount_rate: 0, total: 200, total_incl: 220, vat_amount: 20, is_service: false },
    ];
    const pct = invoiceDipPayload(lines, "percent", 10);
    expect(pct.general_discount_rate).toBe(10);
    expect(pct.general_discount_amount).toBeUndefined();
    const amt = invoiceDipPayload(lines, "amount", 25);
    expect(amt.general_discount_amount).toBe(25);
    expect(amt.general_discount_rate).toBeUndefined();
    const cleared = invoiceDipPayload(lines, "amount", 0);
    expect(cleared.general_discount_rate).toBe(0);
    const live = invoiceDetailTotals(
      { items: lines, general_discount_rate: 0, general_discount_amount: 0 },
      "amount",
      20,
    );
    expect(live.gd).toBeCloseTo(20);
    expect(live.subtotal).toBeCloseTo(180);
    expect(live.vat).toBeCloseTo(18);
    expect(live.grandTotal).toBeCloseTo(198);
  });

  it("deletes drafts and unpaid paper, not issued e-docs", () => {
    expect(canDeleteInvoice({ status: "draft" })).toBe(true);
    expect(canDeleteInvoice({ status: "approved", e_type: "paper", paid_amount: 0 })).toBe(true);
    expect(canDeleteInvoice({ status: "approved", e_type: "e_invoice" })).toBe(false);
    expect(canDeleteInvoice({ status: "approved", e_type: "paper", paid_amount: 10 })).toBe(false);
  });

  it("cancels issued e-invoices and paper, not drafts or dispatches", () => {
    expect(canCancelInvoice({ status: "approved", e_type: "e_invoice" })).toBe(true);
    expect(canCancelInvoice({ status: "approved", e_type: "e_archive", payment_status: "paid" })).toBe(true);
    expect(canCancelInvoice({ status: "draft", e_type: "e_invoice" })).toBe(false);
    expect(canCancelInvoice({ status: "cancelled", e_type: "e_invoice" })).toBe(false);
    expect(canCancelInvoice({ status: "approved", invoice_type: "dispatch" })).toBe(false);
    expect(invoiceRowDangerAction({ status: "draft" })).toBe("delete");
    expect(invoiceRowDangerAction({ status: "approved", e_type: "paper", paid_amount: 0 })).toBe("delete");
    expect(invoiceRowDangerAction({ status: "approved", e_type: "e_invoice" })).toBe("cancel");
    expect(invoiceRowDangerAction({ status: "cancelled", e_type: "e_invoice" })).toBe(null);
  });

  it("flags incoming purchase e-invoices pending GİB response", () => {
    expect(isIncomingPurchasePending({ invoice_type: "purchase", e_type: "e_invoice", gib_status: "Gelen" })).toBe(true);
    expect(isIncomingPurchasePending({ invoice_type: "sales", e_type: "e_invoice" })).toBe(false);
  });

  it("computes remaining payment and withholding parse", () => {
    expect(remainingAmount({ grand_total: 120, paid_amount: 20 })).toBe(100);
    expect(parseWithholding("0.5|602")).toEqual({ withholding_rate: 0.5, withholding_code: "602" });
    expect(plusDaysIso("2026-01-01", 15)).toBe("2026-01-16");
  });

  it("groups withholding options by rate for the dropdown", () => {
    const groups = withholdingSelectGroups();
    expect(groups[0]).toEqual({ label: "Tevkifat", options: [{ value: "", label: "Tevkifat yok" }] });
    expect(groups.slice(1).map((g) => g.label)).toEqual([
      "2/10 tevkifat",
      "3/10 tevkifat",
      "5/10 tevkifat",
      "7/10 tevkifat",
      "9/10 tevkifat",
      "10/10 tevkifat",
    ]);
    const five = groups.find((g) => g.label === "5/10 tevkifat");
    expect(five?.options).toContainEqual({ value: "0.5|602", label: "Etüt, plan-proje (602)" });
    const all = groups.flatMap((g) => g.options);
    expect(all).toHaveLength(WITHHOLDING.length);
  });

  it("invoiceTotals apply general discount and withholding", () => {
    const d = emptyInvoiceDraft();
    d.items = [computeLine({ ...emptyLine(), name: "A", quantity: 1, unit_price: 100, vat_rate: 20 })];
    d.gdMode = "amount";
    d.general_discount_amount = 10;
    d.withholding_rate = 0.5;
    const t = invoiceTotals(d);
    expect(t.itemsSum).toBeCloseTo(100);
    expect(t.gd).toBeCloseTo(10);
    expect(t.subtotal).toBeCloseTo(90);
    expect(t.vat).toBeCloseTo(18);
    expect(t.withholding).toBeCloseTo(9);
    expect(t.grandTotal).toBeCloseTo(99);
  });

  it("groups invoice projects as a collapsible select", () => {
    expect(invoiceProjectSelectGroups([
      { id: "p1", project_number: "PRJ-2026-0014", name: "Fiyat Teklifi" },
      { _id: "p2", name: "Villa" },
    ])).toEqual([{
      label: "Projeler",
      options: [
        { value: "p1", label: "PRJ-2026-0014 · Fiyat Teklifi" },
        { value: "p2", label: "Villa" },
      ],
    }]);
  });
});
