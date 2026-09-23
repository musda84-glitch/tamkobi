import { monthGrid, normalizeYm, normalizeYmd, parseYm, parseYmd, shiftMonth, toYm, toYmd, weekdayLabels, ymOrThisMonth, ymdOrToday } from "./calendar";

describe("calendar", () => {
  it("parses and formats YYYY-MM-DD", () => {
    expect(toYmd(new Date(2026, 8, 16))).toBe("2026-09-16");
    expect(parseYmd("2026-09-16")?.getDate()).toBe(16);
    expect(parseYmd("2026-13-01")).toBeNull();
    expect(parseYmd("16.09.2026")).toBeNull();
    expect(normalizeYmd("2026-09-19T18:00:00.000Z")).toBe("2026-09-19");
    expect(normalizeYmd("18:00")).toBe("");
    expect(normalizeYmd("2026-09-19")).toBe("2026-09-19");
    expect(ymdOrToday("2026-09-19")).toBe("2026-09-19");
    expect(ymdOrToday("")).toBe(toYmd(new Date()));
    expect(ymdOrToday("18:00")).toBe(toYmd(new Date()));
  });

  it("builds a Monday-first September 2026 grid", () => {
    const cells = monthGrid(2026, 8);
    expect(weekdayLabels()).toHaveLength(7);
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe(1);
    expect(cells.filter((d) => d != null)).toHaveLength(30);
  });

  it("parses YYYY-AA periods", () => {
    expect(parseYm("2026-09")).toEqual({ year: 2026, month0: 8 });
    expect(toYm(2026, 8)).toBe("2026-09");
    expect(normalizeYm("2026-09-16")).toBe("2026-09");
    expect(normalizeYm("2026-13")).toBe("");
    expect(ymOrThisMonth("2026-09")).toBe("2026-09");
    expect(ymOrThisMonth("")).toBe(toYm(new Date().getFullYear(), new Date().getMonth()));
  });

  it("shifts months across years", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
  });
});
