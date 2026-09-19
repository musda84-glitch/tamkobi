import { monthGrid, normalizeYmd, parseYmd, shiftMonth, toYmd, weekdayLabels } from "./calendar";

describe("calendar", () => {
  it("parses and formats YYYY-MM-DD", () => {
    expect(toYmd(new Date(2026, 8, 16))).toBe("2026-09-16");
    expect(parseYmd("2026-09-16")?.getDate()).toBe(16);
    expect(parseYmd("2026-13-01")).toBeNull();
    expect(parseYmd("16.09.2026")).toBeNull();
    expect(normalizeYmd("2026-09-19T18:00:00.000Z")).toBe("2026-09-19");
    expect(normalizeYmd("18:00")).toBe("");
    expect(normalizeYmd("2026-09-19")).toBe("2026-09-19");
  });

  it("builds a Monday-first September 2026 grid", () => {
    const cells = monthGrid(2026, 8);
    expect(weekdayLabels()).toHaveLength(7);
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe(1);
    expect(cells.filter((d) => d != null)).toHaveLength(30);
  });

  it("shifts months across years", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
  });
});
