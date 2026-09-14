import { invoiceTypeFilter, mergeDelta, productFilter } from "./dataSync";

test("invoiceTypeFilter all hides dispatch", () => {
  expect(invoiceTypeFilter("all")({ invoice_type: "sales" })).toBe(true);
  expect(invoiceTypeFilter("all")({ invoice_type: "dispatch" })).toBe(false);
});

test("invoiceTypeFilter export/import uses trade_kind", () => {
  expect(invoiceTypeFilter("export")({ trade_kind: "export", invoice_type: "sales" })).toBe(true);
  expect(invoiceTypeFilter("export")({ trade_kind: "export", invoice_type: "dispatch" })).toBe(false);
  expect(invoiceTypeFilter("import")({ trade_kind: "import", invoice_type: "purchase" })).toBe(true);
  expect(invoiceTypeFilter("import")({ trade_kind: "export", invoice_type: "sales" })).toBe(false);
});

test("invoiceTypeFilter matches invoice_type", () => {
  expect(invoiceTypeFilter("sales")({ invoice_type: "sales" })).toBe(true);
  expect(invoiceTypeFilter("purchase")({ invoice_type: "sales" })).toBe(false);
  expect(invoiceTypeFilter("dispatch")({ invoice_type: "dispatch" })).toBe(true);
});

test("mergeDelta patches product flags by id", () => {
  const items = { a: { id: "a", show_in_b2b: true, track_stock: true } };
  const next = mergeDelta(items, [{ id: "a", show_in_b2b: false, track_stock: false }], [], false);
  expect(next.a.show_in_b2b).toBe(false);
  expect(next.a.track_stock).toBe(false);
});

test("productFilter b2bOnly respects show_in_b2b", () => {
  const f = productFilter({ b2bOnly: true });
  expect(f({ show_in_b2b: true, is_active: true, type: "product", sale_price: 10 })).toBe(true);
  expect(f({ show_in_b2b: false, is_active: true, type: "product", sale_price: 10 })).toBe(false);
});
