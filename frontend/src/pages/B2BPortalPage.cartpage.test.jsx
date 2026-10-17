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

function portal(extra = {}) {
  const { settings: settingExtra, ...rest } = extra;
  return {
    contact: { name: "Acme", balance: 0, discount: 0, phone: "", email: "", address: "", city: "", has_password: false },
    company: { name: "Firma", price_decimals: 2 },
    products: [PRODUCT],
    orders: [],
    invoices: [],
    installments: [],
    legal: [],
    card_order_required: false,
    ...rest,
    settings: {
      show_stock: true,
      show_prices: true,
      allow_orders: true,
      show_statement: false,
      show_installments: false,
      min_order_amount: 0,
      allow_ai_cart: false,
      ...(settingExtra || {}),
    },
  };
}

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
  toast.success.mockReset();
  toast.error.mockReset();
  toast.message.mockReset();
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

async function show(data, entry = "/portal/tok") {
  axios.get.mockResolvedValue({ data });
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
  await act(async () => { await Promise.resolve(); });
}

function setControl(el, value) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

test("ürünler sekmesinde sepet paneli yok ve ızgara 4 sütun", async () => {
  await show(portal());
  expect(host.querySelector('[data-testid="b2b-cart"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-catalog-grid"]').className).toContain("lg:grid-cols-4");
  expect(host.querySelector('[data-testid="b2b-cart-page"]')).toBeNull();
});

test("ürün eklenince rozet 1 olur ve Sepet sekmesi sepet sayfasını açar", async () => {
  await show(portal());
  expect(host.querySelector('[data-testid="b2b-cart-badge"]')).toBeNull();
  await act(async () => { host.querySelector('[data-testid="b2b-add-VIDA"]').click(); });
  const badges = host.querySelectorAll('[data-testid="b2b-cart-badge"]');
  expect(badges.length).toBeGreaterThan(0);
  badges.forEach((badge) => {
    expect(badge.textContent).toBe("1");
    expect(badge.getAttribute("aria-label")).toBe("Sepette 1 kalem");
  });
  await act(async () => { host.querySelector('[data-testid="b2b-tab-cart"]').click(); });
  expect(host.querySelector('[data-testid="b2b-cart-page"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="b2b-catalog-grid"]')).toBeNull();
});

test("doğrudan /sepet adet artır azalt kaldır toplamları günceller", async () => {
  localStorage.setItem("b2b_cart_tok", JSON.stringify({ p1: { productId: "p1", qty: 1, note: "" } }));
  await show(portal(), "/portal/tok/sepet");
  expect(host.querySelector('[data-testid="b2b-cart-page"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="b2b-cart-grand-total"]').textContent).toContain("120,00");
  const row = host.querySelector('[data-testid="b2b-cart-row-VIDA-0"]');
  await act(async () => { row.querySelector('[aria-label="Artır"]').click(); });
  expect(host.querySelector('[data-testid="b2b-cart-qty-VIDA-0"]').value).toBe("2");
  expect(host.querySelector('[data-testid="b2b-cart-grand-total"]').textContent).toContain("240,00");
  expect(host.querySelector('[data-testid="b2b-cart-subtotal"]').textContent).toContain("200,00");
  expect(host.querySelector('[data-testid="b2b-cart-vat"]').textContent).toContain("40,00");
  await act(async () => { host.querySelector('[data-testid="b2b-cart-row-VIDA-0"]').querySelector('[aria-label="Azalt"]').click(); });
  expect(host.querySelector('[data-testid="b2b-cart-grand-total"]').textContent).toContain("120,00");
  await act(async () => { host.querySelector('[data-testid="b2b-cart-remove-VIDA-0"]').click(); });
  expect(host.querySelector('[data-testid="b2b-cart-page"]').textContent).toContain("Sepetiniz boş.");
  expect(host.querySelector('[data-testid="b2b-cart-row-VIDA-0"]')).toBeNull();
});

test("not ve sipariş no sepet ürünler sepet geçişinde korunur", async () => {
  await show(portal());
  await act(async () => { host.querySelector('[data-testid="b2b-add-VIDA"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-tab-cart"]').click(); });
  await act(async () => {
    setControl(host.querySelector('[data-testid="b2b-note"]'), "Depo kapısı");
    setControl(host.querySelector('[data-testid="b2b-customer-order-no"]'), "PO-44");
  });
  await act(async () => { host.querySelector('[data-testid="b2b-tab-catalog"]').click(); });
  expect(host.querySelector('[data-testid="b2b-catalog-grid"]')).not.toBeNull();
  await act(async () => { host.querySelector('[data-testid="b2b-tab-cart"]').click(); });
  expect(host.querySelector('[data-testid="b2b-note"]').value).toBe("Depo kapısı");
  expect(host.querySelector('[data-testid="b2b-customer-order-no"]').value).toBe("PO-44");
});

test("gönder orders payload'unu aynen yollar ve Siparişlerim sekmesine döner", async () => {
  axios.post.mockResolvedValue({ data: { order: { order_number: "S-1", grand_total: 120 }, message: "Alındı" } });
  await show(portal());
  await act(async () => { host.querySelector('[data-testid="b2b-add-VIDA"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-go-cart"]').click(); });
  await act(async () => {
    setControl(host.querySelector('[data-testid="b2b-note"]'), "adres notu");
    setControl(host.querySelector('[data-testid="b2b-customer-order-no"]'), "PO-9");
  });
  await act(async () => { host.querySelector('[data-testid="b2b-submit-order"]').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(axios.post).toHaveBeenCalledWith("/api/public/b2b/tok/orders", {
    items: [{ product_id: "p1", quantity: 1, note: "" }],
    note: "adres notu",
    customer_order_number: "PO-9",
  });
  expect(host.querySelector('[data-testid="b2b-orders"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="b2b-cart-page"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-tab-orders"]').className).toContain("bg-slate-900");
});

test("card_order_required gönderimi order-payments çağırır ve sepeti silmez", async () => {
  axios.post.mockResolvedValue({
    data: { kind: "iframe", iframe_url: "https://www.paytr.com/odeme/guvenli/token1", intent_id: "int-1" },
  });
  await show(portal({ card_order_required: true }));
  await act(async () => { host.querySelector('[data-testid="b2b-add-VIDA"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-tab-cart"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-submit-order"]').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(axios.post).toHaveBeenCalledWith(
    "/api/public/b2b/tok/order-payments",
    expect.objectContaining({ items: [expect.objectContaining({ product_id: "p1", quantity: 1 })] }),
  );
  expect(axios.post.mock.calls.some((call) => String(call[0]).endsWith("/orders"))).toBe(false);
  expect(localStorage.getItem("b2b_cart_tok")).toContain("p1");
  expect(host.querySelector('[data-testid="b2b-order-card-iframe"]').getAttribute("src")).toBe(
    "https://www.paytr.com/odeme/guvenli/token1",
  );
  expect(host.querySelector('[data-testid="b2b-card-order-note"]').textContent).toContain("Sipariş kartla ödeme sonrası oluşturulur.");
});

test("402 card_required siparişini order-payments akışına düşürür", async () => {
  axios.post.mockImplementation((url) => {
    if (String(url).endsWith("/orders")) {
      const err = new Error("card");
      err.response = { status: 402, data: { detail: "kart zorunlu", card_required: true } };
      return Promise.reject(err);
    }
    return Promise.resolve({
      data: { kind: "iframe", iframe_url: "https://www.paytr.com/odeme/guvenli/token2", intent_id: "int-2" },
    });
  });
  await show(portal());
  await act(async () => { host.querySelector('[data-testid="b2b-add-VIDA"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-tab-cart"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-submit-order"]').click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(axios.post.mock.calls.map((call) => call[0])).toEqual([
    "/api/public/b2b/tok/orders",
    "/api/public/b2b/tok/order-payments",
  ]);
  expect(host.querySelector('[data-testid="b2b-order-card-iframe"]')).not.toBeNull();
  expect(localStorage.getItem("b2b_cart_tok")).toContain("p1");
});

test("minimum siparişin altında istek atılmaz ve uyarı görünür", async () => {
  await show(portal({ settings: { min_order_amount: 500 } }));
  await act(async () => { host.querySelector('[data-testid="b2b-add-VIDA"]').click(); });
  await act(async () => { host.querySelector('[data-testid="b2b-tab-cart"]').click(); });
  expect(host.querySelector('[data-testid="b2b-cart-min-order"]').textContent).toMatch(/Eksik/);
  await act(async () => { host.querySelector('[data-testid="b2b-submit-order"]').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(axios.post).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

test("AI sepet onApply sonrası rozet güncellenir", async () => {
  axios.post.mockImplementation((url) => {
    if (String(url).includes("/ai-cart") && !String(url).includes("/learn")) {
      return Promise.resolve({
        data: {
          filename: "liste.csv",
          items: [{ requested: "Vida", quantity: 2, product_id: "p1", matched_name: "Vida", confidence: 1 }],
          unmatched: [],
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
  await show(portal({ settings: { allow_ai_cart: true } }));
  const input = host.querySelector('[data-testid="b2b-ai-cart-input"]');
  const file = new File(["sku,qty"], "liste.csv", { type: "text/csv" });
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { host.querySelector('[data-testid="b2b-ai-apply"]').click(); });
  const badges = host.querySelectorAll('[data-testid="b2b-cart-badge"]');
  expect(badges.length).toBeGreaterThan(0);
  badges.forEach((badge) => expect(badge.textContent).toBe("1"));
  expect(toast.success).toHaveBeenCalledWith(
    "Sepete eklendi.",
    expect.objectContaining({ action: expect.objectContaining({ label: "Sepete git" }) }),
  );
});

test("allow_orders kapalıyken Sepet sekmesi ve rozet yoktur", async () => {
  localStorage.setItem("b2b_cart_tok", JSON.stringify({ p1: { productId: "p1", qty: 2, note: "" } }));
  await show(portal({ settings: { allow_orders: false } }));
  expect(host.querySelector('[data-testid="b2b-tab-cart"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-cart-badge"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-header-cart"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-go-cart"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-catalog-grid"]').className).toContain("lg:grid-cols-4");
});
