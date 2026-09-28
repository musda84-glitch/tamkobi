import { recipeToProductionSteps } from "./workDocs";

describe("recipeToProductionSteps", () => {
  it("flattens material and general steps", () => {
    const steps = recipeToProductionSteps({
      materials: [{ product_name: "Plaka", steps: [{ name: "Kesim", station: "CNC", note: "dikkat" }] }],
      steps: [{ name: "Montaj", station: "Montaj" }],
    });
    expect(steps).toEqual([
      { no: 1, name: "Kesim", station: "CNC", note: "dikkat", material_name: "Plaka" },
      { no: 2, name: "Montaj", station: "Montaj", note: "" },
    ]);
  });
  it("falls back to default step", () => {
    expect(recipeToProductionSteps({})).toEqual([{ no: 1, name: "Üretim", station: "" }]);
  });
});
