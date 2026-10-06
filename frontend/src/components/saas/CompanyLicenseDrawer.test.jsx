import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { CompanyLicenseDrawer } from "./CompanyLicenseDrawer";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...rest }) => React.createElement("a", { href: typeof to === "string" ? to : "/", ...rest }, children),
  };
}, { virtual: true });

const companyPayload = {
  id: "comp_matek",
  name: "MATEK DEKORASYON",
  tax_number: "123",
  tax_office: "Kadıköy",
  address: "İstanbul",
  city: "İstanbul",
  phone: "0216",
  email: "info@matek.test",
  currency: "TRY",
  created_at: "2024-01-01T00:00:00Z",
  allow_platform_access: true,
  parent_company_id: null,
  license_id: "comp_matek",
  is_primary: true,
  license_companies: [{ id: "comp_matek", name: "MATEK DEKORASYON", primary: true }],
  admin: {
    id: "usr_1",
    name: "Matek Admin",
    email: "admin@matek.test",
    role: "admin",
    role_label: "Yönetici",
    is_active: true,
    has_password: true,
    last_login_at: "2024-06-01T00:00:00Z",
  },
  membership: {
    plan_name: "Kurumsal",
    plan_color: "amber",
    status: "active",
    status_label: "Aktif",
    billing_period: "monthly",
    started_at: "2024-01-01T00:00:00Z",
    user_count: 1,
    user_limit: 0,
    company_count: 1,
    company_limit: 0,
    product_count: 1894,
    product_limit: 0,
    contact_count: 58,
    contact_limit: 0,
    storage_bytes: 1024,
    storage_limit_mb: 0,
    invoice_count: 19,
    order_count: 3,
    notes: "",
  },
  license: {
    plan_id: "plan_enterprise",
    plan_name: "Kurumsal",
    plan_color: "amber",
    status: "active",
    status_label: "Aktif",
    modules: {},
    module_overrides: {},
    enabled_count: 10,
    total_count: 20,
    locked: false,
    user_limit: 0,
    company_limit: 0,
    billing_period: "monthly",
    addons: {},
  },
  usage: { users: 1, invoices: 19, contacts: 58, products: 1894, orders: 3, storage_bytes: 1024 },
  users: [
    {
      id: "usr_1",
      name: "Matek Admin",
      email: "admin@matek.test",
      role: "admin",
      role_label: "Yönetici",
      is_active: true,
      has_password: true,
      last_login_at: "2024-06-01T00:00:00Z",
    },
  ],
  requests: [],
  einvoice: { provider: "", status: "simulated" },
  protected: false,
};

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/einvoice/providers")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: companyPayload });
  });
  axios.post.mockResolvedValue({ data: { message: "gönderildi", status: "success" } });
});

afterEach(() => {
  host.remove();
});

test("shows admin email, membership and sends password reset", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <CompanyLicenseDrawer
        companyId="comp_matek"
        plans={[{ id: "plan_enterprise", name: "Kurumsal", modules: [], user_limit: 0, company_limit: 0 }]}
        catalog={[]}
        companies={[]}
        onClose={() => {}}
        onChanged={() => {}}
      />
    );
  });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="drawer-admin-email"]')?.textContent).toContain("admin@matek.test");
  expect(host.querySelector('[data-testid="drawer-admin-mail"]')?.textContent).toContain("admin@matek.test");
  expect(host.querySelector('[data-testid="drawer-co-email"]')?.textContent).toContain("info@matek.test");
  expect(host.querySelector('[data-testid="drawer-membership"]')).not.toBeNull();
  const resetBtn = host.querySelector('[data-testid="drawer-admin-reset"]');
  expect(resetBtn).not.toBeNull();
  await act(async () => { resetBtn.click(); });
  await act(async () => { await Promise.resolve(); });
  const call = axios.post.mock.calls.find((c) => String(c[0]).includes("send-password-reset"));
  expect(call).toBeTruthy();
  expect(call[1]).toMatchObject({ email: "admin@matek.test", user_id: "usr_1" });
});

test("system company drawer hosts İşNet SOAP panel when provider is isnet", async () => {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/einvoice/providers")) return Promise.resolve({ data: [{ code: "isnet", name: "İşNet SOAP" }] });
    if (u.includes("/einvoice/settings")) return Promise.resolve({ data: { provider: "isnet", status: "configured", mode: "live", alias: "urn:mail:pk@x.com", company_tax_id: "6131659091" } });
    if (u.includes("/integrations/isnet/egress")) return Promise.resolve({ data: { egress_ips: ["1.1.1.1"], production_ips: ["1.1.1.1"], same_as_production: true } });
    return Promise.resolve({ data: { ...companyPayload, einvoice: { provider: "isnet", status: "configured" } } });
  });
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <CompanyLicenseDrawer
        companyId="comp_matek"
        plans={[{ id: "plan_enterprise", name: "Kurumsal", modules: [], user_limit: 0, company_limit: 0 }]}
        catalog={[]}
        companies={[]}
        onClose={() => {}}
        onChanged={() => {}}
      />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(host.querySelector('[data-testid="drawer-isnet-soap"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-integration-panel"]')?.getAttribute("data-variant")).toBe("system");
  expect(host.querySelector('[data-testid="isnet-mode-live"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-despatch-section"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-company-tax-id"]')).toBeNull();
  expect(host.querySelector('[data-testid="isnet-quick-links"]')).toBeNull();
});
