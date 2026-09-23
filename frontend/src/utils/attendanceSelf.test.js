import { earlyLeaveApproved, selfAttendanceGeoMode, selfCheckoutUnlocked, shouldWatchCheckoutUnlock } from "./attendanceSelf";

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

describe("selfCheckoutUnlocked", () => {
  test("unlocks after early leave approval or schedule end", () => {
    expect(selfCheckoutUnlocked({ checkedIn: true, nowHm: "16:00", scheduleEnd: "18:00" })).toBe(false);
    expect(selfCheckoutUnlocked({ checkedIn: true, nowHm: "16:00", scheduleEnd: "18:00", earlyApproved: true })).toBe(true);
    expect(selfCheckoutUnlocked({ checkedIn: true, nowHm: "18:05", scheduleEnd: "18:00" })).toBe(true);
    expect(earlyLeaveApproved({ early_leave_request: { status: "approved" } })).toBe(true);
    expect(earlyLeaveApproved({ early_leave_request: { status: "pending" } })).toBe(false);
    expect(shouldWatchCheckoutUnlock({ earlyPending: true, checkedIn: true })).toBe(true);
    expect(shouldWatchCheckoutUnlock({ checkedIn: true, checkoutUnlocked: true })).toBe(false);
  });
});
