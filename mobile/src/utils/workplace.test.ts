import { fieldWorkplaceFromProjects, mesaimGeoInLabel, mesaimGeoInOn, workplaceHint, workplaceShort } from "./workplace";

describe("workplace labels", () => {
  it("describes a field task as the workplace", () => {
    const w = { kind: "task" as const, task_title: "Montaj", project_name: "Villa", has_coords: true, radius_m: 300 };
    expect(workplaceHint(w, true)).toContain("Dış görev");
    expect(workplaceHint(w, true)).toContain("görev yeri iş yeri");
    expect(workplaceShort(w)).toBe("Montaj · Villa");
  });

  it("skips company geo when the assigned task has no coords", () => {
    expect(workplaceHint({ kind: "task", task_title: "Keşif", has_coords: false })).toContain("konum yok");
  });

  it("says whether location check-in is on", () => {
    const firm = { kind: "company" as const, has_coords: true, radius_m: 10 };
    expect(mesaimGeoInOn({ workplace: firm, requireGeo: true })).toBe(true);
    expect(mesaimGeoInLabel({ workplace: firm, requireGeo: true })).toBe("Konumlu giriş açık");
    expect(mesaimGeoInLabel({ workplace: firm, requireGeo: false })).toBe("Konumlu giriş kapalı");
    expect(mesaimGeoInLabel({ workplace: { kind: "task", has_coords: false }, requireGeo: true })).toBe("Konumlu giriş kapalı");
    expect(mesaimGeoInLabel({ workplace: null, requireGeo: true })).toBe("Konumlu giriş kapalı");
  });

  it("shows duration days and picks the assigned open task", () => {
    const w = { kind: "task" as const, task_title: "Montaj", project_name: "Villa", duration_days: 3, has_coords: true };
    expect(workplaceShort(w)).toBe("Montaj · Villa · 3 gün");
    expect(workplaceHint(w, true)).toContain("3 gün");
    const fromProj = fieldWorkplaceFromProjects([
      {
        id: "p1", name: "Villa", project_number: "PRJ-1", latitude: 40, longitude: 32,
        tasks: [
          { id: "t0", title: "Bitti", done: true, assignee_id: "e1" },
          { id: "t1", title: "Montaj", assignee_id: "e1", duration_days: 3 },
        ],
      },
    ], "e1");
    expect(fromProj).toMatchObject({ kind: "task", task_title: "Montaj", duration_days: 3, has_coords: true });
  });
});
