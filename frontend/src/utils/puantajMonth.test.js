import {
  buildPuantajCalendarCells,
  buildPuantajDayRows,
  leaveYearArchiveLine,
  leaveYearBalance,
  monthDateList,
  puantajDayLine,
  puantajStatusLabel,
} from "./puantajMonth";

describe("puantajMonth", () => {
  test("lists all days in month", () => {
    expect(monthDateList("2026-09").length).toBe(30);
    expect(monthDateList("2026-09")[0]).toBe("2026-09-01");
    expect(monthDateList("2026-09").at(-1)).toBe("2026-09-30");
  });

  test("builds day rows with present / leave / off / absent", () => {
    const days = buildPuantajDayRows(
      "2026-09",
      [
        { date: "2026-09-01", status: "present", check_in: "09:00", check_out: "18:00", hours: 8, overtime_hours: 0 },
        { date: "2026-09-02", status: "absent" },
        { date: "2026-09-03", status: "present", check_in: "09:00", check_out: "20:00", hours: 10, overtime_hours: 2 },
      ],
      [{ start_date: "2026-09-04", end_date: "2026-09-04", status: "approved", type: "annual", reason: "izin" }],
      { workDays: [0, 1, 2, 3, 4] },
    );
    expect(days.find((d) => d.date === "2026-09-01").status).toBe("present");
    expect(days.find((d) => d.date === "2026-09-02").status).toBe("absent");
    expect(days.find((d) => d.date === "2026-09-03").overtime_hours).toBe(2);
    expect(days.find((d) => d.date === "2026-09-04").status).toBe("leave");
    expect(days.find((d) => d.date === "2026-09-05").status).toBe("off"); // Saturday
    expect(puantajStatusLabel("present")).toBe("Çalıştı");
    expect(puantajDayLine(days.find((d) => d.date === "2026-09-01"))).toContain("09:00 → 18:00");
  });

  test("calendar cells pad Monday-first", () => {
    const days = buildPuantajDayRows("2026-09", [], [], { workDays: [0, 1, 2, 3, 4] });
    // 2026-09-01 is Tuesday → weekday 1 → 1 leading blank
    const cells = buildPuantajCalendarCells(days);
    expect(cells[0]).toBeNull();
    expect(cells[1].date).toBe("2026-09-01");
  });

  test("leave year balance and archive line", () => {
    expect(leaveYearBalance({ annual: 14, used: 4, carry: 2 })).toEqual({
      annual: 14,
      used: 4,
      carry: 2,
      remaining: 12,
    });
    expect(leaveYearArchiveLine({ year: 2025, used: 10, remaining: 4, carry_over: 4 })).toBe(
      "2025 · kullanılan 10g · kalan 4g · devir 4g",
    );
  });
});
