/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import axios from "axios";
import B2BPortalPage from "./B2BPortalPage";
import { navigation, postBankForm } from "../components/VposSettingsPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../components/VposSettingsPanel", () => {
  const actual = jest.requireActual("../components/VposSettingsPanel");
  return {
    ...actual,
    postBankForm: jest.fn(),
    navigation: { assign: jest.fn() },
  };
});

const PORTAL = {
  contact: { name: "Acme", balance: 500, discount: 0, phone: "", email: "", address: "", city: "", has_password: false },
  company: { name: "Firma", price_decimals: 2 },
  products: [{
    id: "p1",
    name: "Vida",
    sku: "VIDA",
    category: "Genel",
    unit: "Adet",
    price: 100,
    price_gross: 120,
    list_price: 100,
    vat_rate: 20,
    in_stock: true,
    stock_quantity: 10,
  }],
  orders: [],
  invoices: [],
  installments: [],
  settings: {
    show_stock: true,
    show_prices: true,
    allow_orders: true,
    show_statement: false,
    show_installments: false,
    min_order_amount: 0,
    allow_ai_cart: false,
    card_payment: { enabled: true, max_installment: 1, commission_payer: "buyer", commission_rate: 2.5 },
  },
  legal: [],
  card_order_required: true,
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  localStorage.clear();
  axios.get.mockReset();
  axios.post.mockReset();
  axios.put.mockReset();
  axios.put.mockResolvedValue({ data: {} });
  postBankForm.mockReset();
  navigation.assign.mockReset();
  window.scrollTo = jest.fn();
  global.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host.remove();
  localStorage.clear();
});

async function show(data) {
  axios.get.mockResolvedValue({ data });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/portal/tok-a"]}>
        <Routes>
          <Route path="/portal/:token/*" element={<B2BPortalPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

async function addAndSubmit() {
  await act(async () => { host.querySelector('[data-testid="b2b-add-VIDA"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-go-cart"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-submit-order"]').click(); });
  await act(async () => { await Promise.resolve(); });
}

test("kart zorunluyken sepet onayı order-payments başlatır ve sepeti silmez", async () => {
  axios.post.mockResolvedValue({
    data: { kind: "form", action_url: "https://bank.example/3d", fields: { oid: "abc" }, intent_id: "int-1" },
  });
  await show(PORTAL);
  await addAndSubmit();
  expect(axios.post).toHaveBeenCalledWith(
    "/api/public/b2b/tok-a/order-payments",
    expect.objectContaining({
      items: [expect.objectContaining({ product_id: "p1", quantity: 1 })],
    }),
  );
  const payload = axios.post.mock.calls[0][1];
  expect(payload.items[0].unit_price).toBeUndefined();
  expect(payload.pan).toBeUndefined();
  expect(postBankForm).toHaveBeenCalledWith("https://bank.example/3d", { oid: "abc" });
  expect(axios.post.mock.calls.some((call) => String(call[0]).endsWith("/orders"))).toBe(false);
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
});

test("402 card_required siparişini order-payments akışına çevirir", async () => {
  axios.post.mockImplementation((url) => {
    if (String(url).endsWith("/orders")) {
      const err = new Error("card");
      err.response = { status: 402, data: { detail: "Bu portalda sipariş için kartla ödeme zorunlu.", card_required: true } };
      return Promise.reject(err);
    }
    return Promise.resolve({
      data: { kind: "iframe", iframe_url: "https://www.paytr.com/odeme/guvenli/token1", intent_id: "int-2" },
    });
  });
  await show({ ...PORTAL, card_order_required: false });
  await addAndSubmit();
  expect(axios.post.mock.calls.map((call) => call[0])).toEqual([
    "/api/public/b2b/tok-a/orders",
    "/api/public/b2b/tok-a/order-payments",
  ]);
  expect(host.querySelector('[data-testid="b2b-order-card-iframe"]').getAttribute("src")).toBe(
    "https://www.paytr.com/odeme/guvenli/token1",
  );
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
});

test("yönlendirme yanıtı sepeti koruyarak banka sayfasına gider", async () => {
  axios.post.mockResolvedValue({
    data: { kind: "redirect", url: "https://sandbox.iyzipay.com/pay/token1", intent_id: "int-3" },
  });
  await show(PORTAL);
  await addAndSubmit();
  expect(navigation.assign).toHaveBeenCalledWith("https://sandbox.iyzipay.com/pay/token1");
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
});
