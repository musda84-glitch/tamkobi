import { b2bGross, b2bNet, b2bOrderGross } from "./b2bPricing";

describe("b2bPricing", () => {
  it("uses price_gross when present", () => {
    expect(b2bGross({ price: 100, vat_rate: 20, price_gross: 118 })).toBe(118);
  });

  it("adds VAT when price is net", () => {
    expect(b2bGross({ price: 100, vat_rate: 20, price_includes_vat: false })).toBe(120);
  });

  it("keeps included VAT as-is", () => {
    expect(b2bGross({ price: 120, vat_rate: 20, price_includes_vat: true })).toBe(120);
  });

  it("derives net from included price", () => {
    expect(b2bNet({ price: 120, vat_rate: 20, price_includes_vat: true })).toBe(100);
  });

  it("prefers order grand_total", () => {
    expect(b2bOrderGross({ grand_total: 250, total_amount: 100, items: [] })).toBe(250);
  });

  it("sums item totals with VAT", () => {
    expect(
      b2bOrderGross({
        items: [
          { total: 100, vat_rate: 20, quantity: 1 },
          { total_incl: 50, quantity: 1 },
        ],
      })
    ).toBe(170);
  });
});
