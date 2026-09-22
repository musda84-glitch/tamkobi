import { workplaceHint, workplaceShort } from "./workplace";

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
});
