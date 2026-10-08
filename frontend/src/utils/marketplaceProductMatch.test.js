import {
  fillMarketplaceMatchSuggestions,
  matchSuggestionLabel,
  normMatchCode,
  scoreMarketplaceProductMatch,
  suggestMarketplaceProductMatches,
  textSimilarity,
} from "./marketplaceProductMatch";

describe("marketplaceProductMatch", () => {
  it("normalizes codes and scores exact barcode/sku", () => {
    expect(normMatchCode("abc-12 34")).toBe("ABC1234");
    const row = { barcode: "8692577197348", title: "MDF Levha", stock_code: "MDF-01" };
    const product = { id: "p1", name: "MDF 18mm", barcode: "8692577197348", sku: "X" };
    expect(scoreMarketplaceProductMatch(row, product)).toBe(1);
  });

  it("ranks name similarity and returns top suggestions", () => {
    expect(textSimilarity("WAX 3,5X30 SUNTA VIDASI", "WAX 3.5x30 Sunta Vidası")).toBeGreaterThan(0.5);
    const row = { barcode: "b1", title: "İtalyan Oval Çekme Antik Sarı", stock_code: "" };
    const products = [
      { id: "a", name: "Vida paketi", sku: "V1", barcode: "9" },
      { id: "b", name: "İtalyan Oval Çekme Antik Sarı 128mm", sku: "CK-1", barcode: "8" },
      { id: "c", name: "MDF Levha", sku: "M1", barcode: "7" },
    ];
    const sug = suggestMarketplaceProductMatches(row, products, { limit: 2, minScore: 0.4 });
    expect(sug[0].product.id).toBe("b");
    expect(sug[0].score).toBeGreaterThanOrEqual(0.45);
  });

  it("fills bulk suggestions above confidence", () => {
    const rows = [
      { barcode: "bc1", title: "ADL10 Lükens Ayak", stock_code: "ADL.10" },
      { barcode: "bc2", title: "Bilinmeyen ürün xyz", stock_code: "" },
    ];
    const products = [
      { id: "p-adl", name: "ADL10 Lükens Ayak 8x8x75", sku: "ADL.10.8.75", barcode: "111" },
    ];
    const filled = fillMarketplaceMatchSuggestions(rows, products, { minScore: 0.45 });
    expect(filled.bc1).toBe("p-adl");
    expect(filled.bc2).toBeUndefined();
    expect(matchSuggestionLabel(0.96)).toMatch(/kesin/);
  });
});
