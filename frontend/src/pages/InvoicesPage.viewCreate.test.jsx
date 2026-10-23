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

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    isCancel: () => false,
    defaults: {},
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({
    activeCompany: { id: "c1" },
    addonOn: () => false,
    can: (mod, level) => {
      const rank = { none: 0, view: 1, edit: 2, delete: 3 };
      const have = globalThis.__invoicePerms?.[mod] || "none";
      return rank[have] >= rank[level];
    },
  }),
}));
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  invoiceTypeFilter: () => () => true,
  cachedList: async (_collection, _cid, opts) => {
    opts?.onCached?.([]);
    return [];
  },
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
  globalThis.__invoicePerms = { "/invoices": "view", "/dispatches": "view" };
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation(async () => ({ data: [] }));
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  jest.clearAllMocks();
});

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderPage(entry = "/") {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <InvoicesPage />
      </MemoryRouter>,
    );
  });
  await flush();
}

test("görür seviyesinde Yeni Fatura Kes görünmez ve ?new=true formu açmaz", async () => {
  await renderPage("/?new=true");
  expect(host.querySelector("[data-testid='create-new-invoice-btn']")).toBeNull();
  expect(host.textContent).not.toContain("Yeni Fatura Kes");
  expect(host.textContent).not.toContain("Yeni Fatura Düzenle");
});

test("ekler/düzenler seviyesinde Yeni Fatura Kes görünür", async () => {
  globalThis.__invoicePerms = { "/invoices": "edit", "/dispatches": "edit" };
  await renderPage();
  const button = host.querySelector("[data-testid='create-new-invoice-btn']");
  expect(button).not.toBeNull();
  expect(button.textContent).toContain("Yeni Fatura Kes");
});
