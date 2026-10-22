import React from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import ShopFloorPage from "./ShopFloorPage";
import { projectColor, stationColor } from "../utils/shopFloorCardMeta";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), message: jest.fn() } }));

const mockAuth = {
  activeCompany: { id: "c1" },
  user: { id: "u9", name: "Mustafa BAL", account_type: "standard", role: "admin" },
};

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => mockAuth,
}));
jest.mock("../components/AssignedDutyCard", () => ({ AssignedDutyCard: () => null }));
jest.mock("../utils/HoverImageThumb", () => ({ HoverImageThumb: () => null }));

const FILTERS = {
  projects: [
    { project_id: "p14", project_number: "PRJ-014", project_name: "Villa Mutfak", job_count: 3 },
    { project_id: "p8", project_number: "PRJ-008", project_name: "", job_count: 2 },
    { project_id: "none", project_number: null, project_name: null, job_count: 1 },
  ],
  recipes: [
    { recipe_id: "r1", recipe_name: "Mutfak Dolabı", job_count: 2 },
    { recipe_id: "r2", recipe_name: "Gardrop", job_count: 1 },
  ],
};

function wo(partial) {
  return {
    step_no: 1,
    step_count: 1,
    step_name: "Adım",
    product_name: "Ürün",
    status: "ready",
    station: "CNC",
    unit: "Adet",
    planned_quantity: 1,
    materials: [],
    ...partial,
    id: partial.id || partial.order_code,
  };
}

const RICH = wo({
  id: "w1",
  order_code: "URT-2026-0003",
  step_no: 1,
  step_count: 2,
  step_name: "Kesim",
  product_name: "Gövde",
  recipe_name: "Mutfak Dolabı",
  recipe_id: "r1",
  station: "CNC",
  project_id: "p14",
  project_number: "PRJ-014",
  project_name: "Villa Mutfak",
  sales_order_no: "SIP-1042",
  customer_name: "Ahmet Yılmaz",
});

const BARE = wo({
  id: "w2",
  order_code: "URT-BARE",
  step_name: "",
  product_name: "Gardrop",
  recipe_name: "",
  station: "Montaj",
  project_id: "",
  project_number: "",
  project_name: "",
  sales_order_no: "",
  customer_name: "",
});

const STEP = wo({
  id: "w3",
  order_code: "URT-STEP",
  step_name: "Kenar Bant",
  product_name: "Kapak",
  recipe_name: " ",
  station: "Kenar Bant",
});

let host;
let quiet;
let root;

function mockGets(workOrders = [RICH, BARE, STEP]) {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("shopfloor-filters")) return Promise.resolve({ data: FILTERS });
    if (u.includes("/production/work-orders/pause-policy")) return Promise.resolve({ data: { allowed: true, phase: "mesai" } });
    if (u.includes("/production/work-orders/shopfloor-settings")) return Promise.resolve({ data: { group_same_station: false } });
    if (u.includes("/production/work-orders/stations")) return Promise.resolve({ data: ["CNC", "Montaj", "Kenar Bant"] });
    if (u.includes("/production/work-orders")) return Promise.resolve({ data: workOrders });
    if (u.includes("/personnel/me")) return Promise.resolve({ data: { tasks: [] } });
    if (u.includes("/work-parks")) return Promise.resolve({ data: { parks: [] } });
    return Promise.resolve({ data: [] });
  });
}

function cssColor(prop, value) {
  const el = document.createElement("div");
  el.style[prop] = value;
  return el.style[prop];
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockAuth.activeCompany = { id: "c1" };
  mockAuth.user = { id: "u9", name: "Mustafa BAL", account_type: "standard", role: "admin" };
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  mockGets();
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  quiet.mockRestore();
  host.remove();
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderPage() {
  root = createRoot(host);
  await act(async () => { root.render(<ShopFloorPage />); });
  await flush();
}

async function choose(testId, value) {
  const sel = host.querySelector(`[data-testid="${testId}"]`);
  expect(sel).not.toBeNull();
  await act(async () => {
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

test("kart reçete adını büyük başlık yapar, etiket ve renkleri çizer", async () => {
  await renderPage();
  const card = host.querySelector('[data-testid="wo-card-URT-2026-0003-1"]');
  const title = host.querySelector('[data-testid="wo-title-URT-2026-0003-1"]');
  expect(title.textContent).toBe("Mutfak Dolabı");
  expect(title.className).toMatch(/text-lg/);
  expect(title.className).toMatch(/font-bold/);
  expect(card.textContent).toContain("URT-2026-0003");
  expect(card.textContent).toContain("Adım 1/2");
  expect(host.querySelector('[data-testid="wo-tag-project-URT-2026-0003-1"]').textContent).toContain("PRJ-014 · Villa Mutfak");
  expect(host.querySelector('[data-testid="wo-tag-order-URT-2026-0003-1"]').textContent).toContain("SIP-1042");
  expect(host.querySelector('[data-testid="wo-tag-customer-URT-2026-0003-1"]').textContent).toContain("Ahmet Yılmaz");
  expect(host.querySelector('[data-testid="wo-tags-URT-2026-0003-1"]').className).toMatch(/flex-wrap/);

  const tag = host.querySelector('[data-testid="wo-station-tag-URT-2026-0003-1"]');
  const tone = stationColor("CNC");
  expect(tag.textContent).toBe("CNC");
  expect(tag.className).toMatch(/bg-(blue|sky|cyan|teal|indigo|violet|purple)-100/);
  expect(tag.getAttribute("data-station-color")).toBe(tone.id);
  expect(tag.style.backgroundColor).toBe(cssColor("backgroundColor", tone.bg));
  expect(tag.style.color).toBe(cssColor("color", tone.fg));

  const project = projectColor("p14");
  expect(project.id).not.toBe("neutral");
  expect(card.getAttribute("data-project-color")).toBe(project.id);
  expect(card.className).toMatch(/border-l-4/);
  expect(card.className).toMatch(/border-blue-200/);
  expect(card.style.borderLeftWidth).toBe("4px");
  expect(card.style.borderLeftColor).toBe(cssColor("borderLeftColor", project.stripe));

  const banner = host.querySelector('[data-testid="shopfloor-station-banner-cnc"]');
  expect(banner).not.toBeNull();
  expect(banner.getAttribute("data-station-color")).toBe(tone.id);
  expect(banner.style.backgroundColor).toBe(cssColor("backgroundColor", tone.bg));
  expect(banner.querySelector("h3").textContent).toBe("CNC");

  const bare = host.querySelector('[data-testid="wo-card-URT-BARE-1"]');
  expect(host.querySelector('[data-testid="wo-title-URT-BARE-1"]').textContent).toBe("Gardrop");
  expect(host.querySelector('[data-testid="wo-tag-project-URT-BARE-1"]')).toBeNull();
  expect(host.querySelector('[data-testid="wo-tag-order-URT-BARE-1"]')).toBeNull();
  expect(host.querySelector('[data-testid="wo-tag-customer-URT-BARE-1"]')).toBeNull();
  expect(host.querySelector('[data-testid="wo-title-URT-BARE-1"]').textContent).not.toContain("—");
  expect(bare.getAttribute("data-project-color")).toBe("neutral");
  expect(bare.style.borderLeftColor).toBe(cssColor("borderLeftColor", projectColor("").stripe));

  const stepCard = host.querySelector('[data-testid="wo-card-URT-STEP-1"]');
  expect(host.querySelector('[data-testid="wo-title-URT-STEP-1"]').textContent).toBe("Kenar Bant");
  expect(host.querySelector('[data-testid="wo-title-URT-STEP-1"]').className).toMatch(/line-clamp-2/);
  expect(stepCard.textContent).toContain("Kapak");

  const start = host.querySelector('[data-testid="wo-start-URT-2026-0003-1"]');
  expect(start.className).toMatch(/min-h-11/);
  expect(start.className).toMatch(/w-full/);
  expect(start.className).toMatch(/col-span-2/);
  expect(card.parentElement.className).toMatch(/grid-cols-1/);
});

test("proje ve reçete filtreleri iş sayısıyla listelenir ve isteği tekrarlar", async () => {
  await renderPage();
  const project = host.querySelector('[data-testid="shopfloor-project"]');
  const recipe = host.querySelector('[data-testid="shopfloor-recipe"]');
  expect(project.className).toMatch(/min-h-11/);
  expect(recipe.className).toMatch(/min-h-11/);
  expect(host.querySelector('[data-testid="shopfloor-kiosk"]').className).toMatch(/min-h-11/);
  expect(host.querySelector('[data-testid="shopfloor-station"]').className).toMatch(/max-w-full/);
  const projectLabels = [...project.options].map((opt) => opt.textContent);
  expect(projectLabels).toEqual([
    "Proje: Tüm projeler",
    "PRJ-014 · Villa Mutfak (3)",
    "PRJ-008 (2)",
    "Projesiz (1)",
  ]);
  expect([...project.options].find((opt) => opt.textContent.startsWith("Projesiz")).value).toBe("none");
  expect([...recipe.options].map((opt) => opt.textContent)).toEqual([
    "Reçete: Tüm reçeteler",
    "Mutfak Dolabı (2)",
    "Gardrop (1)",
  ]);
  const firstList = axios.get.mock.calls.map((call) => String(call[0])).find((url) => url.includes("/production/work-orders?"));
  expect(firstList).not.toContain("project_id=");
  expect(firstList).not.toContain("recipe_id=");
  expect(axios.get.mock.calls.map((call) => String(call[0])).some((url) => url.includes("/production/work-orders/shopfloor-filters?"))).toBe(true);

  axios.get.mockClear();
  await choose("shopfloor-project", "none");
  const projectUrls = axios.get.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/production/work-orders?"));
  expect(projectUrls.some((url) => url.includes("project_id=none"))).toBe(true);

  axios.get.mockClear();
  await choose("shopfloor-recipe", "r1");
  const recipeUrls = axios.get.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/production/work-orders?"));
  expect(recipeUrls.some((url) => url.includes("project_id=none") && url.includes("recipe_id=r1"))).toBe(true);
});

test("atölye olmayan oturumda yalnız operatör adı kalır", async () => {
  await renderPage();
  const chip = host.querySelector('[data-testid="shopfloor-operator-chip"]');
  expect(chip.textContent).toContain("Operatör: Mustafa BAL");
  expect(host.textContent).not.toContain("Kendi oturumunuz");
  expect(host.textContent).not.toContain("seçim gerekmez");
  expect(host.querySelector('[data-testid="shopfloor-operator-change"]')).toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-operator-logout"]')).toBeNull();
});
