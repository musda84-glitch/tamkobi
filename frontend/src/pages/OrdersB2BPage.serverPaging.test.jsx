/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import OrdersB2BPage from "./OrdersB2BPage";
import { ORDERS_PAGING_STORAGE_KEY } from "../utils/featureFlags";
import { DATA_CHANGED_EVENT } from "../utils/dataRefresh";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    isCancel: (err) => err?.code === "ERR_CANCELED",
    defaults: {},
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } }));
jest.mock("../context/AuthContext", () => {
  const company = { id: "c1", name: "Test A.Ş." };
  return {
    API_URL: "/api",
    useAuth: () => ({
      user: { role: "admin" },
      activeCompany: company,
      can: () => true,
      feature: () => true,
    }),
  };
});
jest.mock("react-router-dom", () => {
  const ReactLib = require("react");
  return {
    useNavigate: () => jest.fn(),
    useSearchParams: () => {
      const [, bump] = ReactLib.useState(0);
      ReactLib.useEffect(() => {
        const fn = () => bump((n) => n + 1);
        globalThis.__orderParamListeners.add(fn);
        return () => globalThis.__orderParamListeners.delete(fn);
      }, [bump]);
      const setParams = (next) => {
        const current = globalThis.__orderParams;
        globalThis.__orderParams = typeof next === "function" ? next(current) : new URLSearchParams(next);
        globalThis.__orderParamListeners.forEach((fn) => fn());
      };
      return [globalThis.__orderParams, setParams];
    },
  };
});
jest.mock("../utils/dataSync", () => ({
  cachedList: async () => [],
  contactTypeFilter: () => () => true,
  dropCached: async () => {},
}));

function summary(over = {}) {
  return {
    count: 40,
    total_amount: 9999,
    open_count: 4,
    closed_count: 2,
    missing_contact: 3,
    counts: { pending: 4 },
    channels: ["b2b"],
    pool_open_count: 11,
    pool_closed_count: 6,
    pool_missing_contact: 3,
    pool_counts: { pending: 8, cancelled: 6 },
    pool_channels: ["b2b", "trendyol"],
    ...over,
  };
}

function row(id, name) {
  return {
    id,
    order_number: id,
    customer_name: name,
    order_status: "pending",
    channel: "b2b",
    items: [],
    grand_total: 10,
    total_amount: 10,
    currency: "TRY",
  };
}

function pageBody(params) {
  const pageNo = Number(params?.page || 1);
  const status = params?.status || "";
  if (status === "pending") {
    return {
      items: [row("pend", "Durum Pending")],
      total: 1,
      page: 1,
      page_size: Number(params?.page_size || 50),
      has_more: false,
      summary: summary({ count: 1, total_amount: 9999 }),
    };
  }
  if (pageNo === 1) {
    return {
      items: [row("p1", "Sunucu Sipariş")],
      total: 40,
      page: 1,
      page_size: Number(params?.page_size || 50),
      has_more: true,
      total_amount: 10,
      open_count: 1,
      closed_count: 0,
      missing_contact: 0,
      counts: { pending: 1 },
      channels: ["b2b"],
      summary: summary(),
    };
  }
  return {
    items: [row("p2", "Ikinci Sayfa")],
    total: 40,
    page: pageNo,
    page_size: Number(params?.page_size || 50),
    has_more: false,
    summary: summary(),
  };
}

function orderCalls() {
  return axios.get.mock.calls.filter((call) => String(call[0]).split("?")[0].endsWith("/orders"));
}

let host;
let root;

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.__orderParamListeners = new Set();
});

beforeEach(() => {
  localStorage.removeItem(ORDERS_PAGING_STORAGE_KEY);
  localStorage.removeItem("orders-page-size");
  globalThis.__orderParams = new URLSearchParams();
  globalThis.__orderParamListeners = new Set();
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url, config) => {
    const path = String(url).split("?")[0];
    if (path.endsWith("/orders")) return Promise.resolve({ data: pageBody(config?.params) });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  localStorage.removeItem(ORDERS_PAGING_STORAGE_KEY);
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function waitFor(predicate, { tries = 40 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
  }
  throw new Error("waitFor timed out");
}

async function renderPage() {
  root = createRoot(host);
  await act(async () => { root.render(<OrdersB2BPage />); });
  await flush(10);
}

function setControl(el, value) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

test("bayrak kapalıyken eski paged isteği gider, özet sayfası okunmaz", async () => {
  await renderPage();
  await waitFor(() => orderCalls().length >= 1);
  const calls = orderCalls();
  expect(calls[0][1].params.paged).toBe(1);
  expect(calls[0][1].signal).toBeUndefined();
  expect(host.textContent).toContain("Sunucu Sipariş");
  expect(host.textContent).not.toContain("9.999");
  expect(host.querySelector("[data-testid='orders-load-more']")?.tagName).not.toBe("BUTTON");
  const sizes = [...host.querySelectorAll("[data-testid='ord-page-size'] option")].map((o) => o.value);
  expect(sizes).toEqual(["50", "100", "200", "500", "1000"]);
});

test("bayrak açıkken sayfa ister, özet sayfa dilimi değildir, filtre 1. sayfaya döner", async () => {
  localStorage.setItem(ORDERS_PAGING_STORAGE_KEY, "1");
  const signals = [];
  axios.get.mockImplementation((url, config) => {
    const path = String(url).split("?")[0];
    if (path.endsWith("/orders")) {
      signals.push(config?.signal);
      return Promise.resolve({ data: pageBody(config?.params) });
    }
    return Promise.resolve({ data: [] });
  });
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Sipariş"));
  const first = orderCalls().at(-1);
  expect(first[1].params.paged).toBeUndefined();
  expect(first[1].params.page).toBe(1);
  expect(first[1].params.page_size).toBe(50);
  expect(first[1].signal).toBeInstanceOf(AbortSignal);
  expect(host.textContent).toContain("9.999");
  expect(host.textContent).toContain("Gelen Siparişler (11)");
  const sizes = [...host.querySelectorAll("[data-testid='ord-page-size'] option")].map((o) => o.value);
  expect(sizes).toEqual(["50", "100", "200"]);

  const more = host.querySelector("[data-testid='orders-load-more']");
  expect(more?.tagName).toBe("BUTTON");
  await act(async () => { more.click(); });
  await flush(8);
  await waitFor(() => host.textContent.includes("Ikinci Sayfa"));
  expect(host.textContent).toContain("Sunucu Sipariş");
  expect(orderCalls().at(-1)[1].params.page).toBe(2);

  const status = host.querySelector("[data-testid='ord-status']");
  await act(async () => { setControl(status, "pending"); });
  await flush(8);
  await waitFor(() => orderCalls().some((call) => call[1].params.status === "pending" && call[1].params.page === 1));
  expect(signals[0].aborted).toBe(true);
  expect(host.textContent).toContain("Durum Pending");
  expect(host.textContent).not.toContain("Ikinci Sayfa");

  const before = orderCalls().length;
  await act(async () => {
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { companyId: "c1", scopes: ["orders"] } }));
  });
  await flush(8);
  await waitFor(() => orderCalls().length > before);
  expect(orderCalls().at(-1)[1].params.page).toBe(1);
  expect(orderCalls().at(-1)[1].params.paged).toBeUndefined();
});
