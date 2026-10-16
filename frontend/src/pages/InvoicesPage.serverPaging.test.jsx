/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import InvoicesPage from "./InvoicesPage";
import { INVOICES_PAGING_STORAGE_KEY } from "../utils/featureFlags";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT_INVOICE = {
  id: "local-1",
  invoice_number: "YEREL-1",
  invoice_type: "sales",
  e_type: "paper",
  status: "approved",
  payment_status: "unpaid",
  contact_name: "Yerel Cari",
  contact_id: "ct-local",
  grand_total: 10,
  currency: "TRY",
  issue_date: "2026-01-01",
  items: [{ name: "Yerel kalem", quantity: 1 }],
};

const SERVER_ROW = {
  id: "p1",
  invoice_number: "SF-1",
  invoice_type: "sales",
  e_type: "paper",
  status: "draft",
  payment_status: "unpaid",
  contact_name: "Sunucu Cari",
  contact_id: "ct-1",
  grand_total: 80,
  currency: "TRY",
  issue_date: "2026-04-01",
};

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    isCancel: (err) => err?.code === "ERR_CANCELED",
    defaults: {},
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), message: jest.fn() } }));
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
  invoiceTypeFilter: () => () => true,
  cachedList: async (collection, _cid, opts) => {
    globalThis.__cachedListCalls.push(collection);
    if (collection !== "invoices") return [];
    const rows = [CLIENT_INVOICE];
    opts?.onCached?.(rows);
    return rows;
  },
  dropCached: async () => {},
}));

function pageBody(params) {
  const pageNo = Number(params?.page || 1);
  const q = params?.q || "";
  if (q) {
    return {
      items: [{ ...SERVER_ROW, id: "q1", invoice_number: "AR-9", contact_name: "Arama Cari" }],
      total: 1,
      page: 1,
      page_size: Number(params?.page_size || 50),
      has_more: false,
      summary: { count: 1, total_amount: 15, draft_count: 0, approved_count: 1 },
    };
  }
  if (pageNo === 1) {
    return {
      items: [SERVER_ROW],
      total: 2,
      page: 1,
      page_size: Number(params?.page_size || 50),
      has_more: true,
      summary: { count: 2, total_amount: 180, draft_count: 1, approved_count: 1 },
    };
  }
  return {
    items: [{ ...SERVER_ROW, id: "p2", invoice_number: "SF-2", contact_name: "Ikinci Sayfa", status: "approved" }],
    total: 2,
    page: pageNo,
    page_size: Number(params?.page_size || 50),
    has_more: false,
    summary: { count: 2, total_amount: 180, draft_count: 1, approved_count: 1 },
  };
}

function invoicePageCalls() {
  return axios.get.mock.calls.filter((c) => String(c[0]).includes("/invoices/page") && !String(c[0]).includes("/invoices/page/ids"));
}

let host;
let root;
let quiet;

beforeAll(() => {
  global.IntersectionObserver = class {
    constructor(cb) { globalThis.__io = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  localStorage.removeItem(INVOICES_PAGING_STORAGE_KEY);
  globalThis.__cachedListCalls = [];
  globalThis.__io = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url, config) => {
    const u = String(url);
    if (u.includes("/invoices/page/ids")) {
      return Promise.resolve({ data: { ids: ["p1", "p2"], total: 2 } });
    }
    if (u.includes("/invoices/page")) return Promise.resolve({ data: pageBody(config?.params) });
    if (u.includes("/invoices/p1")) {
      return Promise.resolve({ data: { ...SERVER_ROW, items: [{ name: "Kalem Un", quantity: 2, unit_price: 40, total: 80 }] } });
    }
    if (u.includes("/projects")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  localStorage.removeItem(INVOICES_PAGING_STORAGE_KEY);
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

async function renderPage() {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>,
    );
  });
  await flush(10);
}

test("bayrak kapalıyken cachedList kullanılır, /invoices/page çağrılmaz", async () => {
  await renderPage();
  expect(globalThis.__cachedListCalls).toContain("invoices");
  expect(host.textContent).toContain("YEREL-1");
  expect(invoicePageCalls()).toHaveLength(0);
  expect(host.textContent).not.toContain("SF-1");
});

test("bayrak açıkken sayfa ister, filtre değişince page=1, özet ve tümünü seç", async () => {
  localStorage.setItem(INVOICES_PAGING_STORAGE_KEY, "1");
  await renderPage();
  expect(globalThis.__cachedListCalls).not.toContain("invoices");
  expect(invoicePageCalls().length).toBeGreaterThan(0);
  expect(invoicePageCalls()[0][1].params.page).toBe(1);
  expect(host.textContent).toContain("SF-1");
  expect(host.textContent).not.toContain("YEREL-1");
  expect(host.querySelector('[data-testid="invoices-load-more-server"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="invoices-load-more"]')).toBeNull();
  const summary = host.querySelector('[data-testid="inv-result-summary"]');
  expect(summary.textContent).toContain("2");
  expect(summary.textContent).toContain("belge");
  expect(host.querySelector('[data-testid="inv-status-counts"]').textContent).toContain("Taslak");
  expect(host.querySelector('[data-testid="inv-status-counts"]').textContent).toContain("1");
  expect(host.querySelector('[data-testid="inv-status-counts"]').textContent).toContain("Onaylı");

  const before = invoicePageCalls().length;
  const input = host.querySelector('[data-testid="inv-search"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "arpa");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush(8);
  const after = invoicePageCalls();
  expect(after.length).toBeGreaterThan(before);
  const last = after[after.length - 1][1].params;
  expect(last.page).toBe(1);
  expect(last.q).toBe("arpa");
  expect(host.textContent).toContain("AR-9");

  await act(async () => {
    host.querySelector('[data-testid="inv-select-all"]').click();
  });
  await flush(6);
  const idCalls = axios.get.mock.calls.filter((c) => String(c[0]).includes("/invoices/page/ids"));
  expect(idCalls.length).toBeGreaterThan(0);
  expect(host.querySelector('[data-testid="inv-all-selected"]').textContent).toContain("2 belgenin tümü seçildi");
});

test("proforma ve irsaliye sekmeleri bayrak açıkken eski yolda kalır", async () => {
  localStorage.setItem(INVOICES_PAGING_STORAGE_KEY, "1");
  await renderPage();
  const pageBefore = invoicePageCalls().length;
  expect(pageBefore).toBeGreaterThan(0);

  await act(async () => {
    host.querySelector('[data-testid="filter-tab-proforma"]').click();
  });
  await flush(8);
  expect(globalThis.__cachedListCalls).toContain("invoices");
  expect(invoicePageCalls().length).toBe(pageBefore);

  await act(async () => {
    host.querySelector('[data-testid="filter-tab-dispatch"]').click();
  });
  await flush(8);
  expect(invoicePageCalls().length).toBe(pageBefore);
  expect(globalThis.__cachedListCalls.filter((name) => name === "invoices").length).toBeGreaterThan(0);
});

test("bayrak açıkken kalem açma GET /invoices/{id} çağırır", async () => {
  localStorage.setItem(INVOICES_PAGING_STORAGE_KEY, "1");
  await renderPage();
  const toggle = host.querySelector('[data-testid="inv-lines-toggle-SF-1"]');
  expect(toggle).toBeTruthy();
  await act(async () => { toggle.click(); });
  await flush(8);
  const detail = axios.get.mock.calls.filter((c) => /\/invoices\/p1$/.test(String(c[0]).split("?")[0]));
  expect(detail.length).toBeGreaterThan(0);
  expect(host.textContent).toContain("Kalem Un");
});
