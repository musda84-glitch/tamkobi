import { isCriticalStock, isStockUntracked, stockQuantityLabel } from "./StockToolbar";

describe("stockQuantityLabel", () => {
  it("shows quantity and unit even when stock is untracked", () => {
    expect(stockQuantityLabel({ stock_quantity: 12, unit: "Adet", track_stock: false })).toBe("12 Adet");
    expect(stockQuantityLabel({ stock_quantity: 0, unit: "Kg", track_stock: false })).toBe("0 Kg");
    expect(stockQuantityLabel({ stock_quantity: 3.5, unit: "Lt" })).toBe("3.5 Lt");
    expect(stockQuantityLabel({ stock_quantity: null, unit: "Adet" })).toBe("0 Adet");
  });

  it("marks untracked separately from critical alerts", () => {
    const untracked = { stock_quantity: 0, track_stock: false, min_stock_alert: 5 };
    expect(isStockUntracked(untracked)).toBe(true);
    expect(isCriticalStock(untracked)).toBe(false);
    expect(isCriticalStock({ stock_quantity: 1, track_stock: true, min_stock_alert: 5 })).toBe(true);
  });
});
