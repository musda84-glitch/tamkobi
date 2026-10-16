/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
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
  useAuth: () => ({ activeCompany: { id: "c1" }, can: () => true }),
}));

const FULL_ITEM = { name: "Kalem A", sku: "SKU1", quantity: 2, unit: "ad", unit_price: 50, vat_rate: 20, total_incl: 120 };
const BARE_ITEM = { name: "Lazy Kalem", sku: "LZ", quantity: 1, unit: "ad", unit_price: 10, vat_rate: 20, total: 12 };
const DISP_ITEM = { name: "Sevk", quantity: 3, unit: "ad", unit_price: 0, vat_rate: 0, total: 0 };

const OVERVIEW = {
  contact: { id: "ct1", company_id: "c1", name: "Acme", type: "customer", balance: 100, tax_number_or_id: "111" },
  summary: { total_invoiced: 120, total_paid: 0, open_amount: 120, invoice_count: 3, draft_count: 1, opening_balance: 0 },
  invoices: [
    { id: "full", invoice_number: "F-FULL", invoice_type: "sales", status: "approved", payment_status: "unpaid", grand_total: 120, issue_date: "2026-10-01", currency: "TRY", gib_status: "Onaylandı", items: [FULL_ITEM] },
    { id: "bare", invoice_number: "F-BARE", invoice_type: "sales", status: "draft", payment_status: "unpaid", grand_total: 10, issue_date: "2026-10-02", currency: "TRY", gib_status: "Taslak" },
    { id: "disp", invoice_number: "IRS-1", invoice_type: "dispatch", e_type: "e_dispatch", status: "approved", payment_status: "unpaid", grand_total: 0, issue_date: "2026-10-03", currency: "TRY", items: [DISP_ITEM] },
  ],
  payments: [],
  orders: [],
  communications: [],
  quotes: [],
  surveys: [],
  cheques: [],
  projects: [],
  email_deliveries: [],
};

function invoiceDetailCalls() {
  return axios.get.mock.calls.filter((c) => /\/invoices\/[^/?]+$/.test(String(c[0])) || /\/quotes\/[^/?]+$/.test(String(c[0])));
}

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
    if (u.includes("/invoices/bare")) return Promise.resolve({ data: { id: "bare", items: [BARE_ITEM] } });
    if (u.includes("/installments")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  jest.clearAllMocks();
});

async function flush(times = 6) {
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

test("overview kalemli fatura toggle ile görünür, detay isteği yok", async () => {
  await renderPanel();
  expect(host.textContent).toContain("F-FULL");
  expect(host.querySelector("[data-testid=detail-inv-summary]").textContent).toMatch(/onaylı/);
  expect(host.querySelector("[data-testid=detail-inv-summary]").textContent).toMatch(/taslak/);
  expect(host.querySelector("[data-testid=detail-inv-draft-F-BARE]")).toBeTruthy();
  expect(invoiceDetailCalls()).toHaveLength(0);

  const toggle = host.querySelector("[data-testid=detail-inv-lines-toggle-F-FULL]");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.getAttribute("title")).toBe("Kalemleri göster");
  await act(async () => { toggle.click(); });
  await flush(2);
  expect(invoiceDetailCalls()).toHaveLength(0);
  expect(host.querySelector("[data-testid=detail-inv-lines-row-F-FULL]")).toBeTruthy();
  expect(host.querySelector("[data-testid=detail-inv-line-F-FULL-0]").textContent).toContain("Kalem A");
  expect(host.querySelector("[data-testid=detail-inv-line-F-FULL-0]").textContent).toContain("SKU1");
  expect(host.querySelector("[data-testid=invoice-context-menu]")).toBeNull();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
});

test("kalemsiz fatura bir kez lazy GET eder", async () => {
  await renderPanel();
  expect(invoiceDetailCalls()).toHaveLength(0);
  const toggle = host.querySelector("[data-testid=detail-inv-lines-toggle-F-BARE]");
  await act(async () => { toggle.click(); });
  await flush(4);
  expect(invoiceDetailCalls()).toHaveLength(1);
  expect(String(invoiceDetailCalls()[0][0])).toContain("/invoices/bare");
  expect(host.querySelector("[data-testid=detail-inv-line-F-BARE-0]").textContent).toContain("Lazy Kalem");
  await act(async () => { toggle.click(); });
  await act(async () => { toggle.click(); });
  await flush(2);
  expect(invoiceDetailCalls()).toHaveLength(1);
  expect(host.querySelector("[data-testid=detail-inv-line-F-BARE-0]")).toBeTruthy();
});

test("irsaliye satırı açılıp kapanır", async () => {
  await renderPanel();
  const toggle = host.querySelector("[data-testid=detail-inv-lines-toggle-IRS-1]");
  expect(host.querySelector("[data-testid=detail-inv-dispatch-nobal-IRS-1]")).toBeTruthy();
  await act(async () => { toggle.click(); });
  const line = host.querySelector("[data-testid=detail-inv-line-IRS-1-0]");
  expect(line.textContent).toContain("Sevk");
  expect(line.textContent).toMatch(/0,00/);
  expect(invoiceDetailCalls()).toHaveLength(0);
  await act(async () => { toggle.click(); });
  expect(host.querySelector("[data-testid=detail-inv-lines-row-IRS-1]")).toBeNull();
  expect(toggle.getAttribute("title")).toBe("Kalemleri göster");
});

test("boş fatura listesinde colspan toggle sütununu kapsar", async () => {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/overview")) return Promise.resolve({ data: { ...OVERVIEW, invoices: [], summary: { ...OVERVIEW.summary, draft_count: 0 } } });
    return Promise.resolve({ data: [] });
  });
  await renderPanel();
  const empty = [...host.querySelectorAll("td")].find((td) => td.textContent === "Fatura yok.");
  expect(empty).toBeTruthy();
  expect(empty.getAttribute("colspan")).toBe("8");
});
