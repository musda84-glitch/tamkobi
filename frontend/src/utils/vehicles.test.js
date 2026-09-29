import {
  emptyVehicleForm,
  filterVehicles,
  validateVehicleForm,
  vehicleFromRow,
  vehiclePayload,
  vehicleStatusLabel,
  vehicleTitle,
} from "./vehicles";

test("empty form and payload", () => {
  const f = emptyVehicleForm();
  expect(f.status).toBe("active");
  expect(validateVehicleForm(f)).toMatch(/Plaka/);
  expect(validateVehicleForm({ ...f, plate: "34 ABC 123", year: "2020" })).toBeNull();
  expect(vehiclePayload({ ...f, plate: "34 ABC 123", year: "2020", brand: "Ford" }, "c1")).toEqual({
    company_id: "c1",
    plate: "34 ABC 123",
    brand: "Ford",
    model: "",
    color: "",
    notes: "",
    status: "active",
    year: 2020,
  });
});

test("title status filter", () => {
  expect(vehicleTitle({ plate: "34 A", brand: "Ford", model: "Transit" })).toBe("34 A · Ford Transit");
  expect(vehicleStatusLabel("maintenance")).toBe("Bakımda");
  const rows = [
    { plate: "34 A", brand: "Ford", status: "active" },
    { plate: "06 B", brand: "Fiat", status: "inactive" },
  ];
  expect(filterVehicles(rows, { status: "active" })).toHaveLength(1);
  expect(filterVehicles(rows, { q: "fiat" })).toHaveLength(1);
  expect(vehicleFromRow({ id: "1", plate: "X", year: 2021 }).year).toBe("2021");
});
