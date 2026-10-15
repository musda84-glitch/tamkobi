/**
 * Faturalar Toplu İşlemler PR-B: refresh / xml / tarih / sil — sonuç modalı ve ön eleme.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BulkResultModal } from "../components/BulkResultModal";
import { BulkInvoiceDateModal } from "../components/BulkInvoiceDateModal";
import {
  invoiceBulkRefreshGate,
  runInvoiceRefreshBulk,
  runInvoiceXmlBulk,
  invoiceXmlFileName,
  runInvoiceDateBulk,
  runInvoiceDeleteBulk,
} from "../utils/invoiceBulkActions";
import { invoicesBulkDeleteConfirmMessage, refreshInvoiceGibStatus } from "../components/InvoiceContextMenu";

jest.mock("axios");
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), message: jest.fn() },
}));

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  jest.clearAllMocks();
});

afterEach(() => {
  host.remove();
});

const gibSent = {
  id: "g1",
  invoice_number: "EA-1",
  status: "approved",
  e_type: "e_archive",
  gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
};

test("no selection asks confirm and remaining count is shown in the result modal", async () => {
  const confirm = jest.fn(() => true);
  const visible = Array.from({ length: 41 }, (_, i) => ({ ...gibSent, id: `g${i}`, invoice_number: `EA-${i}` }));
  const gate = invoiceBulkRefreshGate({ selected: [], visible, confirm });
  expect(confirm).toHaveBeenCalledWith("41 belge güncellenecek");
  axios.post.mockResolvedValue({ data: { updated: false, message: "Yeni GİB durumu yok." } });
  const items = await runInvoiceRefreshBulk(gate.targets, {
    remainder: gate.remainder,
    refresh: (inv) => refreshInvoiceGibStatus("/api", inv, { silent: true }),
  });
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  const root = createRoot(host);
  await act(async () => {
    root.render(<BulkResultModal title="GİB durum güncelleme" items={items} onClose={() => {}} />);
  });
  expect(host.textContent).toContain("Değişiklik yok");
  expect(host.textContent).toContain("kalan 1 belge için tekrar çalıştırın");
});

test("xml errors appear in the result modal with invoice-number filename", async () => {
  const inv = { ...gibSent };
  expect(invoiceXmlFileName(inv)).toBe("EA-1.xml");
  const items = await runInvoiceXmlBulk([inv, { id: "d1", invoice_number: "DR-1", status: "draft" }], {
    download: async () => {
      const err = new Error("x");
      err.response = { data: { detail: "XML indirilemedi" } };
      throw err;
    },
  });
  const root = createRoot(host);
  await act(async () => {
    root.render(<BulkResultModal title="XML indirme sonucu" items={items} onClose={() => {}} />);
  });
  expect(host.textContent).toContain("XML indirilemedi");
  expect(host.textContent).toContain("Taslak");
});

test("date modal confirm is required before PUT", async () => {
  const onConfirm = jest.fn(async (date) => {
    await runInvoiceDateBulk(
      [{ id: "d1", invoice_number: "TA-1", status: "draft" }],
      { date, put: (inv, issueDate) => axios.put(`/invoices/${inv.id}`, { issue_date: issueDate }) },
    );
  });
  axios.put.mockResolvedValue({ data: {} });
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <BulkInvoiceDateModal updateCount={1} skipCount={0} defaultDate="2026-10-01" onClose={() => {}} onConfirm={onConfirm} />,
    );
  });
  expect(axios.put).not.toHaveBeenCalled();
  await act(async () => {
    host.querySelector('[data-testid="bulk-invoice-date-confirm"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  expect(axios.put).toHaveBeenCalledWith("/invoices/d1", { issue_date: "2026-10-01" });
});

test("delete 409 reason is shown and confirm copy stays #1264", async () => {
  const deletable = [{ id: "d1", status: "draft", invoice_number: "TA1", order_number: "B2B-1" }];
  expect(invoicesBulkDeleteConfirmMessage(deletable)).toMatch(/1 fatura çöp kutusuna taşınsın mı\?/);
  expect(invoicesBulkDeleteConfirmMessage(deletable)).toMatch(/Bağlı sipariş B2B-1 da silinecek/);
  const items = await runInvoiceDeleteBulk(deletable, {
    remove: async () => {
      const err = new Error("x");
      err.response = { status: 409, data: { detail: "Faturalaşmış belge silinemez; iptal/iade kullanın." } };
      throw err;
    },
  });
  const root = createRoot(host);
  await act(async () => {
    root.render(<BulkResultModal title="Toplu silme sonucu" items={items} onClose={() => {}} />);
  });
  expect(host.textContent).toContain("Faturalaşmış belge silinemez; iptal/iade kullanın.");
});
