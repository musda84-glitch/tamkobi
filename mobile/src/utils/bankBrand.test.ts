import { ibanBankCode, resolveBankBrand } from "./bankBrand";

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
  });
});
