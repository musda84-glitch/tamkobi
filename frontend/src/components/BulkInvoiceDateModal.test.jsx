import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { BulkInvoiceDateModal } from "./BulkInvoiceDateModal";
import { BulkResultModal } from "./BulkResultModal";
import { runInvoiceDateBulk } from "../utils/invoiceBulkActions";

jest.mock("axios");

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.put.mockResolvedValue({ data: {} });
});

afterEach(() => {
  host.remove();
  jest.clearAllMocks();
});

test("date modal does not PUT until confirm", async () => {
  const onConfirm = jest.fn();
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <BulkInvoiceDateModal
        updateCount={2}
        skipCount={1}
        defaultDate="2026-10-15"
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
  });
  expect(host.textContent).toContain("2 fatura güncellenecek; 1 atlanacak");
  expect(axios.put).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
  await act(async () => {
    host.querySelector('[data-testid="bulk-invoice-date-confirm"]').click();
  });
  expect(onConfirm).toHaveBeenCalledWith("2026-10-15");
  expect(axios.put).not.toHaveBeenCalled();
});

test("confirmed date bulk lists backend error in result modal", async () => {
  axios.put.mockRejectedValueOnce({ response: { data: { detail: "İptal edilmiş fatura düzenlenemez." } } });
  const items = await runInvoiceDateBulk(
    [{ id: "ok", invoice_number: "TA-1", status: "draft" }],
    { date: "2026-10-15", put: (inv, date) => axios.put(`/api/invoices/${inv.id}`, { issue_date: date }) },
  );
  const root = createRoot(host);
  await act(async () => {
    root.render(<BulkResultModal title="Toplu fatura tarihi" items={items} onClose={() => {}} />);
  });
  expect(host.textContent).toContain("İptal edilmiş fatura düzenlenemez.");
  expect(host.querySelector('[data-outcome="error"]')).not.toBeNull();
});
