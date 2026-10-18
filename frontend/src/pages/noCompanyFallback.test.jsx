/**
 * @jest-environment jsdom
 */
import React from "react";
import fs from "fs";
import path from "path";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import PersonnelPage from "./PersonnelPage";
import WarehousePage from "./WarehousePage";
import InvoicesPage from "./InvoicesPage";
import Dashboard from "./Dashboard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HARDCODED_COMPANY = "comp_nexus_main_01";

const STATS = {
  total_bank_balance: 0,
  total_stock_value: 0,
  total_receivables: 0,
  total_payables: 0,
  net_profit: 0,
  monthly_sales: 0,
  receivable_count: 0,
  payable_count: 0,
  sales_change_pct: 0,
  pending_orders_count: 0,
  low_stock_count: 0,
  chart_data: [],
  channels_breakdown: [],
  low_stock_products: [],
  recent_invoices: [],
  decision: [],
};

function authFor(company) {
  return {
    activeCompany: company,
    can: () => true,
    addonOn: () => false,
    user: { role: "admin", is_super_admin: true },
  };
}

globalThis.__noCompanyAuth = authFor(null);

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    isCancel: () => false,
    defaults: {},
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn(), message: jest.fn() },
}));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => globalThis.__noCompanyAuth,
}));

const PAGES = [
  ["PersonnelPage", PersonnelPage, "personnel-page"],
  ["WarehousePage", WarehousePage, "warehouses-page"],
  ["InvoicesPage", InvoicesPage, "invoices-page"],
  ["Dashboard", Dashboard, "dashboard-loading"],
];

function listSourceFiles(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) listSourceFiles(full, acc);
    else if (!name.includes(".test.") && !name.includes(".spec.")) acc.push(full);
  }
  return acc;
}

function dumpCalls() {
  return [...axios.get.mock.calls, ...axios.post.mock.calls].map((args) => {
    try { return JSON.stringify(args); } catch { return String(args[0]); }
  }).join("\n");
}

function mentionsCompany(blob, id) {
  return blob.includes(`company_id=${id}`) || blob.includes(`"company_id":"${id}"`);
}

let host;
let root;
let quiet;

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    });
  }
});

beforeEach(() => {
  globalThis.__noCompanyAuth = authFor(null);
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/dashboard/stats")) return Promise.resolve({ data: STATS });
    if (u.includes("/personnel/messages")) return Promise.resolve({ data: { mode: "none" } });
    if (u.includes("/personnel/attendance")) return Promise.resolve({ data: { summary: [] } });
    if (u.includes("/personnel/pending-requests")) return Promise.resolve({ data: { items: [] } });
    if (u.includes("/personnel/role-options")) return Promise.resolve({ data: { roles: [] } });
    if (u.includes("/sync")) {
      return Promise.resolve({ data: { collections: {}, server_time: "t", complete: true } });
    }
    if (u.includes("/dashboard/overview") || u.includes("/demo/status")) return Promise.resolve({ data: null });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockImplementation(() => Promise.resolve({ data: {} }));
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

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderPage(Component) {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Component />
      </MemoryRouter>,
    );
  });
  await flush(10);
}

test("frontend sources outside tests do not hardcode the nexus company id", () => {
  const rootDir = path.resolve(__dirname, "..");
  const hits = listSourceFiles(rootDir).filter((file) => {
    const text = fs.readFileSync(file, "utf8");
    return text.includes(HARDCODED_COMPANY);
  });
  expect(hits).toEqual([]);
});

test("pages render without a company and never request the hardcoded id", async () => {
  for (const [, Component, testId] of PAGES) {
    axios.get.mockClear();
    axios.post.mockClear();
    await renderPage(Component);
    expect(host.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    expect(host.querySelector('[data-testid="no-company"]')).not.toBeNull();
    expect(host.textContent).toContain("Firma seçili değil");
    const blob = dumpCalls();
    expect(blob.includes(HARDCODED_COMPANY)).toBe(false);
    if (root) {
      act(() => { root.unmount(); });
      root = null;
    }
    host.innerHTML = "";
  }
});

test("the same pages request company_id=c1 when a company is selected", async () => {
  globalThis.__noCompanyAuth = authFor({ id: "c1" });
  for (const [name, Component, testId] of PAGES) {
    axios.get.mockClear();
    axios.post.mockClear();
    await renderPage(Component);
    const shown = name === "Dashboard" ? "dashboard-view" : testId;
    expect(host.querySelector(`[data-testid="${shown}"]`) || host.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    expect(host.querySelector('[data-testid="no-company"]')).toBeNull();
    const blob = dumpCalls();
    expect(blob.includes(HARDCODED_COMPANY)).toBe(false);
    expect(mentionsCompany(blob, "c1")).toBe(true);
    if (root) {
      act(() => { root.unmount(); });
      root = null;
    }
    host.innerHTML = "";
  }
});
