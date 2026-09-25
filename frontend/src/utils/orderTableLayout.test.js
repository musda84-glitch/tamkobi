import { ORDER_ACTIONS_COL, ORDER_COL_DEFAULTS, ORDER_COL_LIMITS, orderTableMinWidth } from "./orderTableLayout";

test("order table default width fits a typical content pane without horizontal scroll", () => {
  const total = orderTableMinWidth(ORDER_COL_DEFAULTS);
  expect(total).toBe(1025);
  expect(total).toBeLessThanOrEqual(1050);
});

test("actions column is fixed and not part of resizable defaults", () => {
  expect(ORDER_ACTIONS_COL).toBe(248);
  expect(ORDER_COL_DEFAULTS.actions).toBeUndefined();
  expect(ORDER_COL_LIMITS.min.actions).toBeUndefined();
  expect(ORDER_COL_LIMITS.max.actions).toBeUndefined();
});
