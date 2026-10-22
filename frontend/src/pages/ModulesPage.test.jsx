/**
 * @jest-environment jsdom
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, useLocation } from "react-router-dom";
import ModulesPage from "./ModulesPage";
import ProductsPage from "./ProductsPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HelmetProvider.canUseDOM = true;

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="loc">{pathname}{search}</div>;
}

async function render(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[ui.entry || "/moduller"]}>
          {ui.node}
          <LocationProbe />
        </MemoryRouter>
      </HelmetProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return {
    host,
    async cleanup() {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

describe("marketing module and product pages", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.title = "";
  });

  test("modules page renders cards, details and a placeholder when the screenshot is missing", async () => {
    const view = await render({ node: <ModulesPage /> });
    expect(view.host.querySelector('[data-testid="modules-page"]')).toBeTruthy();
    expect(view.host.querySelectorAll('[data-testid^="module-card-"]')).toHaveLength(15);
    expect(view.host.querySelectorAll('[data-testid^="module-detail-"]')).toHaveLength(15);
    expect(view.host.querySelector("#e-fatura li")).toBeTruthy();
    expect(view.host.querySelectorAll("#e-fatura li")).toHaveLength(4);
    const inspect = view.host.querySelector('[data-testid="module-inspect-e-fatura"]');
    expect(inspect.getAttribute("href")).toBe("/moduller#e-fatura");
    const imgs = [...view.host.querySelectorAll('[data-testid="shot-img-e-fatura"]')];
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs[0].getAttribute("src")).toBe("/brand/screenshots/e-fatura.png");
    expect(view.host.querySelector('[data-testid="shot-placeholder-e-fatura"]').textContent).toMatch(/Örnek görsel/);
    await act(async () => {
      imgs[0].dispatchEvent(new Event("error"));
    });
    expect(view.host.querySelectorAll('[data-testid="shot-img-e-fatura"]')).toHaveLength(imgs.length - 1);
    expect(view.host.querySelector('[data-testid="shot-placeholder-label-e-fatura"]').textContent).toMatch(/Örnek görsel/);
    await view.cleanup();
  });

  test("category filter narrows cards and stays in sync with the query", async () => {
    const view = await render({ entry: "/moduller?kategori=stok", node: <ModulesPage /> });
    const titles = [...view.host.querySelectorAll('[data-testid^="module-card-"] h3')].map((el) => el.textContent);
    expect(titles).toEqual(["Stok & Barkod", "Kargo"]);
    expect(view.host.querySelector('[data-testid="loc"]').textContent).toBe("/moduller?kategori=stok");
    const finans = view.host.querySelector('[data-testid="module-filter-finans"]');
    await act(async () => { finans.click(); });
    const next = [...view.host.querySelectorAll('[data-testid^="module-card-"] h3')].map((el) => el.textContent);
    expect(next).toEqual(["e-Fatura & e-Arşiv", "Banka Entegrasyonu", "Çek / Senet", "Kasa & Sanal POS"]);
    expect(view.host.querySelector('[data-testid="loc"]').textContent).toBe("/moduller?kategori=finans");
    expect(view.host.querySelectorAll('[data-testid^="module-detail-"]')).toHaveLength(15);
    await view.cleanup();
  });

  test("hamburger menu opens and closes with the marketing links", async () => {
    const view = await render({ node: <ModulesPage /> });
    expect(view.host.querySelector('[data-testid="site-nav-menu"]')).toBeNull();
    const toggle = view.host.querySelector('[data-testid="site-nav-toggle"]');
    await act(async () => { toggle.click(); });
    const menu = view.host.querySelector('[data-testid="site-nav-menu"]');
    expect(menu).toBeTruthy();
    expect(menu.textContent).toContain("Ürünler");
    expect(menu.textContent).toContain("Modüller");
    expect(menu.textContent).toContain("Paketler");
    expect(menu.textContent).toContain("SSS");
    expect(menu.textContent).toContain("Giriş Yap");
    await act(async () => { toggle.click(); });
    expect(view.host.querySelector('[data-testid="site-nav-menu"]')).toBeNull();
    await view.cleanup();
  });

  test("products page lists five sections and the web panel host", async () => {
    const view = await render({ entry: "/urunler", node: <ProductsPage /> });
    expect(view.host.querySelector('[data-testid="products-page"]')).toBeTruthy();
    expect(view.host.querySelectorAll('[data-testid^="product-section-"]')).toHaveLength(5);
    expect(view.host.querySelector('[data-testid="product-domain-web-paneli"]').textContent).toBe("app.tamkobi.com");
    expect(view.host.textContent).not.toContain("tamkobi.com/panel");
    expect(view.host.querySelector('[data-testid="shot-placeholder-web-paneli"]').textContent).toMatch(/Örnek görsel/);
    expect(view.host.querySelector('[data-testid="footer-link-moduller"]').getAttribute("href")).toBe("/moduller");
    expect(view.host.querySelector('[data-testid="footer-link-urunler"]').getAttribute("href")).toBe("/urunler");
    await view.cleanup();
  });
});
