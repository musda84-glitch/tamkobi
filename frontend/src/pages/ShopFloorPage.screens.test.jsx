import React from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import ShopFloorPage from "./ShopFloorPage";

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

const ADMIN = { id: "u9", name: "Mustafa BAL", account_type: "standard", role: "admin" };
const VIEWER = { id: "u8", name: "İzleyici", account_type: "standard", role: "user", permissions: { "/atolye": "view" } };
const ATOLYE = {
  id: "u1",
  name: "Atölye Tablet",
  account_type: "atolye",
  role: "production",
  shopfloor_stations: ["CNC"],
};

const FILTERS = {
  projects: [
    { project_id: "p14", project_number: "PRJ-014", project_name: "Villa Mutfak", job_count: 3 },
  ],
  recipes: [{ recipe_id: "r1", recipe_name: "Mutfak Dolabı", job_count: 2 }],
};

const OPERATORS = [
  { operator_type: "employee", id: "e3", name: "Muhammed ASLAN", station: "CNC", has_shopfloor_pin: true },
];

function wo(partial) {
  return {
    step_no: 1,
    step_count: 2,
    step_name: "Kesim",
    product_name: "Gövde",
    recipe_name: "Mutfak Dolabı",
    status: "ready",
    station: "CNC",
    unit: "Adet",
    planned_quantity: 10,
    materials: [],
    order_code: "URT-1",
    unit_price: 987654,
    sale_price: 987654,
    cost: 987654,
    ...partial,
    id: partial.id || partial.order_code || "URT-1",
  };
}

let host;
let quiet;
let root;

function mockGets(workOrders = [wo({})], { settings = {}, userJobs } = {}) {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("shopfloor-filters")) return Promise.resolve({ data: FILTERS });
    if (u.includes("/production/work-orders/pause-policy")) return Promise.resolve({ data: { allowed: true, phase: "mesai" } });
    if (u.includes("/production/work-orders/shopfloor-settings")) {
      return Promise.resolve({ data: { group_same_station: false, idle_lock_minutes: 30, undo_finish_minutes: 5, scrap_reasons: [], ...settings } });
    }
    if (u.includes("/drawing")) {
      return Promise.resolve({
        data: { url: "/api/files/cizim.png?t=1", content_type: "image/png", filename: "kapak.png", expires_in: 900 },
      });
    }
    if (u.includes("/production/work-orders/stations")) return Promise.resolve({ data: ["CNC"] });
    if (u.includes("shopfloor-operators")) return Promise.resolve({ data: OPERATORS });
    if (u.includes("/production/work-orders")) return Promise.resolve({ data: userJobs || workOrders });
    if (u.includes("/personnel/me")) return Promise.resolve({ data: { tasks: [] } });
    if (u.includes("/work-parks")) return Promise.resolve({ data: { parks: [] } });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockAuth.activeCompany = { id: "c1" };
  mockAuth.user = { ...ADMIN };
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { message: "ok" } });
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
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  root = createRoot(host);
  await act(async () => { root.render(<ShopFloorPage />); });
  await flush();
}

async function enterPin(pin) {
  for (const digit of String(pin)) {
    const key = host.querySelector(`[data-testid="shopfloor-pin-key-${digit}"]`);
    expect(key).not.toBeNull();
    await act(async () => { key.click(); });
  }
  await flush();
}

test("iş listesi fiyat basmaz ve Kendi oturumunuz yazmaz", async () => {
  await renderPage();
  const page = host.querySelector('[data-testid="shopfloor-page"]');
  expect(page.className).toMatch(/overflow-x-hidden/);
  expect(page.className).toMatch(/max-w-full/);
  expect(host.querySelector('[data-testid="wo-card-URT-1-1"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="wo-title-URT-1-1"]').textContent).toBe("Mutfak Dolabı");
  expect(host.querySelector('[data-testid="wo-drawing-URT-1-1"]').className).toMatch(/min-h-11/);
  expect(host.textContent).not.toContain("Kendi oturumunuz");
  expect(host.textContent).not.toContain("987654");
  expect(host.textContent).toContain("Renk: istasyon = dolu etiket");
});

test("proje filtresi menüsü seçince listeyi proje kimliğiyle yeniler", async () => {
  await renderPage();
  await act(async () => { host.querySelector('[data-testid="shopfloor-filter-project"]').click(); });
  const menu = host.querySelector('[data-testid="shopfloor-filter-menu"]');
  expect(menu.textContent).toContain("Villa Mutfak");
  axios.get.mockClear();
  await act(async () => { host.querySelector('[data-testid="shopfloor-filter-option-p14"]').click(); });
  await flush();
  expect(host.querySelector('[data-testid="shopfloor-project"]').value).toBe("p14");
  expect(host.querySelector('[data-testid="shopfloor-filter-menu"]')).toBeNull();
  const urls = axios.get.mock.calls.map((call) => String(call[0]));
  expect(urls.some((url) => url.includes("project_id=p14"))).toBe(true);
  expect(host.textContent).not.toContain("Kendi oturumunuz");
});

test("sıradaki iş ve çalışan iş odak ekranları açılır", async () => {
  await renderPage();
  await act(async () => { host.querySelector('[data-testid="shopfloor-focus-open"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-next-job"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-focus-start"]').textContent).toContain("BAŞLAT");
  await act(async () => { host.querySelector('[data-testid="shopfloor-focus-back"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-next-job"]')).toBeNull();

  mockGets([wo({ status: "in_progress", operator_name: "Mustafa BAL", partial_qty_total: 4 })]);
  await renderPage();
  await act(async () => { host.querySelector('[data-testid="shopfloor-focus-open"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-running"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-focus-finish"]').textContent).toContain("BİTİR");
  expect(host.textContent).not.toContain("Kendi oturumunuz");
});

test("devralma uyarısı onayı confirm_takeover ile yeniden dener", async () => {
  const job = wo({ id: "w-take", status: "ready" });
  mockGets([job]);
  let starts = 0;
  axios.post.mockImplementation((url, body) => {
    if (!String(url).includes("/start")) return Promise.resolve({ data: { message: "ok" } });
    starts += 1;
    if (!body?.confirm_takeover) {
      return Promise.reject({
        response: {
          status: 409,
          data: {
            detail: {
              code: "takeover_confirm_required",
              previous_operator: "Ayşe Usta",
              last_action_at: "2026-10-22T09:40:00.000Z",
              message: "devral",
            },
          },
        },
      });
    }
    return Promise.resolve({ data: { message: "devralındı", work_order: { ...job, status: "in_progress", operator_name: "Mustafa BAL" } } });
  });
  await renderPage();
  await act(async () => { host.querySelector('[data-testid="wo-start-URT-1-1"]').click(); });
  await flush();
  const dialog = host.querySelector('[data-testid="shopfloor-takeover-dialog"]');
  expect(dialog.textContent).toContain("Ayşe Usta");
  expect(dialog.textContent).toContain("devralınsın mı");
  await act(async () => { host.querySelector('[data-testid="shopfloor-takeover-confirm"]').click(); });
  await flush();
  expect(starts).toBe(2);
  const retry = axios.post.mock.calls.map((call) => call[1]).find((body) => body?.confirm_takeover);
  expect(retry.confirm_takeover).toBe(true);
  expect(retry.operator_name).toBe("Mustafa BAL");
  expect(host.textContent).not.toContain("Kendi oturumunuz");
});

test("ara sayım penceresi planı aşmayan adedi partial-count ile yollar", async () => {
  mockGets([wo({ status: "in_progress", operator_name: "Mustafa BAL", partial_qty_total: 3, planned_quantity: 10 })]);
  axios.post.mockResolvedValue({ data: { partial_qty_total: 5, message: "ok" } });
  await renderPage();
  expect(host.querySelector('[data-testid="wo-partial-bar-URT-1-1"]')).not.toBeNull();
  await act(async () => { host.querySelector('[data-testid="wo-partial-URT-1-1"]').click(); });
  const dialog = host.querySelector('[data-testid="shopfloor-partial-dialog"]');
  expect(dialog.textContent).toContain("Ara sayım");
  await act(async () => { host.querySelector('[data-testid="shopfloor-numpad-2"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-partial-forecast"]').textContent).toContain("kalan");
  await act(async () => { host.querySelector('[data-testid="shopfloor-partial-add"]').click(); });
  await flush();
  const call = axios.post.mock.calls.find((item) => String(item[0]).includes("/partial-count"));
  expect(call[1]).toEqual({ qty: 2, operator_name: "Mustafa BAL" });
  expect(call[2].headers["Idempotency-Key"]).toBeTruthy();
  expect(host.querySelector('[data-testid="shopfloor-partial-dialog"]')).toBeNull();
});

test("bitir sonrası geri al bildirimi undo-finish çağırır", async () => {
  const running = wo({ status: "in_progress", operator_name: "Mustafa BAL", planned_quantity: 4 });
  mockGets([running]);
  axios.post.mockImplementation((url) => {
    if (String(url).includes("/finish")) {
      return Promise.resolve({
        data: {
          message: "bitti",
          work_order: { ...running, status: "done", finished_at: new Date().toISOString(), produced_qty: 4, scrap_qty: 0 },
        },
      });
    }
    if (String(url).includes("/undo-finish")) return Promise.resolve({ data: { message: "geri alındı" } });
    return Promise.resolve({ data: { message: "ok" } });
  });
  await renderPage();
  await act(async () => { host.querySelector('[data-testid="wo-finish-URT-1-1"]').click(); });
  expect(host.querySelector('[data-testid="wo-finish-modal"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="wo-finish-scrap-reasons"]')).toBeNull();
  await act(async () => { host.querySelector('[data-testid="wo-finish-confirm"]').click(); });
  await flush();
  const toast = host.querySelector('[data-testid="shopfloor-undo-toast"]');
  expect(toast.textContent).toContain("Geri al");
  expect(toast.textContent).toMatch(/\d:\d\d/);
  await act(async () => { host.querySelector('[data-testid="shopfloor-undo-toast-action"]').click(); });
  await flush();
  expect(axios.post.mock.calls.some((call) => String(call[0]).includes("/undo-finish"))).toBe(true);
  expect(host.textContent).not.toContain("Kendi oturumunuz");
});

test("teknik çizim görüntüleyicisi çizim adresini açar", async () => {
  await renderPage();
  await act(async () => { host.querySelector('[data-testid="wo-drawing-URT-1-1"]').click(); });
  await flush();
  const view = host.querySelector('[data-testid="shopfloor-drawing"]');
  expect(view.textContent).toContain("Teknik çizim");
  expect(view.textContent).toContain("kapak.png");
  expect(host.querySelector('[data-testid="shopfloor-drawing-image"]').getAttribute("src")).toBe("/api/files/cizim.png?t=1");
  await act(async () => { host.querySelector('[data-testid="shopfloor-drawing-close"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-drawing"]')).toBeNull();
});

test("görüntüleme yetkisinde başla, duraklat ve bitir pasif kalır", async () => {
  mockAuth.user = { ...VIEWER };
  mockGets([
    wo({ id: "r", order_code: "URT-R", status: "ready" }),
    wo({ id: "i", order_code: "URT-I", status: "in_progress", step_no: 2, operator_name: "Ali" }),
  ]);
  await renderPage();
  for (const id of ["wo-start-URT-R-1", "wo-pause-URT-I-2", "wo-finish-URT-I-2", "wo-partial-URT-I-2"]) {
    const button = host.querySelector(`[data-testid="${id}"]`);
    expect(button.disabled).toBe(true);
    expect(button.className).toMatch(/cursor-not-allowed/);
  }
  expect(host.querySelector('[data-testid="wo-drawing-URT-R-1"]').disabled).toBe(false);
  axios.post.mockClear();
  await act(async () => { host.querySelector('[data-testid="wo-start-URT-R-1"]').click(); });
  await flush();
  expect(axios.post).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("987654");
  expect(host.textContent).not.toContain("Kendi oturumunuz");
});

test("kilit ekranı operatör seçtirir ve Kendi oturumunuz yazmaz", async () => {
  mockAuth.user = { ...ATOLYE };
  mockGets([]);
  await renderPage();
  const gate = host.querySelector('[data-testid="shopfloor-no-operator"]');
  expect(gate.textContent).toContain("Kim çalışıyor?");
  expect(gate.textContent).toContain("Operatör seçin");
  expect(gate.textContent).toContain("PIN tanımlı");
  expect(host.textContent).not.toContain("Kendi oturumunuz");
  expect(host.querySelector("select[data-testid='shopfloor-operator']")).toBeNull();
});

test("boşta kalınca kilit ekranı aynı operatörün PIN'ini ister", async () => {
  mockAuth.user = { ...ATOLYE };
  mockGets([wo({ status: "ready" })], { settings: { idle_lock_minutes: 0.001 } });
  axios.post.mockImplementation((url) => {
    if (String(url).includes("shopfloor-unlock")) {
      return Promise.resolve({
        data: {
          operator_token: "tok-e3",
          operator_name: "Muhammed ASLAN",
          operator_type: "employee",
          operator_id: "e3",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });
    }
    return Promise.resolve({ data: { message: "ok" } });
  });
  await renderPage();
  await act(async () => { host.querySelector('[data-testid="shopfloor-operator-card-e3"]').click(); });
  await enterPin("5829");
  expect(host.querySelector('[data-testid="shopfloor-idle-lock"]')).toBeNull();
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 250); }); });
  const lock = host.querySelector('[data-testid="shopfloor-idle-lock"]');
  expect(lock).not.toBeNull();
  expect(lock.textContent).toContain("Ekran kilitlendi");
  expect(lock.textContent).toContain("Muhammed ASLAN");
  expect(host.textContent).not.toContain("Kendi oturumunuz");
  await act(async () => { host.querySelector('[data-testid="shopfloor-idle-switch"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-no-operator"]')).not.toBeNull();
});
