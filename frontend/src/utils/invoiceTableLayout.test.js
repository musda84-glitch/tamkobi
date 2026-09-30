import { INVOICE_ACTIONS_COL } from "./invoiceTableLayout";

test("invoice actions column is a fixed rail under 360px", () => {
  expect(INVOICE_ACTIONS_COL).toBe(340);
  expect(INVOICE_ACTIONS_COL).toBeLessThanOrEqual(360);
});
