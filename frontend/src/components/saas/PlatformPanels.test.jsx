import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import axios from "axios";
import { PlatformSettingsPanel } from "./PlatformPanels";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "http://test/api" }));

const SETTINGS = {
  reminder_days: [7, 1],
  email_enabled: true,
  whatsapp_enabled: false,
  sender_company_id: "c1",
  sender_mail: "posta@firma.com",
  platform_mail_from: "noreply@tamkobi.com",
  sender_whatsapp_ready: false,
  companies: [{ id: "c1", name: "Demo" }],
  trial_days: 14,
  trial_plan_id: "plan_pro",
  public_url: "https://tamkobi.com",
  brand_name: "TamKobi",
  support_email: "",
  support_phone: "",
  support_whatsapp: "",
  legal_name: "",
  legal_address: "",
  legal_city: "",
  legal_tax_number: "",
  legal_tax_office: "",
  legal_mersis: "",
  legal_iban: "",
  legal_bank_name: "",
  legal_phone: "",
  legal_email: "",
  legal_website: "",
  require_superadmin_2fa: false,
  gib_credits_sales: false,
  gib_packs: [],
  notify_order_batch_minutes_default: 10,
};

test("ynt platform ayarında sipariş gruplama varsayılanı kaydedilir", async () => {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/system/paytr")) {
      return Promise.resolve({ data: { enabled: false, has_key: false, has_salt: false, merchant_id: "", max_installment: 0 } });
    }
    return Promise.resolve({ data: SETTINGS });
  });
  axios.put.mockResolvedValue({ data: { ...SETTINGS, notify_order_batch_minutes_default: 15 } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<PlatformSettingsPanel />);
  });
  await act(async () => {});
  const sel = host.querySelector('[data-testid="set-order-batch-default"]');
  expect(sel).toBeTruthy();
  expect(sel.value).toBe("10");
  expect(sel.textContent).toMatch(/Hemen/);
  expect(sel.textContent).toMatch(/60 dk/);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  await act(async () => {
    setter.call(sel, "15");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector('[data-testid="set-save"]').click();
  });
  expect(axios.put).toHaveBeenCalledWith(
    "http://test/api/system/settings",
    expect.objectContaining({ notify_order_batch_minutes_default: 15 }),
  );
  root.unmount();
  host.remove();
});
