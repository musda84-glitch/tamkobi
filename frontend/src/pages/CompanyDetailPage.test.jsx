import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { CompaniesTable } from "../components/saas/CompaniesTable";
import { companyDetailPath } from "../utils/companyDetailTabs";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

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
  created_at: "2024-01-01T00:00:00Z",
  allow_platform_access: true,
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

function LocationEcho() {
  const loc = useLocation();
  return <div data-testid="location-echo">{loc.pathname}{loc.search}</div>;
}

function renderAt(entry) {
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <LocationEcho />
        <Routes>
          <Route path="/sistem/sirketler/:companyId" element={<CompanyDetailPage />} />
          <Route path="/sistem/sirketler" element={<div data-testid="companies-list" />} />
          <Route path="/sistem" element={<div data-testid="platform-home" />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return root;
}

function CompaniesRoute() {
  const navigate = useNavigate();
  return (
    <CompaniesTable
      rows={[companyPayload]}
      plans={[{ id: "plan_enterprise", name: "Kurumsal", price_monthly: 1, is_popular: true }]}
      onOpen={(id) => navigate(companyDetailPath(id))}
      onCreated={() => {}}
    />
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
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

async function makeDirty() {
  const select = host.querySelector('[data-testid="drawer-einvoice-provider"]');
  expect(select).not.toBeNull();
  await act(async () => {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

test("company detail route page opens with tab from URL", async () => {
  const root = renderAt("/sistem/sirketler/comp_matek?tab=entegrator");
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
  expect(host.querySelector('[data-testid="location-echo"]')?.textContent).toBe("/sistem/sirketler/comp_matek?tab=entegrator");
  root.unmount();
});

test("Yönet in CompaniesTable opens the company detail page", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/sistem/sirketler"]}>
        <LocationEcho />
        <Routes>
          <Route path="/sistem/sirketler" element={<CompaniesRoute />} />
          <Route path="/sistem/sirketler/:companyId" element={<CompanyDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  const manage = host.querySelector('[data-testid="company-manage-comp_matek"]');
  expect(manage).not.toBeNull();
  expect(manage.textContent).toMatch(/Yönet/);
  await act(async () => { manage.click(); });
  await flush();
  expect(host.querySelector('[data-testid="company-detail-page"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="location-echo"]')?.textContent).toBe("/sistem/sirketler/comp_matek");
  expect(host.querySelector('[data-testid="company-detail-crumb-id"]')?.textContent).toBe("comp_matek");
  root.unmount();
});

test("einvoice save calls same system API", async () => {
  const root = renderAt("/sistem/sirketler/comp_matek?tab=entegrator");
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
  const root = renderAt("/sistem/sirketler/comp_matek?tab=entegrator");
  await flush();
  await makeDirty();
  const back = host.querySelector('[data-testid="company-detail-back"]');
  await act(async () => { back.click(); });
  expect(confirmSpy).toHaveBeenCalled();
  expect(host.querySelector('[data-testid="location-echo"]')?.textContent).toContain("/sistem/sirketler/comp_matek");
  expect(host.querySelector('[data-testid="companies-list"]')).toBeNull();
  confirmSpy.mockRestore();
  root.unmount();
});

test("unsaved changes prompt on in-page link and tab", async () => {
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
  const root = renderAt("/sistem/sirketler/comp_matek?tab=entegrator");
  await flush();
  await makeDirty();
  const crumb = host.querySelector('[data-testid="company-detail-breadcrumb"]');
  const companiesLink = [...crumb.querySelectorAll("a")].find((a) => a.textContent.includes("Şirketler"));
  expect(companiesLink).toBeTruthy();
  await act(async () => { companiesLink.click(); });
  expect(confirmSpy).toHaveBeenCalled();
  expect(host.querySelector('[data-testid="location-echo"]')?.textContent).toContain("comp_matek");
  expect(host.querySelector('[data-testid="companies-list"]')).toBeNull();

  confirmSpy.mockClear();
  const licenseTab = host.querySelector('[data-testid="drawer-tab-license"]');
  await act(async () => { licenseTab.click(); });
  expect(confirmSpy).toHaveBeenCalled();
  expect(host.querySelector('[data-testid="drawer-tab-einvoice"]')?.getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector('[data-testid="location-echo"]')?.textContent).toContain("tab=entegrator");

  confirmSpy.mockReturnValue(true);
  await act(async () => { licenseTab.click(); });
  await flush();
  expect(host.querySelector('[data-testid="drawer-tab-license"]')?.getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector('[data-testid="location-echo"]')?.textContent).toBe("/sistem/sirketler/comp_matek");
  confirmSpy.mockRestore();
  root.unmount();
});
