import { INVOICE_BULK_ACTIONS, invoiceBulkNeedsSelection } from "./invoiceBulkActions";

test("invoice bulk menu lists actions and only refresh works without selection", () => {
  expect(INVOICE_BULK_ACTIONS.map((a) => a.id)).toEqual([
    "einvoice_send",
    "einvoice_print",
    "invoice_print",
    "xml",
    "invoice_date",
    "invoice_link",
    "approve",
    "refresh",
    "cancel",
    "delete",
  ]);
  expect(invoiceBulkNeedsSelection("refresh")).toBe(false);
  expect(invoiceBulkNeedsSelection("cancel")).toBe(true);
  expect(invoiceBulkNeedsSelection("einvoice_send")).toBe(true);
});
