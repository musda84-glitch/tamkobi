import { asList, filterProducts, lastPurchaseLabel, listSafeThumb, productCategoryGroups, productGalleryUrls, productImage, productPickSubtitle, productSkuLabel, slimListProducts, stockBadge, stockBarcodeLabel, stockQtyLabel, stockRightLabel, stockRowSubtitle } from "./productDisplay";

describe("productDisplay", () => {
  it("prefers thumbnail, then main image, then gallery", () => {
    expect(productImage({ thumbnail_url: "t.jpg", image_url: "m.jpg", images: ["g.jpg"] })).toBe("t.jpg");
    expect(productImage({ image_url: "m.jpg", images: ["g.jpg"] })).toBe("m.jpg");
    expect(productImage({ images: ["", "g.jpg"] })).toBe("g.jpg");
    expect(productImage({ images: [{ url: "/api/files/x.jpg" }] as unknown as string[] })).toBe("/api/files/x.jpg");
    expect(productImage({ images: [{ image_url: "g.jpg" }] as unknown as string[] })).toBe("g.jpg");
    expect(productImage({ image: "cover.jpg" })).toBe("cover.jpg");
    expect(productImage({})).toBe("");
  });

  it("lists gallery urls then cover", () => {
    expect(productGalleryUrls({ images: ["a.jpg", "", "b.jpg", "a.jpg"], image_url: "cover.jpg" })).toEqual(["a.jpg", "b.jpg"]);
    expect(productGalleryUrls({ image_url: "cover.jpg" })).toEqual(["cover.jpg"]);
    expect(productGalleryUrls({})).toEqual([]);
  });

  it("flags negative stock and min-level warnings", () => {
    expect(stockBadge({ stock_quantity: -467, unit: "Adet" })).toEqual({ label: "-467 Adet", tone: "danger" });
    expect(stockBadge({ stock_quantity: 3, unit: "Adet", min_stock_alert: 5 })?.tone).toBe("warning");
    expect(stockBadge({ stock_quantity: 40, unit: "Adet", min_stock_alert: 5 })?.tone).toBe("muted");
  });

  it("still shows quantity when stock is not tracked", () => {
    expect(stockBadge({ stock_quantity: 5, track_stock: false })?.label).toBe("5 Adet");
    expect(stockBadge({ stock_quantity: 5, type: "service" })?.label).toBe("5 Adet");
    expect(stockRightLabel({ stock_quantity: 18, track_stock: false })).toBe("Stok 18 Adet");
    expect(stockQtyLabel({ type: "service", stock_quantity: 3 })).toBe("3 Adet");
  });

  it("always surfaces quantity on list rows", () => {
    expect(stockQtyLabel({})).toBe("0 Adet");
    expect(stockQtyLabel({ stock_quantity: 12, unit: "Koli" })).toBe("12 Koli");
    expect(stockQtyLabel({ stock_quantity: -467 })).toBe("-467 Adet");
    expect(stockRightLabel({ stock_quantity: -467 })).toBe("Stok -467 Adet");
    expect(stockBarcodeLabel({ barcode: "8690001" })).toBe("8690001");
    expect(stockBarcodeLabel({})).toBe("Barkod yok");
    expect(productSkuLabel({ sku: "DRD-CAM" })).toBe("SKU DRD-CAM");
    expect(productSkuLabel({})).toBe("SKU —");
    expect(productPickSubtitle({ sku: "DRD-CAM", barcode: "8690001" })).toBe("SKU DRD-CAM · Barkod 8690001");
    expect(productPickSubtitle({})).toBe("SKU — · Barkod —");
    expect(stockBadge({})?.label).toBe("0 Adet");
  });

  it("keeps quantity on the right label so the name column can stay wide", () => {
    expect(stockRightLabel({ stock_quantity: -3 })).toBe("Stok -3 Adet");
    expect(productPickSubtitle({ sku: "WOKS_2K5R_BY", barcode: "0749460621171" }))
      .toBe("SKU WOKS_2K5R_BY · Barkod 0749460621171");
  });

  it("keeps SKU and barcode off the list row copy", () => {
    expect(stockRowSubtitle({ sku: "YÜK.DRA.ÇEKME", barcode: "YÜK.DRA.ÇEKME", type: "trade" }, "Ticari Mal", "0,00 ₺"))
      .toBe("Ticari Mal · 0,00 ₺");
    expect(stockRowSubtitle({ category: "Raf", is_active: false }, "Hizmet", "10,00 ₺")).toBe("Raf · Hizmet · 10,00 ₺ · Pasif");
    expect(stockRightLabel({ stock_quantity: 0, track_stock: false })).toBe("Stok 0 Adet");
    expect(stockRightLabel({ stock_quantity: 12, track_stock: false })).not.toMatch(/Takip|YÜK|SKU|Barkod/i);
  });

  it("builds a Tüm Kategoriler dropdown and filters the list", () => {
    expect(productCategoryGroups([{ name: "Raf", count: 3 }, { name: "Masa", count: 1 }])[0].options[0]).toEqual({ value: "all", label: "Tüm Kategoriler" });
    expect(productCategoryGroups([], [{ category: "Raf" }, { category: "Raf" }, { category: "Masa" }])[1].options.map((o) => o.label)).toEqual(["Raf (2)", "Masa (1)"]);
    const rows = [{ name: "A", category: "Raf", sku: "R1" }, { name: "B", category: "Masa", barcode: "99" }];
    expect(filterProducts(rows, "", "Raf").map((p) => p.name)).toEqual(["A"]);
    expect(filterProducts(rows, "99", "all").map((p) => p.name)).toEqual(["B"]);
    expect(filterProducts(rows, "masa", "Masa").map((p) => p.name)).toEqual(["B"]);
    expect(asList({ items: rows })).toEqual(rows);
    expect(asList({ products: rows })).toEqual(rows);
    expect(productCategoryGroups({ name: "Raf" } as never, null)[0].options[0].value).toBe("all");
    expect(filterProducts({} as never, "a", "all")).toEqual([]);
  });

  it("drops gallery payloads and stringifies odd names so the list cannot crash", () => {
    const slim = slimListProducts([
      { name: { tr: "Raf" }, images: ["data:image/jpeg;base64,AAAA"], image_url: "/api/files/a.jpg", description: "x".repeat(8000) },
      null,
      { name: "Masa", thumbnail_url: "t.jpg", images: ["g1.jpg", "g2.jpg"] },
    ]);
    expect(slim[0].name).toBe("Raf");
    expect(slim[0].images).toBeUndefined();
    expect(slim[0].thumbnail_url).toBe("/api/files/a.jpg");
    expect((slim[0] as { description?: string }).description).toBeUndefined();
    expect(slim[1]).toMatchObject({ name: "Masa", thumbnail_url: "t.jpg", images: undefined });
    expect(listSafeThumb("data:image/jpeg;base64,AAAA")).toBe("");
    expect(listSafeThumb("/api/files/a.jpg")).toBe("/api/files/a.jpg");
  });

  it("shows last purchase from invoice then card cost", () => {
    expect(lastPurchaseLabel({ last_purchase_price: 80, last_purchase_supplier: "Ahmet" }, (n) => `${n} ₺`)).toBe("Son alış 80 ₺ · Ahmet");
    expect(lastPurchaseLabel({ purchase_price: 60 }, (n) => `${n} ₺`)).toBe("Son alış 60 ₺");
    expect(lastPurchaseLabel({}, (n) => `${n} ₺`)).toBe("");
    expect(lastPurchaseLabel(null, (n) => `${n} ₺`)).toBe("");
    expect(lastPurchaseLabel(undefined, (n) => `${n} ₺`)).toBe("");
  });
});
