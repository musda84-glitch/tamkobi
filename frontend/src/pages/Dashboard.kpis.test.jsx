import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";
import Dashboard from "./Dashboard";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("../utils/dataRefresh", () => ({ useDataRefresh: () => {} }));
jest.mock("recharts", () => {
  const React = require("react");
  const Passthrough = ({ children }) => React.createElement("div", null, children);
  return {
    ResponsiveContainer: Passthrough,
    BarChart: Passthrough,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
  };
});
jest.mock("../hooks/useDashboardLayout", () => {
  const React = require("react");
  return {
    useDashboardLayout: () => ({
      order: ["ai", "kpis", "overview", "manager", "alerts", "charts", "bottom", "staff", "decision", "demo"],
      wrap: (id, node) => (node == null ? null : React.createElement("div", { "data-testid": `dashboard-section-${id}` }, node)),
      toolbar: null,
    }),
  };
});

const mockAuth = {
  activeCompany: { id: "c1", name: "Demo A.Ş." },
  user: { role: "admin" },
  addonOn: () => false,
  can: () => false,
  moduleOn: () => false,
};

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => mockAuth,
}));

function baseStats(extra = {}) {
  return {
    total_bank_balance: 1000,
    total_receivables: 2500,
    total_payables: 400,
    receivable_count: 2,
    payable_count: 1,
    monthly_sales: 10000,
    monthly_expenses: 4000,
    net_profit: 6000,
    sales_change_pct: null,
    pending_orders_count: 0,
    low_stock_count: 3,
    chart_data: [],
    channels_breakdown: [],
    recent_invoices: [],
    decision: [{ text: "3 üründe stok kritik.", path: "/stock" }],
    ...extra,
  };
}

let host;
let root;
let statsBody;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  statsBody = baseStats();
  mockAuth.activeCompany = { id: "c1", name: "Demo A.Ş." };
  mockAuth.user = { role: "admin" };
  mockAuth.can = () => false;
  mockAuth.moduleOn = () => false;
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/dashboard/stats")) return Promise.resolve({ data: statsBody });
    if (u.includes("/dashboard/overview")) {
      return Promise.resolve({
        data: {
          date: "2026-10-18",
          tasks: [{ key: "critical_stock", label: "Kritik stok", count: 2, path: "/stock" }],
          budget_warnings: [],
          collections: { total: 0, overdue: 0, not_due: 0 },
          payments: { total: 0, overdue: 0, not_due: 0 },
          invoices: { outgoing: { month: 1, week: 0, today: 0 }, incoming: { month: 0, week: 0, today: 0 } },
          drafts: { count: 0, total: 0 },
          vat: { month: "2026-10", calculated: 0, deductible: 0, payable: 0, declaration_date: "2026-10-26", days_left: 8 },
        },
      });
    }
    if (u.includes("/personnel/messages")) return Promise.resolve({ data: { mode: "none" } });
    if (u.includes("/personnel/pending-requests")) return Promise.resolve({ data: { items: [], count: 0 } });
    if (u.includes("/edocs/inbox")) return Promise.resolve({ data: { items: [], counts: { pending: 0 } } });
    if (u.includes("/marketplace/questions")) return Promise.resolve({ data: [] });
    if (u.includes("/dashboard/ops-alerts")) return Promise.resolve({ data: { count: 0, groups: [] } });
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderDash() {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter><Dashboard /></MemoryRouter>);
  });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

test("hides today line when today_sales is missing and shows draft note", async () => {
  await renderDash();
  expect(host.textContent).toContain("taslak ve iptal hariç");
  expect(host.textContent).not.toContain("Bugün:");
  expect(host.querySelectorAll("[data-testid='task-critical_stock']")).toHaveLength(1);
  expect(host.textContent).not.toContain("3 üründe stok kritik");
});

test("shows today sales for a positive amount and for zero", async () => {
  statsBody = baseStats({ today_sales: 1250, sales_change_pct: 12.5 });
  await renderDash();
  expect(host.textContent).toContain("Bugün: 1.250,00 ₺");
  expect(host.textContent).toContain("+%12.5 önceki aya");

  statsBody = baseStats({ today_sales: 0 });
  await renderDash();
  expect(host.textContent).toContain("Bugün: 0,00 ₺");
});

test("does not request dashboard data and shows the notice when no company is selected", async () => {
  mockAuth.activeCompany = null;
  await renderDash();
  const urls = axios.get.mock.calls.map((call) => String(call[0]));
  expect(urls.some((url) => url.includes("/dashboard/stats"))).toBe(false);
  expect(urls.some((url) => url.includes("/dashboard/manager-summary"))).toBe(false);
  expect(host.querySelector("[data-testid='no-company']")).toBeTruthy();
  expect(host.textContent).toContain("Firma seçili değil");
});

test("negative net profit uses a red card and expense subline", async () => {
  statsBody = baseStats({ net_profit: -1500, monthly_expenses: 8000, sales_change_pct: -4 });
  await renderDash();
  const card = host.querySelector("[data-testid='kpi-net']");
  expect(card.className).toMatch(/rose/);
  expect(card.querySelector(".text-rose-600")).toBeTruthy();
  expect(card.textContent).toContain("Gider (alış)");
  expect(card.textContent).toContain("8.000,00 ₺");
  expect(card.textContent).not.toContain("Ciro:");
  expect(host.textContent).toContain("-%4 önceki aya");
});
