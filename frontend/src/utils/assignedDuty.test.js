import { DUTY_MAPS_ACTION, dutyHasProject, dutyIsField, dutyWorkflowProgress, photoVisibility, photoVisibilityLabel } from "./assignedDuty";
import { workMapsLink } from "./mapsLink";

describe("assigned duty field extras", () => {
  test("opens maps for a project assignment and tracks workflow", () => {
    const t = {
      id: "t1",
      kind: "field",
      title: "Montaj",
      project_id: "p1",
      project_number: "PRJ-2026-0006",
      project_name: "Aa",
      latitude: 40.1,
      longitude: 32.8,
      workflow: [{ title: "Montaj" }, { title: "Teslim", done: true }],
      photos: [{ url: "/api/files/a.jpg", source: "employee", visibility: "pending" }],
    };
    expect(DUTY_MAPS_ACTION).toBe("Konuma Git");
    expect(dutyIsField(t)).toBe(true);
    expect(dutyHasProject(t)).toBe(true);
    expect(workMapsLink(t)).toContain("40.1");
    expect(dutyWorkflowProgress(t)).toEqual({ done: 1, total: 2 });
    expect(photoVisibility(t.photos[0])).toBe("pending");
    expect(photoVisibilityLabel(t.photos[0])).toBe("Onay bekliyor");
  });

  test("hides map for office park duties", () => {
    expect(dutyIsField({ kind: "office", park_name: "CNC" })).toBe(false);
    expect(dutyHasProject({ kind: "office", park_name: "CNC" })).toBe(false);
  });
});
