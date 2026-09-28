import { shopFloorCardActions, shopFloorCardBorder, shopFloorPausePhaseLabel, workOrderFinishPlan } from "./shopFloorActions";

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

  test("uses sole material when material_* missing (card shows 16 Metre)", () => {
    expect(
      workOrderFinishPlan({
        planned_quantity: 1,
        unit: "Adet",
        materials: [{ product_id: "m1", product_name: "MDF", needed: 16, unit: "Metre" }],
      }),
    ).toEqual({ qty: 16, unit: "Metre", isMaterial: true, materialName: "MDF" });
  });

  test("ceils fractional Adet for plate steps (2.857 → 3)", () => {
    expect(
      workOrderFinishPlan({
        planned_quantity: 10,
        unit: "M2",
        material_product_id: "plaka",
        materials: [{ product_id: "plaka", product_name: "SAFİR MEŞE MDF PLAKA", needed: 2.857, unit: "Adet" }],
      }),
    ).toEqual({ qty: 3, unit: "Adet", isMaterial: true, materialName: "SAFİR MEŞE MDF PLAKA" });
  });

  test("prefers finish_qty from API", () => {
    expect(
      workOrderFinishPlan({
        planned_quantity: 1,
        unit: "Adet",
        finish_qty: 16,
        finish_unit: "Metre",
        finish_is_material: true,
        materials: [],
      }),
    ).toEqual({ qty: 16, unit: "Metre", isMaterial: true, materialName: null });
  });
});

describe("shopFloorCardActions", () => {
  test("ready shows only start", () => {
    expect(shopFloorCardActions("ready")).toEqual({
      start: true, pause: false, pauseEnabled: false, resume: false, finish: false,
    });
  });

  test("in_progress shows Duraklat + Bitir", () => {
    expect(shopFloorCardActions("in_progress")).toEqual({
      start: false, pause: true, pauseEnabled: true, resume: false, finish: true,
    });
  });

  test("in_progress disables Duraklat outside mesai window", () => {
    expect(shopFloorCardActions("in_progress", false).pauseEnabled).toBe(false);
    expect(shopFloorCardActions("in_progress", false).pause).toBe(true);
  });

  test("paused shows Devam + Bitir", () => {
    expect(shopFloorCardActions("paused")).toEqual({
      start: false, pause: false, pauseEnabled: false, resume: true, finish: true,
    });
  });

  test("pause phase labels", () => {
    expect(shopFloorPausePhaseLabel("mola")).toBe("Mola");
    expect(shopFloorPausePhaseLabel("fazla_mesai")).toBe("Fazla mesai");
  });

  test("border highlights running and paused", () => {
    expect(shopFloorCardBorder("in_progress")).toMatch(/amber/);
    expect(shopFloorCardBorder("paused")).toMatch(/orange/);
    expect(shopFloorCardBorder("ready")).toMatch(/blue/);
  });
});
