import { lineGross, orderFooterTotals, orderGross } from "./orderMoney";

test("lineGross prefers total_incl and never treats net total as gross via price_includes_vat", () => {
  expect(lineGross({ total_incl: 120, total: 100, vat_rate: 20, price_includes_vat: true })).toBe(120);
  expect(lineGross({ total: 100, vat_amount: 20, vat_rate: 20, price_includes_vat: true })).toBe(120);
  expect(lineGross({ total: 100, vat_rate: 20, price_includes_vat: true })).toBe(120);
});

test("orderGross uses grand_total when present", () => {
  expect(orderGross({ grand_total: 240, items: [{ total: 100, vat_rate: 20 }] })).toBe(240);
});

test("orderFooterTotals falls back when stored subtotal+vat != grand", () => {
  const bad = orderFooterTotals(
    { subtotal: 100, vat_total: 20, grand_total: 100 },
    { subtotal: 100, vat: 20, grandTotal: 120 },
  );
  expect(bad).toEqual({ subtotal: 100, vat: 20, grandTotal: 120 });
  const ok = orderFooterTotals(
    { subtotal: 100, vat_total: 20, grand_total: 120 },
    { subtotal: 0, vat: 0, grandTotal: 0 },
  );
  expect(ok).toEqual({ subtotal: 100, vat: 20, grandTotal: 120 });
});
