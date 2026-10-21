/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import B2BPortalPage from "./B2BPortalPage";
import { b2bNav } from "../utils/b2bSession";

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
  return { ...actual, postBankForm: jest.fn(), navigation: { assign: jest.fn() } };
});

const PRODUCT = {
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
};

function portal(companyName = "Anadolu Gıda", contactName = "Örnek Market") {
  return {
    contact: { name: contactName, balance: 0, discount: 0, phone: "", email: "", address: "", city: "", has_password: false },
    company: { name: companyName, price_decimals: 2 },
    products: [PRODUCT],
    orders: [],
    invoices: [],
    installments: [],
    legal: [],
    card_order_required: false,
    settings: {
      show_stock: true,
      show_prices: true,
      allow_orders: true,
      show_statement: false,
      show_installments: false,
      min_order_amount: 0,
      allow_ai_cart: false,
    },
  };
}

const TWO = [
  { contact_id: "cA", company_id: "coA", company_name: "Anadolu Gıda", logo_url: "", contact_name: "Örnek Market" },
  { contact_id: "cB", company_id: "coB", company_name: "Ege Temizlik", logo_url: "", contact_name: "Merkez" },
];

let host;
let root;
let goSpy;

function installGets(suppliers) {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/public/b2b/suppliers")) return Promise.resolve({ data: { suppliers } });
    if (String(url).includes("/tok-b")) return Promise.resolve({ data: portal("Ege Temizlik", "Merkez") });
    return Promise.resolve({ data: portal("Anadolu Gıda", "Örnek Market") });
  });
}

async function show(entry = "/portal/tok-a") {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/portal/:token/*" element={<B2BPortalPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  sessionStorage.clear();
  localStorage.clear();
  axios.get.mockReset();
  axios.post.mockReset();
  axios.put.mockReset();
  axios.put.mockResolvedValue({ data: {} });
  toast.error.mockReset();
  goSpy = jest.spyOn(b2bNav, "go").mockImplementation(() => {});
  window.scrollTo = jest.fn();
  global.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});

afterEach(() => {
  goSpy.mockRestore();
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host.remove();
  sessionStorage.clear();
  localStorage.clear();
});

test("tedarikçi değiştir yalnız liste birden fazlaysa görünür", async () => {
  installGets(TWO);
  await show();
  expect(host.querySelector('[data-testid="b2b-switch-supplier"]')).toBeNull();
  expect(axios.get.mock.calls.some((call) => String(call[0]).includes("/suppliers"))).toBe(false);

  sessionStorage.setItem("b2b_session", "select-secret");
  installGets([TWO[0]]);
  if (root) act(() => root.unmount());
  await show();
  expect(host.querySelector('[data-testid="b2b-switch-supplier"]')).toBeNull();

  installGets(TWO);
  if (root) act(() => root.unmount());
  await show();
  const button = host.querySelector('[data-testid="b2b-switch-supplier"]');
  expect(button).not.toBeNull();
  expect(button.textContent).toContain("Tedarikçi değiştir");
  const listCall = axios.get.mock.calls.find((call) => String(call[0]).includes("/suppliers"));
  expect(listCall[0]).toBe("/api/public/b2b/suppliers");
  expect(String(listCall[0])).not.toContain("select-secret");
  expect(listCall[1]).toEqual({ headers: { Authorization: "B2bSession select-secret" } });
});

test("tedarikçi değişince önceki sepet korunur ve yeni token sepeti ayrı kalır", async () => {
  sessionStorage.setItem("b2b_session", "select-secret");
  localStorage.setItem("b2b_cart_tok-a", JSON.stringify({ p1: { productId: "p1", qty: 3, note: "eski" } }));
  localStorage.setItem("b2b_cart_tok-b", JSON.stringify({ p9: { productId: "p9", qty: 1, note: "yeni" } }));
  installGets(TWO);
  axios.post.mockResolvedValue({ data: { redirect: "/portal/tok-b" } });
  await show();
  await act(async () => { host.querySelector('[data-testid="b2b-switch-supplier"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-switch-item-cB"]').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(axios.post).toHaveBeenCalledWith("/api/public/b2b/select-supplier", {
    select_token: "select-secret",
    contact_id: "cB",
  });
  expect(String(axios.post.mock.calls[0][0])).not.toContain("select-secret");
  expect(goSpy).toHaveBeenCalledWith("/portal/tok-b");
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("eski");
  expect(localStorage.getItem("b2b_cart_tok-b")).toContain("p9");
  expect(localStorage.getItem("b2b_cart_tok-b")).not.toContain("eski");

  act(() => root.unmount());
  root = null;
  await show("/portal/tok-b");
  expect(host.textContent).toContain("Ege Temizlik");
  await act(async () => { host.querySelector('[data-testid="b2b-add-VIDA"]').click(); });
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("eski");
  expect(localStorage.getItem("b2b_cart_tok-a")).not.toContain('"qty":4');
  const nextCart = JSON.parse(localStorage.getItem("b2b_cart_tok-b"));
  expect(Object.values(nextCart).some((row) => row.productId === "p1")).toBe(true);
  expect(Object.values(nextCart).some((row) => row.productId === "p9")).toBe(true);
});

test("portalda 403 seçim hatasını gösterir ve sepeti taşımaz", async () => {
  sessionStorage.setItem("b2b_session", "select-secret");
  localStorage.setItem("b2b_cart_tok-a", JSON.stringify({ p1: { productId: "p1", qty: 2, note: "" } }));
  installGets(TWO);
  axios.post.mockRejectedValue({
    response: { status: 403, data: { detail: "Bu cari bu oturuma bağlı değil." } },
  });
  await show();
  await act(async () => { host.querySelector('[data-testid="b2b-switch-supplier"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-switch-item-cB"]').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="b2b-switch-error"]').textContent).toBe("Bu cari bu oturuma bağlı değil.");
  expect(goSpy).not.toHaveBeenCalled();
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
  expect(localStorage.getItem("b2b_cart_tok-b")).toBeNull();
});
