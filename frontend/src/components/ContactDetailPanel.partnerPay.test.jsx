/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import { ContactDetailPanel } from "./ContactDetailPanel";
import { invoicePayExportLabel } from "./InvoiceToolbar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    defaults: {},
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return { __esModule: true, default: impl };
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" }, can: () => true }),
}));

const OVERVIEW = {
  contact: { id: "ct1", company_id: "c1", name: "TEKBİR ORMAN", type: "supplier", balance: 0, tax_number_or_id: "111" },
  summary: { total_invoiced: 0, total_paid: 0, open_amount: 0, invoice_count: 2, draft_count: 0, opening_balance: 0 },
  invoices: [
    { id: "inv-closed", invoice_number: "FYS2026000002251", invoice_type: "purchase", status: "approved", payment_status: "unpaid", effective_open: 0, grand_total: 70000, paid_amount: 0, issue_date: "2026-09-01", currency: "TRY", gib_status: "Onaylandı" },
    { id: "inv-open", invoice_number: "F-ACIK", invoice_type: "purchase", status: "approved", payment_status: "unpaid", grand_total: 1000, issue_date: "2026-09-02", currency: "TRY", gib_status: "Onaylandı" },
  ],
  payments: [
    { id: "pay-named", type: "outflow", date: "2026-10-10", account_name: "Ortaklar Hesabı", partner_name: "Ali Veli", category: "Cari Ödeme", description: "Ortak ödeme", amount: 70000, source: "partner" },
    { id: "pay-plain", type: "outflow", date: "2026-10-11", account_name: "Ortaklar Hesabı", category: "Cari Ödeme", description: "Eski kayıt", amount: 10, source: "partner" },
  ],
  orders: [],
  communications: [],
  quotes: [],
  surveys: [],
  cheques: [],
  projects: [],
  email_deliveries: [],
};

let host;
let root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/overview")) return Promise.resolve({ data: OVERVIEW });
    if (u.includes("/installments")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  jest.clearAllMocks();
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

test("ortak adı ödemelerde görünür; kapalı fatura Ödendi yazar", async () => {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ContactDetailPanel contactId="ct1" onClose={() => {}} />
      </MemoryRouter>,
    );
  });
  await flush(8);

  const closed = host.querySelector("[data-testid=detail-inv-FYS2026000002251]");
  expect(closed.textContent).toContain("Ödendi");
  expect(closed.textContent).not.toContain("Cariye işlendi");
  expect(closed.querySelector(".bg-emerald-100").textContent).toBe("Ödendi");
  expect(host.querySelector("[data-testid=detail-inv-F-ACIK]").textContent).toContain("Cariye işlendi");

  await act(async () => { host.querySelector("[data-testid=detail-tab-payments]").click(); });
  await flush(2);

  const table = host.querySelector("[data-testid=detail-pay-pay-named]");
  const card = host.querySelector("[data-testid=detail-pay-card-pay-named]");
  expect(table.textContent).toContain("Ortaklar Hesabı · Ali Veli");
  expect(card.textContent).toContain("Ortaklar Hesabı · Ali Veli");
  expect(table.textContent).toContain("Ortak");
  expect(card.textContent).toContain("Ortak");

  const plainTable = host.querySelector("[data-testid=detail-pay-pay-plain]");
  const plainCard = host.querySelector("[data-testid=detail-pay-card-pay-plain]");
  expect(plainTable.textContent).toContain("Ortaklar Hesabı");
  expect(plainTable.textContent).not.toContain("Ortaklar Hesabı ·");
  expect(plainCard.textContent).toContain("Ortaklar Hesabı");
  expect(plainCard.textContent).not.toContain("Ortaklar Hesabı ·");

  expect(invoicePayExportLabel(OVERVIEW.invoices[0])).toBe("Ödendi");
  expect(invoicePayExportLabel(OVERVIEW.invoices[1])).toBe("Cariye işlendi");
});
