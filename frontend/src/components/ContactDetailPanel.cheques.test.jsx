/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { ContactDetailPanel } from "./ContactDetailPanel";

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
  useAuth: () => ({ activeCompany: { id: "c1", name: "Tam Kobi" }, can: () => true }),
}));

const CHEQUES = [
  {
    id: "ch1",
    number: "CEK-1",
    instrument: "cheque",
    direction: "received",
    amount: 100,
    currency: "TRY",
    serial_no: "SN-1",
    bank_name: "Garanti",
    bank_branch: "Levent",
    account_no: "TR1",
    drawer_name: "Ali",
    due_date: "2026-12-01",
    issue_date: "2026-10-01",
    status: "open",
  },
  {
    id: "ch2",
    number: "SNT-2",
    instrument: "promissory",
    direction: "received",
    amount: 50.5,
    currency: "TRY",
    serial_no: "SN-2",
    bank_name: "İş",
    bank_branch: "Kadıköy",
    account_no: "TR2",
    drawer_name: "Ayşe",
    due_date: "2026-12-15",
    issue_date: "2026-10-02",
    status: "open",
  },
  {
    id: "ch3",
    number: "CEK-3",
    instrument: "cheque",
    direction: "issued",
    amount: 80,
    currency: "TRY",
    serial_no: "SN-3",
    bank_name: "Akbank",
    bank_branch: "Beşiktaş",
    account_no: "TR3",
    drawer_name: "Firma",
    due_date: "2026-11-01",
    issue_date: "2026-09-01",
    status: "open",
  },
];

const OVERVIEW = {
  contact: { id: "ct1", company_id: "c1", name: "Acme", type: "customer", balance: 100, tax_number_or_id: "111" },
  summary: { total_invoiced: 0, total_paid: 0, open_amount: 0, invoice_count: 0, draft_count: 0, opening_balance: 0 },
  invoices: [],
  payments: [
    {
      id: "pay-cheque",
      type: "inflow",
      date: "2026-10-01",
      account_name: "Çek Portföyü",
      category: "Alınan Çek",
      description: "CEK-1",
      amount: 100,
      currency: "TRY",
      source: "cheque",
      cheque_id: "ch1",
    },
    {
      id: "pay-cash",
      type: "inflow",
      date: "2026-10-03",
      account_name: "Kasa",
      category: "Tahsilat",
      description: "Nakit tahsilat",
      amount: 40,
      currency: "TRY",
      source: "manual",
    },
  ],
  orders: [],
  communications: [],
  quotes: [],
  surveys: [],
  cheques: CHEQUES,
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
    return Promise.resolve({ data: [] });
  });
  toast.error.mockClear();
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderPanel() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ContactDetailPanel contactId="ct1" onClose={() => {}} />
      </MemoryRouter>,
    );
  });
  await flush(8);
}

test("seçilen aynı yön çeklerle tek makbuz items taşır", async () => {
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-tab-cheques]").click(); });
  expect(host.querySelector("[data-testid=detail-cheques-receipt-selected]").disabled).toBe(true);
  expect(host.querySelector("[data-testid=detail-cheque-select-CEK-1]")).toBeTruthy();

  await act(async () => { host.querySelector("[data-testid=detail-cheque-select-CEK-1]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheque-select-SNT-2]").click(); });
  expect(host.querySelector("[data-testid=detail-cheques-receipt-selected]").disabled).toBe(false);
  await act(async () => { host.querySelector("[data-testid=detail-cheques-receipt-selected]").click(); });

  const table = host.querySelector("[data-testid=receipt-cheque-table]");
  expect(table).toBeTruthy();
  expect(table.textContent).toContain("SN-1");
  expect(table.textContent).toContain("SN-2");
  expect(table.textContent).not.toContain("SN-3");
  expect(host.textContent).toContain("Toplam 2 adet evrak");
  expect(host.querySelector("[data-testid=receipt-amount-words]").textContent).toMatch(/^Yalnız: /);
  expect(host.textContent).not.toContain("İşlem sonrası cari bakiye");
});

test("karışık yön seçilince makbuz açılmaz", async () => {
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-tab-cheques]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheque-select-CEK-1]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheque-select-CEK-3]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheques-receipt-selected]").click(); });
  expect(toast.error).toHaveBeenCalled();
  expect(host.querySelector("[data-testid=receipt-print-modal]")).toBeNull();
});

test("ödeme satırı çek kaynağındaysa eşleşen çeki items olarak geçirir", async () => {
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-tab-payments]").click(); });
  const chequeBtn = host.querySelector("[data-testid=receipt-btn-pay-cheque]")
    || host.querySelector("[data-testid=card-receipt-btn-pay-cheque]");
  await act(async () => { chequeBtn.click(); });
  const table = host.querySelector("[data-testid=receipt-cheque-table]");
  expect(table).toBeTruthy();
  expect(table.textContent).toContain("SN-1");
  expect(table.textContent).toContain("Garanti / Levent");
  expect(host.textContent).toContain("Toplam 1 adet evrak");

  await act(async () => { host.querySelector("[data-testid=receipt-close-btn]").click(); });
  const cashBtn = host.querySelector("[data-testid=receipt-btn-pay-cash]")
    || host.querySelector("[data-testid=card-receipt-btn-pay-cash]");
  await act(async () => { cashBtn.click(); });
  expect(host.querySelector("[data-testid=receipt-cheque-table]")).toBeNull();
  expect(host.querySelector("[data-testid=receipt-simple-table]").textContent).toContain("Nakit tahsilat");
  expect(host.querySelector("[data-testid=receipt-amount-words]").textContent).toMatch(/^Yalnız: /);
});
