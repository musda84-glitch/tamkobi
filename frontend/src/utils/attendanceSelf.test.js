import { earlyLeaveApproved, habitLabel, managerTimeEditHint, selfAttendanceGeoMode, selfCheckoutUnlocked, shouldWatchCheckoutUnlock } from "./attendanceSelf";

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
  test("stays open after check-in even before schedule end", () => {
    expect(selfCheckoutUnlocked({ checkedIn: true, nowHm: "16:00", scheduleEnd: "18:00" })).toBe(true);
    expect(selfCheckoutUnlocked({ checkedIn: false, nowHm: "19:00", scheduleEnd: "18:00" })).toBe(false);
    expect(selfCheckoutUnlocked({ checkedIn: true, checkedOut: true })).toBe(false);
    expect(earlyLeaveApproved({ early_leave_request: { status: "approved" } })).toBe(true);
    expect(shouldWatchCheckoutUnlock({ earlyPending: true, checkedIn: true })).toBe(true);
    expect(shouldWatchCheckoutUnlock({ checkedIn: true, checkoutUnlocked: true })).toBe(false);
  });
});

describe("habitLabel and managerTimeEditHint", () => {
  test("describes typical hours and pending manager edit", () => {
    expect(habitLabel({ typical_in: "08:50", typical_out: "18:05", sample_days: 6 })).toMatch(/08:50/);
    expect(habitLabel(null, "Alışkanlık: hazır")).toBe("Alışkanlık: hazır");
    expect(managerTimeEditHint({ pending_employee: true, prev_check_out: "18:10", check_out: "17:45" })).toMatch(/17:45/);
    expect(managerTimeEditHint({ pending_employee: false, check_out: "17:45" })).toBe("");
  });
});
