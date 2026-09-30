import {
  gibLookupToContactPatch,
  gibLookupSummary,
  gibMukellefLabel,
  isCompleteTaxId,
  digitsTaxId,
} from "./gibContactFill";

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

  it("always overwrites mükellefiyet from GİB even if name kept", () => {
    const patch = gibLookupToContactPatch(
      { tax_id: "12345678901", name: "GİB Unvan", is_e_invoice_user: true },
      { name: "Mevcut", company_title: "Mevcut Ünvan", is_e_invoice_user: false }
    );
    expect(patch.name).toBeUndefined();
    expect(patch.company_title).toBeUndefined();
    expect(patch.is_e_invoice_user).toBe(true);
    expect(patch.tax_number_or_id).toBe("12345678901");
  });

  it("returns empty for missing tax_id", () => {
    expect(gibLookupToContactPatch({})).toEqual({});
  });
});

describe("gibLookupSummary / labels", () => {
  it("labels e-fatura and simulated", () => {
    expect(gibLookupSummary({ tax_id: "1", is_e_invoice_user: true, source: "isnet", name: "A" })).toContain("E-Fatura");
    expect(gibLookupSummary({ tax_id: "1", is_e_invoice_user: false, source: "simulated" })).toContain("simüle");
  });

  it("mukellef label distinguishes e-fatura vs e-arsiv", () => {
    expect(gibMukellefLabel(true).title).toMatch(/E-Fatura/i);
    expect(gibMukellefLabel(false).title).toMatch(/E-Arşiv/i);
  });

  it("isCompleteTaxId accepts 10/11 digits only", () => {
    expect(isCompleteTaxId("1234567890")).toBe(true);
    expect(isCompleteTaxId("12345678901")).toBe(true);
    expect(isCompleteTaxId("123")).toBe(false);
    expect(digitsTaxId("12-34")).toBe("1234");
  });
});
