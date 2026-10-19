import { bankLogoKey, ibanBankCode, resolveBankBrand } from "./bankBrand";

describe("bankBrand", () => {
  it("reads the TR IBAN bank code", () => {
    expect(ibanBankCode("TR33 0006 2000 0000 0000 0000 01")).toBe("00062");
    expect(ibanBankCode("TR790015700000000998213361")).toBe("00157");
    expect(ibanBankCode("")).toBe("");
  });

  it("resolves Kuveyt, Enpara and Vakıf from name or IBAN", () => {
    expect(resolveBankBrand({ bank_name: "Kuveyt Türk" }).key).toBe("kuveyt");
    expect(resolveBankBrand({ bank_name: "Kuveyt Türk POS" }).initials).toBe("KT");
    expect(resolveBankBrand({ bank_name: "Enpara Şirketim API" }).key).toBe("enpara");
    expect(resolveBankBrand({ bank_name: "VakifBank" }).key).toBe("vakif");
    expect(resolveBankBrand({ iban: "TR00 0020 5000 0000 0000 0000 00" }).key).toBe("kuveyt");
    expect(resolveBankBrand({ bank_name: "Enpara", iban: "TR00 0011 1000 0000 0000 0000 00" }).key).toBe("enpara");
  });

  it("falls back to initials for unknown banks", () => {
    const brand = resolveBankBrand({ bank_name: "Matek Bankası" });
    expect(brand.key).toBe("other");
    expect(brand.initials).toBe("MB");
    expect(brand.logoUri).toBeUndefined();
  });

  const isbankIban = "TR33 0006 4000 0000 0000 0000 00";
  const company = { bank_logos: { "0064": "/api/files/is.png", "00064": "/api/files/wrong.png" } };
  const baseUrl = "https://api.test";

  it("uses the account logo, then the company bank logo, then no logo", () => {
    const override = resolveBankBrand(
      { iban: isbankIban, bank_name: "İş Bankası", logo_url: "/api/files/acc.jpg" },
      company,
      baseUrl,
    );
    expect(override.logoUri).toBe("https://api.test/api/files/acc.jpg");

    const shared = resolveBankBrand({ iban: isbankIban, bank_name: "İş Bankası" }, company, baseUrl);
    expect(shared.key).toBe("isbank");
    expect(shared.logoUri).toBe("https://api.test/api/files/is.png");

    const none = resolveBankBrand({ iban: isbankIban, bank_name: "İş Bankası", logo_url: null }, { bank_logos: {} }, baseUrl);
    expect(none.logoUri).toBeUndefined();
    expect(none.initials).toBe("İŞ");
  });

  it("omits logoUri when the bank code cannot be resolved", () => {
    expect(resolveBankBrand(
      { iban: "", bank_name: "İş Bankası" },
      company,
      baseUrl,
    ).logoUri).toBeUndefined();
    expect(resolveBankBrand(
      { iban: "TR79 0015 7000 0000 0998 2133 61" },
      company,
      baseUrl,
    ).logoUri).toBeUndefined();
    expect(resolveBankBrand({ bank_name: "Bilinmeyen Banka" }, company, baseUrl).logoUri).toBeUndefined();
  });

  it("maps IBAN code 00064 onto the 0064 bank_logos key", () => {
    expect(ibanBankCode(isbankIban)).toBe("00064");
    expect(bankLogoKey(isbankIban)).toBe("0064");
    const brand = resolveBankBrand({ iban: isbankIban }, company, `${baseUrl}/`);
    expect(brand.logoUri).toBe("https://api.test/api/files/is.png");
    expect(brand.logoUri).not.toContain("wrong.png");
  });

  it("skips svg sources and does not leak a logo onto the shared monogram", () => {
    const fromCompany = resolveBankBrand(
      { iban: isbankIban, logo_url: "/bank-logos/0064.svg" },
      company,
      baseUrl,
    );
    expect(fromCompany.logoUri).toBe("https://api.test/api/files/is.png");
    const svgOnly = resolveBankBrand(
      { iban: isbankIban, logo_url: "https://cdn.test/logo.svg" },
      { bank_logos: { "0064": "/bank-logos/0064.svg" } },
      baseUrl,
    );
    expect(svgOnly.logoUri).toBeUndefined();
    expect(resolveBankBrand({ bank_name: "İş Bankası" }).logoUri).toBeUndefined();
  });
});
