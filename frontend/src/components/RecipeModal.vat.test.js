import { materialLineCost, materialUnitNet } from "../components/RecipeModal";
import { normalizeWorkshopZones, zoneNamesFromList, workshopZoneSelectGroups } from "../utils/workParks";

describe("recipe material vat cost", () => {
  it("keeps net when KDV hariç", () => {
    expect(materialUnitNet({ cost_per_unit: 333.269946, cost_includes_vat: false, vat_rate: 20 })).toBeCloseTo(333.269946);
  });

  it("strips vat when KDV dahil", () => {
    expect(materialUnitNet({ cost_per_unit: 120, cost_includes_vat: true, vat_rate: 20 })).toBeCloseTo(100);
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

describe("workshop zones", () => {
  it("normalizes and lists zone names", () => {
    const zones = normalizeWorkshopZones(["Kesim", { id: "z2", name: "Montaj" }]);
    expect(zones[1].name).toBe("Montaj");
    expect(zoneNamesFromList(zones)).toEqual(["Kesim", "Montaj"]);
    expect(workshopZoneSelectGroups(zones)[0].options.map((o) => o.label)).toEqual(["Kesim", "Montaj"]);
  });
});
