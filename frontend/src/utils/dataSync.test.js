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

test("critical stock uses default min 5 when alert is unset", () => {
  const { applyStockFilters, isCriticalStock } = require("../components/StockToolbar");
  const unset = { id: "1", name: "A", track_stock: true, stock_quantity: 3 };
  const explicitZero = { id: "2", name: "B", track_stock: true, stock_quantity: 3, min_stock_alert: 0 };
  const below = { id: "3", name: "C", track_stock: true, stock_quantity: 2, min_stock_alert: 5 };
  const base = { status: "critical", b2b: "all", sort: "name_asc" };
  expect(isCriticalStock(unset)).toBe(true);
  expect(isCriticalStock(explicitZero)).toBe(false);
  expect(applyStockFilters([unset, explicitZero, below], base).map((p) => p.id)).toEqual(["1", "3"]);
});

test("order filters incoming and dispatched groups", () => {
  const { applyOrderFilters } = require("../components/OrdersToolbar");
  const rows = [
    { order_number: "N1", order_status: "approved" },
    { order_number: "N2", order_status: "pending" },
    { order_number: "S1", order_status: "shipped" },
    { order_number: "S2", order_status: "completed", cargo_tracking_number: "YK1" },
    { order_number: "S3", order_status: "approved", cargo_tracking_number: "YK2" },
    { order_number: "X", order_status: "cancelled", cargo_tracking_number: "YK3" },
  ];
  const base = { q: "", channel: "all", invoiced: "all", cargo: "all", from: "", to: "", sort: "number" };
  expect(applyOrderFilters(rows, { ...base, status: "incoming" }).map((o) => o.order_number)).toEqual(["N2", "N1"]);
  expect(applyOrderFilters(rows, { ...base, status: "dispatched" }).map((o) => o.order_number).sort()).toEqual(["S1", "S2", "S3"]);
});
