import { gibLookupToContactPatch, gibLookupSummary } from "./gibContactFill";

describe("gibLookupToContactPatch", () => {
  it("fills tax, e-fatura flag and empty name fields", () => {
    const patch = gibLookupToContactPatch({
      tax_id: "1234567890",
      name: "Örnek A.Ş.",
      is_e_invoice_user: true,
      alias: "urn:mail:pk@x.com",
    });
    expect(patch).toEqual({
      tax_number_or_id: "1234567890",
      is_e_invoice_user: true,
      e_invoice_alias: "urn:mail:pk@x.com",
      name: "Örnek A.Ş.",
      company_title: "Örnek A.Ş.",
    });
  });

  it("does not overwrite existing name or title", () => {
    const patch = gibLookupToContactPatch(
      { tax_id: "12345678901", name: "GİB Unvan", is_e_invoice_user: false },
      { name: "Mevcut", company_title: "Mevcut Ünvan" }
    );
    expect(patch.name).toBeUndefined();
    expect(patch.company_title).toBeUndefined();
    expect(patch.tax_number_or_id).toBe("12345678901");
    expect(patch.is_e_invoice_user).toBe(false);
  });

  it("returns empty for missing tax_id", () => {
    expect(gibLookupToContactPatch({})).toEqual({});
  });
});

describe("gibLookupSummary", () => {
  it("labels e-fatura and simulated", () => {
    expect(gibLookupSummary({ tax_id: "1", is_e_invoice_user: true, source: "isnet", name: "A" })).toContain("E-Fatura");
    expect(gibLookupSummary({ tax_id: "1", is_e_invoice_user: false, source: "simulated" })).toContain("simüle");
  });
});
