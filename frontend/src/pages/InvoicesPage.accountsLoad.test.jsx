/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import InvoicesPage from "./InvoicesPage";
import { DATA_CHANGED_EVENT } from "../utils/dataRefresh";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INVOICE = {
  id: "inv1",
  invoice_number: "F-1",
  invoice_type: "sales",
  status: "approved",
  payment_status: "unpaid",
  contact_name: "Acme",
  contact_id: "ct1",
  grand_total: 100,
  paid_amount: 0,
  currency: "TRY",
  issue_date: "2026-10-01",
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
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => {
  const auth = {
    activeCompany: { id: "c1" },
    addonOn: () => false,
    can: () => true,
  };
  return { API_URL: "/api", useAuth: () => auth };
});
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  invoiceTypeFilter: () => ({}),
  cachedList: async (collection, _cid, opts) => {
    const rows = collection === "invoices" ? [INVOICE] : [];
    globalThis.__invoiceLoads = globalThis.__invoiceLoads || { invoices: 0 };
    if (collection === "invoices") globalThis.__invoiceLoads.invoices += 1;
    opts?.onCached?.(rows);
    return rows;
  },
  dropCached: async () => {},
}));

let host;
let root;
let quiet;

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function accountCalls() {
  return axios.get.mock.calls.filter((c) => String(c[0]).includes("/banking/accounts"));
}

function projectCalls() {
  return axios.get.mock.calls.filter((c) => String(c[0]).includes("/projects"));
}

beforeEach(() => {
  globalThis.__invoiceLoads = { invoices: 0 };
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/accounts")) {
      return Promise.resolve({
        data: [{ id: "cash1", type: "cash_box", account_name: "Kasa", current_balance: 10 }],
      });
    }
    if (u.includes("/projects")) {
      return Promise.resolve({ data: [{ id: "p1", project_number: "PR-1", name: "Proje" }] });
    }
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  quiet.mockRestore();
  host.remove();
  jest.clearAllMocks();
});

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderPage() {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>,
    );
  });
  await flush(8);
}

test("ilk yüklemede /banking/accounts yok, tahsilat modalında bir kez", async () => {
  await renderPage();
  expect(host.textContent).toContain("F-1");
  expect(accountCalls()).toHaveLength(0);
  expect(projectCalls()).toHaveLength(1);
  const invoicesBefore = globalThis.__invoiceLoads.invoices;

  await act(async () => {
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, {
      detail: { companyId: "c1", scopes: ["cash"], at: Date.now() },
    }));
  });
  await flush(4);
  expect(globalThis.__invoiceLoads.invoices).toBe(invoicesBefore);
  expect(projectCalls()).toHaveLength(1);
  expect(accountCalls()).toHaveLength(0);

  const more = host.querySelector('[data-testid="inv-more-btn-F-1"]');
  expect(more).toBeTruthy();
  await act(async () => { more.click(); });
  await flush(2);
  const pay = document.body.querySelector('[data-testid="ctx-payment"]');
  expect(pay).toBeTruthy();
  await act(async () => { pay.click(); });
  await flush(6);
  expect(host.querySelector('[data-testid="payment-modal"]')).toBeTruthy();
  expect(accountCalls()).toHaveLength(1);

  const close = [...host.querySelectorAll("button")].find((b) => b.textContent === "İptal");
  await act(async () => { close.click(); });
  await flush(2);
  await act(async () => { host.querySelector('[data-testid="inv-more-btn-F-1"]').click(); });
  await flush(2);
  await act(async () => { document.body.querySelector('[data-testid="ctx-payment"]').click(); });
  await flush(4);
  expect(accountCalls()).toHaveLength(1);
  expect(projectCalls()).toHaveLength(1);
});
