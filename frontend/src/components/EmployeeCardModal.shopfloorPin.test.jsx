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
    delete: jest.fn(() => Promise.resolve({ data: {} })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const mockAuth = { user: { id: "u1", role: "admin" } };
jest.mock("../context/AuthContext", () => ({ API_URL: "/api", useAuth: () => mockAuth }));
jest.mock("../utils/useEscape", () => ({ useEscape: () => {} }));
jest.mock("../utils/modalBackdrop", () => ({ backdropDismissProps: () => ({}) }));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "",
  listImageUrl: (u) => u || "",
  listThumbUrl: (u) => u || "",
  cardThumbUrl: (u) => u || "",
}));
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
let root;
let hasPin = false;

function card() {
  return {
    employee: { id: "emp_1", full_name: "Ali", status: "active", position: "Usta", has_shopfloor_pin: hasPin },
    payrolls: [],
    bonuses: [],
    leaves: [],
    documents: [],
    attendance: {},
    leave_balance: { remaining: 14 },
    totals: {},
    balance: { remaining: 0 },
    overtime: {},
    performance: {},
    tasks: [],
    user: { id: "usr", email: "ali@x.com", role: "production", is_active: true },
  };
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  hasPin = false;
  mockAuth.user = { id: "u1", role: "admin" };
  window.confirm = jest.fn(() => true);
  axios.post.mockReset();
  axios.delete.mockReset();
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/card")) return Promise.resolve({ data: card() });
    if (u.includes("role-options")) return Promise.resolve({ data: { roles: [{ code: "production", name: "Üretim" }] } });
    if (u.includes("work-schedule")) return Promise.resolve({ data: { schedule: {} } });
    if (u.includes("banking/accounts")) return Promise.resolve({ data: [] });
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

async function openSystem() {
  root = createRoot(host);
  await act(async () => {
    root.render(<EmployeeCardModal employee={{ id: "emp_1", full_name: "Ali" }} companyId="c1" onClose={() => {}} />);
  });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  await act(async () => { host.querySelector('[data-testid="emp-tab-user"]').click(); });
}

function setInput(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

test("mismatched or short pins are not sent and a matching pin is posted then cleared", async () => {
  axios.post.mockResolvedValue({ data: { status: "success", has_shopfloor_pin: true, message: "Atölye şifresi kaydedildi." } });
  await openSystem();
  expect(host.querySelector('[data-testid="emp-shopfloor-pin-badge"]').textContent).toBe("Tanımsız");
  const pin = host.querySelector('[data-testid="emp-shopfloor-pin-new"]');
  const again = host.querySelector('[data-testid="emp-shopfloor-pin-confirm"]');
  expect(pin.type).toBe("password");
  await act(async () => {
    setInput(pin, "582");
    setInput(again, "582");
  });
  await act(async () => { host.querySelector('[data-testid="emp-shopfloor-pin-save"]').click(); });
  expect(axios.post).not.toHaveBeenCalled();
  await act(async () => {
    setInput(host.querySelector('[data-testid="emp-shopfloor-pin-new"]'), "5829");
    setInput(host.querySelector('[data-testid="emp-shopfloor-pin-confirm"]'), "1111");
  });
  await act(async () => { host.querySelector('[data-testid="emp-shopfloor-pin-save"]').click(); });
  expect(axios.post).not.toHaveBeenCalled();
  await act(async () => {
    setInput(host.querySelector('[data-testid="emp-shopfloor-pin-new"]'), "5829");
    setInput(host.querySelector('[data-testid="emp-shopfloor-pin-confirm"]'), "5829");
  });
  hasPin = true;
  await act(async () => { host.querySelector('[data-testid="emp-shopfloor-pin-save"]').click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(axios.post).toHaveBeenCalledWith("/api/personnel/employees/emp_1/shopfloor-pin", { pin: "5829" });
  expect(host.querySelector('[data-testid="emp-shopfloor-pin-new"]').value).toBe("");
  expect(host.querySelector('[data-testid="emp-shopfloor-pin-confirm"]').value).toBe("");
  expect(host.textContent).not.toContain("5829");
  expect(host.querySelector('[data-testid="emp-shopfloor-pin-badge"]').textContent).toBe("Tanımlı");
});

test("remove sends DELETE and a viewer only sees the badge", async () => {
  hasPin = true;
  axios.delete.mockResolvedValue({ data: { status: "success", has_shopfloor_pin: false } });
  await openSystem();
  expect(host.querySelector('[data-testid="emp-shopfloor-pin-badge"]').textContent).toBe("Tanımlı");
  hasPin = false;
  await act(async () => { host.querySelector('[data-testid="emp-shopfloor-pin-remove"]').click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(window.confirm).toHaveBeenCalled();
  expect(axios.delete).toHaveBeenCalledWith("/api/personnel/employees/emp_1/shopfloor-pin");
  expect(host.querySelector('[data-testid="emp-shopfloor-pin-badge"]').textContent).toBe("Tanımsız");

  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.innerHTML = "";
  mockAuth.user = { id: "u2", role: "sales" };
  hasPin = true;
  await openSystem();
  expect(host.querySelector('[data-testid="emp-shopfloor-pin-badge"]').textContent).toBe("Tanımlı");
  expect(host.querySelector('[data-testid="emp-shopfloor-pin-new"]')).toBeNull();
  expect(host.querySelector('[data-testid="emp-shopfloor-pin-save"]')).toBeNull();
});
