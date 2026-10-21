import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";
import AccountPage from "./AccountPage";

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
jest.mock("./SettingsPage", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/saas/MyPlanPanel", () => ({ MyPlanPanel: () => null }));

const mockAuth = {
  user: { id: "u1", name: "Yönetici", email: "a@x.com", role: "admin", account_type: "standard", has_shopfloor_pin: false },
  activeCompany: { id: "c1" },
  companies: [{ id: "c1", name: "Demo" }],
  switchCompany: jest.fn(),
  reloadSession: jest.fn(() => Promise.resolve()),
  refreshLicense: jest.fn(),
};

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => mockAuth,
}));

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  mockAuth.user = { id: "u1", name: "Yönetici", email: "a@x.com", role: "admin", account_type: "standard", has_shopfloor_pin: true };
  mockAuth.reloadSession = jest.fn(() => Promise.resolve());
  window.confirm = jest.fn(() => true);
  axios.put.mockReset();
  axios.delete.mockReset();
  axios.get.mockResolvedValue({ data: {} });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderAccount() {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/hesap?tab=profil"]}>
        <AccountPage />
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function setInput(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

test("an admin can save and remove their own shopfloor pin", async () => {
  axios.put.mockResolvedValue({ data: { status: "success", has_shopfloor_pin: true } });
  axios.delete.mockResolvedValue({ data: { status: "success", has_shopfloor_pin: false } });
  await renderAccount();
  expect(host.querySelector('[data-testid="account-shopfloor-pin"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="account-shopfloor-pin-badge"]').textContent).toBe("Tanımlı");
  await act(async () => {
    setInput(host.querySelector('[data-testid="account-shopfloor-pin-new"]'), "5829");
    setInput(host.querySelector('[data-testid="account-shopfloor-pin-confirm"]'), "5829");
  });
  await act(async () => { host.querySelector('[data-testid="account-shopfloor-pin-save"]').click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(axios.put).toHaveBeenCalledWith("/api/auth/me/shopfloor-pin", { pin: "5829", pin_confirm: "5829" }, { withCredentials: true });
  expect(mockAuth.reloadSession).toHaveBeenCalled();
  expect(host.querySelector('[data-testid="account-shopfloor-pin-new"]').value).toBe("");
  expect(host.textContent).not.toContain("5829");
  await act(async () => { host.querySelector('[data-testid="account-shopfloor-pin-remove"]').click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(axios.delete).toHaveBeenCalledWith("/api/auth/me/shopfloor-pin", { withCredentials: true });
});

test("an atolye account and a non-manager do not see the pin card", async () => {
  mockAuth.user = { id: "u2", name: "Tablet", email: "t@x.com", role: "production", account_type: "atolye", has_shopfloor_pin: true };
  await renderAccount();
  expect(host.querySelector('[data-testid="account-shopfloor-pin"]')).toBeNull();
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.innerHTML = "";
  mockAuth.user = { id: "u3", name: "Satış", email: "s@x.com", role: "sales", account_type: "standard" };
  await renderAccount();
  expect(host.querySelector('[data-testid="account-shopfloor-pin"]')).toBeNull();
});
