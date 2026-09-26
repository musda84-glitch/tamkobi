import {
  buildPuantajCalendarCells,
  leaveYearArchiveLine,
  monthDateList,
  movesSheetTitle,
  puantajDayLine,
  puantajStatusLabel,
  puantajStatusTone,
} from "./puantajMonth";

describe("puantajMonth", () => {
  it("lists month dates and labels", () => {
    const days = monthDateList("2026-09");
    expect(days[0]).toBe("2026-09-01");
    expect(days[days.length - 1]).toBe("2026-09-30");
    expect(puantajStatusLabel("present")).toBe("Çalıştı");
    expect(puantajStatusTone("absent")).toBe("rose");
    expect(puantajDayLine({
      date: "2026-09-01",
      weekday: 0,
      weekday_label: "Pzt",
      status: "present",
      status_label: "Çalıştı",
      check_in: "09:00",
      check_out: "18:00",
      hours: 8,
    })).toContain("09:00 → 18:00");
    const cells = buildPuantajCalendarCells([
      { date: "2026-09-01", weekday: 1, weekday_label: "Sal", status: "present", status_label: "Çalıştı" },
    ]);
    expect(cells[0]).toBeNull();
    expect(cells[1]?.date).toBe("2026-09-01");
    expect(leaveYearArchiveLine({ year: 2025, used: 4, remaining: 10, carry_over: 2 })).toMatch(/2025/);
    expect(movesSheetTitle("puantaj")).toBe("Personel puantajı");
    expect(movesSheetTitle("location")).toBe("Konum hareketleri");
  });
});
