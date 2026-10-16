import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import fs from "fs";
import path from "path";
import axios from "axios";
import { VposSettingsPanel } from "./VposSettingsPanel";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ user: { role: "admin", name: "Yönetici" } }),
}));

const SECRET = "SHOULD_NOT_RENDER";
const ENC = "gAAAA-store-key-ciphertext";
const CONFIG = {
  family: "nestpay",
  bank_label: "İş Bankası",
  mode: "test",
  client_id: "100200127",
  has_store_key: true,
  has_api_password: true,
  store_key: SECRET,
  store_key_enc: ENC,
  api_password: "API-SECRET",
  api_password_enc: "gAAAA-api",
  gateway_3d_url: "https://entegrasyon.asseco-see.com.tr/fim/est3Dgate",
  account_id: "pos1",
  enabled: true,
};
const ACCOUNTS = [
  { id: "cash1", type: "cash_box", bank_name: "Kasa", account_name: "Nakit" },
  { id: "pos1", type: "pos", bank_name: "İş", account_name: "Mağaza POS" },
  { id: "okc1", type: "okc_pos", bank_name: "ÖKC", account_name: "Yazar Kasa" },
];

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockResolvedValue({ data: CONFIG });
  axios.put.mockResolvedValue({ data: { ...CONFIG, store_key: undefined, store_key_enc: undefined } });
  axios.post.mockResolvedValue({
    data: {
      intent_id: "intent-1",
      action_url: "https://bank.test/fim/est3Dgate",
      fields: { clientid: "100200127", amount: "1.00", currency: "949", hash: "abc", oid: "order1" },
    },
  });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.querySelectorAll('[data-testid="vpos-bank-form"]').forEach((node) => node.remove());
});

async function renderPanel() {
  root = createRoot(host);
  await act(async () => {
    root.render(<VposSettingsPanel companyId="c1" accounts={ACCOUNTS} />);
  });
  await act(async () => { await Promise.resolve(); });
}

test("ayar formu gizli alanları maskeler ve kasa hesabını listelemez", async () => {
  await renderPanel();
  expect(host.textContent).not.toContain(SECRET);
  expect(host.textContent).not.toContain(ENC);
  expect(host.textContent).not.toContain("API-SECRET");
  expect(host.querySelector('[data-testid="vpos-store-key"]').value).toBe("");
  expect(host.querySelector('[data-testid="vpos-store-key"]').getAttribute("placeholder")).toBe("••••••••");
  expect(host.querySelector('[data-testid="vpos-store-key-mask"]').textContent).toMatch(/•/);
  expect(host.querySelector('[data-testid="vpos-api-password"]').value).toBe("");
  expect(host.querySelector('[data-testid="vpos-api-password-mask"]').textContent).toMatch(/•/);
  const options = [...host.querySelectorAll('[data-testid="vpos-account"] option')].map((node) => node.value);
  expect(options).toContain("pos1");
  expect(options).toContain("okc1");
  expect(options).not.toContain("cash1");
  const family = [...host.querySelectorAll('[data-testid="vpos-family"] option')];
  expect(family.find((node) => node.value === "nestpay").disabled).toBe(false);
  expect(family.find((node) => node.value === "paytr").disabled).toBe(true);
  expect(family.find((node) => node.value === "iyzico").textContent).toMatch(/yakında/);
});

test("test ödemesi formu action_url adresine POST eder", async () => {
  const submit = jest.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  await renderPanel();
  await act(async () => {
    host.querySelector('[data-testid="vpos-test-payment"]').click();
  });
  expect(axios.post).toHaveBeenCalledWith("/api/vpos/test-payment", { company_id: "c1", amount: "1.00" });
  const form = document.querySelector('[data-testid="vpos-bank-form"]');
  expect(form).toBeTruthy();
  expect(form.getAttribute("method").toLowerCase()).toBe("post");
  expect(form.getAttribute("action")).toBe("https://bank.test/fim/est3Dgate");
  expect(form.querySelector('input[name="clientid"]').value).toBe("100200127");
  expect(form.querySelector('input[name="amount"]').value).toBe("1.00");
  expect(form.querySelector('input[name="pan"]')).toBeNull();
  expect(form.querySelector('input[name="cv2"]')).toBeNull();
  expect(submit).toHaveBeenCalled();
  submit.mockRestore();
});

test("canlı modda test ödemesi kapalıdır", async () => {
  axios.get.mockResolvedValue({ data: { ...CONFIG, mode: "live", enabled: true } });
  await renderPanel();
  expect(host.querySelector('[data-testid="vpos-test-payment"]').disabled).toBe(true);
});

test("ayarlar menüsünde Sanal POS sekmesi vardır", () => {
  const settings = fs.readFileSync(path.join(__dirname, "../pages/SettingsPage.jsx"), "utf8");
  const nav = fs.readFileSync(path.join(__dirname, "../navGroups.js"), "utf8");
  expect(settings).toMatch(/\["vpos", "Sanal POS"/);
  expect(settings).toMatch(/settings-tab-\$\{k\}/);
  expect(settings).toMatch(/shownTab === "vpos"/);
  expect(nav).toMatch(/"vpos"/);
});
