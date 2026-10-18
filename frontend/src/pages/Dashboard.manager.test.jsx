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
  return { ResponsiveContainer: Passthrough, BarChart: Passthrough, Bar: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null };
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
  can: (path) => path === "/production" || path === "/projects",
  moduleOn: (path) => path === "/production" || path === "/projects",
};

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => mockAuth,
}));

const stats = {
  total_bank_balance: 1,
  total_receivables: 0,
  total_payables: 0,
  monthly_sales: 0,
  monthly_expenses: 0,
  net_profit: 0,
  sales_change_pct: null,
  pending_orders_count: 0,
  low_stock_count: 0,
  chart_data: [],
  channels_breakdown: [],
  recent_invoices: [],
  decision: [],
};

const production = {
  open: 2,
  in_production: 1,
  late: 0,
  completed_this_month: 3,
  top_orders: [],
  today_completed_steps: 1,
  today_produced_qty: 4,
};
const projects = { active: 1, overdue: 0, cost_total: 10, budget_total: 20, top_projects: [] };

let host;
let root;
let summary;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  summary = { production, projects };
  mockAuth.user = { role: "admin" };
  mockAuth.can = (path) => path === "/production" || path === "/projects";
  mockAuth.moduleOn = (path) => path === "/production" || path === "/projects";
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/dashboard/manager-summary")) {
      if (summary === 404) return Promise.reject({ response: { status: 404 } });
      if (summary === "error") return Promise.reject(new Error("down"));
      return Promise.resolve({ data: summary });
    }
    if (u.includes("/dashboard/stats")) return Promise.resolve({ data: stats });
    if (u.includes("/dashboard/overview")) {
      return Promise.resolve({ data: { date: "2026-10-18", tasks: [], budget_warnings: [], collections: { total: 0, overdue: 0, not_due: 0 }, payments: { total: 0, overdue: 0, not_due: 0 }, invoices: { outgoing: {}, incoming: {} }, drafts: { count: 0, total: 0 }, vat: { payable: 0, calculated: 0, deductible: 0, days_left: 1, month: "2026-10", declaration_date: "2026-10-26" } } });
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
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function summaryCalls() {
  return axios.get.mock.calls.filter((call) => String(call[0]).includes("manager-summary"));
}

test("hides the manager section when the summary is missing or fails", async () => {
  summary = 404;
  await renderDash();
  expect(summaryCalls().length).toBeGreaterThan(0);
  expect(host.querySelector("[data-testid='dashboard-section-manager']")).toBeNull();
  expect(host.querySelector("[data-testid='dashboard-production-card']")).toBeNull();

  summary = "error";
  await renderDash();
  expect(host.querySelector("[data-testid='dashboard-section-manager']")).toBeNull();

  summary = {};
  await renderDash();
  expect(host.querySelector("[data-testid='dashboard-projects-card']")).toBeNull();
  expect(host.querySelector("[data-testid='dashboard-section-manager']")).toBeNull();
});

test("renders only the production card when projects are absent", async () => {
  summary = { production };
  await renderDash();
  expect(host.querySelector("[data-testid='dashboard-production-card']")).toBeTruthy();
  expect(host.querySelector("[data-testid='dashboard-projects-card']")).toBeNull();
});

test("hides projects when the user cannot open the module", async () => {
  mockAuth.can = (path) => path === "/production";
  mockAuth.moduleOn = () => true;
  summary = { production, projects };
  await renderDash();
  expect(host.querySelector("[data-testid='dashboard-production-card']")).toBeTruthy();
  expect(host.querySelector("[data-testid='dashboard-projects-card']")).toBeNull();
});

test("does not request manager summary without production and project access", async () => {
  mockAuth.can = () => false;
  mockAuth.moduleOn = () => false;
  await renderDash();
  expect(summaryCalls()).toHaveLength(0);
  expect(host.querySelector("[data-testid='dashboard-section-manager']")).toBeNull();
});

test("staff home does not include the manager section", async () => {
  mockAuth.user = { role: "personel" };
  mockAuth.can = () => true;
  mockAuth.moduleOn = () => true;
  await renderDash();
  expect(host.querySelector("[data-testid='dashboard-section-manager']")).toBeNull();
  expect(host.getAttribute("data-staff-home") || host.querySelector("[data-staff-home]")?.getAttribute("data-staff-home")).toBe("1");
  expect(summaryCalls()).toHaveLength(0);
});
