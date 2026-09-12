import { invoiceTypeFilter } from "./dataSync";

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
