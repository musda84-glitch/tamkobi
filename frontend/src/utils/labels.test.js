import { orderStatusBadgeClass, statusTr, marketplaceStatusTr } from "./labels";

describe("orderStatusBadgeClass", () => {
  it("colors pending amber and completed emerald", () => {
    expect(orderStatusBadgeClass("pending")).toContain("amber");
    expect(orderStatusBadgeClass("approved")).toContain("emerald");
    expect(orderStatusBadgeClass("shipped")).toContain("emerald");
    expect(orderStatusBadgeClass("cancelled")).toContain("rose");
    expect(orderStatusBadgeClass("preparing")).toContain("sky");
  });

  it("statusTr still maps labels", () => {
    expect(statusTr("pending")).toBe("Beklemede");
    expect(statusTr("shipped")).toBe("Kargolandı");
  });

  it("marketplaceStatusTr maps Trendyol English statuses to Turkish", () => {
    expect(marketplaceStatusTr("Delivered")).toBe("Teslim Edildi");
    expect(marketplaceStatusTr("Cancelled")).toBe("İptal");
    expect(marketplaceStatusTr("Shipped")).toBe("Kargolandı");
    expect(marketplaceStatusTr("ReadyToShip")).toBe("Kargoya Hazır");
  });
});
