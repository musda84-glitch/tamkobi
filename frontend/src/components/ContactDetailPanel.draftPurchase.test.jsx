/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import { ContactDetailPanel } from "./ContactDetailPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    defaults: {},
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return { __esModule: true, default: impl };
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" }, can: () => true }),
}));

const PAPER = {
  id: "al107",
  invoice_number: "AL202600000107",
  invoice_type: "purchase",
  e_type: "paper",
  status: "draft",
  payment_status: "unpaid",
  grand_total: 65000,
  issue_date: "2026-10-01",
  currency: "TRY",
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
  grand_total: 100,
  issue_date: "2026-10-02",
  currency: "TRY",
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
  grand_total: 50,
  issue_date: "2026-10-03",
  currency: "TRY",
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
  grand_total: 80,
  issue_date: "2026-10-04",
  currency: "TRY",
  gib_status: "Onaylandı",
};
const INCOMING = {
  id: "gelen",
  invoice_number: "GLN-1",
  invoice_type: "purchase",
  e_type: "e_invoice",
  direction: "incoming",
  status: "draft",
  payment_status: "unpaid",
  effects_applied: false,
  grand_total: 24,
  issue_date: "2026-10-05",
  currency: "TRY",
  gib_status: "Gelen",
};
const SALES = {
  id: "sale1",
  invoice_number: "TA-1",
  invoice_type: "sales",
  e_type: "e_archive",
  status: "draft",
  payment_status: "unpaid",
  grand_total: 20,
  issue_date: "2026-10-06",
  currency: "TRY",
  gib_status: "Taslak",
};

const OVERVIEW = {
  contact: { id: "ct1", company_id: "c1", name: "Tedarikçi", type: "supplier", balance: 0, tax_number_or_id: "111" },
  summary: { total_invoiced: 0, total_paid: 0, open_amount: 0, invoice_count: 6, draft_count: 3, opening_balance: 0 },
  invoices: [PAPER, APPROVED, PAID, PARTIAL, INCOMING, SALES],
  payments: [],
  orders: [],
  communications: [],
  quotes: [],
  surveys: [],
  cheques: [],
  projects: [],
  email_deliveries: [],
};

let host;
let root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  window.confirm = jest.fn(() => true);
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/overview")) return Promise.resolve({ data: OVERVIEW });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockImplementation(async (url) => {
    if (String(url).includes("/approve")) return { data: { message: "onaylandı" } };
    return { data: {} };
  });
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  document.body.querySelectorAll("[data-testid='invoice-context-menu']").forEach((el) => el.remove());
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
  await flush(8);
}

function approvePosts() {
  return axios.post.mock.calls.filter((c) => String(c[0]).includes("/invoices/") && String(c[0]).endsWith("/approve"));
}

test("taslak satır Taslak, onaylı satır mevcut ödeme rozetlerini gösterir", async () => {
  await renderPanel();
  const draft = host.querySelector("[data-testid='detail-inv-pay-AL202600000107']");
  expect(draft.textContent).toBe("Taslak");
  expect(draft.className).toContain("bg-slate-100");
  expect(draft.className).toContain("text-slate-600");
  expect(host.querySelector("[data-testid='detail-inv-pay-TA-1']").textContent).toBe("Taslak");
  expect(host.querySelector("[data-testid='detail-inv-pay-AL-OK']").textContent).toBe("Cariye işlendi");
  expect(host.querySelector("[data-testid='detail-inv-pay-AL-PAID']").textContent).toBe("Ödendi");
  expect(host.querySelector("[data-testid='detail-inv-pay-AL-PART']").textContent).toBe("Kısmi");
  expect(host.querySelector("[data-testid='detail-inv-pay-AL-OK']").textContent).not.toBe("Taslak");
});

test("kağıt alış taslağında yeşil onay butonu approve çağırır ve liste yenilenir", async () => {
  await renderPanel();
  const before = axios.get.mock.calls.filter((c) => String(c[0]).includes("/overview")).length;
  const btn = host.querySelector("[data-testid='detail-faturalastir-btn-AL202600000107']");
  expect(btn).toBeTruthy();
  expect(btn.className).toContain("bg-emerald-600");
  expect(btn.getAttribute("aria-label")).toBe("Taslağı Onayla");
  expect(btn.getAttribute("title")).toBe("Taslağı Onayla");
  await act(async () => { btn.click(); });
  await flush(4);
  expect(window.confirm).toHaveBeenCalledWith("AL202600000107 alış taslağı onaylansın mı?\nCari bakiyesi ve stok işlenecek.");
  expect(approvePosts()).toEqual([["/api/invoices/al107/approve"]]);
  expect(axios.get.mock.calls.filter((c) => String(c[0]).includes("/overview")).length).toBeGreaterThan(before);
});

test("vazgeçilirse approve çağrılmaz", async () => {
  window.confirm = jest.fn(() => false);
  await renderPanel();
  const btn = host.querySelector("[data-testid='detail-faturalastir-btn-AL202600000107']");
  await act(async () => { btn.click(); });
  await flush(2);
  expect(approvePosts()).toHaveLength(0);
});

test("onay sürerken ikinci tık ikinci istek atmaz", async () => {
  let release;
  axios.post.mockImplementation((url) => {
    if (String(url).includes("/approve")) {
      return new Promise((resolve) => {
        release = () => resolve({ data: { message: "onaylandı" } });
      });
    }
    return Promise.resolve({ data: {} });
  });
  await renderPanel();
  const btn = host.querySelector("[data-testid='detail-faturalastir-btn-AL202600000107']");
  await act(async () => { btn.click(); });
  await flush(2);
  const again = host.querySelector("[data-testid='detail-faturalastir-btn-AL202600000107']");
  await act(async () => { again.click(); });
  await flush(2);
  expect(approvePosts()).toHaveLength(1);
  await act(async () => { release(); });
  await flush(4);
});

test("⋮ menüsünde alış onay öğesi aynı approve çağrısını yapar, FATURAYI KES yoktur", async () => {
  await renderPanel();
  const more = host.querySelector("[data-testid='detail-inv-more-AL202600000107']");
  await act(async () => { more.click(); });
  await flush(2);
  const menu = document.body.querySelector("[data-testid='invoice-context-menu']");
  expect(menu).toBeTruthy();
  expect(menu.textContent).toContain("TASLAĞI ONAYLA");
  expect(menu.textContent).toContain("Taslağı Onayla (Cariye İşle)");
  expect(menu.textContent).toContain("Cari bakiyesi ve stok işlenir");
  expect(menu.textContent).not.toContain("FATURAYI KES");
  expect(menu.querySelector("[data-testid='ctx-issue-types']")).toBeNull();
  const item = menu.querySelector("[data-testid='ctx-draft-approve']");
  await act(async () => { item.click(); });
  await flush(4);
  expect(window.confirm).toHaveBeenCalledWith("AL202600000107 alış taslağı onaylansın mı?\nCari bakiyesi ve stok işlenecek.");
  expect(approvePosts()).toEqual([["/api/invoices/al107/approve"]]);
});

test("satış taslağı menüsü ve butonu eski faturalaştır metnini korur", async () => {
  await renderPanel();
  const btn = host.querySelector("[data-testid='detail-faturalastir-btn-TA-1']");
  expect(btn.textContent).toMatch(/Taslağı Faturalaştır/);
  expect(btn.getAttribute("aria-label")).toBe("Taslağı Faturalaştır");
  const more = host.querySelector("[data-testid='detail-inv-more-TA-1']");
  await act(async () => { more.click(); });
  await flush(2);
  const menu = document.body.querySelector("[data-testid='invoice-context-menu']");
  expect(menu.textContent).toContain("TASLAĞI FATURALAŞTIR");
  expect(menu.textContent).toContain("Taslağı Faturalaştır");
  expect(menu.textContent).not.toContain("TASLAĞI ONAYLA");
  expect(menu.textContent).not.toContain("FATURAYI KES");
});

test("gelen e-fatura alışında yalnız mevcut Faturalaştır butonu vardır", async () => {
  await renderPanel();
  const incoming = host.querySelector("[data-testid='detail-incoming-faturalastir-GLN-1']");
  expect(incoming).toBeTruthy();
  expect(incoming.textContent).toMatch(/Faturalaştır/);
  expect(host.querySelector("[data-testid='detail-faturalastir-btn-GLN-1']")).toBeNull();
  const row = host.querySelector("[data-testid='detail-inv-GLN-1']");
  expect(row.querySelectorAll("button.bg-emerald-600")).toHaveLength(1);
  const more = host.querySelector("[data-testid='detail-inv-more-GLN-1']");
  await act(async () => { more.click(); });
  await flush(2);
  const menu = document.body.querySelector("[data-testid='invoice-context-menu']");
  expect(menu.textContent).toContain("GELEN E-FATURA");
  expect(menu.querySelector("[data-testid='ctx-draft-approve']")).toBeNull();
  expect(menu.textContent).not.toContain("FATURAYI KES");
  expect(menu.textContent).not.toContain("Taslağı Onayla (Cariye İşle)");
});
