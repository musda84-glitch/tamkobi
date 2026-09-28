import { canExportPersonalData } from "./DataExportPanel";

describe("canExportPersonalData", () => {
  test("blocks personel role", () => {
    expect(canExportPersonalData({ role: "personel" })).toBe(false);
    expect(canExportPersonalData({ role: "Personel" })).toBe(false);
  });

  test("allows admin and other roles", () => {
    expect(canExportPersonalData({ role: "admin" })).toBe(true);
    expect(canExportPersonalData({ role: "accountant" })).toBe(true);
    expect(canExportPersonalData({ role: "manager" })).toBe(true);
  });

  test("rejects missing user", () => {
    expect(canExportPersonalData(null)).toBe(false);
    expect(canExportPersonalData(undefined)).toBe(false);
  });
});
