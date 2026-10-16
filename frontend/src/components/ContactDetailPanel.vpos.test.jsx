/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { ContactDetailPanel } from "./ContactDetailPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    defaults: {},
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl };
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" }, can: () => true }),
}));

const OVERVIEW = {
  contact: { id: "ct1", company_id: "c1", name: "Acme", type: "customer", balance: 40, tax_number_or_id: "111" },
  summary: { total_invoiced: 120, total_paid: 0, open_amount: 120, invoice_count: 1, opening_balance: 0 },
  invoices: [],
  payments: [],
  orders: [],
  communications: [],
  quotes: [],
  surveys: [],
  cheques: [],
  projects: [],
  email_deliveries: [],
};

const OPTIONS = {
  enabled: true,
  family: "nestpay",
  bank_label: "İş Bankası",
  mode: "test",
  max_installment: 6,
  no_installment: false,
};

let host;
let root;

function mockGets(options) {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/overview")) return Promise.resolve({ data: OVERVIEW });
    if (u.includes("/collect-options")) return Promise.resolve({ data: options });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mockGets(OPTIONS);
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: {} });
  toast.error.mockClear();
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  jest.clearAllMocks();
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderPanel() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ContactDetailPanel contactId="ct1" onClose={() => {}} />
      </MemoryRouter>,
    );
  });
  await flush();
}

function typeInto(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}

test("etkin sanal POS yoksa kartla tahsil et görünmez", async () => {
  mockGets({ enabled: false, family: "", bank_label: "", mode: "", max_installment: 0, no_installment: false });
  await renderPanel();
  expect(host.querySelector("[data-testid=vpos-collect-btn]")).toBeNull();
});

test("kartla tahsil et modalı açık alacağı doldurur ve kart alanı istemez", async () => {
  await renderPanel();
  const button = host.querySelector("[data-testid=vpos-collect-btn]");
  expect(button.textContent).toMatch(/Kartla tahsil et/);
  await act(async () => { button.click(); });
  expect(host.querySelector("[data-testid=vpos-collect-modal]")).toBeTruthy();
  expect(host.querySelector("[data-testid=vpos-collect-provider]").textContent).toContain("İş Bankası");
  expect(host.querySelector("[data-testid=vpos-collect-provider]").textContent).toContain("NestPay");
  expect(host.querySelector("[data-testid=vpos-collect-amount]").value).toBe("120.00");
  expect(host.querySelector("[data-testid=vpos-collect-installment]").querySelectorAll("option")).toHaveLength(6);
  expect(host.querySelector("[data-testid=vpos-collect-description]").value).toBe("Cari tahsilat");
  const names = [...host.querySelectorAll("input, select")].map((el) => (el.name || "") + (el.getAttribute("data-testid") || "") + (el.autocomplete || ""));
  expect(names.join(" ")).not.toMatch(/pan|cvv|cv2|expiry|skt/i);
  expect(host.querySelector("[data-testid=vpos-collect-modal]").textContent).not.toMatch(/kart numarası/i);

  typeInto(host.querySelector("[data-testid=vpos-collect-amount]"), "0");
  await act(async () => { host.querySelector("[data-testid=vpos-collect-submit]").click(); });
  expect(axios.post).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();

  typeInto(host.querySelector("[data-testid=vpos-collect-amount]"), "15.50");
  const select = host.querySelector("[data-testid=vpos-collect-installment]");
  const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  selectSetter.call(select, "3");
  act(() => { select.dispatchEvent(new Event("change", { bubbles: true })); });
  axios.post.mockResolvedValue({
    data: { intent_id: "i1", kind: "form", action_url: "https://entegrasyon.asseco-see.com.tr/fim/est3Dgate", fields: { amount: "15.50", oid: "abc" } },
  });
  const submit = jest.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  await act(async () => { host.querySelector("[data-testid=vpos-collect-submit]").click(); });
  await flush(4);
  expect(axios.post).toHaveBeenCalledWith("/api/contacts/ct1/vpos-collect", {
    company_id: "c1",
    amount: "15.50",
    description: "Cari tahsilat",
    installment: 3,
  });
  const bankForm = document.querySelector("[data-testid=vpos-bank-form]");
  expect(bankForm).toBeTruthy();
  expect(bankForm.querySelector("input[name=amount]").value).toBe("15.50");
  expect(bankForm.querySelector("input[name=pan]")).toBeNull();
  submit.mockRestore();
});

test("taksit kapalıysa taksit seçimi yoktur", async () => {
  mockGets({ ...OPTIONS, no_installment: true, max_installment: 6 });
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=vpos-collect-btn]").click(); });
  expect(host.querySelector("[data-testid=vpos-collect-installment]")).toBeNull();
});
