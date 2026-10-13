import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const mockNavigate = jest.fn();
let mockParams = { companyId: "comp_matek" };
let mockSearch = new URLSearchParams("tab=entegrator");
const mockSetSearchParams = jest.fn();

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...rest }) => React.createElement("a", { href: typeof to === "string" ? to : "/", ...rest }, children),
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
    useSearchParams: () => [mockSearch, mockSetSearchParams],
    useBlocker: () => ({ state: "unblocked", proceed: jest.fn(), reset: jest.fn() }),
  };
}, { virtual: true });

jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
  useAuth: () => ({
    user: { is_super_admin: true, name: "Admin" },
    authenticated: true,
    loading: false,
    refreshLicense: jest.fn(),
    logout: jest.fn(),
  }),
}));

jest.mock("../components/saas/SystemLayout", () => ({
  SystemLayout: ({ children }) => <div data-testid="system-layout">{children}</div>,
}));

jest.mock("../components/IsnetIntegrationPanel", () => () => <div data-testid="isnet-stub" />);
jest.mock("../components/SmsCenter", () => ({ SmsCenter: () => <div data-testid="sms-stub" /> }));

import CompanyDetailPage from "./CompanyDetailPage";

const companyPayload = {
  id: "comp_matek",
  name: "MATEK DEKORASYON",
  email: "info@matek.test",
  tax_number: "123",
  city: "İstanbul",
  license_id: "comp_matek",
  is_primary: true,
  license_companies: [{ id: "comp_matek", name: "MATEK DEKORASYON", primary: true }],
  admin: { id: "u1", name: "Admin", email: "admin@matek.test", role: "admin", is_active: true, has_password: true },
  membership: { plan_name: "Kurumsal", status: "active", billing_period: "monthly" },
  license: {
    plan_id: "plan_enterprise",
    plan_name: "Kurumsal",
    plan_color: "amber",
    status: "active",
    status_label: "Aktif",
    modules: {},
    module_overrides: {},
    enabled_count: 1,
    total_count: 2,
    locked: false,
    user_limit: 0,
    company_limit: 0,
    storage_limit_mb: 0,
    plan_defaults: {},
    quota_overrides: {},
    billing_period: "monthly",
    addons: {},
    addon_details: {},
  },
  usage: { users: 2, invoices: 5, contacts: 3, products: 10, orders: 1, storage_bytes: 0 },
  users: [],
  requests: [],
  einvoice: { provider: "isnet", status: "configured" },
  protected: false,
};

let host;
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  mockParams = { companyId: "comp_matek" };
  mockSearch = new URLSearchParams("tab=entegrator");
  mockNavigate.mockReset();
  mockSetSearchParams.mockReset();
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/system/companies/comp_matek")) return Promise.resolve({ data: companyPayload });
    if (String(url).includes("/system/companies")) return Promise.resolve({ data: [companyPayload] });
    if (String(url).includes("/system/plans")) return Promise.resolve({ data: [{ id: "plan_enterprise", name: "Kurumsal", modules: [] }] });
    if (String(url).includes("/system/modules")) return Promise.resolve({ data: [] });
    if (String(url).includes("/system/overview")) return Promise.resolve({ data: { pending_requests: 0, open_tickets: 0 } });
    if (String(url).includes("/einvoice/providers")) return Promise.resolve({ data: [{ code: "isnet", name: "İşNet" }] });
    return Promise.resolve({ data: {} });
  });
  axios.put.mockResolvedValue({ data: { provider: "isnet", provider_name: "İşNet", status: "configured" } });
});

afterEach(() => {
  host.remove();
  jest.clearAllMocks();
});

test("company detail route page opens with tab from URL", async () => {
  const root = createRoot(host);
  await act(async () => { root.render(<CompanyDetailPage />); });
  await flush();
  expect(host.querySelector('[data-testid="company-detail-page"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="company-detail-back"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="company-detail-breadcrumb"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="drawer-tabs"]')).not.toBeNull();
  const eiTab = host.querySelector('[data-testid="drawer-tab-einvoice"]');
  expect(eiTab?.getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector('[data-testid="drawer-einvoice"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="drawer-einvoice-info"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="drawer-einvoice-sticky-save"]')).not.toBeNull();
  root.unmount();
});

test("einvoice save calls same system API", async () => {
  const root = createRoot(host);
  await act(async () => { root.render(<CompanyDetailPage />); });
  await flush();
  const saveBtn = host.querySelector('[data-testid="drawer-einvoice-save"]');
  expect(saveBtn).not.toBeNull();
  await act(async () => { saveBtn.click(); });
  await flush();
  expect(axios.put).toHaveBeenCalled();
  const [url, body] = axios.put.mock.calls.find((c) => String(c[0]).includes("/einvoice")) || [];
  expect(String(url)).toContain("/system/companies/comp_matek/einvoice");
  expect(body).toEqual({ provider: "isnet" });
  root.unmount();
});

test("unsaved changes prompt on back", async () => {
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
  const root = createRoot(host);
  await act(async () => { root.render(<CompanyDetailPage />); });
  await flush();
  const select = host.querySelector('[data-testid="drawer-einvoice-provider"]');
  expect(select).not.toBeNull();
  await act(async () => {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  const back = host.querySelector('[data-testid="company-detail-back"]');
  await act(async () => { back.click(); });
  expect(confirmSpy).toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
  root.unmount();
});
