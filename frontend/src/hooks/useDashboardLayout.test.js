import { normalizeLayout, DEFAULT_DASHBOARD_LAYOUT } from "./useDashboardLayout";

test("normalizeLayout keeps known ids, drops junk, appends missing defaults", () => {
  expect(normalizeLayout(["charts", "alerts", "bogus", "charts"])).toEqual([
    "charts",
    "alerts",
    "ai",
    "kpis",
    "overview",
    "manager",
    "bottom",
    "decision",
    "demo",
    "staff",
  ]);
  expect(normalizeLayout([])).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  expect(normalizeLayout(null)).toEqual(DEFAULT_DASHBOARD_LAYOUT);
});

test("manager id is inserted immediately after overview in a saved layout", () => {
  const saved = ["staff", "alerts", "overview", "decision", "demo", "ai", "kpis", "charts", "bottom"];
  expect(normalizeLayout(saved)).toEqual([
    "staff",
    "alerts",
    "overview",
    "manager",
    "decision",
    "demo",
    "ai",
    "kpis",
    "charts",
    "bottom",
  ]);
  expect(DEFAULT_DASHBOARD_LAYOUT.indexOf("manager")).toBe(DEFAULT_DASHBOARD_LAYOUT.indexOf("overview") + 1);
});
