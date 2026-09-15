import { normalizeLayout, DEFAULT_DASHBOARD_LAYOUT } from "./useDashboardLayout";

test("normalizeLayout keeps known ids, drops junk, appends missing defaults", () => {
  expect(normalizeLayout(["charts", "alerts", "bogus", "charts"])).toEqual([
    "charts",
    "alerts",
    "overview",
    "decision",
    "demo",
    "ai",
    "kpis",
    "bottom",
  ]);
  expect(normalizeLayout([])).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  expect(normalizeLayout(null)).toEqual(DEFAULT_DASHBOARD_LAYOUT);
});
