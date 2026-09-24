import { addOrBump, cartTotals, findProductByScan, lineFromProduct, parseScanQty, removeCartLine } from "./cart";

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

  it("parses the scan multiplier and matches barcode or SKU", () => {
    expect(parseScanQty("4")).toBe(4);
    expect(parseScanQty("")).toBe(1);
    const rows = [{ id: "1", sku: "MS-1", barcode: "869" }, { id: "2", sku: "X", barcode: "111", variants: [{ barcode: "222" }] }];
    expect(findProductByScan(rows, "869")?.id).toBe("1");
    expect(findProductByScan(rows, "222")?.id).toBe("2");
    expect(findProductByScan(rows, "000")).toBeUndefined();
  });

  it("bumps quantity for the same product", () => {
    const a = lineFromProduct({ id: "p1", name: "Masa", sale_price: 10, vat_rate: 0 }, 1);
    const cart = addOrBump(addOrBump([], a, 1), a, 2);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
    expect(cartTotals(cart).totalIncl).toBe(30);
  });

  it("removes a cart line by index", () => {
    const a = lineFromProduct({ id: "p1", name: "Masa", sale_price: 10, vat_rate: 0 }, 1);
    const b = lineFromProduct({ id: "p2", name: "Sandalye", sale_price: 20, vat_rate: 0 }, 1);
    expect(removeCartLine([a, b], 0)).toEqual([b]);
    expect(removeCartLine([a], 0)).toEqual([]);
  });
});
