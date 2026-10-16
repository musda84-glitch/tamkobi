/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import InvoicesPage from "./InvoicesPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INCOMING = {
  id: "gelen1",
  invoice_number: "GELEN-1",
  invoice_type: "purchase",
  direction: "incoming",
  e_type: "e_invoice",
  status: "approved",
  payment_status: "unpaid",
  contact_name: "Tedarik",
  contact_id: "ct9",
  grand_total: 24,
  currency: "TRY",
  issue_date: "2026-10-02",
  gib_status: "Gelen",
  items: [{ name: "Vida", sku: "VD-1", quantity: 2, unit: "ad", unit_price: 10, vat_rate: 20, total_incl: 24 }],
};

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    defaults: {},
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" }, addonOn: () => false, can: () => true }),
}));
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  invoiceTypeFilter: () => ({}),
  cachedList: async (collection) => (collection === "invoices" ? [INCOMING] : []),
  dropCached: async () => {},
}));

let host;
let root;

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockImplementation(() => Promise.resolve({ data: [] }));
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

test("gelen fatura kalemleri ve stok eşleştirme aynı testid ile açılır, detay isteği yok", async () => {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>,
    );
  });
  await flush();
  const detailBefore = axios.get.mock.calls.filter((c) => String(c[0]).includes("/invoices/gelen1"));
  expect(detailBefore).toHaveLength(0);
  const toggle = host.querySelector("[data-testid=inv-lines-toggle-GELEN-1]");
  expect(toggle).toBeTruthy();
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await act(async () => { toggle.click(); });
  await flush(2);
  expect(axios.get.mock.calls.filter((c) => String(c[0]).includes("/invoices/gelen1"))).toHaveLength(0);
  expect(host.querySelector("[data-testid=inv-lines-row-GELEN-1]")).toBeTruthy();
  expect(host.querySelector("[data-testid=inv-lines-table-GELEN-1]")).toBeTruthy();
  expect(host.querySelector("[data-testid=inv-line-GELEN-1-0]").textContent).toContain("Vida");
  expect(host.querySelector("[data-testid=inv-line-GELEN-1-0]").textContent).toContain("VD-1");
  expect(host.querySelector("[data-testid=inv-stock-match-bar-GELEN-1]")).toBeTruthy();
  expect(host.querySelector("[data-testid=inv-create-missing-products-GELEN-1]")).toBeTruthy();
  expect(host.querySelector("[data-testid=inv-line-select-GELEN-1-0]")).toBeTruthy();
  expect(host.querySelector("[data-testid=inv-line-create-GELEN-1-0]")).toBeTruthy();
});
