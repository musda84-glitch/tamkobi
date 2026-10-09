import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { BankConnectionsPanel } from "./BankConnectionsPanel";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "" }));
jest.mock("../utils/jsencryptKuveyt", () => ({
  generateJsencryptKeyPair: jest.fn(async () => ({
    privateKey: "PRIV",
    publicKey: "PUB",
    certificatePem: "-----BEGIN CERTIFICATE-----\nCRT\n-----END CERTIFICATE-----",
  })),
  downloadTextFile: jest.fn(),
}));

const PROVIDERS = [{
  code: "kuveytturk",
  name: "Kuveyt Türk API Market",
  fields: ["client_id", "client_secret", "api_key", "private_key"],
  live_url: "https://prep-gateway.kuveytturk.com.tr",
  hint: "Canlı: prep-identity + prep-gateway",
}];
const CONN = {
  id: "c1",
  provider: "kuveytturk",
  provider_name: "Kuveyt Türk API Market",
  linked_account_id: "a1",
  linked_account_name: "Kuveyt Türk — Vadesiz TL",
  mode: "live",
  bank_account_number: "6",
};
const ACCOUNTS = [{ id: "a1", bank_name: "Kuveyt Türk", account_name: "Vadesiz TL", type: "bank" }];

let host;
let quiet;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/providers")) return Promise.resolve({ data: PROVIDERS });
    if (u.includes("/banking/connections")) return Promise.resolve({ data: [CONN] });
    if (u.includes("/banking/transactions/unmatched")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/match-rules")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  quiet.mockRestore();
  host.remove();
});

async function renderPanel() {
  root = createRoot(host);
  await act(async () => {
    root.render(<BankConnectionsPanel companyId="c1" accounts={ACCOUNTS} contacts={[]} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openEditModal() {
  const editBtn = host.querySelector('[data-testid="edit-conn-btn-c1"]')
    || [...host.querySelectorAll("button")].find((b) => /^Düzenle$/i.test((b.textContent || "").trim()));
  expect(editBtn).toBeTruthy();
  await act(async () => { editBtn.click(); });
  await act(async () => { await Promise.resolve(); });
}

test("Kuveyt ReadTimeout shows host checklist instead of bare error", async () => {
  const timedOut = {
    ...CONN,
    mode: "sandbox",
    last_error:
      "Bağlantı kurulamadı: Kuveyt Türk gateway zaman aşımı (ReadTimeout). " +
      "Denenen uçlar: https://prep-gateway.kuveytturk.com.tr/v1/fx/rates. " +
      "üretim çıkış IP’si banka whitelist’te değilse yanıt gelmez.",
  };
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/providers")) return Promise.resolve({ data: PROVIDERS });
    if (u.includes("/banking/connections")) return Promise.resolve({ data: [timedOut] });
    if (u.includes("/banking/transactions/unmatched")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/match-rules")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  await renderPanel();
  const box = host.querySelector('[data-testid="conn-last-error-kuveyt-timeout"]');
  expect(box).not.toBeNull();
  expect(box.textContent).toMatch(/zaman aşımı/i);
  expect(box.textContent).toContain("prep-gateway.kuveytturk.com.tr");
  expect(host.querySelector('[data-testid="conn-last-error"]')).toBeNull();
});

test("Kuveyt edit modal keeps only needed fields and shows live hosts", async () => {
  await renderPanel();
  await openEditModal();

  const modal = host.querySelector('[data-testid="edit-bank-connection-modal"]');
  expect(modal).not.toBeNull();
  const hint = host.querySelector('[data-testid="kuveyt-edit-hint"]');
  expect(hint).not.toBeNull();
  expect(hint.textContent).toContain("identity.kuveytturk.com.tr");
  expect(hint.textContent).toContain("gateway.kuveytturk.com.tr");
  expect(hint.textContent).toContain("prep-identity");
  expect(hint.textContent).toContain("prep-gateway");
  const hrefs = [...hint.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");
  expect(hrefs).toContain("https://identity.kuveytturk.com.tr");
  expect(hrefs).toContain("https://gateway.kuveytturk.com.tr");
  expect(hrefs).toContain("https://prep-identity.kuveytturk.com.tr");
  expect(hrefs).toContain("https://prep-gateway.kuveytturk.com.tr");

  const goliveLinks = host.querySelector('[data-testid="kuveyt-golive-links"]');
  expect(goliveLinks).not.toBeNull();
  const goliveHrefs = [...goliveLinks.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");
  expect(goliveHrefs).toContain("https://developer.kuveytturk.com.tr/");
  expect(goliveHrefs).toContain("https://developer.kuveytturk.com.tr/documentation");
  expect(goliveHrefs).toContain("https://github.com/KuveytTurk/SignatureGenerator2048");
  expect(goliveHrefs).toContain("https://travistidwell.com/jsencrypt/demo/");
  expect(goliveHrefs).toContain("https://developer.kuveytturk.com.tr/contactus");
  expect(goliveHrefs).toContain("mailto:apiekibi@kuveytturk.com.tr");

  expect(host.querySelector('[data-testid="edit-conn-client-id"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="edit-conn-client-secret"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="edit-conn-api-key"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="edit-conn-private-key"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="edit-conn-iban"]')).not.toBeNull();

  expect(host.querySelector('[data-testid="edit-conn-access-token"]')).toBeNull();
  expect(host.querySelector('[data-testid="edit-conn-refresh-token"]')).toBeNull();
  expect(host.querySelector('[data-testid="edit-conn-scope"]')).toBeNull();
  expect(host.querySelector('[data-testid="edit-conn-customer"]')).toBeNull();

  const checklist = host.querySelector('[data-testid="kuveyt-live-checklist"]');
  expect(checklist).not.toBeNull();
  expect(checklist.textContent).toMatch(/İmza/i);
  expect(checklist.textContent).toMatch(/\.crt/i);
  expect(checklist.textContent).toMatch(/IP/i);
  expect(checklist.textContent).toMatch(/scope=accounts/i);
  expect(checklist.textContent).toMatch(/suffix/i);
  expect(checklist.textContent).toMatch(/GoLive/i);
  expect(checklist.textContent).toMatch(/GoLive Talep Yönetimi/i);
});

test("Kuveyt Signature Invalid shows crt checklist", async () => {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/providers")) return Promise.resolve({ data: PROVIDERS });
    if (u.includes("/banking/connections")) {
      return Promise.resolve({
        data: [{ ...CONN, last_error: "Bağlantı kurulamadı: Kuveyt Türk Signature Invalid (.crt)" }],
      });
    }
    return Promise.resolve({ data: [] });
  });
  await renderPanel();
  const box = host.querySelector('[data-testid="conn-last-error-kuveyt-signature"]');
  expect(box).not.toBeNull();
  expect(box.textContent).toMatch(/Signature Invalid/i);
  expect(box.textContent).toMatch(/\.crt/i);
});
