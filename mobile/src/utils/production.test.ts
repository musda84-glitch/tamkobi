import { formatBomQty, productionOrderStatus, recipeIdOf } from "./production";

describe("production helpers", () => {
  it("maps order status labels", () => {
    expect(productionOrderStatus("in_production")).toEqual({ label: "Üretimde", tone: "amber" });
    expect(productionOrderStatus("completed").label).toBe("Tamamlandı");
    expect(productionOrderStatus("unknown").label).toBe("Planlandı");
  });

  it("resolves recipe ids and formats BOM quantities", () => {
    expect(recipeIdOf({ id: "a" })).toBe("a");
    expect(recipeIdOf({ _id: "b" })).toBe("b");
    expect(formatBomQty(2)).toBe("2");
    expect(formatBomQty(1.2345)).toBe("1.235");
    expect(formatBomQty(undefined)).toBe("—");
  });
});
