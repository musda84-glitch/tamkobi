/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { DocumentLineEditor } from "./DocumentLineEditor";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(),
    defaults: {},
    isCancel: () => false,
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: null }),
}));

let host;
let root;

const products = [{
  id: "p1",
  name: "Raf",
  sku: "RAF",
  unit: "Adet",
  stock_quantity: 4,
  sale_price: 300,
  purchase_price: 90,
  last_purchase_price: 180,
  variants: [{ sku: "RAF-K", barcode: "8681", name: "Kırmızı", price: 300, purchase_price: 175.5 }],
}];

const item = {
  product_id: "p1",
  name: "Raf - Kırmızı",
  product_name: "Raf - Kırmızı",
  sku: "RAF-K",
  barcode: "8681",
  quantity: 1,
  unit: "Adet",
  unit_price: 175.5,
  vat_rate: 20,
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: [] });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.innerHTML = "";
});

function render(invoiceType) {
  root = createRoot(host);
  return act(async () => {
    root.render(
      <DocumentLineEditor
        items={[item]}
        onChange={() => {}}
        products={products}
        kind="invoice"
        invoiceType={invoiceType}
        testIdPrefix="inv-item"
      />
    );
  });
}

test("alış faturasında varyant alışından gelen satırda yazı görünür", async () => {
  await render("purchase");
  const hint = host.querySelector('[data-testid="inv-item-variant-cost-0"]');
  expect(hint).not.toBeNull();
  expect(hint.textContent).toBe("Varyant alış fiyatı");
  expect(hint.className).toContain("text-[10px]");
  expect(hint.className).toContain("text-slate-500");
  expect(hint.className).toContain("text-right");
});

test("satış faturasında varyant alış fiyatı yazısı görünmez", async () => {
  await render("sales");
  expect(host.querySelector('[data-testid="inv-item-variant-cost-0"]')).toBeNull();
  expect(host.textContent).not.toContain("Varyant alış fiyatı");
});
