import { shopFloorCardActions, shopFloorCardBorder, workOrderFinishPlan } from "./shopFloorActions";

describe("workOrderFinishPlan", () => {
  test("uses material needed for material-linked step", () => {
    const plan = workOrderFinishPlan({
      planned_quantity: 1,
      unit: "Adet",
      material_product_id: "m1",
      material_name: "MDF",
      materials: [{ product_id: "m1", product_name: "MDF", needed: 16, unit: "Metre" }],
    });
    expect(plan).toEqual({ qty: 16, unit: "Metre", isMaterial: true, materialName: "MDF" });
  });

  test("falls back to finished product plan", () => {
    expect(workOrderFinishPlan({ planned_quantity: 2, unit: "Adet", materials: [] })).toEqual({
      qty: 2, unit: "Adet", isMaterial: false, materialName: null,
    });
  });
});

describe("shopFloorCardActions", () => {
  test("ready shows only start", () => {
    expect(shopFloorCardActions("ready")).toEqual({
      start: true, pause: false, resume: false, finish: false,
    });
  });

  test("in_progress shows Duraklat + Bitir", () => {
    expect(shopFloorCardActions("in_progress")).toEqual({
      start: false, pause: true, resume: false, finish: true,
    });
  });

  test("paused shows Devam + Bitir", () => {
    expect(shopFloorCardActions("paused")).toEqual({
      start: false, pause: false, resume: true, finish: true,
    });
  });

  test("border highlights running and paused", () => {
    expect(shopFloorCardBorder("in_progress")).toMatch(/amber/);
    expect(shopFloorCardBorder("paused")).toMatch(/orange/);
    expect(shopFloorCardBorder("ready")).toMatch(/blue/);
  });
});
