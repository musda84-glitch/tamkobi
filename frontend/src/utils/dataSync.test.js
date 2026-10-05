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

test("invoiceTypeFilter incoming and outgoing_gib", () => {
  expect(invoiceTypeFilter("incoming")({ invoice_type: "purchase", direction: "incoming" })).toBe(true);
  expect(invoiceTypeFilter("incoming")({ invoice_type: "purchase", edoc_id: "x" })).toBe(true);
  expect(invoiceTypeFilter("incoming")({ invoice_type: "purchase", e_type: "e_invoice" })).toBe(true);
  expect(invoiceTypeFilter("incoming")({ invoice_type: "sales", e_type: "e_invoice" })).toBe(false);
  expect(invoiceTypeFilter("outgoing_gib")({ invoice_type: "sales", e_type: "e_invoice" })).toBe(true);
  expect(invoiceTypeFilter("outgoing_gib")({ invoice_type: "purchase", direction: "incoming", e_type: "e_invoice" })).toBe(false);
  expect(invoiceTypeFilter("outgoing_gib")({ invoice_type: "dispatch", e_type: "e_dispatch" })).toBe(false);
});

test("sales and purchase tabs hide GIB sent/received invoices", () => {
  expect(invoiceTypeFilter("sales")({ invoice_type: "sales", e_type: "paper" })).toBe(true);
  expect(invoiceTypeFilter("sales")({ invoice_type: "sales" })).toBe(true);
  expect(invoiceTypeFilter("sales")({ invoice_type: "sales", e_type: "e_invoice" })).toBe(false);
  expect(invoiceTypeFilter("sales")({ invoice_type: "sales", e_type: "e_archive", einvoice_state: "sent" })).toBe(false);
  expect(invoiceTypeFilter("sales")({ invoice_type: "sales", e_type: "paper", gib_uuid: "u1" })).toBe(false);
  expect(invoiceTypeFilter("purchase")({ invoice_type: "purchase", e_type: "paper" })).toBe(true);
  expect(invoiceTypeFilter("purchase")({ invoice_type: "purchase", direction: "incoming" })).toBe(false);
  expect(invoiceTypeFilter("purchase")({ invoice_type: "purchase", source: "edoc_inbox" })).toBe(false);
  expect(invoiceTypeFilter("purchase")({ invoice_type: "purchase", edoc_id: "x" })).toBe(false);
  expect(invoiceTypeFilter("purchase")({ invoice_type: "purchase", gib_uuid: "u1" })).toBe(false);
  expect(invoiceTypeFilter("purchase")({ invoice_type: "purchase", e_type: "e_invoice" })).toBe(false);
  expect(invoiceTypeFilter("purchase")({ invoice_type: "purchase", gib_status: "Gelen e-Fatura" })).toBe(false);
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
  const { applyOrderFilters } = require("./orderFilters");
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

test("cancelled and returned stay out of all/incoming order lists", () => {
  const { applyOrderFilters, ORDER_FILTER_DEFAULTS } = require("./orderFilters");
  const rows = [
    { order_number: "B2B-2026-0016", order_status: "cancelled", channel: "b2b" },
    { order_number: "B2B-OK", order_status: "pending", channel: "b2b" },
    { order_number: "RET-1", order_status: "returned", channel: "trendyol" },
    { order_number: "PART-1", order_status: "partially_returned", channel: "hepsiburada" },
    { order_number: "SHIP-1", order_status: "shipped", channel: "b2b" },
  ];
  const base = { ...ORDER_FILTER_DEFAULTS, sort: "number" };
  expect(applyOrderFilters(rows, { ...base, status: "all" }).map((o) => o.order_number).sort()).toEqual(["B2B-OK", "SHIP-1"]);
  expect(applyOrderFilters(rows, { ...base, status: "incoming" }).map((o) => o.order_number)).toEqual(["B2B-OK"]);
  expect(applyOrderFilters(rows, { ...base, status: "cancelled" }).map((o) => o.order_number)).toEqual(["B2B-2026-0016"]);
  expect(applyOrderFilters(rows, { ...base, status: "returned" }).map((o) => o.order_number)).toEqual(["RET-1"]);
});
