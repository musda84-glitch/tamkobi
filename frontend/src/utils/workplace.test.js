import { workplaceHint, workplaceShort } from "./workplace";

describe("workplace labels", () => {
  it("describes a field task as the workplace", () => {
    const w = { kind: "task", task_title: "Montaj", project_name: "Villa", has_coords: true, radius_m: 300 };
    expect(workplaceHint(w, true)).toContain("Dış görev");
    expect(workplaceHint(w, true)).toContain("görev yeri iş yeri");
    expect(workplaceHint(w, true)).toContain("300 m");
    expect(workplaceShort(w)).toBe("Montaj · Villa");
  });

  it("allows check-in without company geo when the task has no coords", () => {
    const w = { kind: "task", task_title: "Keşif", project_name: "Saha", has_coords: false };
    expect(workplaceHint(w)).toContain("konum yok");
    expect(workplaceShort({ kind: "company", label: "Firma" })).toBe("");
  });
});
