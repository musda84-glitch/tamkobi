import { marketplacePriceIncludesVat, withMarketplaceVatFlag } from "./marketplaceVat";
import { hydrateLine, documentLineTotals } from "./documentLines";

describe("marketplaceVat", () => {
  it("flags ShopPHP / Trendyol as VAT-inclusive channels", () => {
    expect(marketplacePriceIncludesVat("shopphp")).toBe(true);
    expect(marketplacePriceIncludesVat("trendyol")).toBe(true);
    expect(marketplacePriceIncludesVat("b2b")).toBe(false);
    expect(marketplacePriceIncludesVat("manual")).toBe(false);
  });

  it("adds price_includes_vat for legacy ShopPHP lines without unit_price_incl", () => {
    const flagged = withMarketplaceVatFlag(
      { product_name: "X", quantity: 1, unit_price: 11999, vat_rate: 20 },
      "shopphp",
    );
    expect(flagged.price_includes_vat).toBe(true);
    const line = hydrateLine(flagged);
    expect(line.unit_price_incl).toBeCloseTo(11999);
    expect(line.unit_price).toBeCloseTo(9999.1667, 3);
    expect(line.total_incl).toBeCloseTo(11999);
  });

  it("documentLineTotals for ShopPHP sample matches ODEME_TOPLAM", () => {
    const items = [
      { product_name: "A", quantity: 1, unit_price: 11999, vat_rate: 20 },
      { product_name: "B", quantity: 1, unit_price: 549.9, vat_rate: 20 },
    ].map((it) => withMarketplaceVatFlag(it, "shopphp"));
    const t = documentLineTotals(items);
    expect(t.grandTotal).toBeCloseTo(12548.9, 1);
    expect(t.subtotal).toBeCloseTo(10457.42, 1);
  });
});
