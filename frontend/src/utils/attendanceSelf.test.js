import { attendanceCalendarDate, attendanceCalendarMonth, checkInAlreadyDone, checkInBlockedHint, checkInOffsiteBlocked, checkInOnceHint, earlyLeaveApproved, geoConfirmHint, geoConfirmPending, habitLabel, hasOpenMesaimSession, managerTimeEditHint, mesaimDateHolidaySuffix, mesaimEarlyArrivalLine, mesaimExclusivePathAllowed, mesaimExclusiveUntilCheckIn, mesaimInSubtitle, mesaimOutInfoLines, mesaimPunchEditHint, mesaimPunchNowLabel, mesaimPunchOpensEditor, mesaimScheduleLine, mesaimShowsDayLeaveInsteadOfIntraday, resolveMesaimTodayHours, resolveNowHm, selfAttendanceGeoMode, selfCheckoutUnlocked, shouldReloadAttendanceDay, shouldWatchCheckoutUnlock } from "./attendanceSelf";

describe("selfAttendanceGeoMode", () => {
  test("pulls GPS on check-in press; required when workplace/task target exists", () => {
    expect(selfAttendanceGeoMode("check_in", { hasTarget: true, requireGeo: true })).toBe("required");
    expect(selfAttendanceGeoMode("check_in", { hasTarget: false })).toBe("attach");
  });

  test("describes pending manager-confirmed punches", () => {
    expect(geoConfirmPending({ geo_confirm_request: { status: "pending" } })).toBe(true);
    expect(geoConfirmHint({ geo_confirm_request: { status: "pending", action: "check_in", reason: "offsite", proposed_time: "09:10" } })).toMatch(/Giriş 09:10/);
    expect(geoConfirmHint({ geo_confirm_request: { status: "pending", action: "check_out", reason: "time_edit", proposed_time: "18:00" } })).toMatch(/saat düzeltme/);
    expect(mesaimPunchOpensEditor({ action: "check_in", checkIn: "06:55" })).toBe(false);
    expect(mesaimPunchOpensEditor({ action: "check_out", checkOut: "01:20" })).toBe(false);
    expect(mesaimPunchEditHint("check_in")).toMatch(/yönetici/);
    expect(mesaimPunchNowLabel("check_in")).toBe("Şimdiki saat ile giriş");
    expect(mesaimPunchNowLabel("check_out")).toBe("Şimdiki saat ile çıkış");
    expect(resolveNowHm("16:43:09")).toBe("16:43");
    expect(resolveNowHm("", new Date(2026, 8, 24, 9, 5))).toBe("09:05");
  });

  test("does not pre-block the check-in button from stale location", () => {
    expect(checkInOffsiteBlocked({ hasTarget: true, outside: true })).toBe(false);
    expect(checkInOffsiteBlocked({ hasTarget: true, locationMissing: true })).toBe(false);
    expect(checkInBlockedHint({ outside: true })).toMatch(/Giriş yapılamaz/);
  });

  test("disables checkout geo — Mesaim has no checkout button", () => {
    expect(selfAttendanceGeoMode("check_out", { trackingEnabled: true })).toBe("none");
    expect(selfAttendanceGeoMode("check_out", { trackingEnabled: false })).toBe("none");
  });
});

describe("selfCheckoutUnlocked", () => {
  test("Mesaim checkout is always locked — hours come from puantaj", () => {
    expect(selfCheckoutUnlocked({ checkedIn: true, nowHm: "16:00", scheduleEnd: "18:00" })).toBe(false);
    expect(selfCheckoutUnlocked({ checkedIn: false, nowHm: "19:00", scheduleEnd: "18:00" })).toBe(false);
    expect(selfCheckoutUnlocked({ checkedIn: true, checkedOut: true })).toBe(false);
    expect(earlyLeaveApproved({ early_leave_request: { status: "approved" } })).toBe(true);
    expect(shouldWatchCheckoutUnlock({ earlyPending: true, checkedIn: true })).toBe(true);
    expect(shouldWatchCheckoutUnlock({ checkedIn: true, checkoutUnlocked: false })).toBe(false);
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

describe("check-in once per day", () => {
  test("marks done and hints after first punch", () => {
    expect(checkInAlreadyDone("09:13")).toBe(true);
    expect(checkInAlreadyDone(null)).toBe(false);
    expect(checkInOnceHint("09:13")).toMatch(/Günde bir kez/);
  });
});

describe("mesaimExclusiveUntilCheckIn", () => {
  test("locks staff to Mesaim after checkout until next check-in", () => {
    const staff = { role: "personel", employee_id: "e1" };
    expect(hasOpenMesaimSession({ check_in: "08:00" })).toBe(true);
    expect(hasOpenMesaimSession({ check_in: "08:00", check_out: "17:00" })).toBe(false);
    expect(mesaimExclusiveUntilCheckIn(staff, { check_in: "08:00", check_out: "17:00" })).toBe(true);
    expect(mesaimExclusiveUntilCheckIn(staff, { check_in: "08:00" })).toBe(false);
    expect(mesaimExclusiveUntilCheckIn({ role: "admin", employee_id: "e1" }, { check_out: "17:00" })).toBe(false);
    expect(mesaimExclusivePathAllowed("/mesai")).toBe(true);
    expect(mesaimExclusivePathAllowed("/hesap?tab=profil")).toBe(true);
    expect(mesaimExclusivePathAllowed("/panel")).toBe(false);
  });
});

describe("mesaim today card helpers", () => {
  test("builds schedule, early arrival and out-info lines", () => {
    expect(resolveMesaimTodayHours({
      todayWindow: { start: "08:00", end: "18:00", break_minutes: 60 },
      schedule: { start: "09:00", end: "17:00" },
    })).toEqual({ start: "08:00", end: "18:00", breakMinutes: 60 });
    expect(mesaimScheduleLine({ start: "08:00", end: "18:00", break_minutes: 60 }, { label: "Bugün" }))
      .toBe("Bugün 08:00–18:00 · mola 60 dk");
    expect(mesaimEarlyArrivalLine({ checkIn: "07:40", earlyMinutes: 20, mesaiStart: "08:00" })).toMatch(/07:40/);
    expect(mesaimDateHolidaySuffix({ isWorkDay: false })).toMatch(/tatil/);
    expect(mesaimInSubtitle("09:05")).toBe("Giriş 09:05");
    expect(mesaimShowsDayLeaveInsteadOfIntraday(null)).toBe(true);
    expect(mesaimShowsDayLeaveInsteadOfIntraday("09:05")).toBe(false);
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
    }).scheduleLine).toBe("Atanan fazla mesai 18:00–19:00");
    expect(mesaimOutInfoLines({
      checkIn: "08:00",
      assignedOvertimeStart: "18:00",
      assignedOvertimeEnd: "20:30",
      assignedOvertimeHours: 2.5,
    }).scheduleLine).toBe("Atanan fazla mesai 18:00–20:30");
  });
});
