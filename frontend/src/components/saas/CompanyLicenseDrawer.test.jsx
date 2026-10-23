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
  total_bytes: 17436343,
  used_bytes: 17436343,
  total_files: 2,
  storage_limit_mb: 5120,
  folders: [
    { id: "f1", area_key: "products", label: "Ürünler", path: "tamkobi/accounts/comp_matek/products", file_count: 2, bytes: 17436343, is_system: true },
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
    if (u.includes("/system/companies/") && u.endsWith("/sms")) {
      return Promise.resolve({ data: { connected: true, operator: "Netgsm", last_sent_at: "2026-10-12T09:00:00Z", error_count: 2, readonly: true } });
    }
    if (u.includes("/comm/sms/")) return Promise.resolve({ data: u.includes("/logs") ? [] : { provider: "netgsm", usercode: "", has_password: false, providers: [] } });
    if (u.includes("/notify-prefs")) {
      return Promise.resolve({
        data: {
          company_id: "comp_matek",
          events: {
            einvoice_incoming: { inapp: true, email: true, sms: false, digest: "instant" },
            order_new: { inapp: true, email: true, sms: false, digest: "batch", batch_minutes: 10 },
            gib_credits_low: { inapp: true, email: true, sms: false, digest: "instant" },
            receivable_overdue: { inapp: true, email: true, sms: false, digest: "instant" },
          },
          extra_emails: [],
          email_from: "platform",
          gib_credits_threshold: 20,
          daily_email_cap: 8,
          email_usage: { sent_24h: 2, sent_30d: 9, deferred_24h: 0, deferred_30d: 1, deferred: 1 },
          event_labels: {
            einvoice_incoming: "Gelen e-Fatura",
            order_new: "Yeni sipariş",
            gib_credits_low: "GİB kontör düşük",
            receivable_overdue: "Vadesi geçmiş alacak",
          },
        },
      });
    }
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
  const mode = host.querySelector('[data-testid="drawer-storage-mode"]');
  expect(mode?.textContent).toContain("Legacy");
  expect(mode?.parentElement?.querySelector("input, select, textarea, button")).toBeNull();
  const resetBtn = host.querySelector('[data-testid="drawer-admin-reset"]');
  expect(resetBtn).not.toBeNull();
  await act(async () => { resetBtn.click(); });
  await flush();
  const call = axios.post.mock.calls.find((c) => String(c[0]).includes("send-password-reset"));
  expect(call).toBeTruthy();
  expect(call[1]).toMatchObject({ email: "admin@matek.test", user_id: "usr_1" });
});

test("shows a non-legacy storage mode as read-only text", async () => {
  companyPayload.storage_mode = "shared_v2";
  companyPayload.dedicated_dsn_ref = "gAAAA-should-not-render";
  try {
    await renderDrawer();
    const mode = host.querySelector('[data-testid="drawer-storage-mode"]');
    expect(mode?.textContent).toContain("Shared v2");
    expect(host.textContent).not.toContain("gAAAA-should-not-render");
    expect(mode?.parentElement?.querySelector("input, select, textarea")).toBeNull();
  } finally {
    delete companyPayload.storage_mode;
    delete companyPayload.dedicated_dsn_ref;
  }
});

test("renders management tabs including Depolama and Yapay zekâ", async () => {
  await renderDrawer();
  expect(host.querySelector('[data-testid="drawer-tabs"]')).not.toBeNull();
  for (const id of ["license", "einvoice", "sms", "notify", "storage", "ai"]) {
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

test("SMS tab is a read-only summary without operator secrets", async () => {
  await renderDrawer();
  await clickTab("sms");
  expect(host.querySelector('[data-testid="drawer-sms"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="company-sms-summary"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="company-sms-connected"]')?.textContent).toContain("Bağlı");
  expect(host.querySelector('[data-testid="company-sms-operator"]')?.textContent).toContain("Netgsm");
  expect(host.querySelector('[data-testid="company-sms-errors"]')?.textContent).toContain("2");
  expect(host.querySelector('[data-testid="sms-password-input"]')).toBeNull();
  expect(host.querySelector('[data-testid="save-sms-btn"]')).toBeNull();
  expect(host.querySelector('[data-testid="sms-usercode-input"]')).toBeNull();
  const smsGet = axios.get.mock.calls.find((c) => String(c[0]).includes("/system/companies/comp_matek/sms"));
  expect(smsGet).toBeTruthy();
  expect(axios.put.mock.calls.some((c) => String(c[0]).includes("/comm/sms/"))).toBe(false);
});

const setControl = async (el, value) => {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await flush();
};

test("Depolama tab loads usage and saves storage limit via license API", async () => {
  await renderDrawer();
  await clickTab("storage");
  expect(host.querySelector('[data-testid="drawer-storage"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="storage-stat-used"]')?.textContent).toContain("16,6 MB");
  expect(host.querySelector('[data-testid="storage-stat-limit"]')?.textContent).toContain("5 GB");
  expect(host.querySelector('[data-testid="storage-stat-free"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="storage-usage-rate"]')?.textContent).toContain("Kullanım Oranı");
  expect(host.querySelector('[data-testid="drawer-storage-usage"]')?.textContent).toContain("16,6 MB / 5 GB");
  expect(host.textContent).toContain("Depolama limiti");
  expect(host.textContent).toContain("Sınırsız");
  expect(host.querySelector('[data-testid="drawer-storage-save"]')?.textContent).toContain("Kaydet");
  expect(host.querySelector('[data-testid="drawer-storage-folders"]')?.textContent).toContain("Klasör");
  expect(host.querySelector('[data-testid="drawer-storage-folders"]')?.textContent).toContain("Dosya sayısı");
  expect(host.querySelector('[data-testid="drawer-storage-folders"]')?.textContent).toContain("Boyut");
  expect(host.querySelector('[data-testid="drawer-storage-folders"]')?.textContent).toContain("Oran");
  expect(host.querySelector('[data-testid="drawer-storage-folder-products"]')?.textContent).toContain("Ürünler");
  expect(host.querySelector('[data-testid="storage-requests-empty"]')?.textContent).toContain("Henüz depolama artış talebi yok.");
  expect(axios.get.mock.calls.some((c) => String(c[0]).includes("/system/storage/comp_matek"))).toBe(true);
  const input = host.querySelector('[data-testid="drawer-storage-limit"]');
  expect(input).not.toBeNull();
  expect(input.value).toBe("2048");
  const unit = host.querySelector('[data-testid="drawer-storage-unit"]');
  await setControl(unit, "gb");
  expect(host.querySelector('[data-testid="drawer-storage-limit"]').value).toBe("2");
  await setControl(unit, "mb");
  expect(host.querySelector('[data-testid="drawer-storage-limit"]').value).toBe("2048");
  await setControl(host.querySelector('[data-testid="drawer-storage-limit"]'), "4096");
  expect(host.querySelector('[data-testid="drawer-storage-limit"]').value).toBe("4096");
  const saveBtn = host.querySelector('[data-testid="drawer-storage-save"]');
  await act(async () => { saveBtn.click(); });
  await flush();
  const put = axios.put.mock.calls.find((c) => String(c[0]).includes("/system/companies/comp_matek/license"));
  expect(put).toBeTruthy();
  expect(put[1]).toMatchObject({ storage_limit_mb: 4096 });
});

test("Artırma talepleri shows status badges and approve or reject on one line", async () => {
  const pending = {
    id: "sir_1",
    status: "pending",
    status_label: "Bekliyor",
    requested_by_name: "Ayşe",
    requested_by: "ayse@firma.test",
    current_limit_mb: 5120,
    requested_limit_mb: 10240,
    message: "Arşiv büyüdü",
    admin_note: "",
    created_at: "2026-10-22T09:30:00Z",
  };
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/system/storage/") && u.includes("/requests")) return Promise.resolve({ data: { items: [pending], total: 1 } });
    if (u.includes("/system/storage/")) return Promise.resolve({ data: storagePayload });
    if (u.includes("/einvoice/providers")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: companyPayload });
  });
  await renderDrawer();
  await clickTab("storage");
  const row = host.querySelector('[data-testid="storage-request-sir_1"]');
  expect(row).not.toBeNull();
  expect(row.textContent).toContain("Bekliyor");
  expect(row.textContent).toContain("Ayşe");
  expect(row.textContent).toContain("5 GB");
  expect(row.textContent).toContain("10 GB");
  const actions = host.querySelector('[data-testid="storage-request-approve-sir_1"]').parentElement;
  expect(actions.className).toContain("flex-nowrap");
  expect(host.querySelector('[data-testid="storage-request-reject-sir_1"]')).not.toBeNull();
  await act(async () => { host.querySelector('[data-testid="storage-request-approve-sir_1"]').click(); });
  await flush();
  const approved = axios.put.mock.calls.find((c) => String(c[0]).includes("/requests/sir_1"));
  expect(approved[1]).toMatchObject({ status: "approved", note: "" });
  window.prompt = jest.fn().mockReturnValueOnce(null);
  await act(async () => { host.querySelector('[data-testid="storage-request-reject-sir_1"]').click(); });
  await flush();
  expect(axios.put.mock.calls.filter((c) => String(c[0]).includes("/requests/sir_1"))).toHaveLength(1);
  window.prompt = jest.fn().mockReturnValueOnce("kota yetersiz");
  await act(async () => { host.querySelector('[data-testid="storage-request-reject-sir_1"]').click(); });
  await flush();
  const rejected = axios.put.mock.calls.filter((c) => String(c[0]).includes("/requests/sir_1")).at(-1);
  expect(rejected[1]).toMatchObject({ status: "rejected", note: "kota yetersiz" });
});

test("Bildirimler sekmesi paneli açar, limit/sayaç gösterir ve doğru URL'ye PUT eder", async () => {
  axios.put.mockResolvedValue({
    data: {
      company_id: "comp_matek",
      events: {
        einvoice_incoming: { inapp: true, email: true, sms: false, digest: "instant" },
        order_new: { inapp: true, email: true, sms: false, digest: "batch", batch_minutes: 10 },
        gib_credits_low: { inapp: true, email: true, sms: false, digest: "instant" },
        receivable_overdue: { inapp: true, email: true, sms: false, digest: "instant" },
      },
      extra_emails: [],
      email_from: "platform",
      gib_credits_threshold: 20,
      daily_email_cap: 8,
      email_usage: { sent_24h: 2, sent_30d: 9, deferred_24h: 0, deferred_30d: 1, deferred: 1 },
    },
  });
  await renderDrawer();
  await clickTab("notify");
  expect(host.querySelector('[data-testid="drawer-notify"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="notify-prefs-panel"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="notify-daily-email-cap"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="notify-email-usage"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="notify-sent-24h"]')?.textContent).toMatch(/2/);
  const getCall = axios.get.mock.calls.find((c) => String(c[0]).includes("/saas/companies/comp_matek/notify-prefs"));
  expect(getCall).toBeTruthy();
  const saveBtn = host.querySelector('[data-testid="notify-prefs-save"]');
  expect(saveBtn).not.toBeNull();
  await act(async () => { saveBtn.click(); });
  await flush();
  const put = axios.put.mock.calls.find((c) => String(c[0]).includes("/saas/companies/comp_matek/notify-prefs"));
  expect(put).toBeTruthy();
  expect(put[1]).toMatchObject({ daily_email_cap: 8 });
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
