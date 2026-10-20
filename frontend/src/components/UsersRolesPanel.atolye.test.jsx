import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { UsersRolesPanel } from "./UsersRolesPanel";

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
jest.mock("../context/AuthContext", () => ({ API_URL: "/api", useAuth: () => ({ user: { id: "admin" } }) }));
jest.mock("../utils/modalBackdrop", () => ({ backdropDismissProps: () => ({}) }));

const USERS = [
  {
    id: "u9",
    name: "Ali Usta",
    email: "ali@x.com",
    role: "sales",
    phone: "",
    employee_id: "emp1",
    employee_name: "Ali Personel",
    account_type: "standard",
    is_active: true,
    company_ids: ["c1"],
  },
  {
    id: "u8",
    name: "Tablet",
    email: "tablet@x.com",
    role: "production",
    account_type: "atolye",
    shopfloor_stations: ["CNC"],
    is_active: true,
    company_ids: ["c1"],
  },
];

let host;
let root;

function installGets() {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/users")) return Promise.resolve({ data: { users: USERS, invites: [], assignable_companies: [] } });
    if (u.includes("/roles")) return Promise.resolve({ data: { roles: [{ id: "r1", code: "sales", name: "Satış", permissions: {}, features: {} }, { id: "r2", code: "production", name: "Üretim", permissions: {}, features: {} }], modules: [], policies: {} } });
    if (u.includes("/personnel/employees")) return Promise.resolve({ data: [{ id: "emp1", full_name: "Ali Personel" }] });
    if (u.includes("/production/work-orders/stations")) return Promise.resolve({ data: ["CNC", "Kesim"] });
    if (u.includes("/work-parks")) return Promise.resolve({ data: { parks: [{ id: "p1", name: "CNC" }] } });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.put.mockReset();
  axios.put.mockResolvedValue({ data: { status: "success" } });
  toast.error.mockClear();
  installGets();
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderPanel() {
  root = createRoot(host);
  await act(async () => { root.render(<UsersRolesPanel companyId="c1" />); });
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function openAli() {
  await renderPanel();
  await act(async () => { host.querySelector('[data-testid="user-edit-ali@x.com"]').click(); });
}

test("atolye switch with a station saves the shopfloor account and a linked employee shows a warning", async () => {
  await openAli();
  expect(host.querySelector('[data-testid="user-atolye-tablet@x.com"]').textContent).toBe("Atölye");
  expect(host.querySelector('[data-testid="user-atolye-ali@x.com"]')).toBeNull();
  await act(async () => { host.querySelector('[data-testid="user-edit-atolye"]').click(); });
  expect(host.querySelector('[data-testid="user-edit-employee"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="user-edit-employee"]').value).toBe("");
  expect(host.querySelector('[data-testid="user-edit-atolye-employee-warn"]').textContent).toContain("personel");
  expect(host.querySelector('[data-testid="user-edit-station-park-CNC"]').textContent).toBe("Parkur");
  axios.put.mockClear();
  await act(async () => { host.querySelector('[data-testid="user-edit-save"]').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(axios.put).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Atölye hesabı için en az bir istasyon seçin.");
  const station = host.querySelector('[data-testid="user-edit-station-CNC"] input');
  await act(async () => { station.click(); });
  await act(async () => { host.querySelector('[data-testid="user-edit-save"]').click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const userPut = axios.put.mock.calls.find((call) => String(call[0]) === "/api/users/u9");
  const accountPut = axios.put.mock.calls.find((call) => String(call[0]).includes("/shopfloor-account"));
  expect(userPut[1].employee_id).toBeNull();
  expect(accountPut[1]).toEqual({ company_id: "c1", account_type: "atolye", shopfloor_stations: ["CNC"] });
  const userIndex = axios.put.mock.calls.findIndex((call) => String(call[0]) === "/api/users/u9");
  const accountIndex = axios.put.mock.calls.findIndex((call) => String(call[0]).includes("/shopfloor-account"));
  expect(userIndex).toBeGreaterThanOrEqual(0);
  expect(accountIndex).toBeGreaterThan(userIndex);
});

test("turning the shopfloor switch off saves a standard account", async () => {
  await renderPanel();
  await act(async () => { host.querySelector('[data-testid="user-edit-tablet@x.com"]').click(); });
  expect(host.querySelector('[data-testid="user-edit-atolye"]').checked).toBe(true);
  await act(async () => { host.querySelector('[data-testid="user-edit-atolye"]').click(); });
  await act(async () => { host.querySelector('[data-testid="user-edit-save"]').click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const accountPut = axios.put.mock.calls.find((call) => String(call[0]).includes("/shopfloor-account"));
  expect(accountPut[1]).toEqual({ company_id: "c1", account_type: "standard", shopfloor_stations: [] });
});
