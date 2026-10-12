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
    storage_limit_mb: 2048,
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
    storage_limit_mb: 2048,
    plan_defaults: { storage_limit_mb: 0, user_limit: 0, company_limit: 0 },
    quota_overrides: { storage_limit_mb: 2048 },
    billing_period: "monthly",
    addons: { "ai.advisor": true, "ai.invoice": false },
    addon_details: {
      "ai.advisor": { enabled: true, source: "platform", group: "ai", label: "AI finans danışmanı" },
      "ai.invoice": { enabled: false, source: "company", group: "ai", label: "AI fatura aktarımı" },
      "support.tickets": { enabled: true, source: "platform", group: "support", label: "Destek talepleri" },
    },
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

const storagePayload = {
  company_id: "comp_matek",
  company_name: "MATEK DEKORASYON",
  total_bytes: 1024,
  total_files: 2,
  storage_limit_mb: 2048,
  folders: [
    { id: "f1", area_key: "products", label: "Ürünler", path: "tamkobi/accounts/comp_matek/products", file_count: 2, bytes: 1024, is_system: true },
  ],
};

const defaultPlans = [{ id: "plan_enterprise", name: "Kurumsal", modules: [], user_limit: 0, company_limit: 0, storage_limit_mb: 0 }];

let host;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const renderDrawer = async (props = {}) => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <CompanyLicenseDrawer
        companyId="comp_matek"
        plans={defaultPlans}
        catalog={[]}
        companies={[]}
        onClose={() => {}}
        onChanged={() => {}}
        {...props}
      />
    );
  });
  await flush();
  return root;
};

const clickTab = async (id) => {
  const btn = host.querySelector(`[data-testid="drawer-tab-${id}"]`);
  expect(btn).not.toBeNull();
  await act(async () => { btn.click(); });
  await flush();
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/einvoice/providers")) return Promise.resolve({ data: [] });
    if (u.includes("/system/storage/")) return Promise.resolve({ data: storagePayload });
    if (u.includes("/system/ai")) return Promise.resolve({ data: { enabled: true, ready: true, provider: "openai", advisor_model: "gpt-4o-mini", extract_model: "gpt-4o-mini" } });
    if (u.includes("/comm/sms/")) return Promise.resolve({ data: u.includes("/logs") ? [] : { provider: "netgsm", usercode: "", has_password: false, providers: [] } });
    return Promise.resolve({ data: companyPayload });
  });
  axios.post.mockResolvedValue({ data: { message: "gönderildi", status: "success", folder_count: 1 } });
  axios.put.mockResolvedValue({
    data: {
      ...companyPayload.license,
      storage_limit_mb: 4096,
      quota_overrides: { storage_limit_mb: 4096 },
    },
  });
});

afterEach(() => {
  host.remove();
});

test("shows admin email, membership and sends password reset", async () => {
  await renderDrawer();
  expect(host.querySelector('[data-testid="drawer-admin-email"]')?.textContent).toContain("admin@matek.test");
  expect(host.querySelector('[data-testid="drawer-admin-mail"]')?.textContent).toContain("admin@matek.test");
  expect(host.querySelector('[data-testid="drawer-co-email"]')?.textContent).toContain("info@matek.test");
  expect(host.querySelector('[data-testid="drawer-membership"]')).not.toBeNull();
  const resetBtn = host.querySelector('[data-testid="drawer-admin-reset"]');
  expect(resetBtn).not.toBeNull();
  await act(async () => { resetBtn.click(); });
  await flush();
  const call = axios.post.mock.calls.find((c) => String(c[0]).includes("send-password-reset"));
  expect(call).toBeTruthy();
  expect(call[1]).toMatchObject({ email: "admin@matek.test", user_id: "usr_1" });
});

test("renders management tabs including Depolama and Yapay zekâ", async () => {
  await renderDrawer();
  expect(host.querySelector('[data-testid="drawer-tabs"]')).not.toBeNull();
  for (const id of ["license", "einvoice", "sms", "storage", "ai"]) {
    expect(host.querySelector(`[data-testid="drawer-tab-${id}"]`)).not.toBeNull();
  }
  expect(host.querySelector('[data-testid="drawer-membership"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="drawer-storage"]')).toBeNull();
});

test("providers error disables einvoice save and toasts", async () => {
  const { toast } = require("sonner");
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/einvoice/providers")) {
      return Promise.reject({ response: { data: { detail: "Bu uç platform yönetimi oturumunda kullanılamaz" }, status: 403 } });
    }
    return Promise.resolve({ data: { ...companyPayload, einvoice: { provider: "isnet", status: "configured" } } });
  });
  await renderDrawer();
  await clickTab("einvoice");
  const saveBtn = host.querySelector('[data-testid="drawer-einvoice-save"]');
  expect(saveBtn).not.toBeNull();
  expect(saveBtn.disabled).toBe(true);
  expect(toast.error).toHaveBeenCalled();
  expect(host.querySelector('[data-testid="drawer-einvoice-providers-error"]')).not.toBeNull();
});

test("orphan provider keeps current value in dropdown", async () => {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/einvoice/providers")) return Promise.resolve({ data: [{ code: "foriba", name: "Foriba" }] });
    return Promise.resolve({ data: { ...companyPayload, einvoice: { provider: "isnet", status: "configured" } } });
  });
  await renderDrawer();
  await clickTab("einvoice");
  const orphan = host.querySelector('[data-testid="drawer-einvoice-provider-orphan"]');
  expect(orphan).not.toBeNull();
  expect(orphan.textContent).toContain("mevcut: isnet");
  expect(host.querySelector('[data-testid="drawer-einvoice-provider"]')?.value).toBe("isnet");
});

test("system company drawer hosts İşNet SOAP panel when provider is isnet", async () => {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/einvoice/providers")) return Promise.resolve({ data: [{ code: "isnet", name: "İşNet SOAP" }] });
    if (u.includes("/einvoice/settings")) return Promise.resolve({ data: { provider: "isnet", status: "configured", mode: "live", alias: "urn:mail:pk@x.com", company_tax_id: "6131659091" } });
    if (u.includes("/integrations/isnet/egress")) return Promise.resolve({ data: { egress_ips: ["1.1.1.1"], production_ips: ["1.1.1.1"], same_as_production: true } });
    return Promise.resolve({ data: { ...companyPayload, einvoice: { provider: "isnet", status: "configured" } } });
  });
  await renderDrawer();
  await clickTab("einvoice");
  expect(host.querySelector('[data-testid="drawer-isnet-soap"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-integration-panel"]')?.getAttribute("data-variant")).toBe("system");
  expect(host.querySelector('[data-testid="isnet-mode-live"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-despatch-section"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-company-tax-id"]')).toBeNull();
  expect(host.querySelector('[data-testid="isnet-quick-links"]')).toBeNull();
});

test("Depolama tab loads usage and saves storage limit via license API", async () => {
  await renderDrawer();
  await clickTab("storage");
  expect(host.querySelector('[data-testid="drawer-storage"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="drawer-storage-usage"]')?.textContent).toMatch(/MB|KB|B/);
  expect(axios.get.mock.calls.some((c) => String(c[0]).includes("/system/storage/comp_matek"))).toBe(true);
  const input = host.querySelector('[data-testid="drawer-storage-limit"]');
  expect(input).not.toBeNull();
  expect(input.value).toBe("2048");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "4096");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
  expect(host.querySelector('[data-testid="drawer-storage-limit"]').value).toBe("4096");
  const saveBtn = host.querySelector('[data-testid="drawer-storage-save"]');
  await act(async () => { saveBtn.click(); });
  await flush();
  const put = axios.put.mock.calls.find((c) => String(c[0]).includes("/system/companies/comp_matek/license"));
  expect(put).toBeTruthy();
  expect(put[1]).toMatchObject({ storage_limit_mb: 4096 });
});

test("Yapay zekâ tab shows status and toggles addon API", async () => {
  axios.post.mockImplementation((url, body) => {
    if (String(url).includes("/addons/")) {
      return Promise.resolve({
        data: {
          ...companyPayload.license,
          addon_details: {
            ...companyPayload.license.addon_details,
            "ai.invoice": { enabled: !!body.enabled, source: "company", group: "ai", label: "AI fatura aktarımı" },
          },
        },
      });
    }
    return Promise.resolve({ data: { message: "ok" } });
  });
  await renderDrawer();
  await clickTab("ai");
  expect(host.querySelector('[data-testid="drawer-ai"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="drawer-ai-status"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="drawer-ai-advisor-model"]')?.textContent).toContain("gpt-4o-mini");
  expect(host.querySelector('[data-testid="drawer-addons-ai"]')).not.toBeNull();
  const toggle = host.querySelector('[data-testid="addon-toggle-ai-invoice"]');
  expect(toggle).not.toBeNull();
  await act(async () => { toggle.click(); });
  await flush();
  const call = axios.post.mock.calls.find((c) => String(c[0]).includes("/addons/ai.invoice"));
  expect(call).toBeTruthy();
  expect(call[1]).toMatchObject({ enabled: true });
});
