import { INVOICE_ACTIONS_COL } from "./invoiceTableLayout";

test("invoice actions column is a fixed rail under 320px", () => {
  expect(INVOICE_ACTIONS_COL).toBe(240);
  expect(INVOICE_ACTIONS_COL).toBeLessThanOrEqual(320);
});
