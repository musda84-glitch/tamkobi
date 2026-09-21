import { computeLine, documentLineTotals, emptyLine, hydrateLine, invoiceMoneyTotals, lineFromProduct } from "./documentLines";

test("computeLine fills dual unit prices and net/gross totals with discount", () => {
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

test("editing KDV'li unit price back-calculates net", () => {
  const row = computeLine({ ...emptyLine(), quantity: 1, vat_rate: 20, unit_price_incl: 120 }, "unit_price_incl");
  expect(row.unit_price).toBeCloseTo(100);
  expect(row.total).toBeCloseTo(100);
  expect(row.total_incl).toBeCloseTo(120);
});

test("selectable VAT percent recalculates gross from stored net", () => {
  const row = computeLine({ ...emptyLine(), quantity: 1, unit_price: 200, vat_rate: 10 }, "vat_rate");
  expect(row.unit_price_incl).toBeCloseTo(220);
  expect(row.total_incl).toBeCloseTo(220);
});

test("hydrateLine maps product_name and discount_percent", () => {
  const row = hydrateLine({ product_name: "Stok A", quantity: 1, unit_price: 50, discount_percent: 10, vat_rate: 20 });
  expect(row.name).toBe("Stok A");
  expect(row.product_name).toBe("Stok A");
  expect(row.discount_rate).toBe(10);
  expect(row.unit).toBe("Adet");
  expect(row.total).toBeCloseTo(45);
  expect(row.total_incl).toBeCloseTo(54);
});

test("lineFromProduct uses sale vs purchase price and product VAT", () => {
  const prod = { id: "p1", name: "Kart", sale_price: 100, purchase_price: 80, vat_rate: 10, sku: "SKU-1", unit: "Koli" };
  const sale = lineFromProduct(prod, { invoiceType: "sales", quantity: 2 });
  expect(sale.unit_price).toBe(100);
  expect(sale.unit).toBe("Koli");
  expect(sale.vat_rate).toBe(10);
  expect(sale.total_incl).toBeCloseTo(220);
  const buy = lineFromProduct(prod, { invoiceType: "purchase", quantity: 1 });
  expect(buy.unit_price).toBe(80);
});

test("documentLineTotals sums hariç, KDV and dahil", () => {
  const t = documentLineTotals([
    { name: "A", quantity: 2, unit_price: 100, vat_rate: 20, discount_rate: 10 },
    { name: "B", quantity: 1, unit_price: 50, vat_rate: 10, discount_rate: 0 },
  ]);
  expect(t.subtotal).toBeCloseTo(230);
  expect(t.vat).toBeCloseTo(41);
  expect(t.grandTotal).toBeCloseTo(271);
  expect(t.lineDiscount).toBeCloseTo(20);
});

test("lineFromProduct treats sale_price as gross when price_includes_vat", () => {
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

test("two KDV dahil 260 lines at 10% total 520.00 not 519.99", () => {
  const line = computeLine({ ...emptyLine(), quantity: 1, vat_rate: 10, unit_price_incl: 260 }, "unit_price_incl");
  expect(line.unit_price).toBeCloseTo(236.3636, 4);
  expect(line.total).toBe(236.36);
  expect(line.vat_amount).toBe(23.64);
  expect(line.total_incl).toBe(260);
  const t = invoiceMoneyTotals([line, { ...line, name: "B" }]);
  expect(t.subtotal).toBe(472.72);
  expect(t.vat).toBe(47.28);
  expect(t.grandTotal).toBe(520);
});

test("general discount still scales each line VAT to kuruş", () => {
  const t = invoiceMoneyTotals([
    { name: "A", quantity: 1, unit_price: 100, vat_rate: 20 },
    { name: "B", quantity: 1, unit_price: 100, vat_rate: 10 },
  ], { discountMode: "percent", generalDiscountRate: 10 });
  expect(t.subtotal).toBe(180);
  expect(t.vat).toBe(27);
  expect(t.grandTotal).toBe(207);
});

test("documentLineTotals grandTotal equals subtotal + vat (rounded)", () => {
  const t = documentLineTotals([
    { name: "X", quantity: 3, unit_price: 33.33, vat_rate: 20, discount_rate: 0 },
  ]);
  expect(t.grandTotal).toBeCloseTo(t.subtotal + t.vat, 2);
  expect(Math.abs(t.subtotal + t.vat - t.grandTotal)).toBeLessThan(0.005);
});

