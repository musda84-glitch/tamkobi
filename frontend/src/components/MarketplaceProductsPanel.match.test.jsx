import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MarketplaceProductsPanel } from "./MarketplaceProductsPanel";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "" }));

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/marketplace/products")) {
      return Promise.resolve({
        data: {
          live: true,
          count: 1,
          matched: 0,
          fetched_at: "2026-10-08T08:00:00Z",
          push_supported: true,
          rows: [{
            barcode: "8692577197348",
            title: "MDF Levha 18mm",
            stock_code: "MDF-18",
            brand: "X",
            category: "Levha",
            sale_price: 100,
            list_price: 120,
            quantity: 5,
            product_id: null,
          }],
          products: [
            { id: "p1", name: "MDF Levha 18mm Beyaz", sku: "MDF-18", barcode: "8692577197348" },
            { id: "p2", name: "Vida paketi", sku: "V1", barcode: "111" },
          ],
        },
      });
    }
    if (u.includes("/marketplace/push-logs")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

test("stok kartı eşleştirmede arama select ve AI öneri çipi gösterir", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<MarketplaceProductsPanel companyId="c1" />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(host.querySelector('[data-testid="mp-match-select-8692577197348"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="mp-match-select-8692577197348-trigger"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="mp-ai-chip-8692577197348"]')?.textContent).toMatch(/AI/);
  expect(host.querySelector('[data-testid="mp-ai-suggest-btn"]')?.textContent).toMatch(/AI eşleşme/);
  expect(host.querySelector("select.bg-amber-50")).toBeNull();
});
