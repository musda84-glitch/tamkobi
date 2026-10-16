/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { B2BCardSettingsFields } from "./B2BCardSettingsFields";
import { B2BSettings } from "../pages/SettingsPage";

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

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.put.mockReset();
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

test("sanal POS yoksa kart alanları kilitli ve zorunlu ödeme yakında", async () => {
  await show(
    <B2BCardSettingsFields
      settings={SETTINGS}
      onChange={() => {}}
      vposReady={false}
      showRequired
    />,
  );
  expect(host.querySelector('[data-testid="b2b-card-vpos-hint"]').textContent).toContain("Önce Sanal POS ayarlayın");
  expect(host.querySelector('[data-testid="b2b-card-enabled"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="b2b-card-installment"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="b2b-card-payer"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="b2b-card-rate"]').disabled).toBe(true);
  const required = host.querySelector('[data-testid="b2b-card-required"]');
  expect(required.disabled).toBe(true);
  expect(host.textContent).toContain("yakında");
});

test("etkin sanal POS varken alanlar açılır, zorunlu ödeme kapalı kalır", async () => {
  await show(
    <B2BCardSettingsFields
      settings={{ ...SETTINGS, card_payment_enabled: true, card_commission_payer: "buyer", card_commission_rate: 2.5 }}
      onChange={() => {}}
      vposReady
      showRequired
    />,
  );
  expect(host.querySelector('[data-testid="b2b-card-vpos-hint"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-card-enabled"]').disabled).toBe(false);
  expect(host.querySelector('[data-testid="b2b-card-payer"]').value).toBe("buyer");
  expect(host.querySelector('[data-testid="b2b-card-required"]').disabled).toBe(true);
});

test("B2B ayar ekranı kart alanlarını sanal POS durumuna göre kilitler", async () => {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("collect-options")) return Promise.resolve({ data: { enabled: false } });
    return Promise.resolve({ data: { settings: SETTINGS, customers: [], active_count: 0 } });
  });
  await show(<B2BSettings companyId="co-1" />);
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="b2b-card-vpos-hint"]').textContent).toContain("Önce Sanal POS ayarlayın");
  expect(host.querySelector('[data-testid="b2b-card-enabled"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="b2b-card-required"]').disabled).toBe(true);
});
