/**
 * @jest-environment jsdom
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";

jest.mock("axios", () => {
  const impl = {
    get: () => Promise.resolve({ data: { plans: [], catalog: [], trial_days: 14, brand_name: "TamKobi" } }),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    __tamkobiNoticeInterceptor: true,
  };
  return { __esModule: true, default: impl, ...impl };
});

import PricingPage from "./PricingPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HelmetProvider.canUseDOM = true;

test("pricing hero and footer link to the new marketing pages", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <HelmetProvider>
        <MemoryRouter>
          <PricingPage />
        </MemoryRouter>
      </HelmetProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="pricing-modules-link"]').getAttribute("href")).toBe("/moduller");
  expect(host.querySelector('[data-testid="pricing-modules-link"]').textContent).toMatch(/Modülleri İncele/);
  expect(host.querySelector('[data-testid="footer-link-urunler"]').getAttribute("href")).toBe("/urunler");
  expect(host.querySelector('[data-testid="footer-link-moduller"]').getAttribute("href")).toBe("/moduller");
  expect(host.querySelector('[data-testid="site-nav-products"]').textContent).toBe("Ürünler");
  expect(host.querySelector('[data-testid="site-nav-modules"]').textContent).toBe("Modüller");
  await act(async () => { root.unmount(); });
  host.remove();
});
