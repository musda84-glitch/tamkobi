/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import ProductionPage from "./ProductionPage";
import { istanbulToday } from "../utils/openingBalance";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockCan = () => true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: { message: "ok" } })),
    put: jest.fn(() => Promise.resolve({ data: { message: "Güncellendi." } })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({
    activeCompany: { id: "c1" },
    can: (...args) => mockCan(...args),
  }),
}));

jest.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
  useNavigate: () => jest.fn(),
}));

jest.mock("../components/ProductionAiAdvisor", () => ({
  ProductionAiAdvisor: ({ compact }) => <div data-testid="production-ai-advisor" data-compact={compact ? "1" : "0"} />,
}));

jest.mock("../components/RecipeModal", () => ({ RecipeModal: () => null }));
jest.mock("../components/ProductionOrderModal", () => ({ ProductionOrderModal: () => null }));
jest.mock("../components/NoCompanyNotice", () => () => null);

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

const today = istanbulToday();
const late1 = addDays(today, -1);
const late3 = addDays(today, -3);
const future = addDays(today, 4);

const ORDERS = [
  {
    id: "po1",
    order_code: "URT-PLAN",
    status: "planned",
    finished_product_id: "p1",
    finished_product_name: "Duvar Rafı",
    planned_quantity: 1,
    completed_quantity: 0,
    total_cost: 200,
    planned_date: late3,
    source: "sales_order",
    sales_order_no: "B2B-2026-0093",
    customer_name: "ERSAY HOLDING",
    recipe_id: "",
    recipe_name: "",
    shortages: [{ product_name: "Cam", needed: 1, in_stock: 0, shortage: 1, unit: "adet" }],
    steps_summary: {
      done: 0,
      total: 1,
      steps: [{ no: 1, name: "Üretim — Duvar Rafı", status: "ready", done: false, current: true }],
    },
  },
  {
    id: "po2",
    order_code: "URT-RUN",
    status: "in_production",
    finished_product_id: "p2",
    finished_product_name: "MDF Dolap",
    planned_quantity: 1,
    completed_quantity: 0,
    total_cost: 4500,
    planned_date: late1,
    source: "stock_card",
    recipe_id: "rec-run",
    recipe_name: "Dolap reçetesi",
    shortages: [
      { product_name: "Beyaz MDF", needed: 2, in_stock: 1, shortage: 1, unit: "plaka" },
      { product_name: "Tek Yüz Mdf", needed: 1, in_stock: 0, shortage: 1, unit: "plaka" },
    ],
    steps_summary: {
      done: 2,
      total: 5,
      steps: [
        {
          no: 1, name: "Kesim", status: "done", done: true, current: false,
          operator_name: "Ahmet Yılmaz", station: "CNC",
          started_at: "2026-10-20T06:10:00+00:00", finished_at: "2026-10-20T08:25:00+00:00",
          material_name: "Beyaz MDF", material_stock_deducted: true, material_stock_qty: 1, finish_unit: "plaka",
        },
        { no: 2, name: "Delme", status: "done", done: true, current: false },
        { no: 3, name: "Bantlama", status: "in_progress", done: false, current: true, operator_name: "Mehmet Kaya" },
        { no: 4, name: "Montaj", status: "waiting", done: false, current: false },
        { no: 5, name: "Paket", status: "waiting", done: false, current: false },
      ],
    },
  },
  {
    id: "po3",
    order_code: "URT-DONE",
    status: "completed",
    finished_product_name: "Kapak",
    planned_quantity: 2,
    completed_quantity: 2,
    total_cost: 10,
    planned_date: late3,
  },
  {
    id: "po4",
    order_code: "URT-CAN",
    status: "cancelled",
    finished_product_name: "İptal Ürün",
    planned_quantity: 1,
    completed_quantity: 0,
    total_cost: 0,
  },
  {
    id: "po5",
    order_code: "URT-FUT",
    status: "planned",
    finished_product_name: "Masa",
    planned_quantity: 4,
    completed_quantity: 0,
    total_cost: 80,
    planned_date: future,
    source: "manual",
  },
];

const KPI_COUNTS = {
  open: 3,
  late: 2,
  completed: 1,
  cancelled: 1,
  all: 5,
  in_production: 1,
  completed_this_month: 1,
  recipes: 2,
  missing_notifications: 0,
};

function ordersForStatus(url) {
  const path = String(url);
  if (path.includes("status=completed")) return ORDERS.filter((order) => order.status === "completed");
  if (path.includes("status=cancelled")) return ORDERS.filter((order) => order.status === "cancelled");
  if (path.includes("status=open")) return ORDERS.filter((order) => order.status === "planned" || order.status === "in_production");
  return ORDERS;
}

function routeGet(url) {
  const path = String(url);
  if (path.includes("/production/kpis")) {
    return Promise.resolve({ data: KPI_COUNTS });
  }
  if (path.includes("/production/recipes/rec-run")) {
    return Promise.resolve({
      data: { id: "rec-run", target_quantity: 1, material_cost: 3200, labor_cost: 0, overhead_cost: 400 },
    });
  }
  if (path.includes("/production/recipes")) {
    return Promise.resolve({
      data: [{ id: "rec1", name: "Raf reçetesi", finished_product_id: "p1", finished_product_name: "Duvar Rafı", is_active: true }],
    });
  }
  if (path.includes("/production/orders")) return Promise.resolve({ data: ordersForStatus(path) });
  if (path.includes("/products")) return Promise.resolve({ data: [] });
  return Promise.resolve({ data: [] });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

let host;
let root;

async function renderPage() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<ProductionPage />); });
  await flush();
}

function click(selector) {
  const el = host.querySelector(selector);
  if (!el) throw new Error(`missing ${selector}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

beforeEach(() => {
  mockCan = () => true;
  axios.get.mockImplementation(routeGet);
  axios.post.mockResolvedValue({ data: { message: "ok" } });
  axios.put.mockResolvedValue({ data: { message: "Güncellendi." } });
  axios.delete.mockResolvedValue({ data: { message: "Silindi." } });
  window.confirm = jest.fn(() => true);
});

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  host = null;
  root = null;
});

test("duruma göre ana buton, çip sayıları, arama ve gecikti rozeti", async () => {
  await renderPage();
  expect(host.querySelector("[data-testid='production-ai-advisor']").getAttribute("data-compact")).toBe("1");
  expect(host.querySelector("[data-testid='po-order-list'] table")).toBeNull();
  expect(host.querySelector("[data-testid='po-start-URT-PLAN']").textContent).toContain("Başlat");
  expect(host.querySelector("[data-testid='po-complete-URT-PLAN']")).toBeNull();
  expect(host.querySelector("[data-testid='po-complete-URT-RUN']").textContent).toContain("Tamamla");
  expect(host.querySelector("[data-testid='po-start-URT-RUN']")).toBeNull();
  expect(host.querySelector("[data-testid='po-complete-qty-URT-RUN']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-card-URT-PLAN'] select")).toBeNull();
  const firstOrders = axios.get.mock.calls.map((call) => String(call[0])).find((url) => url.includes("/production/orders"));
  expect(firstOrders).toContain("company_id=c1");
  expect(firstOrders).toContain("status=open");
  expect(host.querySelector("[data-testid='po-filter-count-open']").textContent).toBe("3");
  expect(host.querySelector("[data-testid='po-filter-count-late']").textContent).toBe("2");
  expect(host.querySelector("[data-testid='po-filter-count-completed']").textContent).toBe("1");
  expect(host.querySelector("[data-testid='po-filter-count-cancelled']").textContent).toBe("1");
  expect(host.querySelector("[data-testid='po-filter-count-all']").textContent).toBe("5");
  expect(host.querySelector("[data-testid='po-late-URT-PLAN']").textContent).toContain("3 gün gecikti");
  expect(host.querySelector("[data-testid='po-late-URT-RUN']").textContent).toContain("1 gün gecikti");
  expect(host.querySelector("[data-testid='po-late-URT-FUT']")).toBeNull();
  expect(host.querySelector("[data-testid='po-card-URT-DONE']")).toBeNull();
  expect(host.querySelector("[data-testid='po-source-URT-PLAN']").textContent).toContain("Siparişten");
  expect(host.querySelector("[data-testid='po-source-URT-PLAN']").textContent).toContain("B2B-2026-0093");
  expect(host.querySelector("[data-testid='po-source-URT-PLAN']").textContent).toContain("ERSAY HOLDING");
  expect(host.querySelector("[data-testid='po-source-URT-RUN']").textContent).toContain("Stok kartından");
  expect(host.querySelector("[data-testid='po-progress-URT-RUN']").textContent).toContain("3/5");
  expect(host.querySelector("[data-testid='po-progress-URT-RUN']").textContent).toContain("%40");
  expect(host.querySelector("[data-testid='po-step-bar-URT-RUN-1']").className).toContain("bg-emerald-500");
  expect(host.querySelector("[data-testid='po-step-bar-URT-RUN-3']").className).toContain("bg-amber-500");
  expect(host.querySelector("[data-testid='po-step-bar-URT-RUN-4']").className).toContain("bg-slate-200");
  expect(host.querySelector("[data-testid='po-progress-URT-PLAN']").textContent).toContain("başlamadı");
  expect(host.querySelector("[data-testid='po-step-bar-URT-PLAN-1']").className).toContain("bg-slate-200");

  await act(async () => { click("[data-testid='po-start-URT-PLAN']"); });
  await flush();
  expect(axios.post).toHaveBeenCalledWith("/api/production/orders/po1/start", {});

  axios.post.mockClear();
  await act(async () => { click("[data-testid='po-complete-URT-RUN']"); });
  await flush();
  expect(axios.post).toHaveBeenCalledWith("/api/production/orders/po2/complete", expect.objectContaining({
    quantity: 1, update_cost: true, allow_over: true,
  }));

  const search = host.querySelector("[data-testid='po-search']");
  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => { setValue(search, "ersay"); });
  expect(host.querySelector("[data-testid='po-card-URT-PLAN']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-card-URT-RUN']")).toBeNull();
  expect(host.querySelector("[data-testid='po-filter-count-open']").textContent).toBe("3");
  await act(async () => { setValue(search, ""); });
  await act(async () => { click("[data-testid='po-filter-late']"); });
  expect(host.querySelector("[data-testid='po-card-URT-FUT']")).toBeNull();
  expect(host.querySelector("[data-testid='po-card-URT-PLAN']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-card-URT-RUN']")).not.toBeNull();
  await act(async () => { click("[data-testid='po-filter-completed']"); });
  await flush();
  const completedUrl = axios.get.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("status=completed")).at(-1);
  expect(completedUrl).toContain("company_id=c1");
  expect(host.querySelector("[data-testid='po-card-URT-DONE']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-late-URT-DONE']")).toBeNull();
  expect(host.querySelector("[data-testid='po-start-URT-DONE']")).toBeNull();
  expect(host.querySelector("[data-testid='po-complete-URT-DONE']")).toBeNull();
});

test("menü işlemleri, eksik hammadde paneli ve detayda gerçek maliyet", async () => {
  await renderPage();
  await act(async () => { click("[data-testid='po-shortage-URT-RUN']"); });
  const panel = host.querySelector("[data-testid='po-shortage-panel-URT-RUN']");
  expect(panel.textContent).toContain("Beyaz MDF");
  expect(panel.textContent).toContain("Tek Yüz Mdf");
  expect(panel.textContent).toContain("Eksik 1");
  expect(panel.textContent).toContain("plaka");
  expect(panel.textContent).not.toContain("Satın alma");

  await act(async () => { click("[data-testid='po-menu-URT-PLAN']"); });
  expect(host.querySelector("[data-testid='po-menu-panel-URT-PLAN']").textContent).toContain("Detayı aç");
  expect(host.querySelector("[data-testid='po-produce-shortages-URT-PLAN']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-edit-URT-PLAN']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-cancel-URT-PLAN']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-delete-URT-PLAN']")).not.toBeNull();

  await act(async () => { click("[data-testid='po-edit-URT-PLAN']"); });
  await flush();
  const drawer = host.querySelector("[data-testid='po-drawer']");
  expect(drawer).not.toBeNull();
  expect(host.querySelector("[data-testid='po-card-URT-PLAN'] select")).toBeNull();
  const recipe = drawer.querySelector("[data-testid='po-recipe-URT-PLAN']");
  expect(recipe).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(recipe, "rec1");
    recipe.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { drawer.querySelector("[data-testid='po-plan-save-URT-PLAN']").click(); });
  await flush();
  expect(axios.put).toHaveBeenCalledWith("/api/production/orders/po1", expect.objectContaining({ recipe_id: "rec1" }));

  await act(async () => { click("[data-testid='po-menu-URT-RUN']"); });
  axios.post.mockClear();
  await act(async () => { click("[data-testid='po-produce-shortages-URT-RUN']"); });
  await flush();
  expect(axios.post).toHaveBeenCalledWith("/api/production/orders/po2/produce-shortages", {});

  await act(async () => { click("[data-testid='po-menu-URT-PLAN']"); });
  axios.post.mockClear();
  await act(async () => { click("[data-testid='po-cancel-URT-PLAN']"); });
  await flush();
  expect(axios.post).toHaveBeenCalledWith("/api/production/orders/po1/cancel", {});

  await act(async () => { click("[data-testid='po-menu-URT-PLAN']"); });
  await act(async () => { click("[data-testid='po-delete-URT-PLAN']"); });
  await flush();
  expect(window.confirm).toHaveBeenCalled();
  expect(axios.delete).toHaveBeenCalledWith("/api/production/orders/po1");

  await act(async () => { click("[data-testid='po-open-URT-RUN']"); });
  await flush();
  const detail = host.querySelector("[data-testid='po-drawer']");
  expect(detail.textContent).toContain("Ahmet Yılmaz");
  expect(detail.textContent).toContain("09:10");
  expect(detail.textContent).toContain("11:25");
  expect(detail.textContent).toContain("2 sa 15 dk");
  const waiting = host.querySelector("[data-testid='po-drawer-step-URT-RUN-4']");
  expect(waiting.textContent).toContain("Bekliyor");
  expect(waiting.textContent).not.toMatch(/\d{2}:\d{2}/);
  const active = host.querySelector("[data-testid='po-drawer-step-URT-RUN-3']");
  expect(active.textContent).toContain("Mehmet Kaya");
  expect(active.textContent).not.toMatch(/\d{2}:\d{2}/);
  expect(host.querySelector("[data-testid='po-drawer-consumed-URT-RUN']").textContent).toContain("Beyaz MDF");
  expect(host.querySelector("[data-testid='po-drawer-consumed-URT-RUN']").textContent).toContain("plaka");
  expect(host.querySelector("[data-testid='po-cost-line-Hammadde']").textContent).toContain("3.200,00");
  expect(host.querySelector("[data-testid='po-cost-line-Genel gider']").textContent).toContain("400,00");
  expect(host.querySelector("[data-testid='po-cost-line-İşçilik']")).toBeNull();
  expect(detail.textContent).toContain("4.500,00");
});

test("görür yetkisinde işlem butonları gizli", async () => {
  mockCan = (_path, level = "view") => level === "view";
  await renderPage();
  expect(host.querySelector("[data-testid='po-start-URT-PLAN']")).toBeNull();
  expect(host.querySelector("[data-testid='po-complete-URT-RUN']")).toBeNull();
  expect(host.querySelector("[data-testid='po-complete-qty-URT-RUN']")).toBeNull();
  expect(host.querySelector("[data-testid='po-menu-URT-PLAN']")).toBeNull();
  expect(host.querySelector("[data-testid='po-menu-URT-RUN']")).toBeNull();
  expect(host.querySelector("[data-testid='po-delete-URT-PLAN']")).toBeNull();
  expect(host.querySelector("[data-testid='po-cancel-URT-PLAN']")).toBeNull();
  expect(host.querySelector("[data-testid='po-produce-shortages-URT-PLAN']")).toBeNull();
  expect(host.querySelector("[data-testid='new-production-order-btn']")).toBeNull();
  expect(host.querySelector("[data-testid='new-recipe-btn']")).toBeNull();
  expect(host.querySelector("[data-testid='goto-shopfloor-btn']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-shortage-URT-RUN']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-card-URT-RUN']")).not.toBeNull();
});

test("390px kartlarda yatay taşma yok, ana buton tam genişlik, çipler kayar", async () => {
  const previous = window.innerWidth;
  window.innerWidth = 390;
  host = document.createElement("div");
  host.style.width = "390px";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<ProductionPage />); });
  await flush();
  window.innerWidth = previous || 1024;

  const list = host.querySelector("[data-testid='po-order-list']");
  expect(list.querySelector("table")).toBeNull();
  expect(list.className).toContain("min-w-0");
  expect(list.className).toContain("max-w-full");
  const card = host.querySelector("[data-testid='po-card-URT-RUN']");
  expect(card.className).toContain("min-w-0");
  expect(card.className).toContain("max-w-full");
  const bar = host.querySelector("[data-testid='po-filter-bar']");
  expect(bar.className).toContain("overflow-x-auto");
  expect(bar.className).toContain("flex-nowrap");
  const primary = host.querySelector("[data-testid='po-complete-URT-RUN']");
  expect(primary.className).toContain("w-full");
  const nodes = [list, ...list.querySelectorAll("*")];
  nodes.forEach((node) => {
    const cls = typeof node.className === "string" ? node.className : "";
    const mins = cls.match(/min-w-\[(\d+)px\]/g) || [];
    mins.forEach((token) => {
      expect(Number(token.match(/\d+/)[0])).toBeLessThanOrEqual(390);
    });
  });
  expect(list.innerHTML).not.toContain("min-w-[960px]");
});

test("300'den fazla tamamlanmışta eski açık emir listede ve sayımda kalır", async () => {
  const openOrder = {
    id: "old-open",
    order_code: "URT-OLD",
    status: "planned",
    finished_product_name: "Eski Açık",
    planned_quantity: 1,
    completed_quantity: 0,
    planned_date: "2020-01-02",
    created_at: "2020-01-01",
  };
  axios.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/production/kpis")) {
      return Promise.resolve({
        data: {
          open: 1, late: 1, completed: 301, cancelled: 0, all: 302,
          in_production: 0, completed_this_month: 0, recipes: 0, missing_notifications: 0,
        },
      });
    }
    if (path.includes("/production/orders") && path.includes("status=open")) {
      return Promise.resolve({ data: [openOrder] });
    }
    if (path.includes("/production/orders") && path.includes("status=completed")) {
      return Promise.resolve({
        data: [{
          id: "d1", order_code: "URT-D", status: "completed", finished_product_name: "Bitti",
          planned_quantity: 1, completed_quantity: 1,
        }],
      });
    }
    if (path.includes("/production/orders") && path.includes("status=cancelled")) {
      return Promise.resolve({ data: [] });
    }
    if (path.includes("/production/orders")) return Promise.resolve({ data: [openOrder] });
    return Promise.resolve({ data: [] });
  });

  await renderPage();
  expect(host.querySelector("[data-testid='po-card-URT-OLD']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-filter-count-open']").textContent).toBe("1");
  expect(host.querySelector("[data-testid='po-filter-count-late']").textContent).toBe("1");
  expect(host.querySelector("[data-testid='po-filter-count-completed']").textContent).toBe("301");
  expect(host.querySelector("[data-testid='po-filter-count-cancelled']").textContent).toBe("0");
  expect(host.querySelector("[data-testid='po-filter-count-all']").textContent).toBe("302");
  const opened = axios.get.mock.calls.map((call) => String(call[0])).find((url) => url.includes("/production/orders"));
  expect(opened).toContain("company_id=c1");
  expect(opened).toContain("status=open");

  await act(async () => { click("[data-testid='po-filter-completed']"); });
  await flush();
  const completed = axios.get.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("status=completed")).at(-1);
  expect(completed).toContain("company_id=c1");
  expect(host.querySelector("[data-testid='po-card-URT-OLD']")).toBeNull();
  expect(host.querySelector("[data-testid='po-card-URT-D']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-filter-count-open']").textContent).toBe("1");
  expect(host.querySelector("[data-testid='po-filter-count-completed']").textContent).toBe("301");

  await act(async () => { click("[data-testid='po-filter-cancelled']"); });
  await flush();
  const cancelled = axios.get.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("status=cancelled")).at(-1);
  expect(cancelled).toContain("company_id=c1");
  expect(host.querySelector("[data-testid='po-filter-count-cancelled']").textContent).toBe("0");

  await act(async () => { click("[data-testid='po-filter-all']"); });
  await flush();
  const allUrl = axios.get.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/production/orders")).at(-1);
  expect(allUrl).toContain("company_id=c1");
  expect(allUrl).not.toContain("status=");
  expect(host.querySelector("[data-testid='po-card-URT-OLD']")).not.toBeNull();
  expect(host.querySelector("[data-testid='po-filter-count-all']").textContent).toBe("302");
});
