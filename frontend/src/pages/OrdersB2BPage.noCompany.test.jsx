/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import OrdersB2BPage from "./OrdersB2BPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    isCancel: (err) => err?.code === "ERR_CANCELED" || !!err?.__CANCEL__,
    defaults: {},
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => globalThis.__ordersNoCompanyAuth,
}));
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [globalThis.__ordersNoCompanyParams, globalThis.__ordersNoCompanySetParams],
}));
jest.mock("../utils/dataSync", () => ({
  cachedList: async () => [],
  contactTypeFilter: () => () => true,
  dropCached: async () => {},
}));

function setAuth(over = {}) {
  globalThis.__ordersNoCompanyAuth = {
    user: { role: "admin" },
    loading: false,
    authenticated: true,
    activeCompany: null,
    can: () => true,
    feature: () => true,
    ...over,
  };
}

function notice() {
  return document.querySelector("[data-testid='no-company']");
}

describe("OrdersB2BPage NoCompanyNotice", () => {
  let host;
  let root;

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
    window.matchMedia = () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    });
  });

  beforeEach(() => {
    globalThis.__ordersNoCompanyParams = new URLSearchParams();
    globalThis.__ordersNoCompanySetParams = jest.fn();
    setAuth();
    axios.get.mockResolvedValue({ data: [] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    host.remove();
  });

  async function render() {
    await act(async () => { root.render(<OrdersB2BPage />); });
  }

  test("auth loading iken yok; yükleme bitince ve firma yoksa var", async () => {
    setAuth({ loading: true, authenticated: false, activeCompany: null });
    await render();
    expect(notice()).toBeNull();

    setAuth({ loading: false, authenticated: true, activeCompany: null });
    await act(async () => { root.render(<OrdersB2BPage />); });
    expect(notice()).not.toBeNull();
    expect(notice().textContent).toContain("Firma seçili değil");

    setAuth({ loading: false, authenticated: true, activeCompany: { id: "c1", name: "Test" } });
    await act(async () => { root.render(<OrdersB2BPage />); });
    expect(notice()).toBeNull();
  });
});
