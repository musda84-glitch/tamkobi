import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import PersonnelPage from "./PersonnelPage";

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
  useAuth: () => ({ activeCompany: { id: "c1" }, can: () => true }),
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
jest.mock("../components/EmployeePayModal", () => ({ EmployeePayModal: () => null }));
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
        {
          "data-testid": testId,
          "data-compact": compact ? "1" : "0",
          className: compact ? "h-10 w-fit max-w-[16rem] shrink-0 rounded-lg border border-amber-200 bg-amber-50" : "",
        },
        `Talepler (${(items || []).length}) Talep yok`,
      ),
    PersonnelRequestsInbox: () => null,
  };
});

const EMP = {
  id: "emp_1",
  tc_kimlik: "14479874352",
  full_name: "Soner Akkaya",
  position: "Personel",
  department: "",
  status: "active",
  leave_balance: { remaining: 14, annual: 14 },
  annual_leave_days: 14,
  balance: { remaining: 12500.5, advances: 0 },
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
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/personnel/employees")) return Promise.resolve({ data: [EMP] });
    if (u.includes("/personnel/payrolls")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/accounts")) return Promise.resolve({ data: [] });
    if (u.includes("/personnel/attendance")) return Promise.resolve({ data: { summary: [] } });
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

test("identity column stacks requests, actions and remaining receivable", async () => {
  await renderPage();
  const card = host.querySelector('[data-testid="employee-card-14479874352"]');
  expect(card).not.toBeNull();
  expect(card.textContent).toContain("Soner Akkaya");
  expect(card.textContent).toContain("Kalan izin");
  expect(host.querySelector('[data-testid="employee-receivable-14479874352"]')?.textContent).toMatch(/Kalan alacak/);
  const mid = host.querySelector('[data-testid="employee-card-mid-emp_1"]');
  expect(mid).not.toBeNull();
  expect(mid.className).toMatch(/flex-row/);
  expect(mid.className).toMatch(/items-center/);
  expect(mid.className).toMatch(/flex-1/);
  expect(mid.className).toMatch(/max-w-2xl/);
  const requestBox = mid.querySelector('[data-testid="employee-card-requests-14479874352"]');
  const actions = mid.querySelector('[data-testid="employee-card-actions-emp_1"]');
  expect(requestBox?.textContent).toContain("Talepler");
  expect(requestBox?.className).toMatch(/\bh-10\b/);
  expect(actions?.textContent).toMatch(/Hareketler/);
  expect(actions?.textContent).toMatch(/Personel Kartı/);
  expect(actions?.className).toMatch(/\bh-10\b/);
  expect(mid.contains(host.querySelector('[data-testid="employee-receivable-14479874352"]'))).toBe(false);
  const right = host.querySelector('[data-testid="employee-card-right-emp_1"]');
  expect(right).not.toBeNull();
  expect(right.className).toMatch(/flex-row/);
  expect(right.className).toMatch(/items-center/);
  const loc = host.querySelector('[data-testid="employee-card-loc-emp_1"]');
  expect(loc).not.toBeNull();
  expect(loc.className).toMatch(/w-\[148px\]/);
  expect(loc.className).toMatch(/\bh-10\b/);
  expect(right.contains(loc)).toBe(true);
  const editBtn = host.querySelector('[data-testid="employee-edit-14479874352"]');
  const delBtn = host.querySelector('[data-testid="employee-delete-14479874352"]');
  expect(right.contains(editBtn)).toBe(true);
  expect(right.contains(delBtn)).toBe(true);
  expect(editBtn.className).toMatch(/\bh-10\b/);
  expect(delBtn.className).toMatch(/\bh-10\b/);
  expect(card.className).toMatch(/contain-intrinsic-size:auto_120px/);
  expect(host.querySelector('[data-testid="employee-cards-grid"]')?.className).toContain("grid-cols-1");
  expect(host.querySelector('[data-testid="employee-cards-grid"]')?.className).not.toMatch(/xl:grid-cols-2/);
  expect(host.querySelector('[data-testid="employee-card-details-14479874352"]')).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="employee-card-expand-14479874352"]').click();
  });
  expect(host.querySelector('[data-testid="employee-card-details-14479874352"]')).not.toBeNull();
});
