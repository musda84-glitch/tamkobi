import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { EmployeeCardModal } from "./EmployeeCardModal";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: { message: "ok" } })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api", useAuth: () => ({ user: { id: "u1" } }) }));
jest.mock("../utils/useEscape", () => ({ useEscape: () => {} }));
jest.mock("../utils/modalBackdrop", () => ({ backdropDismissProps: () => ({}) }));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "" }));
jest.mock("../utils/compressImage", () => ({ compressImageFile: async (f) => f }));
jest.mock("./WorkScheduleSettings", () => ({ EmployeeCompensationForm: () => null }));
jest.mock("./EmployeePayModal", () => ({ EmployeePayModal: () => null }));
jest.mock("./EmployeeAssignTaskModal", () => ({ EmployeeAssignTaskModal: () => null }));
jest.mock("./EmployeeYevmiyeModal", () => ({ EmployeeYevmiyeModal: () => null }));
jest.mock("./EmployeeMovesModal", () => ({ EmployeeMovesModal: () => null }));
jest.mock("./EmployeePuantajPanel", () => ({ EmployeePuantajPanel: () => null }));
jest.mock("./AssignedDutyCard", () => ({ AssignedDutyCard: () => null }));
jest.mock("./StaffMessagesPanel", () => ({ StaffMessagesPanel: () => null }));

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  window.confirm = jest.fn(() => true);
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/card")) {
      return Promise.resolve({
        data: {
          employee: { id: "emp_1", full_name: "Ali", status: "active", position: "Satış", department: "Satış" },
          payrolls: [
            { id: "pay_pending", period: "2026-11", status: "pending", gross_salary: 0, net_salary: 40000, bonus: 0 },
            { id: "pay_paid", period: "2026-09", status: "paid", gross_salary: 0, net_salary: 35000, bonus: 0, paid_date: "2026-09-28" },
          ],
          bonuses: [],
          leaves: [],
          documents: [],
          attendance: { days_present: 0, total_hours: 0, overtime_hours: 0 },
          leave_balance: { remaining: 14, annual: 14, used: 0, carry: 0 },
          totals: { bonus_total: 0, paid_salary: 35000 },
          balance: { remaining: 40000, overtime_due: 0, month: "2026-10" },
          overtime: {},
          performance: {},
          tasks: [],
        },
      });
    }
    if (u.includes("work-schedule")) return Promise.resolve({ data: { schedule: {} } });
    if (u.includes("banking/accounts")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
  axios.delete.mockResolvedValue({ data: { message: "Maaş kaydı çöp kutusuna taşındı." } });
});
afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

const render = (node) => {
  const root = createRoot(host);
  act(() => root.render(node));
  return root;
};

test("ödemeler tablosunda ödenen maaşa sil koyar", async () => {
  render(<EmployeeCardModal employee={{ id: "emp_1", full_name: "Ali" }} companyId="c1" onClose={() => {}} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => host.querySelector('[data-testid="emp-tab-salary"]').click());
  const paid = host.querySelector('[data-testid="emp-salary-del-pay_paid"]');
  expect(paid).not.toBeNull();
  expect(paid.textContent.toLocaleLowerCase("tr-TR")).toContain("sil");
  expect(host.querySelector('[data-testid="emp-salary-del-pay_pending"]')).not.toBeNull();
  await act(async () => { paid.click(); await Promise.resolve(); await Promise.resolve(); });
  expect(window.confirm).toHaveBeenCalled();
  expect(axios.delete).toHaveBeenCalledWith("/api/personnel/payrolls/pay_paid");
});

test("sistem sekmesinde onaylı personel veri sıfırlama gönderir", async () => {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/card")) {
      return Promise.resolve({
        data: {
          employee: { id: "emp_1", full_name: "Ali", status: "active", position: "Satış", department: "Satış" },
          payrolls: [],
          bonuses: [],
          leaves: [],
          documents: [],
          attendance: { days_present: 0, total_hours: 0, overtime_hours: 0 },
          leave_balance: { remaining: 14, annual: 14, used: 0, carry: 0 },
          totals: { bonus_total: 0, paid_salary: 0 },
          balance: { remaining: 0, overtime_due: 0, month: "2026-10" },
          overtime: {},
          performance: {},
          tasks: [],
          user: { id: "u1", email: "yasaryldrm098@icloud.com", role: "production", is_active: true, last_login_at: "2026-10-03T18:32:10" },
        },
      });
    }
    if (u.includes("role-options")) return Promise.resolve({ data: { roles: [{ code: "production", name: "Üretim" }] } });
    if (u.includes("work-schedule")) return Promise.resolve({ data: { schedule: {} } });
    if (u.includes("banking/accounts")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
  axios.post.mockResolvedValue({ data: { status: "success", message: "Ali için personel verileri sıfırlandı." } });
  render(<EmployeeCardModal employee={{ id: "emp_1", full_name: "Ali" }} companyId="c1" onClose={() => {}} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  act(() => host.querySelector('[data-testid="emp-tab-user"]').click());
  expect(host.querySelector('[data-testid="emp-user-linked"]')).not.toBeNull();
  const openBtn = host.querySelector('[data-testid="emp-data-reset-btn"]');
  expect(openBtn).not.toBeNull();
  act(() => openBtn.click());
  expect(host.querySelector('[data-testid="emp-data-reset-modal"]')).not.toBeNull();
  const confirm = host.querySelector('[data-testid="emp-data-reset-confirm"]');
  expect(confirm.disabled).toBe(true);
  act(() => host.querySelector('[data-testid="emp-data-reset-confirm-check"]').click());
  expect(host.querySelector('[data-testid="emp-data-reset-confirm"]').disabled).toBe(false);
  await act(async () => { host.querySelector('[data-testid="emp-data-reset-confirm"]').click(); await Promise.resolve(); await Promise.resolve(); });
  expect(axios.post).toHaveBeenCalledWith("/api/personnel/employees/emp_1/reset-data", { confirm: true });
});

test("izinler sekmesinde yıllık hak günü kaydeder", async () => {
  axios.put.mockResolvedValue({ data: { annual_leave_days: 20 } });
  render(<EmployeeCardModal employee={{ id: "emp_1", full_name: "Ali" }} companyId="c1" onClose={() => {}} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  act(() => host.querySelector('[data-testid="emp-tab-leaves"]').click());
  const input = host.querySelector('[data-testid="emp-leave-annual-input"]');
  expect(input).not.toBeNull();
  expect(input.value).toBe("14");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "20");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector('[data-testid="emp-leave-annual-save"]').click();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(axios.put).toHaveBeenCalledWith("/api/personnel/employees/emp_1", { annual_leave_days: 20 });
});
