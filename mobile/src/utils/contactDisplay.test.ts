import { balanceHint, contactBalanceLabel, contactCardVisibleActions, contactDisplayBalance, contactInfoRows, contactSummaryRows, contactTabSelectGroups, contactTypeLabel, invoiceOpenByContact } from "./contactDisplay";
import { fmtMoney } from "./money";

describe("contactDisplay", () => {
  it("lists filled cari fields in web form order", () => {
    const rows = contactInfoRows({
      name: "Acme",
      type: "customer",
      company_title: "Acme A.Ş.",
      tax_number_or_id: "1234567890",
      tax_office: "Kadıköy",
      phone: "5337133934",
      email: "a@b.com",
      city: "İstanbul",
      district: "Kadıköy",
      address: "Moda Cad. 1",
      is_e_invoice_user: true,
      payment_term_days: 30,
      credit_limit: 10000,
      iban: "TR00",
      notes: "VIP",
      b2b_token: "secret",
      balance: 4460,
    });
    expect(rows.map((r) => r.key)).toEqual([
      "company_title",
      "phone",
      "email",
      "tax_number_or_id",
      "tax_office",
      "address",
      "district",
      "city",
      "credit_limit",
      "payment_term_days",
      "iban",
      "notes",
    ]);
    expect(rows.find((r) => r.key === "payment_term_days")?.value).toBe("30 gün");
    expect(rows.some((r) => r.key === "b2b_token")).toBe(false);
    expect(rows.some((r) => r.key === "balance")).toBe(false);
  });

  it("drops e-belge and TRY currency noise but keeps foreign currency", () => {
    const tryRows = contactInfoRows({ is_e_invoice_user: true, currency: "TRY", city: "İstanbul" });
    expect(tryRows.map((r) => r.key)).toEqual(["city"]);

    const fxRows = contactInfoRows({ is_e_invoice_user: false, currency: "usd", city: "İstanbul" });
    expect(fxRows.map((r) => r.key)).toEqual(["currency", "city"]);
    expect(fxRows[0].value).toBe("USD");
  });

  it("skips empty optional zeros and secrets", () => {
    expect(contactInfoRows({ credit_limit: 0, payment_term_days: 0, b2b_enabled: false }).map((r) => r.key)).toEqual([]);
  });

  it("hides import and integration leftovers from the card", () => {
    const rows = contactInfoRows({
      sales_rep: "Ayşe",
      import_batch_id: "02d56a9e-a6ec-4d42-a5ac-728b7fe092d0",
      bizimhesap_id: "C6D0054D176A4AC499791F1771D9FCE9",
      opening_balance_source: "bizimhesap",
      external_ref: "9f2c",
      erp_code: "MTK-1",
    });
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("sales_rep");
    expect(keys).toContain("erp_code");
    expect(keys).not.toContain("import_batch_id");
    expect(keys).not.toContain("bizimhesap_id");
    expect(keys).not.toContain("opening_balance_source");
    expect(keys).not.toContain("external_ref");
  });

  it("labels type and balance", () => {
    expect(contactTypeLabel("both")).toBe("Müşteri & Tedarikçi");
    expect(balanceHint(4460).label).toMatch(/Alacaklı/);
    expect(balanceHint(-10).tone).toBe("red");
    expect(contactBalanceLabel(8310).label).toBe("Alacaklı");
    expect(contactBalanceLabel(-58497).label).toBe("Borçlu");
    expect(contactBalanceLabel(0).label).toBe("Cari bakiye");
  });

  it("prefers stored cari balance and falls back to open or overdue amount", () => {
    expect(contactDisplayBalance({ balance: 4460 }, { open_amount: 100 })).toBe(4460);
    expect(contactDisplayBalance({ balance: 0 })).toBe(0);
    expect(contactDisplayBalance({ balance: 0 }, { open_amount: 1800 })).toBe(1800);
    expect(contactDisplayBalance({ balance: -250.5 })).toBe(-250.5);
    expect(contactDisplayBalance({}, { open_amount: 1800 })).toBe(1800);
    expect(contactDisplayBalance({ open_amount: 320 })).toBe(320);
    expect(contactDisplayBalance({ balance: 0 }, null, { overdue_amount: 90 })).toBe(90);
    expect(contactDisplayBalance(undefined, { open_amount: 50 })).toBe(50);
    expect(contactDisplayBalance(null, null)).toBe(0);
  });

  it("sums remaining sales invoices per contact", () => {
    expect(invoiceOpenByContact([
      { contact_id: "c1", invoice_type: "sales", status: "approved", grand_total: 1000, paid_amount: 200 },
      { contact_id: "c1", invoice_type: "sales", status: "draft", grand_total: 500, paid_amount: 0 },
      { contact_id: "c2", invoice_type: "purchase", status: "approved", grand_total: 800, paid_amount: 0 },
      { contact_id: "c3", invoice_type: "sales", status: "cancelled", grand_total: 100, paid_amount: 0 },
    ])).toEqual({ c1: 800 });
  });

  it("keeps non-zero summary figures", () => {
    const rows = contactSummaryRows({
      invoice_count: 2,
      draft_count: 0,
      order_count: 1,
      overdue_count: 0,
      total_invoiced: 100,
      total_paid: 0,
      open_amount: 100,
    });
    expect(rows.map((r) => r.key)).toEqual(["invoice_count", "order_count", "total_invoiced", "open_amount"]);
    expect(rows.find((r) => r.key === "open_amount")?.value).toBe(fmtMoney(100));
  });

  it("puts Düzenle behind Diğerleri and keeps four front tiles when there is no overflow", () => {
    const tiles = [{ key: "edit" }, { key: "statement" }, { key: "quote" }, { key: "order" }, { key: "survey" }];
    expect(contactCardVisibleActions(tiles, false)).toEqual({
      showMore: true,
      shown: [{ key: "statement" }, { key: "quote" }, { key: "order" }],
    });
    expect(contactCardVisibleActions(tiles, true).shown.map((t) => t.key)).toEqual([
      "statement", "quote", "order", "survey", "edit",
    ]);
    expect(contactCardVisibleActions([{ key: "statement" }, { key: "quote" }, { key: "order" }, { key: "survey" }], false)).toEqual({
      showMore: false,
      shown: [{ key: "statement" }, { key: "quote" }, { key: "order" }, { key: "survey" }],
    });
  });

  it("turns contact tabs into a dropdown with counts", () => {
    expect(contactTabSelectGroups(
      [{ key: "invoices", label: "Fatura" }, { key: "cheques", label: "Çek" }],
      { invoices: 1, cheques: 0 },
    )).toEqual([{
      label: "Kayıtlar",
      options: [
        { value: "invoices", label: "Fatura (1)" },
        { value: "cheques", label: "Çek" },
      ],
    }]);
  });
});
