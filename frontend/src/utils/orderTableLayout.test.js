import { ORDER_COL_DEFAULTS, orderTableMinWidth } from "../utils/orderTableLayout";

test("order table default width fits a typical content pane without horizontal scroll", () => {
  const total = orderTableMinWidth(ORDER_COL_DEFAULTS);
  expect(total).toBe(1086);
  expect(total).toBeLessThanOrEqual(1100);
});
