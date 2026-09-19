import { formatHm, hourOptions, minuteOptions, parseHm } from "./clock";

describe("clock", () => {
  it("parses and formats HH:MM", () => {
    expect(parseHm("9:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseHm("14:30")).toEqual({ hour: 14, minute: 30 });
    expect(parseHm("14:30:00")).toEqual({ hour: 14, minute: 30 });
    expect(parseHm("24:00")).toBeNull();
    expect(formatHm(9, 5)).toBe("09:05");
  });

  it("lists 24 hours and 5-minute steps", () => {
    expect(hourOptions()).toHaveLength(24);
    expect(minuteOptions(5)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });
});
