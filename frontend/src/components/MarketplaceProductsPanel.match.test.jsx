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

test("stok kartı eşleştirmede arama select ve yerel öneri çipi gösterir (AI yok)", async () => {
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
  expect(host.querySelector('[data-testid="mp-suggest-chip-8692577197348"]')?.textContent).toMatch(/%\d+/);
  expect(host.querySelector('[data-testid="mp-suggest-btn"]')?.textContent).toMatch(/Eşleşme öner/);
  expect(host.querySelector('[data-testid="mp-bulk-create-btn"]')?.textContent).toMatch(/Eşleşmeyenlere Kart Aç/);
  expect(host.querySelector('[data-testid="mp-ai-suggest-btn"]')).toBeNull();
  expect(host.querySelector("select.bg-amber-50")).toBeNull();
});

test("tekil Kart Aç entegrasyon görselini product-create ile gönderir", async () => {
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
            barcode: "8697017692315",
            title: "Test Ürün",
            stock_code: "T-1",
            brand: "X",
            category: "Genel",
            sale_price: 50,
            list_price: 50,
            quantity: 1,
            product_id: null,
            image: "https://cdn.trendyol.com/img/1.jpg",
            vat_rate: 20,
          }],
          products: [],
        },
      });
    }
    if (u.includes("/marketplace/push-logs")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
  axios.post.mockResolvedValueOnce({ data: { message: "ok", image_url: "/api/files/x.jpg" } });
  const root = createRoot(host);
  await act(async () => {
    root.render(<MarketplaceProductsPanel companyId="c1" />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const btn = host.querySelector('[data-testid="mp-create-btn-8697017692315"]');
  expect(btn).not.toBeNull();
  await act(async () => {
    btn.click();
    await Promise.resolve();
  });
  expect(axios.post).toHaveBeenCalled();
  const call = axios.post.mock.calls.find((c) => String(c[0]).includes("/marketplace/product-create"));
  expect(call).toBeTruthy();
  expect(call[1].image).toBe("https://cdn.trendyol.com/img/1.jpg");
  expect(call[1].image_url).toBe("https://cdn.trendyol.com/img/1.jpg");
});
