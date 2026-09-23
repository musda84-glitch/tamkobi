import { locationControllerLabel, locationTrackingEnabled, todayAttendanceParts } from "./employeeCardStatus";

describe("employeeCardStatus", () => {
  test("location controller and today punches", () => {
    expect(locationTrackingEnabled({ enabled: true, field: { enabled: false } })).toBe(true);
    expect(locationTrackingEnabled({ enabled: false, field: { enabled: false } })).toBe(false);
    expect(locationControllerLabel(true)).toBe("Konum açık");
    expect(todayAttendanceParts({ check_in: "01:37", check_out: "10:26" })).toEqual({
      checkIn: "01:37", checkOut: "10:26", late: 0, empty: false,
    });
    expect(todayAttendanceParts(null).empty).toBe(true);
  });
});
