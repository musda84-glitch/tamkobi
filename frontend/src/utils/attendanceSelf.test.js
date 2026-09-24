import { attendanceCalendarDate, attendanceCalendarMonth, earlyLeaveApproved, geoConfirmHint, geoConfirmPending, habitLabel, managerTimeEditHint, mesaimPunchEditHint, mesaimPunchNowLabel, mesaimPunchOpensEditor, resolveNowHm, selfAttendanceGeoMode, selfCheckoutUnlocked, shouldReloadAttendanceDay, shouldWatchCheckoutUnlock } from "./attendanceSelf";

describe("selfAttendanceGeoMode", () => {
  test("never blocks the punch — GPS is attached when a target or tracking exists", () => {
    expect(selfAttendanceGeoMode("check_in", { hasTarget: true, requireGeo: true, trackingEnabled: true })).toBe("attach");
    expect(selfAttendanceGeoMode("check_in", { hasTarget: false, trackingEnabled: true })).toBe("attach");
    expect(selfAttendanceGeoMode("check_in", { hasTarget: false })).toBe("none");
  });

  test("describes pending manager-confirmed punches", () => {
    expect(geoConfirmPending({ geo_confirm_request: { status: "pending" } })).toBe(true);
    expect(geoConfirmHint({ geo_confirm_request: { status: "pending", action: "check_in", reason: "offsite", proposed_time: "09:10" } })).toMatch(/Giriş 09:10/);
    expect(geoConfirmHint({ geo_confirm_request: { status: "pending", action: "check_out", reason: "time_edit", proposed_time: "18:00" } })).toMatch(/saat düzeltme/);
    expect(mesaimPunchOpensEditor({ action: "check_in", checkIn: "06:55" })).toBe(true);
    expect(mesaimPunchEditHint("check_in")).toMatch(/yönetici/);
    expect(mesaimPunchNowLabel("check_in")).toBe("Şimdiki saat ile giriş");
    expect(mesaimPunchNowLabel("check_out")).toBe("Şimdiki saat ile çıkış");
    expect(resolveNowHm("16:43:09")).toBe("16:43");
    expect(resolveNowHm("", new Date(2026, 8, 24, 9, 5))).toBe("09:05");
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

describe("attendance calendar day", () => {
  test("uses Europe/Istanbul and reloads after midnight", () => {
    const before = new Date("2026-09-23T20:59:00.000Z");
    const after = new Date("2026-09-23T21:01:00.000Z");
    expect(attendanceCalendarDate(before)).toBe("2026-09-23");
    expect(attendanceCalendarDate(after)).toBe("2026-09-24");
    expect(attendanceCalendarMonth(after)).toBe("2026-09");
    expect(shouldReloadAttendanceDay("2026-09-23", before)).toBe(false);
    expect(shouldReloadAttendanceDay("2026-09-23", after)).toBe(true);
  });
});

describe("habitLabel and managerTimeEditHint", () => {
  test("describes typical hours and pending manager edit", () => {
    expect(habitLabel({ typical_in: "08:50", typical_out: "18:05", sample_days: 6 })).toMatch(/08:50/);
    expect(habitLabel(null, "Alışkanlık: hazır")).toBe("Alışkanlık: hazır");
    expect(managerTimeEditHint({ pending_employee: true, prev_check_out: "18:10", check_out: "17:45", attempt: 1 })).toMatch(/1\/3/);
    expect(managerTimeEditHint({ pending_employee: false, check_out: "17:45" })).toBe("");
  });
});
