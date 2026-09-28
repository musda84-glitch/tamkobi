import { coerceStepsList, materialLineCost, materialUnitNet, materialsFromRecipe, normalizeStepImages, normalizeSteps, serializeSteps } from "../components/RecipeModal";
import { normalizeWorkshopZones, zoneNamesFromList, workshopZoneSelectGroups } from "../utils/workParks";

describe("recipe material vat cost", () => {
  it("keeps net when KDV hariç", () => {
    expect(materialUnitNet({ cost_per_unit: 333.269946, cost_includes_vat: false, vat_rate: 20 })).toBeCloseTo(333.269946);
  });

  it("strips vat when KDV dahil", () => {
    expect(materialUnitNet({ cost_per_unit: 120, cost_includes_vat: true, vat_rate: 20 })).toBeCloseTo(100);
  });

  it("defaults missing vat_rate to 20 when dahil", () => {
    expect(materialUnitNet({ cost_per_unit: 120, cost_includes_vat: true })).toBeCloseTo(100);
  });

  it("keeps typed amount as exclusive when hariç", () => {
    // 3000 hariç → net 3000; satır (qty2, fire%20) = 7200
    expect(materialUnitNet({ cost_per_unit: 3000, cost_includes_vat: false, vat_rate: 20 })).toBeCloseTo(3000);
    expect(
      materialLineCost({
        cost_per_unit: 3000,
        cost_includes_vat: false,
        vat_rate: 20,
        quantity: 2,
        wastage_percent: 20,
      })
    ).toBeCloseTo(7200);
  });

  it("treats typed amount as inclusive when dahil", () => {
    // 3000 dahil %20 → net 2500; satır (qty2, fire%20) = 6000
    expect(materialUnitNet({ cost_per_unit: 3000, cost_includes_vat: true, vat_rate: 20 })).toBeCloseTo(2500);
    expect(
      materialLineCost({
        cost_per_unit: 3000,
        cost_includes_vat: true,
        vat_rate: 20,
        quantity: 2,
        wastage_percent: 20,
      })
    ).toBeCloseTo(6000);
  });

  it("applies wastage on net unit cost", () => {
    const line = materialLineCost({
      cost_per_unit: 120,
      cost_includes_vat: true,
      vat_rate: 20,
      quantity: 2,
      wastage_percent: 10,
    });
    // 100 * 2 * 1.1 = 220
    expect(line).toBeCloseTo(220);
  });
});

describe("per-material recipe steps", () => {
  it("serializes named steps; station-only keeps step; empty drops", () => {
    expect(
      serializeSteps(
        [
          { name: " Kesim ", station: "CNC", duration_min: "10", images: ["/a.jpg", "/a.jpg"] },
          { name: "  ", station: "X", duration_min: 1 },
          { name: "Montaj", station: "", duration_min: 0 },
          { name: "", station: "", duration_min: 5 },
        ],
        "Genel"
      )
    ).toEqual([
      { no: 1, name: "Kesim", station: "CNC", duration_min: 10, note: "", images: ["/a.jpg"] },
      { no: 2, name: "X", station: "X", duration_min: 1, note: "", images: [] },
      { no: 3, name: "Montaj", station: "Genel", duration_min: 0, note: "", images: [] },
    ]);
  });

  it("serializes step note for atelier", () => {
    expect(
      serializeSteps([{ name: "Kesim", station: "CNC", duration_min: 5, note: "  Delik Ø8  " }])
    ).toEqual([{ no: 1, name: "Kesim", station: "CNC", duration_min: 5, note: "Delik Ø8", images: [] }]);
  });

  it("normalizes step image urls", () => {
    expect(normalizeStepImages(["/a", { url: "/b" }, "", { image_url: "/a" }])).toEqual(["/a", "/b"]);
  });

  it("coerces JSON-string steps and loads material steps on edit", () => {
    expect(coerceStepsList('[{"name":"Kesim","station":"CNC"}]')).toEqual([{ name: "Kesim", station: "CNC" }]);
    expect(normalizeSteps('[{"name":"Kesim","station":"CNC","duration_min":5}]')[0].name).toBe("Kesim");
    const mats = materialsFromRecipe({
      materials: [
        { product_id: "m1", product_name: "MDF", quantity: 2, unit: "Adet", steps: [{ name: "Kesim", station: "CNC OEMAK", duration_min: 10 }] },
        { product_id: "m2", product_name: "Medelak", quantity: 1, unit: "Adet", steps: '[{"name":"Kaplama","station":"Pres"}]' },
      ],
    });
    expect(mats[0].steps).toHaveLength(1);
    expect(mats[0].steps[0].station).toBe("CNC OEMAK");
    expect(mats[1].steps[0].name).toBe("Kaplama");
  });
});

describe("workshop zones", () => {
  it("normalizes and lists zone names", () => {
    const zones = normalizeWorkshopZones(["Kesim", { id: "z2", name: "Montaj" }]);
    expect(zones[1].name).toBe("Montaj");
    expect(zoneNamesFromList(zones)).toEqual(["Kesim", "Montaj"]);
    expect(workshopZoneSelectGroups(zones)[0].options.map((o) => o.label)).toEqual(["Kesim", "Montaj"]);
  });
});
