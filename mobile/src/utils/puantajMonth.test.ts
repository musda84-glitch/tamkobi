import {
  buildPuantajCalendarCells,
  leaveYearArchiveLine,
  monthDateList,
  movesSheetTitle,
  puantajDayLine,
  puantajStatusLabel,
  puantajStatusTone,
  puantajWageAskCopy,
  puantajWageAskReason,
  puantajWageCanAsk,
  puantajWageDecisionPath,
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
    expect(movesSheetTitle("tasks")).toBe("Atanan görevler");
    const lateDay = {
      date: "2026-10-01",
      weekday: 3,
      weekday_label: "Per",
      status: "present",
      status_label: "Çalıştı",
      attendance_id: "att-1",
      late_minutes: 10,
      wage: 1058.66,
      wage_full: 1080,
      wage_proposed: 1058.66,
      wage_ask: true,
    };
    expect(puantajWageCanAsk(lateDay)).toBe(true);
    expect(puantajWageAskReason(lateDay)).toBe("10 dk geç");
    expect(puantajWageAskCopy(lateDay, (n) => String(n)).kes).toBe("Ücret kes");
    expect(puantajWageAskCopy(lateDay, (n) => String(n)).kesme).toBe("Ücret kesme");
    expect(puantajWageDecisionPath(lateDay)).toBe("/personnel/attendance/att-1/yevmiye-decision");
  });
});
