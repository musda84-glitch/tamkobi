import { productImage, stockBadge, stockBarcodeLabel, stockQtyLabel } from "./productDisplay";

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

  it("hides the badge when stock is not tracked", () => {
    expect(stockBadge({ stock_quantity: 5, track_stock: false })).toBeNull();
    expect(stockBadge({ stock_quantity: 5, type: "service" })).toBeNull();
  });

  it("always surfaces quantity and barcode on list rows", () => {
    expect(stockQtyLabel({})).toBe("0 Adet");
    expect(stockQtyLabel({ stock_quantity: 12, unit: "Koli" })).toBe("12 Koli");
    expect(stockQtyLabel({ type: "service" })).toBe("Takip yok");
    expect(stockBarcodeLabel({ barcode: "8690001" })).toBe("8690001");
    expect(stockBarcodeLabel({})).toBe("Barkod yok");
    expect(stockBadge({})?.label).toBe("0 Adet");
  });
});
