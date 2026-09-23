import { selfAttendanceGeoMode } from "./attendanceSelf";

describe("selfAttendanceGeoMode", () => {
  test("requires geo only on check-in near a target", () => {
    expect(selfAttendanceGeoMode("check_in", { hasTarget: true, requireGeo: true, trackingEnabled: true })).toBe("required");
    expect(selfAttendanceGeoMode("check_in", { hasTarget: false, trackingEnabled: true })).toBe("none");
  });

  test("attaches checkout geo when tracking is on and never requires it", () => {
    expect(selfAttendanceGeoMode("check_out", { trackingEnabled: true })).toBe("attach");
    expect(selfAttendanceGeoMode("check_out", { trackingEnabled: false })).toBe("none");
    expect(selfAttendanceGeoMode("check_out", { trackingEnabled: true })).not.toBe("required");
  });
});
