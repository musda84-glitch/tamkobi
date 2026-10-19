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
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" } }),
}));
jest.mock("../components/AssignedDutyCard", () => ({ AssignedDutyCard: () => null }));
jest.mock("../utils/HoverImageThumb", () => ({ HoverImageThumb: () => null }));

const EMPS = [
  { id: "e1", full_name: "Soner Akkaya", position: "Personel", has_user: false },
  { id: "e2", full_name: "Gökhan Yılmaz", position: "Personel" },
  { id: "e3", full_name: "Muhammed ASLAN", position: "Usta", has_user: true },
  { id: "e4", full_name: "Yaşar Yıldırım", position: "Üretim", user_id: "usr_1" },
];

let host;
let quiet;
let root;

function mockGets(workOrders, { group = false, stations = [] } = {}) {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/personnel/employees")) return Promise.resolve({ data: EMPS });
    if (u.includes("/production/work-orders/pause-policy")) return Promise.resolve({ data: { allowed: true, phase: "mesai" } });
    if (u.includes("/production/work-orders/shopfloor-settings")) return Promise.resolve({ data: { group_same_station: group } });
    if (u.includes("/production/work-orders/stations")) return Promise.resolve({ data: stations });
    if (u.includes("/production/work-orders")) return Promise.resolve({ data: workOrders });
    if (u.includes("/personnel/me")) return Promise.resolve({ data: { tasks: [] } });
    if (u.includes("/work-parks")) return Promise.resolve({ data: { parks: [] } });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  mockGets([]);
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
  await act(async () => {
    root.render(<ShopFloorPage />);
  });
  await flush();
  return root;
}

function setNativeValue(el, value) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}

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

function cardIds() {
  return [...host.querySelectorAll('[data-testid^="wo-card-"]')].map((el) => el.getAttribute("data-testid"));
}

async function loginAsMuhammed() {
  axios.post.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("shopfloor-unlock")) return Promise.resolve({ data: { operator_name: "Muhammed ASLAN" } });
    return Promise.resolve({ data: { message: "ok" } });
  });
  const sel = host.querySelector('[data-testid="shopfloor-operator"]');
  await act(async () => { setNativeValue(sel, "Muhammed ASLAN"); });
  const pin = host.querySelector('[data-testid="shopfloor-pin-input"]');
  expect(pin).not.toBeNull();
  await act(async () => { setNativeValue(pin, "1234"); });
  const submit = host.querySelector('[data-testid="shopfloor-pin-submit"]');
  expect(submit.disabled).toBe(false);
  await act(async () => { submit.click(); });
  await flush();
}

test("operator select hides personnel without a system user", async () => {
  await renderPage();
  const sel = host.querySelector('[data-testid="shopfloor-operator"]');
  expect(sel).not.toBeNull();
  const labels = [...sel.querySelectorAll("option")].map((o) => o.textContent);
  expect(labels[0]).toBe("Operatör seçin…");
  expect(labels).toContain("Muhammed ASLAN — Usta");
  expect(labels).toContain("Yaşar Yıldırım — Üretim");
  expect(labels.some((t) => t.includes("Soner Akkaya"))).toBe(false);
  expect(labels.some((t) => t.includes("Gökhan Yılmaz"))).toBe(false);
  expect(host.querySelector('[data-testid="shopfloor-load-error"]')).toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-empty"]')).not.toBeNull();
});

test("work order load failure shows permission message instead of an empty list", async () => {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/personnel/employees")) return Promise.resolve({ data: EMPS });
    if (u.includes("/production/work-orders/pause-policy")) return Promise.resolve({ data: { allowed: true, phase: "mesai" } });
    if (u.includes("/production/work-orders/shopfloor-settings")) return Promise.resolve({ data: { group_same_station: false } });
    if (u.includes("/production/work-orders/stations")) return Promise.resolve({ data: [] });
    if (u.includes("/production/work-orders")) {
      return Promise.reject({ response: { status: 403, data: { detail: "Bu özellik için yetkiniz yok" } } });
    }
    if (u.includes("/personnel/me")) return Promise.resolve({ data: { tasks: [] } });
    if (u.includes("/work-parks")) return Promise.resolve({ data: { parks: [] } });
    return Promise.resolve({ data: [] });
  });
  await renderPage();
  const err = host.querySelector('[data-testid="shopfloor-load-error"]');
  expect(err).not.toBeNull();
  expect(err.textContent).toBe("Yetkiniz yok / yüklenemedi");
  expect(host.querySelector('[data-testid="shopfloor-empty"]')).toBeNull();
});

test("does not render shop floor performance or the production AI advisor", async () => {
  await renderPage();
  const urls = axios.get.mock.calls.map((call) => String(call[0]));
  expect(urls.some((url) => url.includes("/performance"))).toBe(false);
  expect(host.querySelector('[data-testid="shopfloor-performance"]')).toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-perf-toggle"]')).toBeNull();
  expect(host.querySelector('[data-testid="production-ai-advisor"]')).toBeNull();
  const gate = host.querySelector('[data-testid="shopfloor-no-operator"]');
  expect(gate).not.toBeNull();
  expect(gate.textContent).toContain("Operatör seç ve PIN gir");
  expect(gate.textContent).toContain("Başla / Devam / Bitir operatör girişinden sonra açılır");
  expect(gate.querySelector('[data-testid="shopfloor-operator"]')).not.toBeNull();
});

test("keeps actions closed until the operator enters a PIN", async () => {
  mockGets([
    wo({ id: "r", order_code: "URT-R", status: "ready", step_no: 1 }),
    wo({
      id: "p",
      order_code: "URT-P",
      status: "paused",
      step_no: 2,
      paused_at: new Date(Date.now() - 12 * 60000).toISOString(),
      auto_paused: false,
      elapsed_min: 6,
    }),
    wo({ id: "i", order_code: "URT-I", status: "in_progress", step_no: 3, elapsed_min: 4 }),
  ]);
  await renderPage();
  for (const id of ["wo-start-URT-R-1", "wo-resume-URT-P-2", "wo-finish-URT-P-2", "wo-pause-URT-I-3", "wo-pause-icon-URT-I-3", "wo-finish-URT-I-3", "wo-trash-URT-R-1", "wo-trash-URT-P-2", "wo-trash-URT-I-3"]) {
    expect(host.querySelector(`[data-testid="${id}"]`).disabled).toBe(true);
  }
  expect(host.querySelector('[data-testid="wo-need-operator-URT-R-1"]').textContent).toBe("Önce operatör seçin");
  expect(host.querySelector('[data-testid="wo-need-operator-URT-P-2"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="wo-need-operator-URT-I-3"]')).not.toBeNull();

  await loginAsMuhammed();
  expect(host.querySelector('[data-testid="shopfloor-no-operator"]')).toBeNull();
  expect(host.querySelector('[data-testid="wo-need-operator-URT-R-1"]')).toBeNull();
  for (const id of ["wo-start-URT-R-1", "wo-resume-URT-P-2", "wo-finish-URT-P-2", "wo-pause-URT-I-3", "wo-pause-icon-URT-I-3", "wo-finish-URT-I-3", "wo-trash-URT-R-1"]) {
    expect(host.querySelector(`[data-testid="${id}"]`).disabled).toBe(false);
  }
  axios.post.mockClear();
  await act(async () => {
    host.querySelector('[data-testid="wo-start-URT-R-1"]').click();
  });
  await flush();
  const startCall = axios.post.mock.calls.find((call) => String(call[0]).includes("/start"));
  expect(startCall).toBeTruthy();
  expect(startCall[1].operator_name).toBe("Muhammed ASLAN");
});

test("stat buttons filter active cards and toggle off", async () => {
  const today = new Date().toISOString();
  mockGets([
    wo({ id: "r", order_code: "URT-R", status: "ready" }),
    wo({ id: "p", order_code: "URT-P", status: "paused", step_no: 2 }),
    wo({ id: "i", order_code: "URT-I", status: "in_progress", step_no: 3 }),
    wo({ id: "w", order_code: "URT-W", status: "waiting", step_no: 4 }),
    wo({ id: "d", order_code: "URT-D", status: "done", step_no: 1, finished_at: today, produced_qty: 1 }),
    wo({ id: "o", order_code: "URT-O", status: "done", step_no: 1, finished_at: "2000-01-01T00:00:00.000Z", produced_qty: 1 }),
  ]);
  await renderPage();
  const activeBtn = () => host.querySelector('[data-testid="shopfloor-stat-active"]');
  expect(activeBtn().getAttribute("aria-pressed")).toBe("false");
  expect(activeBtn().textContent).toContain("2");
  await act(async () => { activeBtn().click(); });
  expect(activeBtn().getAttribute("aria-pressed")).toBe("true");
  expect(activeBtn().className).toMatch(/border-amber/);
  expect(activeBtn().className).toMatch(/bg-amber/);
  expect(host.querySelector('[data-testid="shopfloor-stat-ready"]').getAttribute("aria-pressed")).toBe("false");
  expect(new Set(cardIds())).toEqual(new Set(["wo-card-URT-I-3", "wo-card-URT-P-2"]));
  await act(async () => { activeBtn().click(); });
  expect(activeBtn().getAttribute("aria-pressed")).toBe("false");
  expect(activeBtn().className).not.toMatch(/bg-amber/);
  expect(new Set(cardIds())).toEqual(new Set(["wo-card-URT-I-3", "wo-card-URT-P-2", "wo-card-URT-R-1", "wo-card-URT-W-4"]));

  const doneBtn = host.querySelector('[data-testid="shopfloor-stat-done"]');
  await act(async () => { doneBtn.click(); });
  expect(doneBtn.getAttribute("aria-pressed")).toBe("true");
  expect(cardIds()).toEqual(["wo-card-URT-D-1"]);
});

function stationGroupEls() {
  const wrap = host.querySelector('[data-testid="shopfloor-station-groups"]');
  if (!wrap) return [];
  return [...wrap.children].filter((el) => (el.getAttribute("data-testid") || "").startsWith("shopfloor-station-group-"));
}

function groupCardIds(key) {
  const group = host.querySelector(`[data-testid="shopfloor-station-group-${key}"]`);
  if (!group) return [];
  return [...group.querySelectorAll('[data-testid^="wo-card-"]')].map((el) => el.getAttribute("data-testid"));
}

test("sorts paused ahead of ready, and keeps station groups when grouping is on", async () => {
  const rows = [
    wo({ id: "p", order_code: "URT-P", status: "paused", station: "Delik", step_no: 1 }),
    wo({ id: "r", order_code: "URT-R", status: "ready", station: "Kesim", step_no: 1 }),
    wo({ id: "i", order_code: "URT-I", status: "in_progress", station: "Kesim", step_no: 2, step_count: 2 }),
  ];
  mockGets(rows, { group: false });
  await renderPage();
  expect(host.querySelector('[data-testid="shopfloor-group-same-station"]').checked).toBe(false);
  expect(host.querySelector('[data-testid="shopfloor-station-groups"]')).not.toBeNull();
  expect(groupCardIds("delik")).toEqual(["wo-card-URT-P-1"]);
  expect(groupCardIds("kesim")).toEqual(["wo-card-URT-I-2", "wo-card-URT-R-1"]);
  expect(cardIds()).toEqual(["wo-card-URT-P-1", "wo-card-URT-I-2", "wo-card-URT-R-1"]);

  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.innerHTML = "";
  localStorage.setItem("nx_group_same_station", "1");
  mockGets(rows, { group: true });
  await renderPage();
  expect(host.querySelector('[data-testid="shopfloor-group-same-station"]').checked).toBe(true);
  const delik = host.querySelector('[data-testid="shopfloor-station-group-delik"]');
  const kesim = host.querySelector('[data-testid="shopfloor-station-group-kesim"]');
  expect(delik).not.toBeNull();
  expect(kesim).not.toBeNull();
  expect(delik.compareDocumentPosition(kesim) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect([...delik.querySelectorAll('[data-testid^="wo-card-"]')].map((el) => el.getAttribute("data-testid"))).toEqual(["wo-card-URT-P-1"]);
  expect([...kesim.querySelectorAll('[data-testid^="wo-card-"]')].map((el) => el.getAttribute("data-testid"))).toEqual(["wo-card-URT-I-2", "wo-card-URT-R-1"]);
});

function twoStationRows() {
  return [
    wo({ id: "kr", order_code: "URT-KR", status: "ready", station: "KESİM", step_no: 1 }),
    wo({ id: "kp", order_code: "URT-KP", status: "paused", station: "KESİM", step_no: 2 }),
    wo({ id: "pr", order_code: "URT-PR", status: "ready", station: "PVC BANTLAMA", step_no: 1 }),
    wo({ id: "pi", order_code: "URT-PI", status: "in_progress", station: "PVC BANTLAMA", step_no: 2 }),
  ];
}

function expectKesimPvcGroups() {
  const groups = stationGroupEls();
  expect(host.querySelector('[data-testid="shopfloor-station-groups"]')).not.toBeNull();
  expect(groups).toHaveLength(2);
  expect(groups.map((el) => el.querySelector("h3").textContent)).toEqual(["KESİM", "PVC BANTLAMA"]);
  expect(host.querySelector('[data-testid="shopfloor-station-group-count-kesim"]').textContent).toBe("2");
  expect(host.querySelector('[data-testid="shopfloor-station-group-count-pvc bantlama"]').textContent).toBe("2");
  expect(groupCardIds("kesim")).toEqual(["wo-card-URT-KP-2", "wo-card-URT-KR-1"]);
  expect(groupCardIds("pvc bantlama")).toEqual(["wo-card-URT-PI-2", "wo-card-URT-PR-1"]);
}

test("groups open work orders by station when all stations is selected and grouping is off", async () => {
  mockGets(twoStationRows(), { group: false });
  await renderPage();
  expect(host.querySelector('[data-testid="shopfloor-station"]').value).toBe("");
  expect(host.querySelector('[data-testid="shopfloor-group-same-station"]').checked).toBe(false);
  expectKesimPvcGroups();
  expect(host.textContent).toContain("Açık İş Emirleri (4)");

  await act(async () => { host.querySelector('[data-testid="shopfloor-kiosk"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-page"]').className).toContain("fixed");
  expectKesimPvcGroups();
});

test("keeps the same station groups when same-station ordering is on", async () => {
  localStorage.setItem("nx_group_same_station", "1");
  mockGets(twoStationRows(), { group: true });
  await renderPage();
  expect(host.querySelector('[data-testid="shopfloor-group-same-station"]').checked).toBe(true);
  expectKesimPvcGroups();
});

test("single station filter renders a flat status-sorted grid without group headers", async () => {
  localStorage.setItem("nx_station", "KESİM");
  mockGets([
    wo({ id: "kr", order_code: "URT-KR", status: "ready", station: "KESİM", step_no: 1 }),
    wo({ id: "kp", order_code: "URT-KP", status: "paused", station: "KESİM", step_no: 2 }),
    wo({ id: "ki", order_code: "URT-KI", status: "in_progress", station: "KESİM", step_no: 3 }),
  ], { group: false, stations: ["KESİM"] });
  await renderPage();
  expect(host.querySelector('[data-testid="shopfloor-station"]').value).toBe("KESİM");
  expect(host.querySelector('[data-testid="shopfloor-station-groups"]')).toBeNull();
  expect(host.querySelector('[data-testid^="shopfloor-station-group-"]')).toBeNull();
  expect(cardIds()).toEqual(["wo-card-URT-KI-3", "wo-card-URT-KP-2", "wo-card-URT-KR-1"]);
});

test("stationless work orders are last under İstasyonsuz", async () => {
  mockGets([
    wo({ id: "n1", order_code: "URT-N1", status: "ready", station: "", step_no: 1 }),
    wo({ id: "k", order_code: "URT-K", status: "ready", station: "KESİM", step_no: 1 }),
    wo({ id: "n2", order_code: "URT-N2", status: "in_progress", station: null, step_no: 2 }),
    wo({ id: "p", order_code: "URT-P", status: "paused", station: "PVC BANTLAMA", step_no: 1 }),
  ], { group: false });
  await renderPage();
  const groups = stationGroupEls();
  expect(groups.map((el) => el.querySelector("h3").textContent)).toEqual(["KESİM", "PVC BANTLAMA", "İstasyonsuz"]);
  expect(groups[groups.length - 1].getAttribute("data-testid")).toBe("shopfloor-station-group-_none");
  expect(host.querySelector('[data-testid="shopfloor-station-group-count-_none"]').textContent).toBe("2");
  expect(groupCardIds("_none")).toEqual(["wo-card-URT-N2-2", "wo-card-URT-N1-1"]);
  expect(host.textContent).not.toContain("İstasyon yok");
});

test("active status filter drops empty station groups", async () => {
  mockGets([
    ...twoStationRows(),
    wo({ id: "dr", order_code: "URT-DR", status: "ready", station: "DELİK", step_no: 1 }),
  ], { group: false });
  await renderPage();
  const activeBtn = host.querySelector('[data-testid="shopfloor-stat-active"]');
  await act(async () => { activeBtn.click(); });
  expect(activeBtn.getAttribute("aria-pressed")).toBe("true");
  const groups = stationGroupEls();
  expect(groups.map((el) => el.querySelector("h3").textContent)).toEqual(["KESİM", "PVC BANTLAMA"]);
  expect(host.querySelector('[data-testid="shopfloor-station-group-delik"]')).toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-station-group-count-kesim"]').textContent).toBe("1");
  expect(host.querySelector('[data-testid="shopfloor-station-group-count-pvc bantlama"]').textContent).toBe("1");
  expect(groupCardIds("kesim")).toEqual(["wo-card-URT-KP-2"]);
  expect(groupCardIds("pvc bantlama")).toEqual(["wo-card-URT-PI-2"]);
  expect(new Set(cardIds())).toEqual(new Set(["wo-card-URT-KP-2", "wo-card-URT-PI-2"]));
});

test("shows how long a card has been paused and who paused it", async () => {
  mockGets([
    wo({
      id: "pa",
      order_code: "URT-PA",
      status: "paused",
      paused_at: new Date(Date.now() - 12 * 60000).toISOString(),
      auto_paused: true,
      elapsed_min: 9,
    }),
    wo({
      id: "pe",
      order_code: "URT-PE",
      status: "paused",
      step_no: 2,
      paused_at: new Date(Date.now() - 72 * 60000).toISOString(),
      auto_paused: false,
      elapsed_min: 20,
    }),
    wo({ id: "px", order_code: "URT-PX", status: "paused", step_no: 3, paused_at: null, elapsed_min: 4 }),
    wo({ id: "i", order_code: "URT-I", status: "in_progress", step_no: 4, elapsed_min: 4 }),
  ]);
  await renderPage();
  const auto = host.querySelector('[data-testid="wo-paused-for-URT-PA-1"]');
  expect(auto.textContent).toContain("12 dk duraklatıldı");
  expect(auto.textContent).toContain("Otomatik (mesai dışı)");
  expect(host.querySelector('[data-testid="wo-card-URT-PA-1"]').textContent).toContain("çalışılan 9 dk");
  const manual = host.querySelector('[data-testid="wo-paused-for-URT-PE-2"]');
  expect(manual.textContent).toContain("1 sa 12 dk duraklatıldı");
  expect(manual.textContent).toContain("Elle");
  expect(host.querySelector('[data-testid="wo-card-URT-PE-2"]').textContent).toContain("çalışılan 20 dk");
  expect(host.querySelector('[data-testid="wo-paused-for-URT-PX-3"]')).toBeNull();
  expect(host.querySelector('[data-testid="wo-card-URT-I-4"]').textContent).toContain("4 dk geçti");
  expect(host.querySelector('[data-testid="wo-card-URT-I-4"]').textContent).not.toContain("çalışılan");
});

test("hides materials until Detay is opened and clamps long step names", async () => {
  const stepName = "Panel kenar bantlama ve ölçülendirme adımı";
  mockGets([
    wo({
      id: "long",
      order_code: "URT-LONG",
      status: "ready",
      step_no: 2,
      step_count: 4,
      step_name: stepName,
      product_name: "Safir meşe kapak takımı",
      notes: "sipariş notu",
      materials: [{ product_id: "m1", product_name: "MDF", needed: 2, unit: "Adet" }],
    }),
    wo({ id: "one", order_code: "URT-ONE", status: "ready", step_no: 1, step_count: 1, step_name: "Tek" }),
  ]);
  await renderPage();
  expect(host.querySelector('[data-testid="wo-materials-URT-LONG-2"]')).toBeNull();
  expect(host.querySelector('[data-testid="wo-card-URT-LONG-2"]').textContent).not.toContain("sipariş notu");
  expect(host.querySelector('[data-testid="wo-meta-URT-LONG-2"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="wo-detail-toggle-URT-LONG-2"]').click();
  });
  expect(host.querySelector('[data-testid="wo-materials-URT-LONG-2"]').textContent).toContain("MDF");
  expect(host.querySelector('[data-testid="wo-card-URT-LONG-2"]').textContent).toContain("sipariş notu");
  const card = host.querySelector('[data-testid="wo-card-URT-LONG-2"]');
  const title = [...card.querySelectorAll(".line-clamp-2")].find((el) => el.textContent === stepName);
  expect(title).toBeTruthy();
  expect(title.className).toMatch(/line-clamp-2/);
  expect(title.getAttribute("title")).toBe(stepName);
  expect(card.className).toMatch(/h-full/);
  expect(card.className).toMatch(/flex-col/);
  expect(host.querySelector('[data-testid="wo-start-URT-LONG-2"]').parentElement.className).toMatch(/mt-auto/);
  expect(card.parentElement.className).toMatch(/items-stretch/);
  expect(host.querySelector('[data-testid="wo-stepbar-URT-LONG-2"]').children).toHaveLength(4);
  expect(host.querySelector('[data-testid="wo-stepbar-URT-LONG-2"]').children[0].className).not.toMatch(/bg-slate-800/);
  expect(host.querySelector('[data-testid="wo-stepbar-URT-LONG-2"]').children[1].className).toMatch(/bg-slate-800/);
  expect(host.querySelector('[data-testid="wo-stepbar-URT-ONE-1"]').children).toHaveLength(1);
  expect(host.querySelector('[data-testid="wo-detail-toggle-URT-ONE-1"]')).toBeNull();
});

function clickByText(text) {
  const modal = host.querySelector('[data-testid="shopfloor-pin-modal"]');
  const scope = modal || host;
  const btn = [...scope.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  expect(btn).toBeTruthy();
  return btn;
}

test("operator gate is one row and a verified operator becomes a green chip", async () => {
  axios.post.mockImplementation((url, body) => {
    const u = String(url);
    if (u.includes("shopfloor-unlock")) {
      const name = body?.employee_id === "e4" ? "Yaşar Yıldırım" : "Muhammed ASLAN";
      return Promise.resolve({ data: { operator_name: name } });
    }
    return Promise.resolve({ data: { message: "ok" } });
  });
  await renderPage();
  const gate = host.querySelector('[data-testid="shopfloor-no-operator"]');
  expect(gate).not.toBeNull();
  expect(gate.className).toMatch(/flex/);
  expect(gate.className).toMatch(/flex-col/);
  expect(gate.className).toMatch(/sm:flex-row/);
  expect(gate.textContent).toContain("Operatör seç ve PIN gir");
  expect(gate.textContent).toContain("Başla / Devam / Bitir operatör girişinden sonra açılır.");
  const badge = gate.querySelector(".bg-orange-500");
  expect(badge).not.toBeNull();
  expect(badge.querySelector("svg")).not.toBeNull();
  const sel = gate.querySelector('[data-testid="shopfloor-operator"]');
  expect(sel).not.toBeNull();
  expect(sel.className).toMatch(/min-w-\[220px\]/);
  const pinOpen = gate.querySelector('[data-testid="shopfloor-pin-open"]');
  expect(pinOpen).not.toBeNull();
  expect(pinOpen.textContent).toContain("PIN gir");
  expect(pinOpen.disabled).toBe(true);
  expect(pinOpen.getAttribute("title")).toBe("Önce operatör seçin");
  const bar = host.querySelector('[data-testid="shopfloor-station"]').parentElement;
  expect(bar.querySelector('[data-testid="shopfloor-operator"]')).toBeNull();

  await act(async () => { host.querySelector('[data-testid="shopfloor-kiosk"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-page"]').className).toContain("fixed");
  const kioskGate = host.querySelector('[data-testid="shopfloor-no-operator"]');
  expect(kioskGate.textContent).toContain("Operatör seç ve PIN gir");
  expect(kioskGate.querySelector('[data-testid="shopfloor-pin-open"]').disabled).toBe(true);
  expect(kioskGate.querySelector('[data-testid="shopfloor-operator"]')).not.toBeNull();
  await act(async () => { host.querySelector('[data-testid="shopfloor-kiosk"]').click(); });

  axios.post.mockClear();
  await act(async () => { setNativeValue(host.querySelector('[data-testid="shopfloor-operator"]'), "Muhammed ASLAN"); });
  expect(host.querySelector('[data-testid="shopfloor-pin-modal"]')).not.toBeNull();
  expect(axios.post.mock.calls.some((call) => String(call[0]).includes("shopfloor-unlock"))).toBe(false);
  await act(async () => { clickByText("Vazgeç").click(); });
  expect(host.querySelector('[data-testid="shopfloor-pin-modal"]')).toBeNull();
  const pinAgain = host.querySelector('[data-testid="shopfloor-pin-open"]');
  expect(pinAgain.disabled).toBe(false);
  expect(host.querySelector('[data-testid="shopfloor-operator"]').value).toBe("Muhammed ASLAN");
  await act(async () => { pinAgain.click(); });
  expect(host.querySelector('[data-testid="shopfloor-pin-modal"]')).not.toBeNull();

  const pin = host.querySelector('[data-testid="shopfloor-pin-input"]');
  await act(async () => { setNativeValue(pin, "1234"); });
  await act(async () => { host.querySelector('[data-testid="shopfloor-pin-submit"]').click(); });
  await flush();

  const chip = host.querySelector('[data-testid="shopfloor-operator-chip"]');
  expect(chip).not.toBeNull();
  expect(chip.className).toMatch(/bg-emerald-50/);
  expect(chip.className).toMatch(/border-emerald-200/);
  expect(chip.className).toMatch(/text-emerald-800/);
  expect(chip.textContent).toContain("Muhammed ASLAN");
  expect(chip.textContent).toContain("değiştir");
  expect(host.querySelector('[data-testid="shopfloor-no-operator"]')).toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-station"]').parentElement.querySelector('[data-testid="shopfloor-operator"]')).toBeNull();

  await act(async () => { host.querySelector('[data-testid="shopfloor-operator-change"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-operator-chip"]')).toBeNull();
  const changeSel = host.querySelector('[data-testid="shopfloor-operator"]');
  expect(changeSel).not.toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-pin-modal"]')).toBeNull();
  expect(changeSel.value).toBe("Muhammed ASLAN");

  await act(async () => { setNativeValue(changeSel, "Yaşar Yıldırım"); });
  expect(host.querySelector('[data-testid="shopfloor-pin-modal"]')).not.toBeNull();
  await act(async () => { clickByText("Vazgeç").click(); });
  const kept = host.querySelector('[data-testid="shopfloor-operator-chip"]');
  expect(kept).not.toBeNull();
  expect(kept.textContent).toContain("Muhammed ASLAN");
  expect(kept.textContent).not.toContain("Yaşar");
  expect(host.querySelector('[data-testid="shopfloor-operator"]')).toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-pin-modal"]')).toBeNull();

  await act(async () => { host.querySelector('[data-testid="shopfloor-operator-change"]').click(); });
  await act(async () => { setNativeValue(host.querySelector('[data-testid="shopfloor-operator"]'), "Yaşar Yıldırım"); });
  await act(async () => { setNativeValue(host.querySelector('[data-testid="shopfloor-pin-input"]'), "5678"); });
  await act(async () => { host.querySelector('[data-testid="shopfloor-pin-submit"]').click(); });
  await flush();
  const next = host.querySelector('[data-testid="shopfloor-operator-chip"]');
  expect(next.textContent).toContain("Yaşar Yıldırım");
  expect(host.querySelector('[data-testid="shopfloor-operator"]')).toBeNull();
  const unlockCall = axios.post.mock.calls.find((call) => String(call[0]).includes("shopfloor-unlock") && call[1]?.employee_id === "e4");
  expect(unlockCall).toBeTruthy();
  expect(unlockCall[1].password).toBe("5678");

  await act(async () => { host.querySelector('[data-testid="shopfloor-kiosk"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-page"]').className).toContain("fixed");
  expect(host.querySelector('[data-testid="shopfloor-operator-chip"]').textContent).toContain("Yaşar Yıldırım");
  expect(host.querySelector('[data-testid="shopfloor-operator"]')).toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-no-operator"]')).toBeNull();
});

test("logout clears the operator and change-cancel keeps the current one", async () => {
  mockGets([
    wo({ id: "r", order_code: "URT-R", status: "ready", step_no: 1 }),
    wo({ id: "i", order_code: "URT-I", status: "in_progress", step_no: 3, elapsed_min: 4 }),
  ]);
  await renderPage();
  await loginAsMuhammed();
  expect(host.querySelector('[data-testid="wo-start-URT-R-1"]').disabled).toBe(false);
  expect(host.querySelector('[data-testid="wo-pause-URT-I-3"]').disabled).toBe(false);
  expect(host.querySelector('[data-testid="wo-need-operator-URT-R-1"]')).toBeNull();

  const pauseCalls = () => axios.get.mock.calls.filter((call) => String(call[0]).includes("/production/work-orders/pause-policy")).length;
  const beforePause = pauseCalls();
  axios.post.mockClear();
  await act(async () => { host.querySelector('[data-testid="shopfloor-operator-logout"]').click(); });
  await flush();
  expect(host.querySelector('[data-testid="shopfloor-operator-chip"]')).toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-operator"]')).not.toBeNull();
  const gate = host.querySelector('[data-testid="shopfloor-no-operator"]');
  expect(gate).not.toBeNull();
  expect(gate.textContent).toContain("Operatör seç ve PIN gir");
  const pinOpen = gate.querySelector('[data-testid="shopfloor-pin-open"]');
  expect(pinOpen.disabled).toBe(true);
  expect(pinOpen.getAttribute("title")).toBe("Önce operatör seçin");
  expect(host.querySelector('[data-testid="wo-start-URT-R-1"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="wo-pause-URT-I-3"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="wo-need-operator-URT-R-1"]').textContent).toBe("Önce operatör seçin");
  expect(host.querySelector('[data-testid="wo-need-operator-URT-I-3"]').textContent).toBe("Önce operatör seçin");
  expect(axios.post.mock.calls.some((call) => String(call[0]).includes("shopfloor-unlock"))).toBe(false);
  expect(pauseCalls()).toBe(beforePause);

  await loginAsMuhammed();
  await act(async () => { host.querySelector('[data-testid="shopfloor-operator-change"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-pin-modal"]')).toBeNull();
  const changeSel = host.querySelector('[data-testid="shopfloor-operator"]');
  expect(changeSel).not.toBeNull();
  expect(changeSel.value).toBe("Muhammed ASLAN");
  await act(async () => { setNativeValue(changeSel, ""); });
  expect(host.querySelector('[data-testid="shopfloor-operator-chip"]').textContent).toContain("Muhammed ASLAN");
  expect(host.querySelector('[data-testid="shopfloor-no-operator"]')).toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-pin-modal"]')).toBeNull();

  await act(async () => { host.querySelector('[data-testid="shopfloor-operator-change"]').click(); });
  expect(host.querySelector('[data-testid="shopfloor-operator-change-cancel"]')).not.toBeNull();
  await act(async () => { host.querySelector('[data-testid="shopfloor-operator-change-cancel"]').click(); });
  const kept = host.querySelector('[data-testid="shopfloor-operator-chip"]');
  expect(kept.textContent).toContain("Muhammed ASLAN");
  expect(kept.textContent).toContain("Çıkış");
  expect(host.querySelector('[data-testid="shopfloor-operator"]')).toBeNull();
  expect(host.querySelector('[data-testid="shopfloor-pin-modal"]')).toBeNull();
  expect(host.querySelector('[data-testid="wo-start-URT-R-1"]').disabled).toBe(false);
});

test("tablet mode opens and closes without performance or AI", async () => {
  await renderPage();
  const kiosk = () => host.querySelector('[data-testid="shopfloor-kiosk"]');
  expect(kiosk().textContent).toContain("Tablet Modu");
  await act(async () => { kiosk().click(); });
  expect(host.querySelector('[data-testid="shopfloor-page"]').className).toContain("fixed");
  expect(kiosk().textContent).toContain("Çık");
  expect(host.querySelector('[data-testid="shopfloor-performance"]')).toBeNull();
  expect(host.querySelector('[data-testid="production-ai-advisor"]')).toBeNull();
  await act(async () => { kiosk().click(); });
  expect(kiosk().textContent).toContain("Tablet Modu");
  expect(host.querySelector('[data-testid="shopfloor-page"]').className).not.toContain("fixed");
});
