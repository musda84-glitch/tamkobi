import { attendanceDisputePayload, attendanceDisputeStatus, canRequestAttendanceFix, checkoutConfirmMessage, earlyLeaveApproved, earlyLeavePayload, selfAttendanceGeoMode, selfCheckoutLockedHint, selfCheckoutUnlocked, shouldWatchCheckoutUnlock, validateAttendanceDispute, validateEarlyLeave, validateIntradayLeave, intradayLeavePayload } from "./attendanceSelf";

describe("early leave request", () => {
  it("requires a reason and optional HH:MM", () => {
    expect(validateEarlyLeave("ab")).toBe("Erken çıkış nedeni en az 3 karakter olmalı.");
    expect(validateEarlyLeave("doktor", "9")).toBe("Planlanan saat HH:MM formatında olmalı.");
    expect(validateEarlyLeave("doktor randevusu", "14:30")).toBeNull();
    expect(validateEarlyLeave("doktor randevusu", "14:30:00")).toBeNull();
    expect(earlyLeavePayload(" doktor ", "14:30")).toEqual({
      reason: "doktor",
      planned_time: "14:30",
    });
    expect(earlyLeavePayload("doktor", "9:05:00")).toEqual({ reason: "doktor", planned_time: "09:05" });
    expect(earlyLeavePayload("doktor", "")).toEqual({ reason: "doktor" });
  });
});

describe("intraday leave request", () => {
  it("requires reason and out/return times with return after out", () => {
    expect(validateIntradayLeave("ab", "14:00", "16:00")).toMatch(/neden/);
    expect(validateIntradayLeave("doktor randevusu", "14", "16:00")).toMatch(/Çıkış saati/);
    expect(validateIntradayLeave("doktor randevusu", "16:00", "14:00")).toMatch(/sonra/);
    expect(validateIntradayLeave("doktor randevusu", "14:00", "16:30")).toBeNull();
    expect(intradayLeavePayload(" doktor ", "9:05", "11:00")).toEqual({
      reason: "doktor",
      out_time: "09:05",
      return_time: "11:00",
    });
  });
});

describe("selfAttendanceGeoMode", () => {
  it("requires geo only on check-in near a target", () => {
    expect(selfAttendanceGeoMode("check_in", { hasTarget: true, requireGeo: true, trackingEnabled: true })).toBe("required");
    expect(selfAttendanceGeoMode("check_in", { hasTarget: false, trackingEnabled: true })).toBe("none");
    expect(selfAttendanceGeoMode("check_in", { hasTarget: true, requireGeo: false })).toBe("none");
  });
  it("attaches checkout geo when tracking is on and never requires it", () => {
    expect(selfAttendanceGeoMode("check_out", { trackingEnabled: true, hasTarget: true })).toBe("attach");
    expect(selfAttendanceGeoMode("check_out", { trackingEnabled: false })).toBe("none");
    expect(selfAttendanceGeoMode("check_out", { trackingEnabled: true })).not.toBe("required");
  });
});

describe("checkoutConfirmMessage", () => {
  it("warns that checkout cannot be undone and mentions check-in when known", () => {
    expect(checkoutConfirmMessage("12:25")).toContain("giriş 12:25");
    expect(checkoutConfirmMessage("12:25")).toMatch(/geri alınamaz/);
    expect(checkoutConfirmMessage("")).toMatch(/Yanlışlıkla bastıysanız vazgeçin/);
    expect(checkoutConfirmMessage(null)).not.toContain("giriş");
  });
});

describe("selfCheckoutUnlocked", () => {
  it("stays locked before schedule end unless early leave is approved", () => {
    expect(selfCheckoutUnlocked({ checkedIn: true, nowHm: "16:00", scheduleEnd: "18:00" })).toBe(false);
    expect(selfCheckoutUnlocked({ checkedIn: true, nowHm: "16:00", scheduleEnd: "18:00", earlyApproved: true })).toBe(true);
    expect(selfCheckoutUnlocked({ checkedIn: true, nowHm: "18:00", scheduleEnd: "18:00" })).toBe(true);
    expect(selfCheckoutUnlocked({ checkedIn: false, nowHm: "19:00", scheduleEnd: "18:00" })).toBe(false);
    expect(selfCheckoutUnlocked({ checkedIn: true, checkedOut: true, earlyApproved: true })).toBe(false);
    expect(earlyLeaveApproved({ early_leave_request: { status: "approved" } })).toBe(true);
    expect(earlyLeaveApproved({ early_leave_request: { status: "pending" } })).toBe(false);
    expect(selfCheckoutLockedHint({ checkedIn: true, earlyPending: true })).toMatch(/onaylanınca/);
  });
});

describe("shouldWatchCheckoutUnlock", () => {
  it("polls while early leave is pending or checkout is still locked", () => {
    expect(shouldWatchCheckoutUnlock({ earlyPending: true, checkedIn: true })).toBe(true);
    expect(shouldWatchCheckoutUnlock({ checkedIn: true, checkoutUnlocked: false })).toBe(true);
    expect(shouldWatchCheckoutUnlock({ checkedIn: true, checkoutUnlocked: true })).toBe(false);
    expect(shouldWatchCheckoutUnlock({ checkedOut: true, earlyPending: true })).toBe(false);
  });
});

describe("attendance dispute", () => {
  it("requires a short note and only on open records", () => {
    expect(validateAttendanceDispute("")).toMatch(/saatini seçin/);
    expect(validateAttendanceDispute("", "19:30", "")).toBeNull();
    expect(attendanceDisputePayload("", "", "19:30")).toEqual({ note: "çıkış 19:30 olmalı" });
    expect(canRequestAttendanceFix({ id: "a1" })).toBe(true);
    expect(canRequestAttendanceFix({ id: "a1", employee_confirmed: true })).toBe(false);
    expect(canRequestAttendanceFix({ id: "a1", dispute_note: "yanlış", dispute_resolved: false })).toBe(false);
    expect(canRequestAttendanceFix({ id: "a1", dispute_note: "yanlış", dispute_resolved: true })).toBe(true);
    expect(attendanceDisputeStatus({ dispute_note: "yanlış", dispute_resolved: false })).toBe("Düzeltme talebi iletildi");
  });
});
