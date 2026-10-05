import {
  b2bOrderGross,
  b2bEditLineFromItem,
  b2bEditUnitGross,
  b2bEditLineGross,
  b2bEditLinesGrossTotal,
  b2bEditLinesQtyTotal,
} from "./B2BPortalParts";

describe("b2bOrderGross", () => {
  it("uses grand_total (KDV dahil) instead of net total_amount", () => {
    expect(b2bOrderGross({ total_amount: 78124.99, grand_total: 93750 })).toBe(93750);
  });
});

describe("b2bEditLine KDV dahil + görsel", () => {
  const products = [{
    id: "p1",
    name: "Duvar Rafı",
    sku: "DRC",
    price: 227.27,
    price_gross: 272.72,
    vat_rate: 20,
    image_url: "/api/files/raf.webp",
  }];

  it("pulls image and computes KDV dahil unit from order net + vat", () => {
    const line = b2bEditLineFromItem({
      product_id: "p1",
      product_name: "Duvar Rafı Çizgili DRC 70x20cm - Beyaz",
      sku: "DRC",
      quantity: 2,
      unit_price: 227.27,
      vat_rate: 20,
    }, products);
    expect(line.image_url).toBe("/api/files/raf.webp");
    expect(b2bEditUnitGross(line)).toBeCloseTo(272.72, 1);
    expect(b2bEditLineGross(line)).toBeCloseTo(545.45, 1);
  });

  it("uses catalog price_gross when adding without order unit", () => {
    const line = b2bEditLineFromItem({
      product_id: "p1",
      product_name: "Duvar Rafı",
      sku: "DRC",
      quantity: 1,
      unit_price: products[0].price,
      vat_rate: 20,
      unit_price_incl: products[0].price_gross,
      image_url: products[0].image_url,
    }, products);
    expect(b2bEditUnitGross(line)).toBe(272.72);
  });

  it("totals kalem count and KDV dahil grand", () => {
    const lines = [
      b2bEditLineFromItem({ product_id: "p1", quantity: 2, unit_price: 100, vat_rate: 20 }, products),
      b2bEditLineFromItem({ product_id: "p1", quantity: 3, unit_price: 50, vat_rate: 20, note: "özel" }, products),
    ];
    expect(b2bEditLinesQtyTotal(lines)).toBe(5);
    expect(b2bEditLinesGrossTotal(lines)).toBeCloseTo(2 * 120 + 3 * 60, 1);
  });
});
