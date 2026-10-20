/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import axios from "axios";
import OrdersB2BPage from "./OrdersB2BPage";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: { message: "ok" } })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    isCancel: (err) => err?.code === "ERR_CANCELED",
    defaults: {},
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => globalThis.__ordersStaffAuth,
}));
jest.mock("react-router-dom", () => {
  const ReactLib = require("react");
  return {
    useNavigate: () => jest.fn(),
    useSearchParams: () => {
      const [, bump] = ReactLib.useState(0);
      ReactLib.useEffect(() => {
        const fn = () => bump((n) => n + 1);
        globalThis.__staffOrderParamListeners.add(fn);
        return () => globalThis.__staffOrderParamListeners.delete(fn);
      }, [bump]);
      const setParams = (next) => {
        const current = globalThis.__staffOrderParams;
        globalThis.__staffOrderParams = typeof next === "function" ? next(current) : new URLSearchParams(next);
        globalThis.__staffOrderParamListeners.forEach((fn) => fn());
      };
      return [globalThis.__staffOrderParams, setParams];
    },
  };
});
jest.mock("../utils/dataSync", () => ({
  cachedList: async () => [],
  contactTypeFilter: () => () => true,
  dropCached: async () => {},
}));

const sample = {
  id: "o1",
  order_number: "B2B-1",
  customer_name: "ERSAY",
  order_status: "pending",
  channel: "saha",
  order_date: "2026-10-20",
  grand_total: 1500,
  total_amount: 1500,
  shipping_address: "Atölye sokak 1",
  city: "İstanbul",
  notes: "Acil kesim",
  items: [{ product_name: "Profil", quantity: 2, unit_price: 100, total: 200, note: "kırmızı" }],
};

function pageBody() {
  return {
    items: [sample],
    total: 1,
    page: 1,
    page_size: 50,
    has_more: false,
    total_amount: 1500,
    open_count: 1,
    closed_count: 0,
    missing_contact: 0,
    counts: { pending: 1 },
    channels: ["saha"],
    summary: {
      count: 1,
      total_amount: 1500,
      open_count: 1,
      closed_count: 0,
      missing_contact: 0,
      counts: { pending: 1 },
      channels: ["saha"],
      pool_open_count: 1,
      pool_closed_count: 0,
      pool_missing_contact: 0,
      pool_counts: { pending: 1 },
      pool_channels: ["saha"],
    },
  };
}

function setMedia(matches) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

function setAuth({ user, loading = false, viewPrices = true } = {}) {
  globalThis.__ordersStaffAuth = {
    user,
    loading,
    activeCompany: { id: "c1", name: "Test A.Ş." },
    can: () => true,
    feature: (key) => (key === "view_prices" ? viewPrices : true),
  };
}

const personel = { role: "personel", features: { portal_orders: true } };

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.__staffOrderParamListeners = new Set();
});

beforeEach(() => {
  globalThis.__staffOrderParams = new URLSearchParams();
  globalThis.__staffOrderParamListeners = new Set();
  setMedia(false);
  setAuth({ user: { role: "admin" } });
  axios.get.mockImplementation((url, config) => {
    const path = String(url).split("?")[0];
    if (/\/orders\/[^/]+$/.test(path)) return Promise.resolve({ data: { ...sample } });
    if (path.endsWith("/orders")) {
      const params = config?.params || {};
      const staffList = params.company_id && params.paged == null && params.page == null;
      return Promise.resolve({ data: staffList ? [{ ...sample }] : pageBody() });
    }
    if (String(url).includes("stations")) return Promise.resolve({ data: ["CNC"] });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockClear();
  axios.post.mockResolvedValue({ data: { message: "ok" } });
});

async function renderPage() {
  const view = render(<OrdersB2BPage />);
  return view;
}

test("admin on a narrow screen keeps the existing orders page", async () => {
  setMedia(true);
  setAuth({ user: { role: "admin" } });
  await renderPage();
  expect(await screen.findByTestId("orders-b2b-page")).toBeInTheDocument();
  expect((await screen.findAllByText("ERSAY")).length).toBeGreaterThan(0);
  expect(screen.queryByTestId("orders-staff-mobile")).not.toBeInTheDocument();
  expect(screen.getAllByTestId("order-delete-B2B-1").length).toBeGreaterThan(0);
  expect(screen.getAllByTitle("Diğer işlemler").length).toBeGreaterThan(0);
  expect(screen.getAllByTestId("convert-inv-btn-B2B-1").length).toBeGreaterThan(0);
  expect(screen.getByTestId("orders-bulk-menu-btn")).toBeInTheDocument();
  expect(screen.getAllByText("Toplu İşlemler").length).toBeGreaterThan(0);
  expect(screen.getByTestId("new-order-btn")).toBeInTheDocument();
  expect(screen.getByTestId("tab-claims")).toBeInTheDocument();
});

test("owner and manager on a phone still see the full orders page", async () => {
  setMedia(true);
  for (const role of ["owner", "manager"]) {
    setAuth({ user: { role } });
    const view = await renderPage();
    expect(await screen.findByTestId("orders-b2b-page")).toBeInTheDocument();
    expect(screen.queryByTestId("orders-staff-mobile")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("order-delete-B2B-1").length).toBeGreaterThan(0);
    view.unmount();
  }
});

test("personel desktop keeps the orders layout and only the five actions", async () => {
  setMedia(false);
  setAuth({ user: personel });
  await renderPage();
  expect(await screen.findByText("Sipariş Modülü")).toBeInTheDocument();
  expect((await screen.findAllByText("B2B-1")).length).toBeGreaterThan(0);
  expect(screen.getByTestId("orders-b2b-page")).toBeInTheDocument();
  expect(screen.queryByTestId("orders-staff-mobile")).not.toBeInTheDocument();
  for (const name of ["Sipariş yazdır", "Eksik bildir", "Üretime al", "Kargola", "Kargo etiketi"]) {
    expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
  }
  expect(screen.queryByTestId("order-delete-B2B-1")).not.toBeInTheDocument();
  expect(screen.queryByTitle("Diğer işlemler")).not.toBeInTheDocument();
  expect(screen.queryByText("Diğer işlemler")).not.toBeInTheDocument();
  expect(screen.queryByTestId("convert-inv-btn-B2B-1")).not.toBeInTheDocument();
  expect(screen.queryByTestId("orders-bulk-menu-btn")).not.toBeInTheDocument();
  expect(screen.queryByTestId("orders-bulk-menu-btn-m")).not.toBeInTheDocument();
  expect(screen.queryByText("Toplu İşlemler")).not.toBeInTheDocument();
  expect(screen.queryByTestId("new-order-btn")).not.toBeInTheDocument();
  expect(screen.queryByTestId("auto-ship-btn")).not.toBeInTheDocument();
  expect(screen.queryByTestId("tab-claims")).not.toBeInTheDocument();
  expect(screen.queryByText("Siparişi Düzenle")).not.toBeInTheDocument();
  expect(screen.queryByText("Taslağı Faturalaştır")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sil" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Onayla" })).not.toBeInTheDocument();
  expect(screen.queryByText("e-Belge")).not.toBeInTheDocument();
});

test("personel on a narrow screen opens the staff list, detail and produce page", async () => {
  setMedia(true);
  setAuth({ user: personel, viewPrices: true });
  await renderPage();
  expect(await screen.findByTestId("orders-staff-mobile")).toBeInTheDocument();
  expect(screen.queryByTestId("orders-b2b-page")).not.toBeInTheDocument();
  expect(screen.getByTestId("order-filter-new")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByPlaceholderText("Sipariş no / müşteri")).toBeInTheDocument();
  expect(screen.getByTestId("order-amount-o1")).toHaveTextContent("1.500,00");
  expect(screen.getByText(/ERSAY · Beklemede · 20.10.2026/)).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("order-row-o1"));
  const detail = await screen.findByTestId("orders-staff-detail");
  const actions = within(detail).getByTestId("order-staff-actions");
  expect(within(actions).getAllByRole("button")).toHaveLength(5);
  expect(within(detail).getByTestId("order-staff-note")).toHaveTextContent("Personel görünümü: yalnız 5 işlem. Diğer işlemler gizli.");
  expect(within(detail).queryByText(/gizli işlemler kutusu/i)).not.toBeInTheDocument();
  expect(detail.querySelector(".bg-rose-600, .bg-red-600, [data-testid='order-staff-hidden-box']")).toBeNull();
  expect(within(detail).queryByRole("button", { name: /Sil|Düzenle|Onayla|Faturalaştır|Diğer işlemler/ })).not.toBeInTheDocument();
  expect(within(detail).queryByText("Kalemi sil")).not.toBeInTheDocument();
  expect(within(detail).getByTestId("order-item-0")).toHaveTextContent("Sipariş stok notu · kırmızı");
  expect(within(detail).getByTestId("order-item-0")).toHaveTextContent("2 × 100,00 ₺");
  expect(within(detail).getByTestId("order-detail-total")).toHaveTextContent("1.500,00");
  expect(within(detail).getByText("Saha")).toBeInTheDocument();

  fireEvent.click(within(actions).getByRole("button", { name: "Eksik bildir" }));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith("/api/order-picks/o1/notify-missing", {}));

  fireEvent.click(await screen.findByRole("button", { name: "Üretime al" }));
  expect(await screen.findByTestId("orders-staff-produce")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("order-produce-missing"));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith("/api/order-picks/o1/to-production", {}));

  fireEvent.click(await screen.findByRole("button", { name: "Üretime al" }));
  fireEvent.click(screen.getByTestId("order-produce-btn"));
  expect(await screen.findByTestId("order-produce-recipe-modal")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("order-produce-recipe-close"));
  fireEvent.click(screen.getByTestId("order-produce-cancel"));
  expect(screen.queryByTestId("orders-staff-produce")).not.toBeInTheDocument();
  expect(screen.getByTestId("orders-staff-detail")).toBeInTheDocument();
});

test("personel narrow hides amounts when view_prices is off", async () => {
  setMedia(true);
  setAuth({ user: personel, viewPrices: false });
  await renderPage();
  expect(await screen.findByTestId("order-row-o1")).toBeInTheDocument();
  expect(screen.queryByTestId("order-amount-o1")).not.toBeInTheDocument();
  expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("order-row-o1"));
  const item = await screen.findByTestId("order-item-0");
  expect(item).toHaveTextContent("2");
  expect(item).not.toHaveTextContent("₺");
  expect(item).not.toHaveTextContent("100");
  expect(screen.queryByTestId("order-detail-total")).not.toBeInTheDocument();
  expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
});

test("personel without portal_orders renders neither staff screen nor order actions", async () => {
  setMedia(true);
  setAuth({ user: { role: "personel", features: {} } });
  const view = await renderPage();
  expect(screen.queryByTestId("orders-staff-mobile")).not.toBeInTheDocument();
  expect(screen.queryByTestId("orders-b2b-page")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sipariş yazdır" })).not.toBeInTheDocument();
  expect(screen.queryByText("Toplu İşlemler")).not.toBeInTheDocument();
  expect(view.container).toBeEmptyDOMElement();
});

test("auth loading and a null user render no order actions", async () => {
  setMedia(true);
  setAuth({ user: { role: "personel", features: { portal_orders: true } }, loading: true });
  let view = await renderPage();
  expect(screen.queryByTestId("orders-staff-mobile")).not.toBeInTheDocument();
  expect(screen.queryByTestId("orders-b2b-page")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sipariş yazdır" })).not.toBeInTheDocument();
  expect(screen.queryByText("Toplu İşlemler")).not.toBeInTheDocument();
  view.unmount();

  setAuth({ user: null, loading: false });
  view = await renderPage();
  expect(view.container).toBeEmptyDOMElement();
  expect(screen.queryByTestId("orders-b2b-page")).not.toBeInTheDocument();
  expect(screen.queryByTestId("orders-staff-mobile")).not.toBeInTheDocument();
});
