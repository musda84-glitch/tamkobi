import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { WhatsAppSettings } from "./SettingsPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const COMPANY = "comp-wa-ui-57a6";
const SECRET_WARNING = "App Secret girilmedi: gelen WhatsApp mesajları güvenlik nedeniyle reddedilir.";

function settings(over = {}) {
  return {
    company_id: COMPANY,
    phone_number_id: "pn-ui-57a6",
    verify_token: "verify-ui-57a6",
    has_token: true,
    has_app_secret: false,
    status: "connected",
    webhook_url: "/api/comm/whatsapp/webhook",
    ...over,
  };
}

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockResolvedValue({ data: settings() });
  axios.put.mockResolvedValue({ data: settings({ has_app_secret: true }) });
});

afterEach(() => {
  host.remove();
  jest.clearAllMocks();
});

async function renderForm() {
  const root = createRoot(host);
  await act(async () => {
    root.render(<WhatsAppSettings companyId={COMPANY} />);
  });
  await act(async () => { await Promise.resolve(); });
  return root;
}

test("phone number id kayıtlı ve app secret boşken uyarı ve eksik ayar rozeti görünür", async () => {
  await renderForm();
  expect(host.querySelector('[data-testid="wa-app-secret-missing"]')?.textContent).toBe(SECRET_WARNING);
  expect(host.querySelector('[data-testid="wa-status"]')?.textContent).toBe("EKSİK AYAR");
  expect(host.textContent).not.toContain("BAĞLI");
  expect(host.querySelector('[data-testid="wa-has-app-secret"]')).toBeNull();
});

test("app secret kayıtlıyken uyarı görünmez ve rozet bağlı kalır", async () => {
  axios.get.mockResolvedValue({ data: settings({ has_app_secret: true }) });
  await renderForm();
  expect(host.querySelector('[data-testid="wa-app-secret-missing"]')).toBeNull();
  expect(host.textContent).not.toContain(SECRET_WARNING);
  expect(host.querySelector('[data-testid="wa-status"]')?.textContent).toBe("BAĞLI");
  expect(host.querySelector('[data-testid="wa-has-app-secret"]')?.textContent).toContain("(kayıtlı)");
});

test("kaydetme 409 ayrıntısı ekranda görünür", async () => {
  const detail = "Bu WhatsApp telefon numarası kimliği (phone_number_id) başka bir şirkette kullanılıyor.";
  axios.put.mockRejectedValue({ response: { status: 409, data: { detail } } });
  await renderForm();
  await act(async () => {
    host.querySelector('[data-testid="save-wa-btn"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="wa-save-error"]')?.textContent).toBe(detail);
  expect(toast.error).toHaveBeenCalledWith(detail);
  expect(host.textContent).not.toContain("Kaydedilemedi.");
});
