import {
  applyRecipeQuery,
  filterCounts,
  formatMarginPct,
  groupByFinishedProduct,
  marginLabel,
  marginPct,
  materialStockState,
  producibleQty,
  stockStatusLabel,
} from "./recipeViewModel";

const products = [
  { id: "p-raf", name: "Duvar Rafı", sale_price: 297, stock_quantity: 4 },
  { id: "p-mdf", name: "Beyaz MDF", stock_quantity: 3, min_stock_alert: 5 },
  { id: "p-cam", name: "Cam", stock_quantity: 120 },
  { id: "p-yok", name: "Eksik levha", stock_quantity: -24 },
];

function recipe(partial) {
  return {
    id: "r1",
    code: "BOM-1",
    name: "Raf",
    finished_product_id: "p-raf",
    finished_product_name: "Duvar Rafı",
    target_quantity: 1,
    unit: "Adet",
    is_active: true,
    one_time: false,
    unit_cost: 64.81,
    materials: [],
    steps: [],
    ...partial,
  };
}

test("filtre çipi sayıları arşivi Tümü dışına alır", () => {
  const rows = [
    recipe({ id: "a", one_time: false }),
    recipe({ id: "b", one_time: false, materials: [{ product_id: "p-yok", quantity: 1, stock_quantity: -24, missing_qty: 24 }] }),
    recipe({ id: "c", one_time: true, name: "Sipariş", contact_name: "Ferhat" }),
    recipe({ id: "d", is_active: false, name: "Eski" }),
  ];
  expect(filterCounts(rows, products)).toEqual({
    all: 3,
    standard: 2,
    one_time: 1,
    missing: 1,
    archive: 1,
  });
});

test("arama reçete, ürün, BOM kodu ve müşteri alanlarında çalışır", () => {
  const rows = [
    recipe({ id: "a", name: "DRY2C", code: "BOM-314", finished_product_name: "İkiz Raf" }),
    recipe({ id: "b", name: "Dolap", code: "BOM-232", contact_name: "Ferhat 10.bölge", one_time: true, finished_product_name: "MDF Dolap" }),
  ];
  expect(applyRecipeQuery(rows, { query: "bom-232", products }).map((r) => r.id)).toEqual(["b"]);
  expect(applyRecipeQuery(rows, { query: "ikiz", products }).map((r) => r.id)).toEqual(["a"]);
  expect(applyRecipeQuery(rows, { query: "ferhat", products }).map((r) => r.id)).toEqual(["b"]);
  expect(applyRecipeQuery(rows, { query: "dry2c", products }).map((r) => r.id)).toEqual(["a"]);
  expect(applyRecipeQuery(rows, { filter: "one_time", products }).map((r) => r.id)).toEqual(["b"]);
  expect(applyRecipeQuery(rows, { filter: "archive", products })).toEqual([]);
});

test("stok durumu: eksi stok kırmızı ve N eksik, yeterli yeşil, az amber", () => {
  const none = materialStockState({ quantity: 1, stock_quantity: -24, missing_qty: 24 }, null);
  expect(none.status).toBe("none");
  expect(stockStatusLabel(none)).toBe("24 eksik");
  expect(stockStatusLabel(none)).not.toMatch(/stok\s*-/);

  const computed = materialStockState({ quantity: 1, stock_quantity: -24 }, null);
  expect(computed.status).toBe("none");
  expect(stockStatusLabel(computed)).toBe("25 eksik");

  const remain = materialStockState({ quantity: 0.5, product_id: "p-mdf" }, products[1]);
  expect(remain.status).toBe("low");
  expect(remain.lowRemaining).toBe(true);
  expect(stockStatusLabel(remain)).toBe("az · 3 kaldı");

  const ok = materialStockState({ quantity: 1, product_id: "p-cam" }, products[2]);
  expect(ok.status).toBe("ok");
  expect(stockStatusLabel(ok)).toBe("yeterli · 120");

  const partial = materialStockState({ quantity: 10, stock_quantity: 4 }, null);
  expect(partial.status).toBe("low");
  expect(stockStatusLabel(partial)).toBe("6 eksik");
});

test("üretilebilir adet stok ve fire ile hesaplanır", () => {
  const row = recipe({
    target_quantity: 10,
    materials: [
      { product_id: "m1", quantity: 2, wastage_percent: 0, stock_quantity: 7 },
      { product_id: "m2", quantity: 1, wastage_percent: 10, stock_quantity: 20 },
    ],
  });
  // 2 / 10 birim → 7 stok = 35 adet; 1.1 / 10 → 20 stok = 181 adet; sınır 35
  expect(producibleQty(row, [])).toBe(35);

  const blocked = recipe({
    materials: [{ quantity: 1, stock_quantity: -24, missing_qty: 24 }],
  });
  expect(producibleQty(blocked, [])).toBe(0);

  const unknown = recipe({ materials: [{ quantity: 1, product_name: "Belirsiz" }] });
  expect(producibleQty(unknown, [])).toBeNull();
});

test("marj satış fiyatından; satış yoksa fiyat yok", () => {
  const priced = recipe({ unit_cost: 64.81, finished_product_id: "p-raf" });
  expect(Math.round(marginPct(priced, products))).toBe(78);
  expect(formatMarginPct(marginPct(priced, products))).toBe("%78");
  expect(marginLabel(priced, products)).toBe("%78");

  const noPrice = recipe({ finished_product_id: "yok", sale_price: 0, unit_cost: 200 });
  expect(marginPct(noPrice, [])).toBeNull();
  expect(marginLabel(noPrice, [])).toBe("fiyat yok");

  const negative = recipe({ unit_cost: 150, sale_price: 100 });
  expect(marginLabel(negative, [])).toBe("-%50");
});

test("aynı bitmiş ürün tek grupta toplanır", () => {
  const rows = [
    recipe({ id: "v2", name: "WD-14", code: "BOM-239726", finished_product_id: "wd", finished_product_name: "WD_Serisi", version: 2 }),
    recipe({ id: "tek", name: "DRY", code: "BOM-1", finished_product_id: "dry", finished_product_name: "DRY" }),
    recipe({ id: "v1", name: "WD-12", code: "BOM-253544", finished_product_id: "wd", finished_product_name: "WD_Serisi", version: 1 }),
  ];
  const groups = groupByFinishedProduct(rows);
  expect(groups.map((g) => g.key)).toEqual(["wd", "dry"]);
  expect(groups[0].items.map((r) => r.code)).toEqual(["BOM-239726", "BOM-253544"]);
  expect(groups[1].items).toHaveLength(1);
});
