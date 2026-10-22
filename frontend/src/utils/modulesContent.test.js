import { existsSync } from "fs";
import { join } from "path";
import { MODULES, PRODUCTS, filterModules, normalizeCategory, screenshotSrc } from "./modulesContent";

const SHOT_DIR = join(__dirname, "../../public/brand/screenshots");

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
  expect(MODULES.map((m) => m.slug)).toEqual([
    "e-fatura", "banka", "cek-senet", "kasa-pos", "cari", "teklif-siparis", "b2b-portal",
    "stok", "kargo", "personel", "atolye-is-emirleri", "projeler", "pazaryerleri", "whatsapp-eposta", "ai-asistan",
  ]);
  expect(PRODUCTS.map((p) => p.slug)).toEqual(["web-paneli", "mobil", "b2b", "ik", "atolye"]);
  for (const row of [...MODULES, ...PRODUCTS]) {
    expect(row.points).toHaveLength(4);
    expect(screenshotSrc(row.slug)).toBe(`/brand/screenshots/${row.slug}.png`);
    expect(existsSync(join(SHOT_DIR, `${row.slug}.png`))).toBe(true);
    expect(row.width).toBeGreaterThan(0);
    expect(row.height).toBeGreaterThan(0);
  }
  expect(PRODUCTS.find((p) => p.slug === "mobil")).toMatchObject({ width: 390, height: 844 });
  expect(MODULES[0]).toMatchObject({ width: 1440, height: 900 });
});

test("category filter keeps only the matching cards", () => {
  expect(normalizeCategory("")).toBe("tumu");
  expect(normalizeCategory("Satış")).toBe("satis");
  expect(filterModules("tumu")).toHaveLength(15);
  expect(filterModules("stok").map((m) => m.slug)).toEqual(["stok", "kargo"]);
  expect(filterModules("Finans").every((m) => m.category === "finans")).toBe(true);
  expect(filterModules("olmayan")).toHaveLength(15);
});
