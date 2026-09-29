import { canExportPersonalData } from "./DataExportPanel";

describe("canExportPersonalData", () => {
  test("blocks when export_personal_data feature is off", () => {
    expect(canExportPersonalData({ role: "personel", features: { export_personal_data: false } })).toBe(false);
    expect(canExportPersonalData({ role: "manager", features: { export_personal_data: false } })).toBe(false);
  });

  test("allows admin and roles with feature on", () => {
    expect(canExportPersonalData({ role: "admin" })).toBe(true);
    expect(canExportPersonalData({ role: "accountant", features: { export_personal_data: true } })).toBe(true);
    expect(canExportPersonalData({ role: "personel", features: { export_personal_data: true } })).toBe(true);
  });

  test("rejects missing user", () => {
    expect(canExportPersonalData(null)).toBe(false);
    expect(canExportPersonalData(undefined)).toBe(false);
  });
});
