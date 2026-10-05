import { expenseDateRange, localIso } from "./expenseDateRange";

test("bu ay is the full calendar month, not through today", () => {
  const now = new Date(2026, 9, 5, 15, 0, 0); // 5 Ekim
  expect(expenseDateRange("month", now)).toEqual(["2026-10-01", "2026-10-31"]);
});

test("geçen ay and quarter use local calendar bounds", () => {
  const now = new Date(2026, 9, 5);
  expect(expenseDateRange("last_month", now)).toEqual(["2026-09-01", "2026-09-30"]);
  expect(expenseDateRange("quarter", now)).toEqual(["2026-10-01", "2026-12-31"]);
  expect(expenseDateRange("year", now)).toEqual(["2026-01-01", "2026-12-31"]);
  expect(expenseDateRange("", now)).toEqual(["", ""]);
});

test("localIso does not shift the day via UTC", () => {
  const d = new Date(2026, 9, 1, 0, 30, 0);
  expect(localIso(d)).toBe("2026-10-01");
});
