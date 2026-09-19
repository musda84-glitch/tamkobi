import { filterProducts, productCategoryGroups, productImage, productPickSubtitle, productSkuLabel, stockBadge, stockBarcodeLabel, stockQtyLabel, stockRightLabel, stockRowSubtitle } from "./productDisplay";

describe("productDisplay", () => {
  it("prefers thumbnail, then main image, then gallery", () => {
    expect(productImage({ thumbnail_url: "t.jpg", image_url: "m.jpg", images: ["g.jpg"] })).toBe("t.jpg");
    expect(productImage({ image_url: "m.jpg", images: ["g.jpg"] })).toBe("m.jpg");
    expect(productImage({ images: ["", "g.jpg"] })).toBe("g.jpg");
    expect(productImage({})).toBe("");
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
  });
});
