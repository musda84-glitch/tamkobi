import { hoursFromTimeRange, hoursToHm } from "./overtimeRange";

describe("hoursFromTimeRange", () => {
  it("computes decimal hours and wraps past midnight", () => {
    expect(hoursFromTimeRange("18:00", "20:30")).toBe(2.5);
    expect(hoursFromTimeRange("22:00", "01:00")).toBe(3);
    expect(hoursFromTimeRange("09:00", "09:00")).toBe(0);
    expect(hoursFromTimeRange("18:00", "")).toBeNull();
    expect(hoursFromTimeRange("25:00", "20:00")).toBeNull();
  });

  it("turns decimal hours into a clock value", () => {
    expect(hoursToHm("2,5")).toBe("02:30");
    expect(hoursToHm(2)).toBe("02:00");
    expect(hoursToHm("18:00")).toBe("18:00");
    expect(hoursToHm("")).toBe("");
  });
});
