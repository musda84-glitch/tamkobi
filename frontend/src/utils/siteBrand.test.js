import { siteBrand } from "./siteBrand";

describe("siteBrand", () => {
  it("strips a trailing .com so the header never shows brand.com.com", () => {
    expect(siteBrand("tamkobi.com")).toBe("TamKobi");
    expect(siteBrand("TamKobi.com")).toBe("TamKobi");
    expect(siteBrand("TAMKOBI.COM")).toBe("TamKobi");
  });

  it("keeps custom brand names without appending .com", () => {
    expect(siteBrand("Acme ERP")).toBe("Acme ERP");
    expect(siteBrand("acme.com")).toBe("acme");
  });

  it("defaults to TamKobi", () => {
    expect(siteBrand("")).toBe("TamKobi");
    expect(siteBrand(null)).toBe("TamKobi");
  });
});
