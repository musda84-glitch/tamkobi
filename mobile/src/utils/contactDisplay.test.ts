import { balanceHint, contactInfoRows, contactSummaryRows, contactTypeLabel } from "./contactDisplay";
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
    expect(balanceHint(4460).label).toMatch(/Alacak/);
    expect(balanceHint(-10).tone).toBe("red");
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
});
