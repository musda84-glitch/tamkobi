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

async function openAccount() {
  await act(async () => { host.querySelector("[data-testid='b2b-account-trigger']").click(); });
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
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
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
  expect(button.textContent).toContain("Tedarikçi · 2 tedarikçi");
  expect(button.querySelector("[data-testid='b2b-supplier-chevron']")).not.toBeNull();
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

test("tek tedarikçi ve eski portal bağlantısında hesap menüsünde çıkış görünür", async () => {
  installGets([TWO[0]]);
  await show();
  expect(host.querySelector('[data-testid="b2b-switch-supplier"]')).toBeNull();
  expect(host.querySelector("[data-testid='b2b-supplier-chevron']")).toBeNull();
  await openAccount();
  const bare = host.querySelector('[data-testid="b2b-header-logout"]');
  expect(bare).not.toBeNull();
  expect(bare.textContent).toContain("Çıkış");
  expect(bare.getAttribute("aria-label")).toBe("Çıkış");

  sessionStorage.setItem("b2b_session", "select-secret");
  if (root) act(() => root.unmount());
  await show();
  expect(host.querySelector('[data-testid="b2b-switch-supplier"]')).toBeNull();
  await openAccount();
  expect(host.querySelector('[data-testid="b2b-header-logout"]')).not.toBeNull();
});

test("çok tedarikçide başlık ve menü aynı çıkış fonksiyonunu kullanır", async () => {
  sessionStorage.setItem("b2b_session", "select-secret");
  sessionStorage.setItem("b2b_session_email", "ali@ornek.test");
  installGets(TWO);
  axios.post.mockResolvedValue({ data: { status: "success" } });
  await show();
  await openAccount();
  const menuLogout = host.querySelector('[data-testid="b2b-header-logout"]');
  expect(menuLogout).not.toBeNull();
  expect(menuLogout.textContent).toContain("Çıkış");
  await act(async () => { menuLogout.click(); });
  expect(axios.post).toHaveBeenCalledWith(
    "/api/public/b2b/logout",
    { select_token: "select-secret" },
    { headers: { Authorization: "B2BSession select-secret" } },
  );
  expect(sessionStorage.getItem("b2b_session")).toBeNull();
  expect(goSpy).toHaveBeenCalledWith("/b2b/giris");
});

test("çıkış ucu hata verse de oturumu siler, sepeti ve panel anahtarını bırakır", async () => {
  sessionStorage.setItem("b2b_session", "select-secret");
  sessionStorage.setItem("b2b_session_email", "ali@ornek.test");
  sessionStorage.setItem("tamkobi_access_token", "panel-session");
  localStorage.setItem("tamkobi_access_token", "panel-local");
  localStorage.setItem("b2b_contact_portals", JSON.stringify({ cA: "tok-a" }));
  localStorage.setItem("b2b_cart_tok-a", JSON.stringify({ p1: { productId: "p1", qty: 2, note: "" } }));
  localStorage.setItem("b2b_held_carts_tok-a", JSON.stringify([{ id: "h1", seq: 1, cart: { p1: { productId: "p1", qty: 1, note: "" } }, note: "" }]));
  document.cookie = "tamkobi_app=stay";
  installGets([TWO[0]]);
  axios.post.mockRejectedValue(new Error("logout down"));
  await show();
  await openAccount();
  await act(async () => { host.querySelector('[data-testid="b2b-header-logout"]').click(); });
  expect(axios.post).toHaveBeenCalledWith(
    "/api/public/b2b/logout",
    { select_token: "select-secret" },
    { headers: { Authorization: "B2BSession select-secret" } },
  );
  expect(String(axios.post.mock.calls[0][0])).not.toContain("select-secret");
  expect(sessionStorage.getItem("b2b_session")).toBeNull();
  expect(sessionStorage.getItem("b2b_session_email")).toBeNull();
  expect(localStorage.getItem("b2b_contact_portals")).toBeNull();
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
  expect(localStorage.getItem("b2b_held_carts_tok-a")).toContain("h1");
  expect(sessionStorage.getItem("tamkobi_access_token")).toBe("panel-session");
  expect(localStorage.getItem("tamkobi_access_token")).toBe("panel-local");
  expect(document.cookie).toContain("tamkobi_app=stay");
  expect(goSpy).toHaveBeenCalledWith("/b2b/giris");
  expect(toast.message).toHaveBeenCalledWith("Sepetiniz bu cihazda saklandı.");
});

test("390px başlık tek satırda seçici, sepet ikonu ve avatar, altında tam genişlik bakiye", async () => {
  host.style.width = "390px";
  window.innerWidth = 390;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: true,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  installGets([]);
  await show();
  const bar = host.querySelector('[data-testid="b2b-header-bar"]');
  expect(bar).not.toBeNull();
  expect(bar.textContent).toContain("Anadolu Gıda");
  expect(bar.textContent).not.toContain("Bayi Portalı");
  expect(bar.textContent).not.toContain("Sepet");
  expect(bar.textContent).not.toContain("B2B");
  expect(host.querySelector('[data-testid="b2b-header-cart"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="b2b-account-trigger"]')).not.toBeNull();
  const balance = host.querySelector('[data-testid="b2b-header-balance"]');
  expect(balance).not.toBeNull();
  expect(balance.className).toMatch(/w-full/);
  expect(bar.contains(balance)).toBe(false);
  await openAccount();
  const button = host.querySelector('[data-testid="b2b-header-logout"]');
  expect(button.textContent.replace(/\s+/g, " ").trim()).toBe("Çıkış");
  expect(button.className).toMatch(/whitespace-nowrap/);
  expect(button.className).toMatch(/min-h-10/);
  expect(button.className).toMatch(/rounded-xl/);
});
