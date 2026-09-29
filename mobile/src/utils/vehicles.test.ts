import {
  draftFromVehicle,
  emptyVehicleDraft,
  filterVehicles,
  validateVehicleDraft,
  vehiclePayload,
  vehicleStatusLabel,
  vehicleTitle,
} from "./vehicles";

describe("vehicles", () => {
  it("validates plate and year", () => {
    expect(validateVehicleDraft(emptyVehicleDraft())).toMatch(/Plaka/);
    expect(validateVehicleDraft({ ...emptyVehicleDraft(), plate: "34 ABC 123", year: "2019" })).toBeNull();
    expect(vehiclePayload({ ...emptyVehicleDraft(), plate: "34 A", year: "2019", brand: "Ford" }, "c1").year).toBe(2019);
  });

  it("titles filters and drafts", () => {
    expect(vehicleTitle({ plate: "34 A", brand: "Ford", model: "Transit" })).toBe("34 A · Ford Transit");
    expect(vehicleStatusLabel("maintenance")).toBe("Bakımda");
    expect(filterVehicles([{ plate: "34", status: "active" }, { plate: "06", status: "inactive" }], "active")).toHaveLength(1);
    expect(draftFromVehicle({ plate: "X", year: 2020 }).year).toBe("2020");
  });
});
