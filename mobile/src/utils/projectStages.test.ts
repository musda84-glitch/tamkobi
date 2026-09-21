import { DEFAULT_PROJECT_STAGES, finalProjectStageKey, isCompletedProjectStatus, normalizeProjectStages } from "./projectStages";

describe("projectStages", () => {
  it("defaults to completed as the final stage", () => {
    expect(finalProjectStageKey(null)).toBe("completed");
    expect(DEFAULT_PROJECT_STAGES.filter((s) => s.is_final)).toHaveLength(1);
  });

  it("uses the company final stage, not only completed", () => {
    const custom = normalizeProjectStages([
      { key: "planning", label: "Keşif" },
      { key: "done", label: "Bitti", is_final: true },
    ]);
    expect(finalProjectStageKey(custom)).toBe("done");
    expect(isCompletedProjectStatus("done", custom)).toBe(true);
    expect(isCompletedProjectStatus("planning", custom)).toBe(false);
    expect(isCompletedProjectStatus("completed", custom)).toBe(true);
    expect(isCompletedProjectStatus("Tamamlandı")).toBe(true);
  });
});
