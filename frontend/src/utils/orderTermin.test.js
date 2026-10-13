import { formatOrderDateTime, orderCalendarDay, orderDisplayTimeZone, orderTerminRemaining, parseOrderInstant } from "./orderTermin";

describe("orderTermin", () => {
  it("parses and formats order date in Europe/Istanbul", () => {
    expect(parseOrderInstant(null)).toBeNull();
    expect(orderDisplayTimeZone()).toBe("Europe/Istanbul");
    expect(orderDisplayTimeZone({ timezone: "Europe/Berlin" })).toBe("Europe/Berlin");
    expect(orderDisplayTimeZone({ settings: { timezone: "Europe/Athens" } })).toBe("Europe/Athens");
    // 12:30 UTC = 15:30 İstanbul
    expect(formatOrderDateTime("2026-10-08T12:30:00.000Z")).toBe("08.10.2026 15:30");
    // 23:30 İstanbul aynı takvim gününde kalır (20:30 UTC)
    expect(formatOrderDateTime("2026-10-13T20:30:00+00:00")).toBe("13.10.2026 23:30");
    expect(orderCalendarDay("2026-10-13T20:30:00+00:00")).toBe("2026-10-13");
    // 21:30 UTC = ertesi gün 00:30 İstanbul
    expect(orderCalendarDay("2026-10-13T21:30:00+00:00")).toBe("2026-10-14");
    expect(formatOrderDateTime("2026-10-13")).toBe("13.10.2026");
    expect(orderCalendarDay("2026-10-13")).toBe("2026-10-13");
  });

  it("shows remaining and overdue termin labels", () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    const soon = orderTerminRemaining("2026-10-10T14:00:00.000Z", now);
    expect(soon.overdue).toBe(false);
    expect(soon.label).toMatch(/Termin/);
    expect(soon.label).toMatch(/2g/);

    const late = orderTerminRemaining("2026-10-07T10:00:00.000Z", now);
    expect(late.overdue).toBe(true);
    expect(late.label).toMatch(/geçti/);
  });
});
