/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { VariantManager } from "./VariantManager";
import { setPriceDecimals } from "../utils/money";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
    defaults: {},
    isCancel: () => false,
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

let host;
let root;

const product = {
  id: "p1",
  sku: "ANA",
  currency: "TRY",
  sale_price: 250,
  purchase_price: 90,
  last_purchase_price: 180,
  variants: [
    { variant_id: "v1", name: "Mavi", sku: "ANA-M", barcode: "111", stock: 2, price: 250, purchase_price: 0 },
    { variant_id: "v2", name: "Kırmızı", sku: "ANA-K", barcode: "222", stock: 1, price: 260, purchase_price: 175.5 },
  ],
};

beforeEach(() => {
  setPriceDecimals(2);
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.put.mockReset();
  axios.put.mockResolvedValue({ data: { ...product, variants: product.variants } });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.innerHTML = "";
});

function render() {
  root = createRoot(host);
  return act(async () => {
    root.render(<VariantManager product={product} onUpdated={() => {}} />);
  });
}

test("satış ve alış fiyatı başlıkları ile ana ürün alış placeholder'ı görünür", async () => {
  await render();
  const headers = Array.from(host.querySelectorAll("th")).map((th) => th.textContent);
  expect(headers).toEqual(expect.arrayContaining(["Satış fiyatı (₺)", "Alış fiyatı (₺)"]));
  expect(headers.some((h) => h === "Fiyat (₺)")).toBe(false);
  const inputs = host.querySelectorAll('[data-testid="variant-purchase-price-input"]');
  expect(inputs).toHaveLength(2);
  expect(inputs[0].placeholder).toBe("Ana ürün alışı: ₺180,00");
  expect(inputs[0].value).toBe("");
  expect(inputs[1].value).not.toBe("");
});

test("kaydet payload'unda purchase_price sayı olarak gider", async () => {
  await render();
  await act(async () => {
    host.querySelector('[data-testid="save-variants-btn"]').click();
  });
  expect(axios.put).toHaveBeenCalledTimes(1);
  const [url, payload] = axios.put.mock.calls[0];
  expect(url).toBe("/api/products/p1/variants");
  expect(payload.variants.map((v) => v.purchase_price)).toEqual([0, 175.5]);
  payload.variants.forEach((v) => {
    expect(typeof v.purchase_price).toBe("number");
  });
  expect(payload.variants[0].price).toBe(250);
});

test("alış fiyatı olmayan ana üründe placeholder 0", async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <VariantManager
        product={{ ...product, last_purchase_price: 0, purchase_price: 0, avg_purchase_price: 0, variants: [product.variants[0]] }}
        onUpdated={() => {}}
      />
    );
  });
  const input = host.querySelector('[data-testid="variant-purchase-price-input"]');
  expect(input.placeholder).toBe("0");
  expect(input.value).toBe("");
});
