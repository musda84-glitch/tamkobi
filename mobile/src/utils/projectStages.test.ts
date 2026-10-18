import { DEFAULT_PROJECT_STAGES, finalProjectStageKey, isCompletedProjectStatus, normalizeProjectStages, projectStageState } from "./projectStages";

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

  it("marks stepper steps done, current, or todo", () => {
    expect(projectStageState(null, "active", "planning")).toBe("done");
    expect(projectStageState(null, "active", "active")).toBe("current");
    expect(projectStageState(null, "active", "on_hold")).toBe("todo");
    expect(projectStageState(null, "active", "completed")).toBe("todo");
    expect(projectStageState(null, "planning", "planning")).toBe("current");
    expect(projectStageState(null, "mystery", "planning")).toBe("todo");
    expect(projectStageState(DEFAULT_PROJECT_STAGES, "active", "missing")).toBe("todo");
  });

  it("uses a custom stage list for stepper state", () => {
    const custom = normalizeProjectStages([
      { key: "survey", label: "Keşif" },
      { key: "build", label: "Uygulama" },
      { key: "done", label: "Bitti", is_final: true },
    ]);
    expect(projectStageState(custom, "build", "survey")).toBe("done");
    expect(projectStageState(custom, "build", "build")).toBe("current");
    expect(projectStageState(custom, "build", "done")).toBe("todo");
    expect(projectStageState(custom, "done", "build")).toBe("done");
    expect(projectStageState(custom, "done", "done")).toBe("current");
  });
});
