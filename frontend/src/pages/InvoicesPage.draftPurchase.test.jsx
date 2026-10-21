/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import InvoicesPage from "./InvoicesPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAPER = {
  id: "al107",
  invoice_number: "AL202600000107",
  invoice_type: "purchase",
  e_type: "paper",
  status: "draft",
  payment_status: "unpaid",
  contact_name: "Tedarikçi",
  contact_id: "ct1",
  grand_total: 65000,
  currency: "TRY",
  issue_date: "2026-10-01",
  gib_status: "Taslak",
  effects_applied: false,
};
const APPROVED = {
  id: "alok",
  invoice_number: "AL-OK",
  invoice_type: "purchase",
  e_type: "paper",
  status: "approved",
  payment_status: "unpaid",
  effects_applied: true,
  contact_name: "Tedarikçi",
  grand_total: 100,
  currency: "TRY",
  issue_date: "2026-10-02",
  gib_status: "Kağıt Fatura (Matbu)",
};
const PAID = {
  id: "alpaid",
  invoice_number: "AL-PAID",
  invoice_type: "purchase",
  e_type: "paper",
  status: "approved",
  payment_status: "paid",
  effects_applied: true,
  contact_name: "Tedarikçi",
  grand_total: 50,
  currency: "TRY",
  issue_date: "2026-10-03",
  gib_status: "Kağıt Fatura (Matbu)",
};
const PARTIAL = {
  id: "alpart",
  invoice_number: "AL-PART",
  invoice_type: "sales",
  e_type: "e_archive",
  status: "approved",
  payment_status: "partially_paid",
  effects_applied: true,
  contact_name: "Müşteri",
  grand_total: 80,
  currency: "TRY",
  issue_date: "2026-10-04",
  gib_status: "Onaylandı",
};
const INCOMING = {
  id: "gelen",
  invoice_number: "GLN-1",
  invoice_type: "purchase",
  direction: "incoming",
  e_type: "e_invoice",
  status: "draft",
  payment_status: "unpaid",
  effects_applied: false,
  contact_name: "Gelen",
  grand_total: 24,
  currency: "TRY",
  issue_date: "2026-10-05",
  gib_status: "Gelen",
};
const SALES = {
  id: "sale1",
  invoice_number: "TA-1",
  invoice_type: "sales",
  e_type: "e_archive",
  status: "draft",
  payment_status: "unpaid",
  contact_name: "Müşteri",
  grand_total: 20,
  currency: "TRY",
  issue_date: "2026-10-06",
  gib_status: "Taslak",
};
const mockInvoiceRows = [PAPER, APPROVED, PAID, PARTIAL, INCOMING, SALES];
const mockListCalls = [];

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    defaults: {},
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" }, addonOn: () => false, can: () => true }),
}));
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  invoiceTypeFilter: () => ({}),
  cachedList: async (collection) => {
    mockListCalls.push(collection);
    return collection === "invoices" ? mockInvoiceRows : [];
  },
  dropCached: async () => {},
}));

let host;
let root;

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  window.confirm = jest.fn(() => true);
  axios.get.mockImplementation(() => Promise.resolve({ data: [] }));
  axios.post.mockImplementation(async (url) => {
    if (String(url).includes("/approve")) return { data: { message: "onaylandı" } };
    return { data: {} };
  });
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  document.body.querySelectorAll("[data-testid='invoice-context-menu']").forEach((el) => el.remove());
  mockListCalls.length = 0;
  jest.clearAllMocks();
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderPage() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>,
    );
  });
  await flush();
}

function approvePosts() {
  return axios.post.mock.calls.filter((c) => String(c[0]).includes("/invoices/") && String(c[0]).endsWith("/approve"));
}

test("faturalar sayfasında taslak rozeti Taslak, onaylı rozetler durur", async () => {
  await renderPage();
  const draft = host.querySelector("[data-testid='inv-pay-AL202600000107']");
  expect(draft.textContent).toBe("Taslak");
  expect(draft.className).toContain("bg-slate-100");
  expect(draft.className).toContain("text-slate-600");
  expect(host.querySelector("[data-testid='inv-pay-TA-1']").textContent).toBe("Taslak");
  expect(host.querySelector("[data-testid='inv-pay-AL-OK']").textContent).toBe("Cariye işlendi");
  expect(host.querySelector("[data-testid='inv-pay-AL-PAID']").textContent).toBe("Ödendi");
  expect(host.querySelector("[data-testid='inv-pay-AL-PART']").textContent).toBe("Kısmi Ödendi");
});

test("kağıt alış taslağı yeşil onay butonu ve menü öğesi approve çağırır", async () => {
  await renderPage();
  const before = mockListCalls.filter((c) => c === "invoices").length;
  const btn = host.querySelector("[data-testid='draft-faturalastir-btn-AL202600000107']");
  expect(btn).toBeTruthy();
  expect(btn.className).toContain("bg-emerald-600");
  expect(btn.getAttribute("aria-label")).toBe("Taslağı Onayla");
  await act(async () => { btn.click(); });
  await flush(4);
  expect(window.confirm).toHaveBeenCalledWith("AL202600000107 alış taslağı onaylansın mı?\nCari bakiyesi ve stok işlenecek.");
  expect(approvePosts()).toEqual([["/api/invoices/al107/approve"]]);
  expect(mockListCalls.filter((c) => c === "invoices").length).toBeGreaterThan(before);

  axios.post.mockClear();
  window.confirm.mockClear();
  const more = host.querySelector("[data-testid='inv-more-btn-AL202600000107']");
  await act(async () => { more.click(); });
  await flush(2);
  const menu = document.body.querySelector("[data-testid='invoice-context-menu']");
  expect(menu.textContent).toContain("TASLAĞI ONAYLA");
  expect(menu.textContent).toContain("Taslağı Onayla (Cariye İşle)");
  expect(menu.textContent).toContain("Cari bakiyesi ve stok işlenir");
  expect(menu.textContent).not.toContain("FATURAYI KES");
  await act(async () => { menu.querySelector("[data-testid='ctx-draft-approve']").click(); });
  await flush(4);
  expect(approvePosts()).toEqual([["/api/invoices/al107/approve"]]);
});

test("gelen e-fatura satırında yeni onay butonu çıkmaz, satış metni aynı kalır", async () => {
  await renderPage();
  expect(host.querySelectorAll("[data-testid='incoming-faturalastir-GLN-1']")).toHaveLength(1);
  expect(host.querySelector("[data-testid='draft-faturalastir-btn-GLN-1']")).toBeNull();
  const incomingActions = host.querySelector("[data-testid='inv-actions-GLN-1']");
  expect(incomingActions.querySelector("[data-testid='draft-faturalastir-btn-GLN-1']")).toBeNull();
  const salesBtn = host.querySelector("[data-testid='draft-faturalastir-btn-TA-1']");
  expect(salesBtn.textContent).toMatch(/Taslağı Faturalaştır/);
  expect(salesBtn.getAttribute("aria-label")).toBe("Taslağı Faturalaştır");
  const more = host.querySelector("[data-testid='inv-more-btn-TA-1']");
  await act(async () => { more.click(); });
  await flush(2);
  const menu = document.body.querySelector("[data-testid='invoice-context-menu']");
  expect(menu.textContent).toContain("TASLAĞI FATURALAŞTIR");
  expect(menu.textContent).not.toContain("TASLAĞI ONAYLA");
  expect(menu.textContent).not.toContain("FATURAYI KES");
});
