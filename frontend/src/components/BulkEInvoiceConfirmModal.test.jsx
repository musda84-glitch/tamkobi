import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { BulkEInvoiceConfirmModal } from "./BulkEInvoiceConfirmModal";
import { shouldAskBulkEInvoiceDate, docDocumentDate } from "../utils/orderBulkActions";

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

test("docDocumentDate prefers invoice_date then issue_date then order_date", () => {
  expect(docDocumentDate({ invoice_date: "2026-01-01", issue_date: "2026-02-02" })).toBe("2026-01-01");
  expect(docDocumentDate({ issue_date: "2026-02-02T10:00:00Z" })).toBe("2026-02-02");
  expect(docDocumentDate({ order_date: "2026-03-03" })).toBe("2026-03-03");
});

test("shouldAskBulkEInvoiceDate true when any doc is older than today", () => {
  expect(shouldAskBulkEInvoiceDate([
    { issue_date: "2026-10-05" },
    { invoice_date: "2026-09-01" },
  ], "2026-10-05")).toBe(true);
  expect(shouldAskBulkEInvoiceDate([
    { issue_date: "2026-10-05" },
  ], "2026-10-05")).toBe(false);
});

test("accepts invoices prop and confirms setDateToToday", async () => {
  const onConfirm = jest.fn();
  const root = createRoot(host);
  const invoices = [
    { id: "i1", invoice_number: "A1", issue_date: "2026-09-01" },
    { id: "i2", invoice_number: "A2", issue_date: "2026-10-01" },
  ];
  await act(async () => {
    root.render(
      <BulkEInvoiceConfirmModal invoices={invoices} onClose={() => {}} onConfirm={onConfirm} />,
    );
  });
  expect(host.querySelector('[data-testid="bulk-einvoice-confirm-modal"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="bulk-einvoice-old-date-warn"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="bulk-einvoice-date-today"]').click();
    host.querySelector('[data-testid="bulk-einvoice-confirm-submit"]').click();
  });
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
    setDateToToday: true,
    invoices: expect.any(Array),
  }));
  expect(onConfirm.mock.calls[0][0].invoices).toHaveLength(2);
});

test("keep dates mode passes setDateToToday false", async () => {
  const onConfirm = jest.fn();
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <BulkEInvoiceConfirmModal
        orders={[{ id: "o1", order_date: "2026-01-01" }]}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
  });
  await act(async () => {
    host.querySelector('[data-testid="bulk-einvoice-date-keep"]').click();
    host.querySelector('[data-testid="bulk-einvoice-confirm-submit"]').click();
  });
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ setDateToToday: false }));
});
