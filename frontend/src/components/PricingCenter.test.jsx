import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { PricingCenter } from "./PricingCenter";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.post.mockImplementation((url) => {
    if (String(url).includes("/pricing/compute")) {
      return Promise.resolve({
        data: {
          channel: "trendyol",
          rule: {
            margin_pct: 30,
            margin_base: "cost",
            include_cargo: true,
            include_service_fee: true,
            rounding: "0.90",
            min_price: 0,
            max_price: 0,
            list_price_markup_pct: 0,
          },
          fees: { commission_rate: 21.5, commission_vat_rate: 20, service_fee: 12.99, cargo_fee: 0 },
          push_supported: true,
          priced: 1,
          no_cost: 0,
          count: 1,
          rows: [{
            barcode: "8691",
            title: "Test Ürün",
            product_sku: "T1",
            sale_price: 199,
            marketplace_price: 199,
            local_price: 210,
            cost: 80,
            current_net: 65.12,
            commission_rate: 21.5,
            effective_commission_rate: 25.8,
            suggested: 149.9,
            list_price: 149.9,
            net_profit: 40,
            margin_pct: 50,
            diff: -49.1,
            diff_pct: -24.7,
            image: null,
          }],
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  host.remove();
});

test("pazaryeri fiyatı ve şu anki komisyon oranını gösterir", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<PricingCenter companyId="c1" />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(host.textContent).toMatch(/Pazaryeri Fiyatı/);
  expect(host.querySelector('[data-testid="pricing-fees-summary"]')?.textContent).toMatch(/Şu anki komisyon %21\.5/);
  expect(host.querySelector('[data-testid="pricing-mp-price-8691"]')?.textContent).toMatch(/199/);
  expect(host.querySelector('[data-testid="pricing-mp-price-8691"]')?.textContent).toMatch(/stok kartı/);
  const meta = host.querySelector('[data-testid="pricing-net-meta-8691"]');
  expect(meta?.textContent).toMatch(/pazaryeri/);
  expect(meta?.textContent).toMatch(/komisyon %21\.5/);
  expect(meta?.textContent).toMatch(/KDV'li %25\.8/);
});
