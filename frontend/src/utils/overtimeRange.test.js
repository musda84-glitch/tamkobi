import { hoursFromTimeRange } from "./overtimeRange";

describe("hoursFromTimeRange", () => {
  test("same-day window", () => {
    expect(hoursFromTimeRange("18:00", "20:00")).toBe(2);
    expect(hoursFromTimeRange("18:00", "19:30")).toBe(1.5);
  });

  test("overnight window", () => {
    expect(hoursFromTimeRange("22:00", "00:30")).toBe(2.5);
  });

  test("invalid", () => {
    expect(hoursFromTimeRange("", "20:00")).toBeNull();
    expect(hoursFromTimeRange("18:00", "")).toBeNull();
    expect(hoursFromTimeRange("25:00", "20:00")).toBeNull();
  });
});
