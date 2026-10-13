/**
 * Faturalar toplu e-belge: eski tarih → BulkEInvoiceConfirm; Bugün → PUT; yoksa atla.
 * InvoicesPage'in tamamını mount etmeden confirm/open akışını birim olarak doğrular.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { BulkEInvoiceConfirmModal } from "../components/BulkEInvoiceConfirmModal";
import { shouldAskBulkEInvoiceDate, todayYmd } from "../utils/orderBulkActions";
import { bulkApiErrorDetail } from "../utils/invoiceBulkActions";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const { toast } = require("sonner");

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.put.mockResolvedValue({ data: { status: "ok" } });
  toast.error.mockClear();
});

afterEach(() => {
  host.remove();
  jest.clearAllMocks();
});

/** InvoicesPage.confirmBulkEInvoiceDates ile aynı sözleşme. */
async function confirmBulkEInvoiceDates({ setDateToToday, invoices: list, docs }, { openSend }) {
  const rows = Array.isArray(docs) && docs.length ? docs : (Array.isArray(list) ? list : []);
  if (!rows.length) return;
  if (setDateToToday) {
    const today = todayYmd();
    const updated = [];
    for (const inv of rows) {
      const id = inv.id || inv._id;
      try {
        await axios.put(`/api/invoices/${id}`, { issue_date: today });
        updated.push({ ...inv, issue_date: today, invoice_date: today });
      } catch (err) {
        toast.error(bulkApiErrorDetail(err) || "tarih güncellenemedi");
        updated.push(inv);
      }
    }
    openSend(updated);
    return;
  }
  openSend(rows);
}

test("bulk send with old date opens confirm modal", async () => {
  const issuable = [
    { id: "i1", issue_date: "2020-01-01", invoice_number: "A" },
    { id: "i2", issue_date: todayYmd(), invoice_number: "B" },
  ];
  expect(shouldAskBulkEInvoiceDate(issuable)).toBe(true);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <BulkEInvoiceConfirmModal invoices={issuable} onClose={() => {}} onConfirm={() => {}} />,
    );
  });
  expect(host.querySelector('[data-testid="bulk-einvoice-confirm-modal"]')).not.toBeNull();
});

test("no old date skips confirm modal", () => {
  const today = todayYmd();
  expect(shouldAskBulkEInvoiceDate([
    { id: "i1", issue_date: today },
    { id: "i2", invoice_date: today },
  ])).toBe(false);
});

test("Bugün confirm PUTs issue_date then opens send with updated list", async () => {
  const openSend = jest.fn();
  const rows = [
    { id: "i1", issue_date: "2020-01-01", invoice_number: "A" },
    { id: "i2", issue_date: "2021-02-02", invoice_number: "B" },
  ];
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <BulkEInvoiceConfirmModal
        invoices={rows}
        onClose={() => {}}
        onConfirm={(p) => confirmBulkEInvoiceDates(p, { openSend })}
      />,
    );
  });
  await act(async () => {
    host.querySelector('[data-testid="bulk-einvoice-date-today"]').click();
    host.querySelector('[data-testid="bulk-einvoice-confirm-submit"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  expect(axios.put).toHaveBeenCalledTimes(2);
  expect(axios.put.mock.calls[0][0]).toMatch(/\/invoices\/i1$/);
  expect(axios.put.mock.calls[0][1]).toEqual({ issue_date: todayYmd() });
  expect(openSend).toHaveBeenCalled();
  const sent = openSend.mock.calls[0][0];
  expect(sent.every((r) => r.issue_date === todayYmd())).toBe(true);
});

test("PUT failure toasts but still opens send", async () => {
  axios.put.mockRejectedValueOnce({ response: { data: { detail: "Kilitli" } } });
  axios.put.mockResolvedValueOnce({ data: {} });
  const openSend = jest.fn();
  await confirmBulkEInvoiceDates({
    setDateToToday: true,
    invoices: [
      { id: "bad", issue_date: "2020-01-01" },
      { id: "ok", issue_date: "2020-01-02" },
    ],
  }, { openSend });
  expect(toast.error).toHaveBeenCalled();
  expect(openSend).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ id: "bad", issue_date: "2020-01-01" }),
    expect.objectContaining({ id: "ok", issue_date: todayYmd() }),
  ]));
});
