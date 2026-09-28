import {
  flattenRecipeStepsPreview,
  groupStepsByStation,
  sameStationOrderHint,
  splitSameStations,
} from "./recipeStationOrder";

describe("recipeStationOrder", () => {
  test("detects split same stations across materials", () => {
    const mats = [
      { product_name: "MDF", steps: [{ name: "Kesim", station: "KESİM EBATLAMA HOLZHER" }, { name: "Delik", station: "DELİK İŞLEMİ OMAKSAN" }] },
      { product_name: "Kapak", steps: [{ name: "Kesim", station: "KESİM EBATLAMA HOLZHER" }] },
    ];
    const flat = flattenRecipeStepsPreview(mats, []);
    expect(splitSameStations(flat)).toEqual(["KESİM EBATLAMA HOLZHER"]);
    expect(sameStationOrderHint(mats, [], false)?.stations).toEqual(["KESİM EBATLAMA HOLZHER"]);
    expect(sameStationOrderHint(mats, [], true)).toBeNull();
  });

  test("no hint when same station already consecutive", () => {
    const mats = [
      { product_name: "A", steps: [{ station: "CNC" }] },
      { product_name: "B", steps: [{ station: "CNC" }] },
    ];
    expect(splitSameStations(flattenRecipeStepsPreview(mats, []))).toEqual([]);
  });

  test("groupStepsByStation keeps first-seen station order", () => {
    const steps = [
      { name: "K1", station: "HOLZHER", material_name: "A" },
      { name: "D1", station: "OMAKSAN", material_name: "A" },
      { name: "K2", station: "HOLZHER", material_name: "B" },
    ];
    const grouped = groupStepsByStation(steps);
    expect(grouped.map((s) => s.station)).toEqual(["HOLZHER", "HOLZHER", "OMAKSAN"]);
    expect(grouped.map((s) => s.no)).toEqual([1, 2, 3]);
  });
});
