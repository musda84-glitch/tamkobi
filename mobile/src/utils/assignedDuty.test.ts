import { dutyStatusLabel, dutySubtitle, openAssignedDuties } from "./assignedDuty";

describe("assignedDuty", () => {
  it("builds office and field subtitles", () => {
    expect(dutySubtitle({ title: "kesim yap", kind: "office", park_name: "CNC OEMAK", project_name: "CNC OEMAK" })).toBe("CNC OEMAK");
    expect(dutySubtitle({ title: "Keşif", kind: "field", project_number: "P-12", project_name: "Villa", due_date: "2026-09-24" })).toBe("P-12 · Villa · son 2026-09-24");
  });

  it("keeps only open duties and labels status", () => {
    const rows = [
      { id: "1", title: "kesim yap", done: false },
      { id: "2", title: "eski", done: true },
    ];
    expect(openAssignedDuties(rows).map((t) => t.id)).toEqual(["1"]);
    expect(dutyStatusLabel(rows[0])).toBe("Açık");
    expect(dutyStatusLabel(rows[1])).toBe("Tamam");
  });
});
