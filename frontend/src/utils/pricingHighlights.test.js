import { billableCatalog, highlightModules } from "./pricingHighlights";

const catalog = [
  { key: "/dashboard", label: "Panel", is_core: true },
  { key: "/invoices", label: "Faturalar", is_core: false },
  { key: "/contacts", label: "Cari", is_core: false },
  { key: "/stock", label: "Stok", is_core: false },
  { key: "/banking", label: "Banka", is_core: false },
  { key: "/ecommerce", label: "E-ticaret", is_core: false },
  { key: "/production", label: "Üretim", is_core: false },
  { key: "/personnel", label: "Personel", is_core: false },
  { key: "/reports", label: "Raporlar", is_core: false },
];

test("highlightModules returns at most limit included modules", () => {
  const mods = catalog.filter((m) => !m.is_core).map((m) => m.key);
  const h = highlightModules(mods, catalog, 6);
  expect(h).toHaveLength(6);
  expect(h[0].key).toBe("/invoices");
  expect(h.every((m) => mods.includes(m.key))).toBe(true);
});

test("billableCatalog excludes core", () => {
  expect(billableCatalog(catalog).every((m) => !m.is_core)).toBe(true);
});
