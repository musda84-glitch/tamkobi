import { formatOrderDateTime, orderTerminRemaining, parseOrderInstant } from "./orderTermin";

describe("orderTermin", () => {
  it("parses and formats order date", () => {
    expect(parseOrderInstant(null)).toBeNull();
    expect(formatOrderDateTime("2026-10-08T12:30:00.000Z")).toMatch(/2026/);
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
