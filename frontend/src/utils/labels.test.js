import { orderStatusBadgeClass, statusTr } from "./labels";

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
});
