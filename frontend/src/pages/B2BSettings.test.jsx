/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { B2BSettings } from "./SettingsPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

const SETTINGS = {
  enabled: true,
  login_method: "both",
  allow_ai_cart: true,
  default_discount: 0,
  show_stock: true,
  show_prices: true,
  allow_orders: true,
  show_statement: true,
  show_installments: true,
  min_order_amount: 0,
  welcome_note: "",
  card_payment_enabled: false,
  card_max_installment: 1,
  card_commission_payer: "seller",
  card_commission_rate: 0,
  card_payment_required: false,
};

const PAYLOAD = {
  settings: SETTINGS,
  customers: [
    {
      id: "c1",
      name: "Acme Ltd",
      email: "a@acme.test",
      tax_number_or_id: "1234567890",
      b2b_enabled: true,
      b2b_discount: 5,
      has_password: false,
      b2b_token: "tok-secret",
    },
    {
      id: "c-hidden",
      name: "Gizli Cari",
      email: "gizli@example.com",
      b2b_enabled: true,
      b2b_token: null,
      b2b_token_hidden: true,
      b2b_discount: 0,
      has_password: false,
    },
  ],
  active_count: 2,
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.put.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
});

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host.remove();
});

const show = async (node) => {
  root = createRoot(host);
  await act(async () => { root.render(node); });
};

const flush = async () => {
  await act(async () => { await Promise.resolve(); });
};

function mockGets({ settings }) {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("collect-options")) return Promise.resolve({ data: { enabled: false } });
    return settings();
  });
}

test("istek beklerken yükleniyor görünür, müşteri listesi yok", async () => {
  let releaseSettings;
  mockGets({
    settings: () => new Promise((resolve) => { releaseSettings = resolve; }),
  });
  await show(<B2BSettings companyId="co-1" />);
  const loading = host.querySelector('[data-testid="b2b-settings-loading"]');
  expect(loading).not.toBeNull();
  expect(loading.textContent).toContain("B2B ayarları yükleniyor…");
  expect(loading.className).toContain("bg-white");
  expect(loading.className).toContain("border");
  expect(loading.className).toContain("rounded-2xl");
  expect(loading.className).toContain("p-5");
  expect(host.querySelector('[data-testid="b2b-settings"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-cust-c1"]')).toBeNull();
  expect(host.textContent).not.toContain("Müşteri Erişimleri");
  expect(host.textContent).not.toContain("Acme Ltd");
  releaseSettings({ data: PAYLOAD });
  await flush();
});

test("500 hatasında kutu ve tekrar dene; ikinci çağrı müşteri listesini ve kart ayarlarını açar", async () => {
  let settingsCalls = 0;
  mockGets({
    settings: () => {
      settingsCalls += 1;
      if (settingsCalls === 1) {
        return Promise.reject({ response: { status: 500, data: { detail: "Geçici sunucu hatası" } } });
      }
      return Promise.resolve({ data: PAYLOAD });
    },
  });
  await show(<B2BSettings companyId="co-1" />);
  await flush();
  const box = host.querySelector('[data-testid="b2b-settings-error"]');
  expect(box).not.toBeNull();
  expect(box.textContent).toContain("B2B ayarları yüklenemedi.");
  expect(box.textContent).toContain("Geçici sunucu hatası");
  expect(box.className).toContain("bg-white");
  expect(box.className).toContain("rounded-2xl");
  expect(box.className).toContain("p-5");
  const retry = host.querySelector('[data-testid="b2b-settings-retry"]');
  expect(retry.textContent).toContain("Tekrar dene");
  expect(host.querySelector('[data-testid="b2b-settings"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-cust-c1"]')).toBeNull();
  expect(toast.error).toHaveBeenCalledWith("B2B ayarları yüklenemedi.");

  await act(async () => { retry.click(); });
  await flush();
  expect(settingsCalls).toBe(2);
  expect(host.querySelector('[data-testid="b2b-settings-error"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-settings-loading"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-cust-c1"]').textContent).toContain("Acme Ltd");
  expect(host.querySelector('[data-testid="b2b-card-fields"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="b2b-card-vpos-hint"]').textContent).toContain("Önce Sanal POS ayarlayın");
  const hidden = host.querySelector('[data-testid="b2b-cust-c-hidden"]');
  expect(hidden.querySelector("a")).toBeNull();
  expect(hidden.textContent).toContain("Aktif");
  expect(hidden.textContent).not.toContain("linki aç");
  const linked = host.querySelector('[data-testid="b2b-cust-c1"]');
  expect(linked.querySelector("a").textContent).toContain("Aktif • linki aç");
  expect(linked.textContent).not.toContain("tok-secret");
});

test("başarılı ilk yükleme içeriği gösterir; kaydet sonrası yeniden yüklemede içerik kalır", async () => {
  let settingsCalls = 0;
  let releaseReload;
  mockGets({
    settings: () => {
      settingsCalls += 1;
      if (settingsCalls === 1) return Promise.resolve({ data: PAYLOAD });
      return new Promise((resolve) => { releaseReload = resolve; });
    },
  });
  axios.put.mockResolvedValue({ data: {} });
  await show(<B2BSettings companyId="co-1" />);
  await flush();
  expect(host.querySelector('[data-testid="b2b-settings-loading"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-settings"]')).not.toBeNull();
  expect(host.textContent).toContain("Şirket Varsayılanları (B2B)");
  expect(host.querySelector('[data-testid="b2b-cust-c1"]').textContent).toContain("Acme Ltd");
  expect(host.querySelector('[data-testid="b2b-card-fields"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="b2b-save"]')).not.toBeNull();
  const hidden = host.querySelector('[data-testid="b2b-cust-c-hidden"]');
  expect(hidden.textContent).toContain("Aktif");
  expect(hidden.querySelector("a")).toBeNull();

  await act(async () => { host.querySelector('[data-testid="b2b-save"]').click(); });
  await flush();
  expect(settingsCalls).toBe(2);
  expect(axios.put).toHaveBeenCalledTimes(1);
  expect(String(axios.put.mock.calls[0][0])).toContain("/companies/co-1/b2b-settings");
  expect(axios.put.mock.calls[0][1]).toEqual(expect.objectContaining({ apply_discount_to_all: false, enabled: true }));
  expect(host.querySelector('[data-testid="b2b-settings-loading"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-settings-error"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-cust-c1"]').textContent).toContain("Acme Ltd");
  expect(host.querySelector('[data-testid="b2b-card-fields"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="b2b-cust-c-hidden"]').textContent).toContain("Aktif");
  expect(toast.success).toHaveBeenCalledWith("B2B ayarları kaydedildi.");

  await act(async () => { releaseReload({ data: { ...PAYLOAD, active_count: 2 } }); });
  await flush();
  expect(host.querySelector('[data-testid="b2b-settings-loading"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-cust-c1"]').textContent).toContain("Acme Ltd");
  expect(host.querySelector('[data-testid="b2b-card-fields"]')).not.toBeNull();
});
