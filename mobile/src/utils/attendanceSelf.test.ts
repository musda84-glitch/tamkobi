import { attendanceCalendarDate, attendanceCalendarMonth, attendanceDisputePayload, attendanceDisputeStatus, canRequestAttendanceFix, checkInBlockedHint, checkInOffsiteBlocked, checkoutConfirmMessage, earlyLeaveApproved, earlyLeavePayload, geoConfirmHint, geoConfirmPending, habitLabel, hasOpenMesaimSession, managerTimeEditHint, mesaimDateHolidaySuffix, mesaimEarlyArrivalLine, mesaimExclusiveUntilCheckIn, mesaimInSubtitle, mesaimLongDate, mesaimOutInfoLines, mesaimOutSubtitle, mesaimPunchEditHint, mesaimPunchNowLabel, mesaimPunchOpensEditor, mesaimScheduleLine, mesaimShowsDayLeaveInsteadOfIntraday, mesaimWorkDaysLine, resolveMesaimTodayHours, selfAttendanceGeoMode, selfCheckoutLockedHint, selfCheckoutUnlocked, shouldReloadAttendanceDay, shouldWatchCheckoutUnlock, validateAttendanceDispute, validateEarlyLeave, validateIntradayLeave, intradayLeavePayload } from "./attendanceSelf";

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
  it("pulls GPS on check-in press; required when workplace/task target exists", () => {
    expect(selfAttendanceGeoMode("check_in", { hasTarget: true, requireGeo: true })).toBe("required");
    expect(selfAttendanceGeoMode("check_in", { hasTarget: true, requireGeo: false })).toBe("required");
    expect(selfAttendanceGeoMode("check_in", { hasTarget: false })).toBe("attach");
  });
  it("disables checkout geo — Mesaim has no checkout button", () => {
    expect(selfAttendanceGeoMode("check_out", { trackingEnabled: true, hasTarget: true })).toBe("none");
    expect(selfAttendanceGeoMode("check_out", { trackingEnabled: false })).toBe("none");
  });
});

describe("mesaimExclusiveUntilCheckIn", () => {
  it("locks staff to Mesaim after checkout until next check-in", () => {
    const staff = { role: "personel", employee_id: "e1" };
    expect(hasOpenMesaimSession({ check_in: "08:00" })).toBe(true);
    expect(hasOpenMesaimSession({ check_in: "08:00", check_out: "17:00" })).toBe(false);
    expect(hasOpenMesaimSession({})).toBe(false);
    expect(mesaimExclusiveUntilCheckIn(staff, { check_in: "08:00", check_out: "17:00" })).toBe(true);
    expect(mesaimExclusiveUntilCheckIn(staff, { check_in: "08:00" })).toBe(false);
    expect(mesaimExclusiveUntilCheckIn(staff, {})).toBe(true);
    expect(mesaimExclusiveUntilCheckIn({ role: "admin", employee_id: "e1" }, { check_out: "17:00" })).toBe(false);
    expect(mesaimExclusiveUntilCheckIn({ role: "manager", employee_id: "e1" }, {})).toBe(false);
    expect(mesaimExclusiveUntilCheckIn({ role: "personel" }, { check_out: "17:00" })).toBe(false);
  });
});

describe("checkInOffsiteBlocked", () => {
  it("does not pre-block the button from stale location", () => {
    expect(checkInOffsiteBlocked({ hasTarget: true, outside: true })).toBe(false);
    expect(checkInOffsiteBlocked({ hasTarget: true, locationMissing: true })).toBe(false);
    expect(checkInBlockedHint({ outside: true })).toMatch(/Giriş yapılamaz/);
    expect(checkInBlockedHint({ locationMissing: true })).toMatch(/Konum alınamadı/);
  });
});

describe("geoConfirmHint", () => {
  it("describes pending manager-confirmed punches", () => {
    expect(geoConfirmPending({ geo_confirm_request: { status: "pending", action: "check_in" } })).toBe(true);
    expect(geoConfirmHint({
      geo_confirm_request: { status: "pending", action: "check_in", reason: "location_off", proposed_time: "08:41" },
    })).toMatch(/Giriş 08:41/);
    expect(geoConfirmHint({
      geo_confirm_request: { status: "pending", action: "check_out", reason: "offsite", place: "Firma", distance_m: 1200 },
    })).toMatch(/iş yerinde değil/);
    expect(geoConfirmHint({ geo_confirm_request: { status: "approved" } })).toBe("");
    expect(geoConfirmHint({
      geo_confirm_request: { status: "pending", action: "check_out", reason: "time_edit", proposed_time: "18:00" },
    })).toMatch(/saat düzeltme/);
  });
});

describe("mesaim card copy", () => {
  it("formats schedule, work days, date and punch subtitles like the web card", () => {
    expect(mesaimScheduleLine({ start: "09:00", end: "18:00", break_minutes: 60 })).toBe("Mesai 09:00–18:00 · mola 60 dk");
    expect(mesaimWorkDaysLine([0, 1, 4], ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"])).toBe("Pzt, Sal, Cum");
    expect(mesaimLongDate("2026-09-23")).toMatch(/23/);
    expect(mesaimInSubtitle("01:37")).toBe("Giriş 01:37");
    expect(mesaimInSubtitle(null)).toBe("henüz giriş yok");
    expect(mesaimShowsDayLeaveInsteadOfIntraday(null)).toBe(true);
    expect(mesaimShowsDayLeaveInsteadOfIntraday("")).toBe(true);
    expect(mesaimShowsDayLeaveInsteadOfIntraday("09:00")).toBe(false);
    expect(mesaimOutSubtitle({ checkOut: "10:26" })).toBe("Çıkış 10:26");
    expect(mesaimOutSubtitle({ checkIn: null })).toBe("önce giriş yapın");
    expect(mesaimOutSubtitle({ checkIn: "01:37", confirming: true })).toMatch(/puantaj/);
    expect(mesaimOutInfoLines({
      checkIn: "02:30",
      checkOut: "03:30",
      scheduledEnd: "03:30",
      expectedEnd: "03:30",
      workplace: { kind: "task", task_title: "Montaj", project_name: "Villa", duration_days: 2 },
    })).toEqual({
      headline: "Çıkış 03:30",
      baseNote: "Çıkış Saati Yazan Saattir.",
      scheduleLine: "Atanan fazla mesai çıkış 03:30",
      fieldDutyLine: "Dış görev: Montaj · Villa · 2 gün",
    });
    expect(mesaimOutInfoLines({
      checkIn: "08:00",
      scheduledEnd: "18:00",
      expectedEnd: "19:00",
      assignedOvertimeHours: 1,
      workplace: { kind: "company" },
    }).scheduleLine).toBe("Atanan fazla mesai 18:00–19:00");
    expect(mesaimOutInfoLines({
      checkIn: "08:00",
      assignedOvertimeStart: "18:00",
      assignedOvertimeEnd: "20:30",
      assignedOvertimeHours: 2.5,
    }).scheduleLine).toBe("Atanan fazla mesai 18:00–20:30");
    expect(mesaimOutInfoLines({ checkIn: null }).headline).toBe("önce giriş yapın");
    expect(mesaimPunchOpensEditor({ action: "check_in", checkIn: "06:55" })).toBe(false);
    expect(mesaimPunchOpensEditor({ action: "check_out", checkOut: "01:20" })).toBe(false);
    expect(mesaimPunchOpensEditor({ action: "check_in" })).toBe(false);
    expect(mesaimPunchEditHint("check_out")).toMatch(/yönetici/);
    expect(mesaimPunchNowLabel("check_in")).toBe("Şimdiki saat ile giriş");
    expect(mesaimPunchNowLabel("check_out")).toBe("Şimdiki saat ile çıkış");
  });
});

describe("checkoutConfirmMessage", () => {
  it("points to puantaj instead of self-checkout", () => {
    expect(checkoutConfirmMessage("12:25")).toContain("giriş 12:25");
    expect(checkoutConfirmMessage("12:25")).toMatch(/puantaj/i);
    expect(checkoutConfirmMessage("")).toMatch(/puantaj/i);
    expect(checkoutConfirmMessage(null)).toMatch(/puantaj/i);
  });
});

describe("mesaim today window helpers", () => {
  it("resolves Bugün hours from today_window and early arrival copy", () => {
    expect(resolveMesaimTodayHours({
      todayWindow: { start: "08:00", end: "17:00", break_minutes: 45 },
      schedule: { start: "09:00", end: "18:00", break_minutes: 60 },
    })).toEqual({ start: "08:00", end: "17:00", breakMinutes: 45 });
    expect(mesaimScheduleLine({ start: "08:00", end: "17:00", break_minutes: 45 }, { label: "Bugün" })).toBe("Bugün 08:00–17:00 · mola 45 dk");
    expect(mesaimEarlyArrivalLine({ checkIn: "07:40", earlyMinutes: 20, mesaiStart: "08:00" })).toMatch(/07:40/);
    expect(mesaimEarlyArrivalLine({ checkIn: "08:00", earlyMinutes: 0, mesaiStart: "08:00" })).toBe("");
    expect(mesaimDateHolidaySuffix({ todayDate: "2026-09-26", isWorkDay: false })).toMatch(/tatil/);
    expect(mesaimDateHolidaySuffix({ todayDate: "2026-09-26", isWorkDay: true })).toBe("");
  });
});

describe("selfCheckoutUnlocked", () => {
  it("is always false — checkout is from puantaj", () => {
    expect(selfCheckoutUnlocked({ checkedIn: true, nowHm: "16:00", scheduleEnd: "18:00" })).toBe(false);
    expect(selfCheckoutUnlocked({ checkedIn: true, nowHm: "16:00", scheduleEnd: "18:00", earlyApproved: true })).toBe(false);
    expect(selfCheckoutUnlocked({ checkedIn: false, nowHm: "19:00", scheduleEnd: "18:00" })).toBe(false);
    expect(selfCheckoutUnlocked({ checkedIn: true, checkedOut: true, earlyApproved: true })).toBe(false);
    expect(earlyLeaveApproved({ early_leave_request: { status: "approved" } })).toBe(true);
    expect(earlyLeaveApproved({ early_leave_request: { status: "pending" } })).toBe(false);
    expect(selfCheckoutLockedHint({ checkedIn: true })).toMatch(/puantaj/i);
    expect(habitLabel({ typical_in: "08:50", typical_out: "18:05", sample_days: 6 })).toMatch(/08:50/);
    expect(managerTimeEditHint({ pending_employee: true, prev_check_out: "18:10", check_out: "17:45", attempt: 1 })).toMatch(/1\/3/);
    expect(managerTimeEditHint({ pending_employee: false })).toBe("");
  });
});

describe("shouldWatchCheckoutUnlock", () => {
  it("polls only while early leave is pending", () => {
    expect(shouldWatchCheckoutUnlock({ earlyPending: true, checkedIn: true })).toBe(true);
    expect(shouldWatchCheckoutUnlock({ checkedIn: true, checkoutUnlocked: false })).toBe(false);
    expect(shouldWatchCheckoutUnlock({ checkedIn: true, checkoutUnlocked: true })).toBe(false);
    expect(shouldWatchCheckoutUnlock({ checkedOut: true, earlyPending: true })).toBe(false);
  });
});

describe("attendance calendar day", () => {
  it("uses Europe/Istanbul and reloads after midnight", () => {
    const before = new Date("2026-09-23T20:59:00.000Z"); // 23:59 TR
    const after = new Date("2026-09-23T21:01:00.000Z"); // 00:01 TR
    expect(attendanceCalendarDate(before)).toBe("2026-09-23");
    expect(attendanceCalendarDate(after)).toBe("2026-09-24");
    expect(attendanceCalendarMonth(after)).toBe("2026-09");
    expect(shouldReloadAttendanceDay("2026-09-23", before)).toBe(false);
    expect(shouldReloadAttendanceDay("2026-09-23", after)).toBe(true);
    expect(shouldReloadAttendanceDay(null, after)).toBe(true);
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
