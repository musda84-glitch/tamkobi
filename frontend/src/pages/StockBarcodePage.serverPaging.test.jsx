/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import StockBarcodePage from "./StockBarcodePage";
import { PRODUCTS_PAGING_STORAGE_KEY } from "../utils/featureFlags";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROWS = [
  { id: "1", name: "Ada Kulaklık", sku: "ADA-1", barcode: "111", category: "Elektronik", stock_quantity: 2, min_stock_alert: 5, track_stock: true, purchase_price: 10, sale_price: 20, show_in_b2b: true, is_active: true, unit: "Adet" },
  { id: "2", name: "Bora Kablo", sku: "BOR-2", barcode: "222", category: "Aksesuar", stock_quantity: 8, min_stock_alert: 1, track_stock: true, purchase_price: 4, sale_price: 9, show_in_b2b: false, is_active: true, unit: "Adet" },
];

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    isCancel: (err) => err?.code === "ERR_CANCELED",
    defaults: {},
    interceptors: { response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } }));
jest.mock("../context/AuthContext", () => {
  const company = { id: "c1" };
  return {
    API_URL: "/api",
    useAuth: () => ({ activeCompany: company, addonOn: () => false, can: () => true }),
  };
});
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(""), jest.fn()],
  useNavigate: () => jest.fn(),
}), { virtual: true });
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  cachedList: async (collection, _cid, opts) => {
    globalThis.__cachedListCalls.push(collection);
    if (collection !== "products") return [];
    const rows = opts?.filter ? ROWS.filter(opts.filter) : ROWS.slice();
    opts?.onCached?.(rows);
    return rows;
  },
  productFilter: ({ category } = {}) => (p) => !category || category === "all" || p.category === category,
  patchCached: async () => {},
  dropCached: async () => {},
}));
jest.mock("../components/ProductProfitPanel", () => ({ ProductProfitPanel: () => null }));
jest.mock("../components/StockCountPanel", () => ({ StockCountPanel: () => null }));
jest.mock("../components/LabelDesigner", () => ({ LabelDesigner: () => null, LabelQuickPrint: () => null }));
jest.mock("../components/ProductDetailModal", () => ({ ProductDetailModal: () => null }));
jest.mock("../components/AiStockImportModal", () => ({ AiStockImportModal: () => null }));
jest.mock("../components/ProductionOrderModal", () => ({ ProductionOrderModal: () => null }));
jest.mock("../components/CameraScanner", () => ({ ScanButton: () => null }));

function summaryBody(over = {}) {
  return {
    count: 120,
    stock_value: 9999,
    quantity_total: 40,
    critical_count: 7,
    zero_count: 2,
    negative_count: 1,
    warehouse_quantities: { wh_main: 40 },
    brands: ["Tam"],
    ...over,
  };
}

const LIST_TOTAL = 120;
let totalOverride = null;

function rowFor(pageNo) {
  if (pageNo === 1) {
    return {
      id: "p1", name: "Sunucu Ürün", sku: "SUN-1", barcode: "999", category: "Elektronik",
      stock_quantity: 4, min_stock_alert: 1, track_stock: true, purchase_price: 3, sale_price: 8,
      show_in_b2b: true, is_active: true, unit: "Adet", currency: "TRY",
      last_purchase_price: 12.5, last_purchase_date: "2026-03-15", last_purchase_supplier: "Yeni Tedarik",
      purchase_costs: [
        { date: "2026-03-15", unit_price: 12.5, supplier: "Yeni Tedarik" },
        { date: "2026-01-01", unit_price: 10, supplier: "Eski Tedarik" },
      ],
    };
  }
  return {
    id: `p${pageNo}`,
    name: pageNo === 2 ? "Ikinci Sayfa" : `Sayfa ${pageNo}`,
    sku: `P${pageNo}`,
    barcode: "888",
    category: "Aksesuar",
    stock_quantity: 1,
    min_stock_alert: 1,
    track_stock: true,
    purchase_price: 1,
    sale_price: 2,
    show_in_b2b: true,
    is_active: true,
    unit: "Adet",
  };
}

function pageBody(params) {
  const pageNo = Number(params?.page || 1);
  const q = params?.q || "";
  const size = Number(params?.page_size || 50);
  if (q) {
    const total = q === "yok" ? 0 : 1;
    const limit = Math.max(1, Math.ceil(total / size) || 1);
    const inRange = total > 0 && pageNo <= limit;
    return {
      items: inRange ? [{ id: "q1", name: "Arama Sonucu", sku: "ARA-1", barcode: "333", category: "Elektronik", stock_quantity: 1, min_stock_alert: 1, track_stock: true, purchase_price: 2, sale_price: 3, unit: "Adet" }] : [],
      total,
      page: pageNo,
      page_size: size,
      has_more: false,
      summary: summaryBody({ count: total, stock_value: total ? 3 : 0, quantity_total: total ? 1 : 0, critical_count: 0, zero_count: 0, negative_count: 0 }),
    };
  }
  const total = totalOverride == null ? LIST_TOTAL : totalOverride;
  const limit = Math.max(1, Math.ceil(total / size) || 1);
  if (pageNo > limit) {
    return { items: [], total, page: pageNo, page_size: size, has_more: false, summary: summaryBody() };
  }
  return {
    items: [rowFor(pageNo)],
    total,
    page: pageNo,
    page_size: size,
    has_more: pageNo < limit,
    summary: summaryBody(),
  };
}

function productListCalls() {
  return axios.get.mock.calls.filter((c) => /\/products\/?$/.test(String(c[0]).split("?")[0]));
}

let host;
let root;

beforeEach(() => {
  totalOverride = null;
  localStorage.removeItem(PRODUCTS_PAGING_STORAGE_KEY);
  globalThis.__cachedListCalls = [];
  if (!globalThis.IntersectionObserver) {
    globalThis.IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url, config) => {
    const u = String(url);
    if (/\/products\/?$/.test(u.split("?")[0])) return Promise.resolve({ data: pageBody(config?.params) });
    if (u.includes("/warehouses")) return Promise.resolve({ data: [{ id: "wh_main", name: "Ana Depo" }] });
    if (u.includes("/products/categories")) return Promise.resolve({ data: [{ name: "Elektronik", count: 1 }] });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  localStorage.removeItem(PRODUCTS_PAGING_STORAGE_KEY);
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function waitFor(predicate, { tries = 40 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  throw new Error("waitFor timed out");
}

async function renderPage() {
  root = createRoot(host);
  await act(async () => { root.render(<StockBarcodePage />); });
  await flush(8);
}

function setControl(el, value) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}

function indicatorParts() {
  const text = host.querySelector('[data-testid="stock-page-indicator"]').textContent;
  const [cur, pages] = text.split("/").map((s) => Number(String(s).trim()));
  return { cur, pages, text };
}

test("flag kapalıyken eski liste akar, sayfa parametresi gitmez", async () => {
  await renderPage();
  await waitFor(() => host.textContent.includes("Ada Kulaklık"));
  expect(globalThis.__cachedListCalls).toContain("products");
  expect(productListCalls()).toHaveLength(0);
  expect(host.querySelector('[data-testid="stock-pager"]')).toBeNull();
  expect(host.querySelector('[data-testid="stock-status-select"]').textContent).toContain("(1)");
  expect(host.textContent).toContain("Bora Kablo");
  expect(host.querySelector('[data-testid="stock-brand-select"]')).toBeNull();

  const input = host.querySelector('[data-testid="stock-search-input"]');
  await act(async () => { setControl(input, "bora"); });
  await flush(4);
  expect(host.textContent).toContain("Bora Kablo");
  expect(host.textContent).not.toContain("Ada Kulaklık");
  expect(productListCalls()).toHaveLength(0);
  const inputWrap = input.parentElement;
  expect(input.className).toContain("w-full");
  expect(input.className).toContain("min-w-[240px]");
  expect(input.className).not.toContain("sm:w-64");
  expect(inputWrap.className).toContain("flex-1");
  expect(inputWrap.className).toContain("min-w-[240px]");
  expect(inputWrap.parentElement.className).toContain("flex-wrap");
});

test("flag açıkken sayfa ister, arama sayfa 1'e döner, toplam sunucudadır", async () => {
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Ürün"));
  expect(globalThis.__cachedListCalls).not.toContain("products");
  const first = productListCalls();
  expect(first).toHaveLength(1);
  expect(first[0][1].params).toMatchObject({
    company_id: "c1",
    page: 1,
    page_size: 50,
    category: "all",
    status: "all",
    b2b: "all",
    sort: "name_asc",
    active: "all",
  });
  expect(first[0][1].params.q).toBeUndefined();
  const summary = host.querySelector('[data-testid="stock-result-summary"]');
  expect(summary.textContent.replace(/\s/g, "")).toMatch(/9[.\s,]?999/);
  expect(summary.textContent).toContain("120");
  expect(summary.textContent).toContain("7");
  expect(host.textContent).not.toContain("Ikinci Sayfa");

  await act(async () => { host.querySelector('[data-testid="stock-page-next"]').click(); });
  await waitFor(() => host.textContent.includes("Ikinci Sayfa"));
  expect(productListCalls().map((c) => c[1].params.page)).toEqual([1, 2]);
  expect(host.textContent).not.toContain("Sunucu Ürün");

  const input = host.querySelector('[data-testid="stock-search-input"]');
  await act(async () => { setControl(input, "ada"); });
  await waitFor(() => {
    const last = productListCalls().at(-1);
    return last && last[1].params.page === 1 && last[1].params.q === "ada";
  });
  await waitFor(() => host.textContent.includes("Arama Sonucu"));
  expect(host.querySelector('[data-testid="stock-page-indicator"]').textContent.replace(/\s/g, "")).toBe("1/1");
});

test("flag açıkken son alış satırı görünür", async () => {
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.querySelector('[data-testid="stock-last-buy-SUN-1"]'));
  const line = host.querySelector('[data-testid="stock-last-buy-SUN-1"]');
  expect(line.textContent.replace(/\s+/g, " ").trim()).toMatch(/^son /);
  expect(line.textContent).toContain("15.03");
  expect(host.querySelector('[data-testid="stock-last-buy-ADA-1"]')).toBeNull();
});

test("seri 5 sonraki tıklaması totalPages'i geçmez", async () => {
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Ürün"));
  const next = host.querySelector('[data-testid="stock-page-next"]');
  expect(next.disabled).toBe(false);
  await act(async () => {
    for (let i = 0; i < 5; i += 1) host.querySelector('[data-testid="stock-page-next"]').click();
  });
  await flush(8);
  const { cur, pages } = indicatorParts();
  expect(pages).toBe(Math.max(1, Math.ceil(LIST_TOTAL / 50)));
  expect(cur).toBe(pages);
  const requested = productListCalls().map((c) => Number(c[1].params.page));
  expect(Math.max(...requested)).toBeLessThanOrEqual(pages);
  expect(host.textContent).not.toContain("Filtreye uyan ürün yok.");
});

test("yükleme sürerken önceki ve sonraki kapalı", async () => {
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "1");
  const pending = [];
  axios.get.mockImplementation((url, config) => {
    const u = String(url);
    if (/\/products\/?$/.test(u.split("?")[0])) {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, params: config?.params });
        config?.signal?.addEventListener("abort", () => {
          const err = new Error("canceled");
          err.code = "ERR_CANCELED";
          err.name = "CanceledError";
          reject(err);
        });
      });
    }
    return Promise.resolve({ data: [] });
  });
  root = createRoot(host);
  await act(async () => { root.render(<StockBarcodePage />); });
  await flush(3);
  expect(host.querySelector('[data-testid="stock-page-prev"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="stock-page-next"]').disabled).toBe(true);

  await act(async () => { pending[0].resolve({ data: pageBody(pending[0].params) }); });
  await waitFor(() => host.textContent.includes("Sunucu Ürün"));
  expect(host.querySelector('[data-testid="stock-page-prev"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="stock-page-next"]').disabled).toBe(false);

  await act(async () => { host.querySelector('[data-testid="stock-page-next"]').click(); });
  await flush(3);
  expect(host.querySelector('[data-testid="stock-page-prev"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="stock-page-next"]').disabled).toBe(true);

  const pageTwo = pending.filter((entry) => Number(entry.params.page) === 2).at(-1);
  await act(async () => { pageTwo.resolve({ data: pageBody(pageTwo.params) }); });
  await waitFor(() => host.textContent.includes("Ikinci Sayfa"));
  expect(host.querySelector('[data-testid="stock-page-prev"]').disabled).toBe(false);
  expect(host.querySelector('[data-testid="stock-page-next"]').disabled).toBe(false);
});

test("son sayfada sonraki kapalı", async () => {
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Ürün"));
  const pages = Math.max(1, Math.ceil(LIST_TOTAL / 50));
  for (let i = 1; i < pages; i += 1) {
    await waitFor(() => host.querySelector('[data-testid="stock-page-next"]').disabled === false);
    const before = indicatorParts().cur;
    await act(async () => { host.querySelector('[data-testid="stock-page-next"]').click(); });
    await waitFor(() => indicatorParts().cur === before + 1);
  }
  await waitFor(() => host.querySelector('[data-testid="stock-page-next"]').disabled === true);
  const shown = indicatorParts();
  expect(shown.cur).toBe(shown.pages);
  expect(shown.pages).toBe(pages);
  expect(host.querySelector('[data-testid="stock-page-prev"]').disabled).toBe(false);
  expect(host.textContent).toContain("Sayfa 3");
});

test("filtre ile total küçülünce sayfa sınırlanır", async () => {
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Ürün"));
  await act(async () => { host.querySelector('[data-testid="stock-page-next"]').click(); });
  await waitFor(() => host.textContent.includes("Ikinci Sayfa"));
  expect(indicatorParts().cur).toBe(2);

  const input = host.querySelector('[data-testid="stock-search-input"]');
  await act(async () => { setControl(input, "yok"); });
  await waitFor(() => indicatorParts().text.replace(/\s/g, "") === "1/1");
  const shown = indicatorParts();
  expect(shown.cur).toBe(1);
  expect(shown.cur).toBeLessThanOrEqual(shown.pages);
  expect(host.textContent).not.toContain("Ikinci Sayfa");
  const pages = productListCalls().map((c) => Number(c[1].params.page));
  expect(pages.at(-1)).toBe(1);
  expect(productListCalls().at(-1)[1].params.q).toBe("yok");
});

test("yanıtta total düşünce sayfa son sayfaya iner", async () => {
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Ürün"));
  totalOverride = 100;
  await act(async () => {
    for (let i = 0; i < 5; i += 1) host.querySelector('[data-testid="stock-page-next"]').click();
  });
  await waitFor(() => indicatorParts().text.replace(/\s/g, "") === "2/2");
  expect(host.querySelector('[data-testid="stock-page-prev"]').disabled).toBe(false);
  expect(host.querySelector('[data-testid="stock-page-next"]').disabled).toBe(true);
  expect(host.textContent).toContain("Ikinci Sayfa");
  expect(host.textContent).not.toContain("Filtreye uyan ürün yok.");
  expect(Math.max(...productListCalls().map((c) => Number(c[1].params.page)))).toBeLessThanOrEqual(3);
});

test("eski isteğin yanıtı son sayfayı ezmez", async () => {
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "1");
  const pending = [];
  axios.get.mockImplementation((url, config) => {
    const u = String(url);
    if (/\/products\/?$/.test(u.split("?")[0])) {
      return new Promise((resolve, reject) => {
        const entry = { resolve, params: { ...(config?.params || {}) }, settled: false };
        pending.push(entry);
        const fail = () => {
          if (entry.settled) return;
          entry.settled = true;
          const err = new Error("canceled");
          err.code = "ERR_CANCELED";
          err.name = "CanceledError";
          reject(err);
        };
        config?.signal?.addEventListener("abort", fail);
      });
    }
    return Promise.resolve({ data: [] });
  });
  root = createRoot(host);
  await act(async () => { root.render(<StockBarcodePage />); });
  await flush(2);
  await act(async () => { pending[0].resolve({ data: pageBody(pending[0].params) }); pending[0].settled = true; });
  await waitFor(() => host.textContent.includes("Sunucu Ürün"));

  await act(async () => { host.querySelector('[data-testid="stock-page-next"]').click(); });
  await flush(2);
  const stale = pending.filter((entry) => !entry.settled && Number(entry.params.page) === 2).at(-1);
  const input = host.querySelector('[data-testid="stock-search-input"]');
  await act(async () => { setControl(input, "ada"); });
  await flush(3);
  const latest = pending.filter((entry) => !entry.settled && entry.params.q === "ada" && Number(entry.params.page) === 1).at(-1);
  expect(latest).toBeTruthy();
  if (stale && !stale.settled) {
    await act(async () => { stale.resolve({ data: pageBody({ ...stale.params, page: 2 }) }); stale.settled = true; });
    await flush(4);
  }
  expect(host.textContent).not.toContain("Ikinci Sayfa");
  await act(async () => { latest.resolve({ data: pageBody(latest.params) }); latest.settled = true; });
  await waitFor(() => host.textContent.includes("Arama Sonucu"));
  expect(indicatorParts().text.replace(/\s/g, "")).toBe("1/1");
  expect(host.textContent).not.toContain("Ikinci Sayfa");
});

test("sayfa boyutu, sıralama ve depo sayfa 1'den istenir", async () => {
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Ürün"));
  await act(async () => { host.querySelector('[data-testid="stock-page-next"]').click(); });
  await waitFor(() => host.textContent.includes("Ikinci Sayfa"));

  const size = host.querySelector('[data-testid="stock-page-size"]');
  await act(async () => { setControl(size, "100"); });
  await waitFor(() => {
    const last = productListCalls().at(-1);
    return last && last[1].params.page === 1 && Number(last[1].params.page_size) === 100;
  });

  const sort = host.querySelector('[data-testid="stock-sort-select"]');
  await act(async () => { setControl(sort, "stock_desc"); });
  await waitFor(() => {
    const last = productListCalls().at(-1);
    return last && last[1].params.page === 1 && last[1].params.sort === "stock_desc" && Number(last[1].params.page_size) === 100;
  });

  const wh = host.querySelector('[data-testid="stock-warehouse-select"]');
  await act(async () => { setControl(wh, "wh_main"); });
  await waitFor(() => {
    const last = productListCalls().at(-1);
    return last && last[1].params.page === 1 && last[1].params.warehouse_id === "wh_main";
  });
});
