import { DEFAULT_STOCK_UNIT, mergeUnitOptions, unitNamesFromApi, unitSelectGroups } from "./stockUnits";

describe("stockUnits", () => {
  it("keeps Adet first and merges company settings", () => {
    expect(DEFAULT_STOCK_UNIT).toBe("Adet");
    expect(mergeUnitOptions(["Kg", "Paket"])).toEqual(["Adet", "Kg", "Paket"]);
    expect(mergeUnitOptions(["adet", "Metre"], "Rulo")).toEqual(["Adet", "Metre", "Rulo"]);
  });

  it("reads API rows and builds the dropdown group", () => {
    expect(unitNamesFromApi([{ name: "Kg" }, { name: "Adet" }, { name: "" }])).toEqual(["Kg", "Adet"]);
    expect(unitSelectGroups(["Adet", "Kg"])).toEqual([
      {
        label: "Birimler",
        options: [
          { value: "Adet", label: "Adet" },
          { value: "Kg", label: "Kg" },
        ],
      },
    ]);
  });
});
