import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { EInvoiceSettings } from "./SettingsPage";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const SETTINGS = {
  provider: "qnb_efinans",
  provider_name: "QNB eFinans (eSolutions)",
  assigned: true,
  fields: ["username", "password", "erp_code", "company_tax_id", "alias"],
  docs: "https://www.qnbesolutions.com.tr/api-docs-tr-final.html",
  hint: "erpKodu kaynak kodu",
  status: "configured",
  mode: "live",
  username: "qnb-user",
  company_tax_id: "1234567890",
  erp_code: "ERP1",
  alias: "urn:mail:defaultpk@firma.com.tr",
  efatura_url: "https://efatura.example/connector",
  earsiv_url: "https://earsiv.example/connector",
  has_password: true,
};

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockResolvedValue({ data: SETTINGS });
  axios.put.mockResolvedValue({ data: SETTINGS });
  axios.post.mockResolvedValue({ data: { ok: true, message: "QNB eFinans bağlantısı doğrulandı." } });
});

afterEach(() => {
  host.remove();
  jest.clearAllMocks();
});

async function renderForm() {
  const root = createRoot(host);
  await act(async () => {
    root.render(<EInvoiceSettings companyId="comp_qnb" />);
  });
  await act(async () => { await Promise.resolve(); });
  return root;
}

test("qnb ayar formunda alanlar var ve şifre maskeli", async () => {
  await renderForm();
  expect(host.querySelector('[data-testid="einvoice-username-input"]')?.value).toBe("qnb-user");
  expect(host.querySelector('[data-testid="einvoice-company-tax-id"]')?.value).toBe("1234567890");
  expect(host.querySelector('[data-testid="einvoice-erp-code"]')?.value).toBe("ERP1");
  expect(host.querySelector('[data-testid="einvoice-alias"]')?.value).toBe("urn:mail:defaultpk@firma.com.tr");
  expect(host.textContent).toContain("PK etiketi");
  expect(host.querySelector('[data-testid="einvoice-efatura-url"]')?.value).toBe("https://efatura.example/connector");
  expect(host.querySelector('[data-testid="einvoice-earsiv-url"]')?.value).toBe("https://earsiv.example/connector");
  const password = host.querySelector('[data-testid="einvoice-password-input"]');
  expect(password).not.toBeNull();
  expect(password.type).toBe("password");
  expect(password.value).toBe("");
  expect(host.textContent).toContain("(kayıtlı)");
  expect(host.textContent).not.toContain("plain-secret");
  expect(JSON.stringify(SETTINGS)).not.toMatch(/password_enc|plain-secret/);

  await act(async () => {
    host.querySelector('[data-testid="save-einvoice-btn"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  const save = axios.put.mock.calls.find((c) => String(c[0]).includes("/einvoice/settings"));
  expect(save).toBeTruthy();
  expect(save[1]).toMatchObject({
    company_id: "comp_qnb",
    username: "qnb-user",
    company_tax_id: "1234567890",
    erp_code: "ERP1",
    alias: "urn:mail:defaultpk@firma.com.tr",
    efatura_url: "https://efatura.example/connector",
    earsiv_url: "https://earsiv.example/connector",
    password: "",
  });
  expect(save[1].password).toBe("");
});
