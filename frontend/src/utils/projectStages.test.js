import {
  DEFAULT_PROJECT_STAGES,
  normalizeProjectStages,
  projectStageMap,
  finalProjectStageKey,
  slugStageKey,
  stageToneClass,
} from "./projectStages";

describe("projectStages", () => {
  test("defaults have one final stage", () => {
    expect(DEFAULT_PROJECT_STAGES.filter((s) => s.is_final)).toHaveLength(1);
    expect(finalProjectStageKey(null)).toBe("completed");
  });

  test("normalize fills empty and keeps custom labels", () => {
    expect(normalizeProjectStages([])).toEqual(DEFAULT_PROJECT_STAGES);
    const custom = normalizeProjectStages([
      { key: "planning", label: "Keşif", tone: "violet" },
      { key: "active", label: "Şantiyede", tone: "blue" },
      { key: "done", label: "Bitti", tone: "emerald", is_final: true },
    ]);
    expect(custom).toHaveLength(3);
    expect(custom[0].label).toBe("Keşif");
    expect(custom[0].tone).toBe("violet");
    expect(finalProjectStageKey(custom)).toBe("done");
  });

  test("slug and map", () => {
    expect(slugStageKey("Montaj Aşaması")).toMatch(/^montaj/);
    const map = projectStageMap(DEFAULT_PROJECT_STAGES);
    expect(map.planning[0]).toBe("Planlama");
    expect(map.completed[1]).toBe(stageToneClass("emerald"));
  });

  test("tone labels are Turkish", () => {
    const { stageToneLabel, PROJECT_STAGE_TONES } = require("./projectStages");
    expect(stageToneLabel("slate")).toBe("Gri");
    expect(stageToneLabel("blue")).toBe("Mavi");
    expect(stageToneLabel("emerald")).toBe("Yeşil");
    expect(PROJECT_STAGE_TONES.map(stageToneLabel)).toEqual([
      "Gri", "Mavi", "Amber", "Yeşil", "Gül", "Mor", "İndigo",
    ]);
  });

  test("forces a final stage when missing", () => {
    const list = normalizeProjectStages([
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ]);
    expect(list[1].is_final).toBe(true);
  });
});
