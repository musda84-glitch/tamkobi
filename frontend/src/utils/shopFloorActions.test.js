import { employeeHasSystemUser, operatorStationLock, operatorStationLockMessage, shopFloorCardActions, shopFloorCardBorder, shopFloorOperators, shopFloorPausePhaseLabel, workOrderFinishPlan } from "./shopFloorActions";

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

  test("ceils fractional finish_qty Adet from API", () => {
    expect(
      workOrderFinishPlan({
        planned_quantity: 10,
        unit: "M2",
        finish_qty: 2.857,
        finish_unit: "Adet",
        finish_is_material: true,
        materials: [],
      }),
    ).toEqual({ qty: 3, unit: "Adet", isMaterial: true, materialName: null });
  });
});

describe("operatorStationLock", () => {
  const rows = [
    { id: "a", status: "in_progress", operator_name: "Ali", station: "PVC BANTLAMA", order_code: "URT-1", step_no: 3 },
    { id: "b", status: "paused", operator_name: "Ali", station: "HOLZHER", order_code: "URT-2", step_no: 1 },
    { id: "c", status: "in_progress", operator_name: "Veli", station: "HOLZHER", order_code: "URT-3", step_no: 2 },
  ];

  test("blocks same operator at a different station while in_progress", () => {
    const b = operatorStationLock(rows, "Ali", "HOLZHER");
    expect(b?.id).toBe("a");
    expect(operatorStationLockMessage(b, "Ali")).toMatch(/PVC BANTLAMA/);
    expect(operatorStationLockMessage(b, "Ali")).toMatch(/Başka personel/);
  });

  test("allows same station and other operators", () => {
    expect(operatorStationLock(rows, "Ali", "PVC BANTLAMA")).toBeNull();
    // Ali'nin PVC işi Veli'yi engellemez
    expect(operatorStationLock([rows[0]], "Veli", "HOLZHER")).toBeNull();
    expect(operatorStationLock(rows, "Veli", "HOLZHER")).toBeNull();
    expect(operatorStationLock(rows, "Ali", "HOLZHER", "a")).toBeNull();
  });

  test("paused does not lock", () => {
    expect(operatorStationLock([rows[1]], "Ali", "PVC BANTLAMA")).toBeNull();
  });

  test("station-filtered list alone would miss cross-station lock — need full in_progress scope", () => {
    const filteredToHolzher = rows.filter((r) => r.station === "HOLZHER");
    // Tablet yalnızca HOLZHER görürse Ali'nin PVC işi listede yok → yanlışlıkla serbest
    expect(operatorStationLock(filteredToHolzher, "Ali", "HOLZHER")).toBeNull();
    // Tüm istasyonlardan in_progress gelince kilit doğru
    const lockScope = rows.filter((r) => r.status === "in_progress");
    expect(operatorStationLock(lockScope, "Ali", "HOLZHER")?.id).toBe("a");
  });
});

describe("shopFloorCardActions", () => {
  test("ready shows only start", () => {
    expect(shopFloorCardActions("ready")).toEqual({
      start: true, pause: false, pauseEnabled: false, resume: false, finish: false,
    });
  });

  test("waiting allows start (araya gir)", () => {
    expect(shopFloorCardActions("waiting")).toEqual({
      start: true, pause: false, pauseEnabled: false, resume: false, finish: false,
    });
    expect(shopFloorCardBorder("waiting")).toMatch(/blue/);
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

describe("shopFloorOperators", () => {
  test("hides personnel without a system user", () => {
    expect(employeeHasSystemUser({ id: "a", has_user: false, full_name: "Soner Akkaya" })).toBe(false);
    expect(employeeHasSystemUser({ id: "b", has_user: true, full_name: "Muhammed ASLAN" })).toBe(true);
    expect(employeeHasSystemUser({ id: "c", user_id: "usr_1" })).toBe(true);
    expect(employeeHasSystemUser({ id: "d", user_id: "" })).toBe(false);
    expect(employeeHasSystemUser({ id: "e", user_id: "-" })).toBe(false);
    expect(shopFloorOperators([
      { id: "a", full_name: "Soner Akkaya", has_user: false },
      { id: "b", full_name: "Gökhan Yılmaz" },
      { id: "c", full_name: "Muhammed ASLAN", has_user: true },
      { id: "d", full_name: "Yaşar Yıldırım", user_id: "usr_1" },
    ]).map((e) => e.full_name)).toEqual(["Muhammed ASLAN", "Yaşar Yıldırım"]);
  });
});
