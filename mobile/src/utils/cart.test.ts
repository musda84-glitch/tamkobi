import { addOrBump, cartTotals, lineFromProduct } from "./cart";

describe("cart", () => {
  it("adds VAT on net sale price", () => {
    const line = lineFromProduct({ id: "p1", name: "Masa", sale_price: 100, vat_rate: 20 }, 2);
    expect(line.unit_price).toBe(100);
    expect(line.total).toBe(200);
    expect(line.vat_amount).toBe(40);
    expect(line.total_incl).toBe(240);
  });

  it("splits included VAT", () => {
    const line = lineFromProduct({ id: "p1", name: "Masa", sale_price: 120, vat_rate: 20, price_includes_vat: true }, 1);
    expect(line.unit_price).toBe(100);
    expect(line.total_incl).toBe(120);
  });

  it("bumps quantity for the same product", () => {
    const a = lineFromProduct({ id: "p1", name: "Masa", sale_price: 10, vat_rate: 0 }, 1);
    const cart = addOrBump(addOrBump([], a, 1), a, 2);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
    expect(cartTotals(cart).totalIncl).toBe(30);
  });
});
