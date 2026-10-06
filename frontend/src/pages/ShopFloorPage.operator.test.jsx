import React from "react";
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
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" } }),
}));
jest.mock("../components/ProductionAiAdvisor", () => ({ ProductionAiAdvisor: () => null }));
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

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/personnel/employees")) return Promise.resolve({ data: EMPS });
    if (u.includes("/production/work-orders/performance")) return Promise.resolve({ data: { total_done: 0, operators: [], stations: [] } });
    if (u.includes("/production/work-orders/pause-policy")) return Promise.resolve({ data: { allowed: true, phase: "mesai" } });
    if (u.includes("/production/work-orders/shopfloor-settings")) return Promise.resolve({ data: { group_same_station: false } });
    if (u.includes("/production/work-orders/stations")) return Promise.resolve({ data: [] });
    if (u.includes("/production/work-orders")) return Promise.resolve({ data: [] });
    if (u.includes("/personnel/me")) return Promise.resolve({ data: { tasks: [] } });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  quiet.mockRestore();
  host.remove();
});

async function renderPage() {
  root = createRoot(host);
  await act(async () => {
    root.render(<ShopFloorPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return root;
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
});
