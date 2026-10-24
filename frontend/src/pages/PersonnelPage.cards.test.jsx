import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import PersonnelPage from "./PersonnelPage";

let mockAllowDelete = true;

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
    can: (_path, action) => (action === "delete" ? mockAllowDelete : true),
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
jest.mock("../components/EmployeeMovesModal", () => ({
  EmployeeMovesModal: ({ employee }) => <div data-testid="emp-pay-moves-sheet">{employee?.full_name}</div>,
}));
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
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "",
  listImageUrl: (u) => u || "",
  listThumbUrl: (u) => u || "",
  cardThumbUrl: (u) => u || "",
}));
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

const IN = {
  id: "emp_in",
  tc_kimlik: "11111111111",
  full_name: "Ayşe Demir",
  position: "Usta",
  department: "Üretim",
  status: "active",
  location_last_inside: true,
  workplace: { kind: "office" },
  pay_start_date: "2026-01-01",
  annual_leave_days: 14,
  balance: { remaining: 1500, advances: 250 },
};
const OT = {
  id: "emp_ot",
  tc_kimlik: "22222222222",
  full_name: "Mehmet Kaya",
  position: "Operatör",
  department: "Saha",
  status: "active",
  location_last_inside: true,
  pay_start_date: "2026-01-01",
  annual_leave_days: 14,
  balance: { remaining: 0, advances: 0 },
};
const OUT = {
  id: "emp_out",
  tc_kimlik: "33333333333",
  full_name: "Zeynep Ak",
  position: "Muhasebe",
  department: "Ofis",
  status: "active",
  location_last_inside: false,
  pay_start_date: "2026-01-01",
  annual_leave_days: 14,
  balance: { remaining: -1000, advances: 0 },
};

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
  mockAllowDelete = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/personnel/employees")) return Promise.resolve({ data: [IN, OT, OUT] });
    if (u.includes("/personnel/payrolls")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/accounts")) return Promise.resolve({ data: [] });
    if (u.includes("/personnel/attendance")) {
      return Promise.resolve({
        data: {
          summary: [
            { employee_id: "emp_in", today: { check_in: "09:00", hours: 3.5 } },
            {
              employee_id: "emp_ot",
              today: { check_in: "09:00", assigned_overtime_start: "00:00", assigned_overtime_end: "00:00" },
            },
            { employee_id: "emp_out", today: { check_in: "09:00", check_out: "17:00" } },
          ],
        },
      });
    }
    if (u.includes("/personnel/pending-requests")) return Promise.resolve({ data: { items: [] } });
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

test("team summary, balance tone, filters, and status pills", async () => {
  await renderPage();
  expect(host.querySelector('[data-testid="personnel-team-summary"]')?.textContent).toContain("2 / 3 şu an mesaide");
  const owes = host.querySelector('[data-testid="employee-receivable-33333333333"]');
  expect(owes?.textContent).toMatch(/Personel borçlu/);
  expect(owes?.className).toMatch(/rose/);
  expect(host.querySelector('[data-testid="employee-receivable-11111111111"]')?.textContent).toMatch(/Ödenecek/);
  expect(host.querySelector('[data-testid="employee-status-pill-emp_in"]')?.textContent).toMatch(/Mesaide/);
  expect(host.querySelector('[data-testid="employee-status-pill-emp_ot"]')?.textContent).toMatch(/Fazla mesaide/);
  expect(host.querySelector('[data-testid="employee-status-pill-emp_out"]')?.textContent).toMatch(/Mesai dışı/);
  expect(host.querySelector('[data-testid="employee-card-today-work-emp_in"]')?.textContent).toContain("3,5 sa");
  expect(host.querySelector('[data-testid="employee-card-today-work-emp_out"]')?.textContent).toContain("—");
  expect(host.textContent).not.toMatch(/Genişlet/);

  await act(async () => {
    host.querySelector('[data-testid="personnel-filter-in"]').click();
  });
  expect(card("11111111111")).not.toBeNull();
  expect(card("22222222222")).not.toBeNull();
  expect(card("33333333333")).toBeNull();

  await act(async () => {
    host.querySelector('[data-testid="personnel-filter-balance"]').click();
  });
  expect(card("11111111111")).not.toBeNull();
  expect(card("33333333333")).not.toBeNull();
  expect(card("22222222222")).toBeNull();

  await act(async () => {
    host.querySelector('[data-testid="personnel-filter-all"]').click();
  });
  expect(card("11111111111")).not.toBeNull();
  expect(card("22222222222")).not.toBeNull();
  expect(card("33333333333")).not.toBeNull();
});

test("pay and moves open the existing flows; card body expands and buttons do not", async () => {
  await renderPage();
  expect(host.querySelector('[data-testid="emp-pay-modal"]')).toBeNull();
  expect(host.querySelector('[data-testid="employee-card-details-11111111111"]')).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="employee-pay-btn-11111111111"]').click();
  });
  expect(host.querySelector('[data-testid="emp-pay-modal"]')?.textContent).toContain("Ayşe Demir");
  expect(host.querySelector('[data-testid="employee-card-details-11111111111"]')).toBeNull();
  expect(host.querySelector('[data-testid="employee-pay-btn-11111111111"]')?.className).toMatch(/bg-emerald-600/);
  expect(host.querySelector('[data-testid="employee-pay-btn-11111111111"]')?.textContent).toMatch(/Öde/);

  await act(async () => {
    host.querySelector('[data-testid="emp-card-moves-btn-emp_in"]').click();
  });
  expect(host.querySelector('[data-testid="emp-pay-moves-sheet"]')?.textContent).toContain("Ayşe Demir");
  expect(host.querySelector('[data-testid="employee-card-details-11111111111"]')).toBeNull();

  await act(async () => {
    host.querySelector('[data-testid="employee-card-expand-11111111111"]').click();
  });
  expect(host.querySelector('[data-testid="employee-card-details-11111111111"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="employee-card-expand-11111111111"]')?.getAttribute("aria-expanded")).toBe("true");
});

test("more menu lists task, overtime, and edit; delete follows permission", async () => {
  await renderPage();
  expect(host.querySelector('[data-testid="employee-task-btn-11111111111"]')).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="employee-more-btn-emp_in"]').click();
  });
  expect(host.querySelector('[data-testid="employee-task-btn-11111111111"]')?.textContent).toMatch(/Görev ata/);
  expect(host.querySelector('[data-testid="employee-overtime-btn-11111111111"]')?.textContent).toMatch(/\+ Mesai/);
  expect(host.querySelector('[data-testid="employee-edit-11111111111"]')?.textContent).toMatch(/Düzenle/);
  expect(host.querySelector('[data-testid="employee-card-btn-11111111111"]')?.textContent).toMatch(/Kart/);
  expect(host.querySelector('[data-testid="employee-delete-11111111111"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="employee-card-details-11111111111"]')).toBeNull();

  await act(async () => {
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  expect(host.querySelector('[data-testid="employee-task-btn-11111111111"]')).toBeNull();

  await act(async () => {
    host.querySelector('[data-testid="employee-more-btn-emp_in"]').click();
  });
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(host.querySelector('[data-testid="employee-edit-11111111111"]')).toBeNull();
});

test("delete stays hidden without personnel delete permission", async () => {
  mockAllowDelete = false;
  await renderPage();
  await act(async () => {
    host.querySelector('[data-testid="employee-more-btn-emp_in"]').click();
  });
  expect(host.querySelector('[data-testid="employee-task-btn-11111111111"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="employee-delete-11111111111"]')).toBeNull();
});
