import { cardPunchAttempts, cardPunchConfirmMessage, cardPunchDraftTime, cardPunchPayload, cardPunchRequiresTime, cardPunchTimeHint, locationCellCaption, locationControllerLabel, locationTrackingEnabled, requestsDetailsToggleLabel, todayAttendanceParts } from "./employeeCardStatus";

describe("employeeCardStatus", () => {
  test("location controller and today punches", () => {
    expect(locationTrackingEnabled({ enabled: true, field: { enabled: false } })).toBe(true);
    expect(locationTrackingEnabled({ enabled: false, field: { enabled: false } })).toBe(false);
    expect(locationControllerLabel(true)).toBe("Konum açık");
    expect(locationCellCaption(true)).toBe("Açık");
    expect(locationCellCaption(false)).toBe("Kapalı");
    expect(requestsDetailsToggleLabel(false)).toBe("Büyüt");
    expect(todayAttendanceParts({ check_in: "01:37", check_out: "10:26" })).toEqual({
      checkIn: "01:37", checkOut: "10:26", late: 0, empty: false,
    });
    expect(todayAttendanceParts(null).empty).toBe(true);
    expect(cardPunchConfirmMessage("check_in", "Davut")).toBe("Davut için giriş saati personel onayına gönderilsin mi?");
    expect(cardPunchConfirmMessage("check_out")).toMatch(/çıkış saati/);
    expect(cardPunchDraftTime("check_in", { check_in: "09:13" })).toBe("09:13");
    expect(cardPunchRequiresTime("09:13")).toBeNull();
    expect(cardPunchPayload("check_out", "18:05")).toEqual({ action: "check_out", check_out: "18:05" });
    expect(cardPunchAttempts({ manager_time_edit_rounds: { check_out: { attempts: 2 } } }, "check_out")).toBe(2);
    expect(cardPunchTimeHint(2)).toMatch(/3\. deneme/);
  });
});
