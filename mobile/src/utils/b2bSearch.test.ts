import { matchesB2BQuery } from "./b2bSearch";

describe("matchesB2BQuery", () => {
  const product = { name: "KLM-86 Kiler", sku: "KLM-86_SM", barcode: "8690001", tags: ["kiler", "beyaz"] };

  it("matches empty query", () => {
    expect(matchesB2BQuery(product, "")).toBe(true);
  });

  it("matches name sku barcode and tags", () => {
    expect(matchesB2BQuery(product, "kiler")).toBe(true);
    expect(matchesB2BQuery(product, "KLM-86_SM")).toBe(true);
    expect(matchesB2BQuery(product, "8690001")).toBe(true);
    expect(matchesB2BQuery(product, "beyaz")).toBe(true);
  });

  it("rejects misses", () => {
    expect(matchesB2BQuery(product, "raf")).toBe(false);
  });
});
