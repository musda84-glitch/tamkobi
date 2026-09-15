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
  expect(invoiceTypeFilter("sales")({ invoice_type: "late_fee" })).toBe(true);
  expect(invoiceTypeFilter("purchase")({ invoice_type: "sales" })).toBe(false);
  expect(invoiceTypeFilter("purchase")({ invoice_type: "late_fee" })).toBe(false);
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

test("applyStockFilters b2b yes/no matches toggle semantics (undefined = open)", () => {
  const { applyStockFilters } = require("../components/StockToolbar");
  const open = { id: "1", name: "A", show_in_b2b: true, track_stock: true, stock_quantity: 1 };
  const closed = { id: "2", name: "B", show_in_b2b: false, track_stock: true, stock_quantity: 1 };
  const legacy = { id: "3", name: "C", track_stock: true, stock_quantity: 1 }; // undefined show_in_b2b
  const base = { status: "all", sort: "name_asc" };
  expect(applyStockFilters([open, closed, legacy], { ...base, b2b: "yes" }).map((p) => p.id)).toEqual(["1", "3"]);
  expect(applyStockFilters([open, closed, legacy], { ...base, b2b: "no" }).map((p) => p.id)).toEqual(["2"]);
  expect(applyStockFilters([open, closed, legacy], { ...base, b2b: "all" }).map((p) => p.id)).toEqual(["1", "2", "3"]);
});
