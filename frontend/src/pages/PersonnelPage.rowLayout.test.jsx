import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import PersonnelPage from "./PersonnelPage";
import { employeePayButtonLabel } from "../utils/personnelCard";

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
  useAuth: () => ({
    activeCompany: { id: "c1" },
    can: () => true,
    user: { role: "admin" },
  }),
}));
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
  useNavigate: () => jest.fn(),
}), { virtual: true });
jest.mock("../components/PersonnelExtras", () => ({
  LeaveRequestsPanel: () => null,
  SalaryCalculator: () => null,
  BonusPanel: () => null,
}));
jest.mock("../components/AttendancePanel", () => ({ AttendancePanel: () => null }));
jest.mock("../components/EmployeeCardModal", () => ({ EmployeeCardModal: () => null }));
jest.mock("../components/EmployeePayModal", () => ({
  EmployeePayModal: ({ employee }) => <div data-testid="emp-pay-modal">{employee?.full_name}</div>,
}));
jest.mock("../components/EmployeeMovesModal", () => ({ EmployeeMovesModal: () => null }));
jest.mock("../components/EmployeeAssignTaskModal", () => ({ EmployeeAssignTaskModal: () => null }));
jest.mock("../components/AssignOvertimeModal", () => ({ AssignOvertimeModal: () => null }));
jest.mock("../components/QuickPayModal", () => ({ QuickPayModal: () => null }));
jest.mock("../components/PaymentTargetSelect", () => ({
  PaymentTargetSelect: () => null,
  splitPaymentTarget: () => ({}),
}));
jest.mock("../components/EmployeeLedgerModal", () => ({ EmployeeLedgerModal: () => null }));
jest.mock("../components/EmployeeYevmiyeModal", () => ({ EmployeeYevmiyeModal: () => null }));
jest.mock("../utils/payslip", () => ({ printPayslip: jest.fn() }));
jest.mock("../utils/compressImage", () => ({ compressImageFile: async (f) => f }));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "" }));
jest.mock("../utils/dataRefresh", () => ({
  notifyDataChanged: jest.fn(),
  useDataRefresh: () => {},
}));
jest.mock("../components/PersonnelRequestsInbox", () => {
  const React = require("react");
  return {
    EmployeeRequestChips: ({ items, testId, compact }) =>
      React.createElement(
        "div",
        { "data-testid": testId, "data-compact": compact ? "1" : "0" },
        `Talepler (${(items || []).length})`,
      ),
    PersonnelRequestsInbox: () => null,
  };
});

const SONER = {
  id: "emp_soner",
  tc_kimlik: "10000000001",
  full_name: "Soner Akkaya",
  position: "Personel",
  department: "Ofis",
  status: "active",
  annual_leave_days: 14,
  balance: { remaining: 0, advances: 0 },
};
const YASAR = {
  id: "emp_yasar",
  tc_kimlik: "10000000002",
  full_name: "Yaşar Yıldırım",
  position: "Usta",
  department: "Üretim",
  status: "active",
  annual_leave_days: 14,
  balance: { remaining: 400, advances: 0 },
};
const MUHAMMED = {
  id: "emp_muhammed",
  tc_kimlik: "10000000003",
  full_name: "Muhammed ASLAN",
  position: "Operatör",
  department: "Saha",
  status: "active",
  annual_leave_days: 14,
  balance: { remaining: -7140, advances: 8600 },
};
const ABDULL = {
  id: "emp_abdull",
  tc_kimlik: "10000000004",
  full_name: "Abdullrahman Haşim",
  position: "Usta",
  department: "Montaj",
  status: "active",
  location_last_inside: true,
  annual_leave_days: 14,
  balance: { remaining: -12032.7, advances: 0 },
};
const PEOPLE = [SONER, YASAR, MUHAMMED, ABDULL];

let host;
let quiet;

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/personnel/employees")) return Promise.resolve({ data: PEOPLE });
    if (u.includes("/personnel/payrolls")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/accounts")) return Promise.resolve({ data: [] });
    if (u.includes("/personnel/attendance")) {
      return Promise.resolve({
        data: {
          summary: [
            {
              employee_id: "emp_abdull",
              today: { check_in: "14:46", assigned_overtime_hours: 2 },
            },
          ],
        },
      });
    }
    if (u.includes("/personnel/pending-requests")) {
      return Promise.resolve({
        data: {
          items: [{ id: "req_leave_1", employee_id: "emp_abdull", kind: "leave", title: "Yıllık izin" }],
        },
      });
    }
    if (u.includes("/personnel/role-options")) return Promise.resolve({ data: { roles: [] } });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

async function renderPage() {
  const root = createRoot(host);
  await act(async () => {
    root.render(<PersonnelPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return root;
}

function card(tc) {
  return host.querySelector(`[data-testid="employee-card-${tc}"]`);
}

function payText(tc) {
  return (host.querySelector(`[data-testid="employee-pay-btn-${tc}"]`)?.textContent || "").replace(/\s+/g, " ").trim();
}

test("employee cards are a single full-width column with horizontal rows", async () => {
  await renderPage();
  const grid = host.querySelector('[data-testid="employee-cards-grid"]');
  expect(grid).not.toBeNull();
  expect(grid.className).not.toMatch(/md:grid-cols-2/);
  expect(grid.className).not.toMatch(/2xl:grid-cols-3/);
  expect(grid.className).toMatch(/flex-col/);
  expect(grid.className).not.toMatch(/grid-cols-[2-9]/);

  for (const emp of PEOPLE) {
    const row = host.querySelector(`[data-testid="employee-card-expand-${emp.tc_kimlik}"]`);
    expect(row?.className).toMatch(/md:flex-row/);
    const actions = host.querySelector(`[data-testid="employee-card-actions-${emp.id}"]`);
    expect(actions?.className).toMatch(/md:flex-nowrap/);
    expect(actions?.className).toMatch(/flex-wrap/);
    expect(actions?.textContent).toMatch(/Öde/);
    expect(actions?.textContent).toMatch(/Hareketler/);
    expect(actions?.querySelector(`[data-testid="employee-more-btn-${emp.id}"]`)).not.toBeNull();
  }

  expect(payText(SONER.tc_kimlik)).toBe(employeePayButtonLabel(SONER));
  expect(payText(YASAR.tc_kimlik)).toBe(employeePayButtonLabel(YASAR));
  expect(payText(MUHAMMED.tc_kimlik)).toBe(employeePayButtonLabel(MUHAMMED));
  expect(payText(ABDULL.tc_kimlik)).toBe(employeePayButtonLabel(ABDULL));
  expect(payText(SONER.tc_kimlik)).toBe("Öde");
  expect(payText(YASAR.tc_kimlik)).toBe("Öde · 400,00 ₺");
  expect(payText(MUHAMMED.tc_kimlik)).toBe("Öde · -7.140,00 ₺");
  expect(payText(ABDULL.tc_kimlik)).toBe("Öde · -12.032,70 ₺");

  expect(host.querySelector(`[data-testid="employee-receivable-${SONER.tc_kimlik}"]`)?.textContent).toMatch(/Bakiye yok/);
  expect(host.querySelector(`[data-testid="employee-receivable-${YASAR.tc_kimlik}"]`)?.textContent).toMatch(/Ödenecek/);
  expect(host.querySelector(`[data-testid="employee-receivable-${MUHAMMED.tc_kimlik}"]`)?.textContent).toMatch(/Personel borçlu/);
  expect(host.querySelector(`[data-testid="employee-receivable-${ABDULL.tc_kimlik}"]`)?.textContent).toMatch(/Personel borçlu/);
  const summary = host.querySelector('[data-testid="personnel-team-summary"]');
  expect(summary?.textContent).toContain("Personel borçlu (toplam)");
  expect(summary?.textContent).toContain("18.772,70");
});

test("request chips and assigned overtime render only when present", async () => {
  await renderPage();
  const chips = host.querySelectorAll('[data-testid^="employee-card-requests-"]');
  expect(chips).toHaveLength(1);
  expect(card(ABDULL.tc_kimlik)?.contains(chips[0])).toBe(true);
  expect(chips[0].textContent).toContain("Talepler (1)");
  expect(host.querySelector(`[data-testid="employee-card-requests-${SONER.tc_kimlik}"]`)).toBeNull();
  expect(host.querySelector(`[data-testid="employee-card-requests-${YASAR.tc_kimlik}"]`)).toBeNull();
  expect(host.querySelector(`[data-testid="employee-card-requests-${MUHAMMED.tc_kimlik}"]`)).toBeNull();

  const boxes = host.querySelectorAll('[data-testid^="employee-card-assigned-ot-"]');
  expect(boxes).toHaveLength(1);
  expect(boxes[0].textContent).toContain("+2 sa");
  expect(host.querySelector('[data-testid="employee-card-assigned-ot-emp_abdull"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="employee-card-assigned-ot-emp_soner"]')).toBeNull();
  expect(host.querySelector('[data-testid="employee-card-assigned-ot-emp_yasar"]')).toBeNull();
  expect(host.querySelector('[data-testid="employee-card-assigned-ot-emp_muhammed"]')).toBeNull();
  expect(host.querySelector('[data-testid="employee-card-loc-emp_soner"]')).toBeNull();
  expect(host.querySelector('[data-testid="employee-status-pill-emp_abdull"]')?.textContent).toMatch(/Fazla mesaide/);
  expect(host.querySelector('[data-testid="employee-card-today-in-emp_abdull"]')?.textContent).toContain("14:46");
});

test("card body expands details; pay opens the modal without expanding; more menu keeps actions", async () => {
  await renderPage();
  expect(host.querySelector(`[data-testid="employee-card-details-${SONER.tc_kimlik}"]`)).toBeNull();
  expect(host.querySelector('[data-testid="emp-pay-modal"]')).toBeNull();

  await act(async () => {
    host.querySelector(`[data-testid="employee-pay-btn-${SONER.tc_kimlik}"]`).click();
  });
  expect(host.querySelector('[data-testid="emp-pay-modal"]')?.textContent).toContain("Soner Akkaya");
  expect(host.querySelector(`[data-testid="employee-card-details-${SONER.tc_kimlik}"]`)).toBeNull();

  await act(async () => {
    host.querySelector(`[data-testid="employee-card-expand-${SONER.tc_kimlik}"]`).click();
  });
  expect(host.querySelector(`[data-testid="employee-card-details-${SONER.tc_kimlik}"]`)).not.toBeNull();

  expect(host.querySelector(`[data-testid="employee-task-btn-${ABDULL.tc_kimlik}"]`)).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="employee-more-btn-emp_abdull"]').click();
  });
  expect(host.querySelector(`[data-testid="employee-task-btn-${ABDULL.tc_kimlik}"]`)?.textContent).toMatch(/Görev ata/);
  expect(host.querySelector(`[data-testid="employee-overtime-btn-${ABDULL.tc_kimlik}"]`)?.textContent).toMatch(/\+ Mesai/);
  expect(host.querySelector(`[data-testid="employee-card-details-${ABDULL.tc_kimlik}"]`)).toBeNull();
});
