import { MODULES, PRODUCTS, filterModules, normalizeCategory, screenshotSrc } from "./modulesContent";

test("catalog has the fifteen modules and five products from the mockup", () => {
  expect(MODULES).toHaveLength(15);
  expect(PRODUCTS).toHaveLength(5);
  expect(PRODUCTS[0].domain).toBe("app.tamkobi.com");
  expect(PRODUCTS.map((p) => p.title)).toEqual([
    "Web Paneli",
    "Mobil Uygulama",
    "B2B Bayi Portalı",
    "İK & Personel Portalı",
    "Atölye & Üretim Ekranı",
  ]);
  for (const row of [...MODULES, ...PRODUCTS]) {
    expect(row.points).toHaveLength(4);
    expect(screenshotSrc(row.slug)).toBe(`/brand/screenshots/${row.slug}.png`);
  }
});

test("category filter keeps only the matching cards", () => {
  expect(normalizeCategory("")).toBe("tumu");
  expect(normalizeCategory("Satış")).toBe("satis");
  expect(filterModules("tumu")).toHaveLength(15);
  expect(filterModules("stok").map((m) => m.slug)).toEqual(["stok-barkod", "kargo"]);
  expect(filterModules("Finans").every((m) => m.category === "finans")).toBe(true);
  expect(filterModules("olmayan")).toHaveLength(15);
});
