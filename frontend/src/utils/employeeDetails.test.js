import { BLOOD_TYPE_OPTIONS, hasExtraEmployeeDetails, maritalStatusLabel, MARITAL_STATUS_OPTIONS } from "./employeeDetails";

describe("employeeDetails", () => {
  test("marital and blood options", () => {
    expect(MARITAL_STATUS_OPTIONS.some((o) => o.value === "married")).toBe(true);
    expect(BLOOD_TYPE_OPTIONS.some((o) => o.value === "A+")).toBe(true);
    expect(maritalStatusLabel("married")).toBe("Evli");
    expect(maritalStatusLabel("")).toBe("");
  });

  test("hasExtraEmployeeDetails", () => {
    expect(hasExtraEmployeeDetails({})).toBe(false);
    expect(hasExtraEmployeeDetails({ blood_type: "0+" })).toBe(true);
    expect(hasExtraEmployeeDetails({ illnesses: "astım" })).toBe(true);
    expect(hasExtraEmployeeDetails({ safety_info: "İSG eğitimi 2026" })).toBe(true);
  });
});
