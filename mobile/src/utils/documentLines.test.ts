import { addProductToItems, computeLine, documentLineTotals, emptyLine, hydrateLine, lineFromProduct } from "./documentLines";

describe("documentLines", () => {
  it("fills dual unit prices and net/gross totals with discount", () => {
    const row = computeLine({
      ...emptyLine(),
      name: "Hizmet",
      quantity: 2,
      unit_price: 100,
      vat_rate: 20,
      discount_rate: 10,
    });
    expect(row.unit_price).toBeCloseTo(100);
    expect(row.unit_price_incl).toBeCloseTo(120);
    expect(row.total).toBeCloseTo(180);
    expect(row.vat_amount).toBeCloseTo(36);
    expect(row.total_incl).toBeCloseTo(216);
  });

  it("back-calculates net from KDV'li unit price", () => {
    const row = computeLine({ ...emptyLine(), quantity: 1, vat_rate: 20, unit_price_incl: 120 }, "unit_price_incl");
    expect(row.unit_price).toBeCloseTo(100);
    expect(row.total).toBeCloseTo(100);
    expect(row.total_incl).toBeCloseTo(120);
  });

  it("recalculates gross when VAT changes", () => {
    const row = computeLine({ ...emptyLine(), quantity: 1, unit_price: 200, vat_rate: 10 }, "vat_rate");
    expect(row.unit_price_incl).toBeCloseTo(220);
    expect(row.total_incl).toBeCloseTo(220);
  });

  it("hydrateLine maps product_name and discount_percent", () => {
    const row = hydrateLine({ product_name: "Stok A", quantity: 1, unit_price: 50, discount_percent: 10, vat_rate: 20 });
    expect(row.name).toBe("Stok A");
    expect(row.product_name).toBe("Stok A");
    expect(row.discount_rate).toBe(10);
    expect(row.total).toBeCloseTo(45);
    expect(row.total_incl).toBeCloseTo(54);
  });

  it("lineFromProduct uses sale vs purchase price", () => {
    const prod = { id: "p1", name: "Kart", sale_price: 100, purchase_price: 80, vat_rate: 10, sku: "SKU-1" };
    const sale = lineFromProduct(prod, { invoiceType: "sales", quantity: 2 });
    expect(sale.unit_price).toBe(100);
    expect(sale.vat_rate).toBe(10);
    expect(sale.total_incl).toBeCloseTo(220);
    const buy = lineFromProduct(prod, { invoiceType: "purchase", quantity: 1 });
    expect(buy.unit_price).toBe(80);
  });

  it("documentLineTotals sums hariç, KDV and dahil", () => {
    const t = documentLineTotals([
      { name: "A", quantity: 2, unit_price: 100, vat_rate: 20, discount_rate: 10 },
      { name: "B", quantity: 1, unit_price: 50, vat_rate: 10, discount_rate: 0 },
    ]);
    expect(t.subtotal).toBeCloseTo(230);
    expect(t.vat).toBeCloseTo(41);
    expect(t.grandTotal).toBeCloseTo(271);
    expect(t.lineDiscount).toBeCloseTo(20);
  });

  it("treats sale_price as gross when price_includes_vat", () => {
    const prod = { id: "p2", name: "Brüt", sale_price: 120, purchase_price: 80, vat_rate: 20, price_includes_vat: true };
    const sale = lineFromProduct(prod, { invoiceType: "sales", quantity: 2 });
    expect(sale.unit_price).toBeCloseTo(100);
    expect(sale.unit_price_incl).toBeCloseTo(120);
    expect(sale.total).toBeCloseTo(200);
    expect(sale.vat_amount).toBeCloseTo(40);
    expect(sale.total_incl).toBeCloseTo(240);
    const buy = lineFromProduct(prod, { invoiceType: "purchase", quantity: 1 });
    expect(buy.unit_price).toBe(80);
  });

  it("adds a product onto an empty line or bumps quantity", () => {
    const prod = { id: "p1", name: "Masa", sale_price: 100, vat_rate: 20 };
    const first = addProductToItems([emptyLine()], prod, "sales");
    expect(first).toHaveLength(1);
    expect(first[0].product_id).toBe("p1");
    expect(first[0].quantity).toBe(1);
    const bumped = addProductToItems(first, prod, "sales");
    expect(bumped).toHaveLength(1);
    expect(bumped[0].quantity).toBe(2);
  });
});
