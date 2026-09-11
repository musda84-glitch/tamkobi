
import { parseModuleKeys, serializeModuleKeys, packQuote } from "./modulePack";

test("parse and serialize module keys for /kayit?modules=", () => {
  expect(parseModuleKeys("invoices,stock,contacts")).toEqual(["/invoices", "/stock", "/contacts"]);
  expect(parseModuleKeys("/invoices,/stock")).toEqual(["/invoices", "/stock"]);
  expect(serializeModuleKeys(["/invoices", "/stock"])).toBe("invoices,stock");
});

test("packQuote sums monthly prices of picked non-core modules", () => {
  const catalog = [
    { key: "/", is_core: true, price_monthly: 0 },
    { key: "/invoices", price_monthly: 249 },
    { key: "/stock", price_monthly: 129 },
    { key: "/ecommerce", price_monthly: 249 },
  ];
  expect(packQuote(catalog, ["/invoices", "/stock"], false)).toBe(378);
  expect(packQuote(catalog, ["/invoices", "/stock"], true)).toBe(3780);
  expect(packQuote(catalog, ["/ecommerce"], false)).toBe(249);
});
