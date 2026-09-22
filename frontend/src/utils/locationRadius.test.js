import { DEFAULT_LOCATION_RADIUS_M, LOCATION_RADIUS_OPTIONS, normalizeRadiusM } from "./locationRadius";

describe("locationRadius", () => {
  it("normalizes distance meters", () => {
    expect(normalizeRadiusM(50)).toBe(50);
    expect(normalizeRadiusM("750")).toBe(750);
    expect(normalizeRadiusM(10)).toBe(DEFAULT_LOCATION_RADIUS_M);
    expect(normalizeRadiusM(null)).toBe(DEFAULT_LOCATION_RADIUS_M);
    expect(LOCATION_RADIUS_OPTIONS).toContain(300);
  });
});
