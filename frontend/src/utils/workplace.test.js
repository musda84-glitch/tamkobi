import { mesaimGeoHeaderLine, mesaimGeoInLabel, mesaimGeoInOn, workplaceHint, workplaceShort } from "./workplace";

describe("workplace labels", () => {
  it("describes a field task as the workplace", () => {
    const w = { kind: "task", task_title: "Montaj", project_name: "Villa", has_coords: true, radius_m: 300 };
    expect(workplaceHint(w, true)).toContain("Dış görev");
    expect(workplaceHint(w, true)).toContain("görev yeri iş yeri");
    expect(workplaceHint(w, true)).toContain("300 m");
    expect(workplaceShort(w)).toBe("Montaj · Villa");
    expect(workplaceShort({ ...w, duration_days: 3 })).toBe("Montaj · Villa · 3 gün");
  });

  it("builds a minimal Mesaim header geo line", () => {
    expect(mesaimGeoHeaderLine({
      workplace: { kind: "company", has_coords: true, radius_m: 200 },
      requireGeo: true,
    })).toEqual({ title: "Mesaim", place: "Firma · 200 m", status: "Giriş açık", on: true });
    expect(mesaimGeoHeaderLine({
      workplace: { kind: "task", task_title: "Montaj", project_name: "Villa", has_coords: true },
      requireGeo: true,
    }).place).toBe("Montaj · Villa");
    expect(mesaimGeoHeaderLine({
      workplace: { kind: "company", has_coords: false },
      requireGeo: true,
    }).status).toBe("Giriş kapalı");
  });

  it("allows check-in without company geo when the task has no coords", () => {
    const w = { kind: "task", task_title: "Keşif", project_name: "Saha", has_coords: false };
    expect(workplaceHint(w)).toContain("konum yok");
    expect(workplaceShort({ kind: "company", label: "Firma" })).toBe("");
  });

  it("says whether location check-in is on", () => {
    const firm = { kind: "company", has_coords: true, radius_m: 10 };
    expect(mesaimGeoInOn({ workplace: firm, requireGeo: true })).toBe(true);
    expect(mesaimGeoInLabel({ workplace: firm, requireGeo: true })).toBe("Konumlu giriş açık");
    expect(mesaimGeoInLabel({ workplace: firm, requireGeo: false })).toBe("Konumlu giriş kapalı");
    expect(mesaimGeoInLabel({ workplace: { kind: "task", has_coords: false }, requireGeo: true })).toBe("Konumlu giriş kapalı");
    expect(mesaimGeoInLabel({})).toBe("Konumlu giriş kapalı");
  });
});
