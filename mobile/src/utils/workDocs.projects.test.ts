import { fmtMoney } from "./money";
import { projectListFilter, projectMoneyLine, projectThumbs } from "./workDocs";

const stages = [
  { key: "planning", label: "Planlama" },
  { key: "active", label: "Devam Ediyor" },
  { key: "completed", label: "Tamamlandı", is_final: true },
];

const projects = [
  { id: "a", status: "active", name: "Aktif" },
  { id: "b", status: "completed", name: "Biten" },
  { id: "c", status: "planning", name: "Plan" },
];

describe("project list helpers", () => {
  it("filters active, completed and all and exposes counts", () => {
    expect(projectListFilter(projects, "active", stages).map((p) => p.id)).toEqual(["a", "c"]);
    expect(projectListFilter(projects, "completed", stages).map((p) => p.id)).toEqual(["b"]);
    expect(projectListFilter(projects, "all", stages).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(projectListFilter(projects, "active", stages)).toHaveLength(2);
    expect(projectListFilter(projects, "completed", stages)).toHaveLength(1);
    expect(projectListFilter(projects, "all", stages)).toHaveLength(3);
    expect(projectListFilter(null, "active", stages)).toEqual([]);
  });

  it("treats a custom final stage as completed", () => {
    const custom = [
      { key: "survey", label: "Keşif" },
      { key: "done", label: "Bitti", is_final: true },
    ];
    const rows = [
      { id: "1", status: "survey" },
      { id: "2", status: "done" },
      { id: "3", status: "completed" },
    ];
    expect(projectListFilter(rows, "active", custom).map((p) => p.id)).toEqual(["1"]);
    expect(projectListFilter(rows, "completed", custom).map((p) => p.id)).toEqual(["2", "3"]);
  });

  it("formats the money line with fmtMoney", () => {
    const bits = { budget: 0, quoted: 0, invoiced: 0, expense: 0 };
    expect(projectMoneyLine(bits)).toBe(
      `Bütçe ${fmtMoney(0)} · Teklif ${fmtMoney(0)} · Fatura ${fmtMoney(0)} · Masraf ${fmtMoney(0)}`,
    );
    expect(projectMoneyLine(bits)).toBe("Bütçe 0,00 ₺ · Teklif 0,00 ₺ · Fatura 0,00 ₺ · Masraf 0,00 ₺");
    expect(projectMoneyLine({ budget: 10, quoted: 20.5, invoiced: 3, expense: 1 })).toBe(
      `Bütçe ${fmtMoney(10)} · Teklif ${fmtMoney(20.5)} · Fatura ${fmtMoney(3)} · Masraf ${fmtMoney(1)}`,
    );
  });

  it("returns at most three photo urls", () => {
    const project = {
      status: "active",
      stage_photos: [
        { url: "/api/files/a.jpg", stage: "planning" },
        { url: "/api/files/b.jpg", stage: "planning" },
        { url: "/api/files/c.jpg", stage: "active" },
        { url: "/api/files/d.jpg", stage: "active" },
      ],
      images: ["/api/files/a.jpg", "/api/files/e.jpg"],
    };
    expect(projectThumbs(project, 3, stages)).toEqual([
      "/api/files/a.jpg",
      "/api/files/b.jpg",
      "/api/files/c.jpg",
    ]);
    expect(projectThumbs(project, 3, stages).length).toBeLessThanOrEqual(3);
    expect(projectThumbs(project, 10, stages)).toContain("/api/files/e.jpg");
    expect(projectThumbs({ images: [] }, 3)).toEqual([]);
  });
});
