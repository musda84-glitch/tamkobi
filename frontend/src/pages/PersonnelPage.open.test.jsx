/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import PersonnelPage from "./PersonnelPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  useAuth: () => ({ activeCompany: { id: "c1" }, can: () => true, user: { role: "admin" } }),
}));
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [globalThis.__personnelParams || new URLSearchParams(), jest.fn()],
  useNavigate: () => jest.fn(),
}), { virtual: true });
jest.mock("../components/PersonnelExtras", () => ({
  LeaveRequestsPanel: ({ focusId }) => <div data-testid="leave-focus">{focusId}</div>,
  SalaryCalculator: () => null,
  BonusPanel: () => null,
}));
jest.mock("../components/AttendancePanel", () => ({
  AttendancePanel: ({ focusId }) => <div data-testid="attendance-focus">{focusId}</div>,
}));
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
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "",
  listImageUrl: (u) => u || "",
  listThumbUrl: (u) => u || "",
  cardThumbUrl: (u) => u || "",
}));
jest.mock("../utils/dataRefresh", () => ({
  notifyDataChanged: jest.fn(),
  useDataRefresh: () => {},
}));
jest.mock("../components/PersonnelRequestsInbox", () => ({
  EmployeeRequestChips: () => null,
  PersonnelRequestsInbox: ({ focusId, focusKind }) => (
    <div data-testid="inbox-focus" data-kind={focusKind}>{focusId}</div>
  ),
}));

const EMP = {
  id: "emp_1",
  tc_kimlik: "14479874352",
  full_name: "Soner Akkaya",
  position: "Personel",
  status: "active",
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
  toast.error.mockClear();
  globalThis.__personnelParams = new URLSearchParams();
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/personnel/employees")) return Promise.resolve({ data: [EMP] });
    if (u.includes("/personnel/leaves")) return Promise.resolve({ data: [] });
    if (u.includes("/personnel/bonuses")) return Promise.resolve({ data: [] });
    if (u.includes("/personnel/pending-requests")) return Promise.resolve({ data: { items: [] } });
    if (u.includes("/personnel/attendance")) return Promise.resolve({ data: { records: [] } });
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
    await Promise.resolve();
  });
  return root;
}

test("tab and leave open the leave record", async () => {
  globalThis.__personnelParams = new URLSearchParams("tab=leaves&leave=lv1");
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/personnel/employees")) return Promise.resolve({ data: [EMP] });
    if (u.includes("/personnel/leaves")) return Promise.resolve({ data: [{ id: "lv1", status: "pending" }] });
    if (u.includes("/personnel/pending-requests")) return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: [] });
  });
  await renderPage();
  expect(host.querySelector("[data-testid='personnel-tab-leaves']").className).toMatch(/border-emerald-600/);
  expect(host.querySelector("[data-testid='leave-focus']")?.textContent).toBe("lv1");
  expect(host.querySelector("[data-testid='inbox-focus']")?.textContent).toBe("lv1");
  expect(host.querySelector("[data-testid='inbox-focus']")?.getAttribute("data-kind")).toBe("leave");
  expect(toast.error).not.toHaveBeenCalled();
});

test("missing leave id toasts and the page still renders", async () => {
  globalThis.__personnelParams = new URLSearchParams("tab=leaves&leave=gone");
  await renderPage();
  expect(toast.error).toHaveBeenCalledWith("Kayıt bulunamadı");
  expect(host.querySelector("[data-testid='personnel-tab-leaves']")).not.toBeNull();
  expect(host.querySelector("[data-testid='leave-focus']")).not.toBeNull();
  expect(host.querySelector("[data-testid='leave-focus']")?.textContent).toBe("");
  expect(host.textContent).toContain("İzin Talepleri");
});
