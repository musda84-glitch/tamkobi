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
  items: [{ name: "Örnek A4 Fotokopi Kağıdı (koli)", quantity: 100, unit: "Koli" }],
};
const APPROVED = {
  id: "alok",
  invoice_number: "AL-OK",
  invoice_type: "purchase",
  e_type: "paper",
  status: "approved",
  payment_status: "unpaid",
  effects_applied: true,
  stock_effects_applied: true,
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
const DRAFT_OFF = {
  id: "aloff",
  invoice_number: "AL-OFF",
  invoice_type: "purchase",
  e_type: "paper",
  status: "draft",
  post_stock: false,
  payment_status: "unpaid",
  contact_name: "Tedarikçi",
  contact_id: "ct1",
  grand_total: 10,
  currency: "TRY",
  issue_date: "2026-10-07",
  gib_status: "Taslak",
  effects_applied: false,
};
const SALES = {
  id: "sale1",
  invoice_number: "TA-1",
  invoice_type: "sales",
  e_type: "e_archive",
  status: "draft",
  payment_status: "unpaid",
  contact_name: "Müşteri",
  contact_id: "ct1",
  grand_total: 20,
  currency: "TRY",
  issue_date: "2026-10-06",
  gib_status: "Taslak",
};
const mockInvoiceRows = [PAPER, APPROVED, PAID, PARTIAL, INCOMING, SALES, DRAFT_OFF];
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
  expect(window.confirm).toHaveBeenCalledWith("AL202600000107 alış taslağı onaylansın mı?\nCari bakiyesi işlenecek.\nStok işlenecek: 1 kalem (100 Koli) depoya girer.\nE-belge gönderimi ayrı adımdır.\nOnaydan sonra 'Stoğa işle' değiştirilemez.");
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
  expect(menu.textContent).toContain("Cari bakiyesi işlenir. Stok, Stoğa işle seçimine bağlıdır.");
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

test("stok rozeti tür rozetinin yanında, satışta ve işaretli taslakta yok", async () => {
  await renderPage();
  const inStock = host.querySelector("[data-testid='inv-stock-badge-AL-OK']");
  expect(inStock.textContent).toBe("Stokta");
  expect(inStock.className).toContain("bg-emerald-50");
  expect(inStock.className).toContain("text-emerald-700");
  expect(inStock.className).toContain("border-emerald-200");
  expect(inStock.getAttribute("title")).toBe("Kalemler depoya girdi");
  const none = host.querySelector("[data-testid='inv-stock-badge-AL-PAID']");
  expect(none.textContent).toBe("Stoksuz");
  expect(none.className).toContain("bg-slate-100");
  expect(none.className).toContain("text-slate-600");
  expect(none.className).toContain("border-slate-300");
  expect(none.getAttribute("title")).toBe("Yalnız cari işlendi");
  expect(host.querySelector("[data-testid='inv-stock-badge-AL202600000107']")).toBeNull();
  expect(host.querySelector("[data-testid='inv-stock-badge-TA-1']")).toBeNull();
  expect(host.querySelector("[data-testid='inv-stock-badge-GLN-1']")).toBeNull();
  expect(host.querySelector("[data-testid='inv-stock-badge-AL-PART']")).toBeNull();
  const off = host.querySelector("[data-testid='inv-stock-badge-AL-OFF']");
  expect(off.textContent).toBe("Stoksuz");
  expect(off.getAttribute("title")).toBe("Onayda seçilecek");
});

const CHECKED_CONFIRM = "AL202600000107 alış taslağı onaylansın mı?\nCari bakiyesi işlenecek.\nStok işlenecek: 1 kalem (100 Koli) depoya girer.\nE-belge gönderimi ayrı adımdır.\nOnaydan sonra 'Stoğa işle' değiştirilemez.";
const UNCHECKED_CONFIRM = "AL202600000107 alış taslağı onaylansın mı?\nCari bakiyesi işlenecek. Stok işlenmeyecek.\nE-belge gönderimi ayrı adımdır.\nOnaydan sonra 'Stoğa işle' değiştirilemez.";

function setSelect(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

test("yeni alış formunda Stoğa işle işaretli, satışta gizli", async () => {
  await renderPage();
  await act(async () => { host.querySelector("[data-testid='create-new-invoice-btn']").click(); });
  await flush(2);
  expect(host.querySelector("[data-testid='inv-post-stock']")).toBeNull();
  const type = host.querySelector("[data-testid='inv-type-select']");
  await act(async () => { setSelect(type, "purchase"); });
  await flush(2);
  const box = host.querySelector("[data-testid='inv-post-stock']");
  expect(box.checked).toBe(true);
  expect(box.disabled).toBe(false);
  const chip = box.closest("label");
  expect(chip.className).toContain("h-8");
  expect(chip.className).toContain("bg-emerald-50");
  expect(chip.className).toContain("border-emerald-500");
  expect(chip.className).toContain("text-[11px]");
  expect(chip.className).toContain("font-bold");
  expect(chip.className).toContain("rounded-md");
  expect(host.querySelector("[data-testid='inv-post-stock-hint']").textContent).toBe(
    "İşaretliyse onayda kalemler depoya girer. İşaretsizse yalnız cari bakiyesi işlenir. Onaydan sonra değiştirilemez.",
  );
  await act(async () => { setSelect(type, "sales"); });
  await flush(1);
  expect(host.querySelector("[data-testid='inv-post-stock']")).toBeNull();
  expect(host.querySelector("[data-testid='inv-post-stock-hint']")).toBeNull();
});

test("işaret kaldırılınca kayıt gövdesinde post_stock false", async () => {
  await renderPage();
  await act(async () => { host.querySelector("[data-testid='edit-inv-btn-AL202600000107']").click(); });
  await flush(3);
  const box = host.querySelector("[data-testid='inv-post-stock']");
  expect(box.checked).toBe(true);
  await act(async () => { box.click(); });
  await flush(1);
  expect(host.querySelector("[data-testid='inv-post-stock']").checked).toBe(false);
  axios.put.mockClear();
  await act(async () => { host.querySelector("[data-testid='save-invoice-btn']").click(); });
  await flush(4);
  const put = axios.put.mock.calls.find((c) => String(c[0]).includes("/invoices/al107"));
  expect(put).toBeTruthy();
  expect(put[1].post_stock).toBe(false);
  expect(window.confirm).not.toHaveBeenCalled();
});

test("doğrudan Onaylı kayıt seçeneğe göre sorar, satış metni aynı kalır", async () => {
  await renderPage();
  await act(async () => { host.querySelector("[data-testid='edit-inv-btn-AL202600000107']").click(); });
  await flush(3);
  await act(async () => { host.querySelector("[data-testid='inv-status-approved']").click(); });
  window.confirm.mockClear();
  axios.post.mockClear();
  await act(async () => { host.querySelector("[data-testid='save-invoice-btn']").click(); });
  await flush(4);
  expect(window.confirm).toHaveBeenCalledWith(CHECKED_CONFIRM);
  expect(axios.post.mock.calls.some((c) => String(c[0]).endsWith("/invoices/al107/approve"))).toBe(true);

  window.confirm.mockClear();
  axios.post.mockClear();
  axios.put.mockClear();
  await act(async () => { host.querySelector("[data-testid='edit-inv-btn-AL202600000107']").click(); });
  await flush(3);
  await act(async () => { host.querySelector("[data-testid='inv-post-stock']").click(); });
  await act(async () => { host.querySelector("[data-testid='inv-status-approved']").click(); });
  await act(async () => { host.querySelector("[data-testid='save-invoice-btn']").click(); });
  await flush(4);
  expect(window.confirm).toHaveBeenCalledWith(UNCHECKED_CONFIRM);
  const put = axios.put.mock.calls.find((c) => String(c[0]).includes("/invoices/al107"));
  expect(put[1].post_stock).toBe(false);

  window.confirm.mockClear();
  axios.put.mockClear();
  await act(async () => { host.querySelector("[data-testid='edit-inv-btn-TA-1']").click(); });
  await flush(3);
  expect(host.querySelector("[data-testid='inv-post-stock']")).toBeNull();
  await act(async () => { host.querySelector("[data-testid='inv-status-approved']").click(); });
  await act(async () => { host.querySelector("[data-testid='save-invoice-btn']").click(); });
  await flush(4);
  expect(window.confirm).not.toHaveBeenCalled();
  const salesPut = axios.put.mock.calls.find((c) => String(c[0]).includes("/invoices/sale1"));
  expect(salesPut).toBeTruthy();
  expect(salesPut[1].post_stock).toBeUndefined();
});

test("onaylı faturada Stoğa işle salt okunur", async () => {
  await renderPage();
  await act(async () => { host.querySelector("[data-testid='edit-inv-btn-AL-OK']").click(); });
  await flush(3);
  const box = host.querySelector("[data-testid='inv-post-stock']");
  expect(box.checked).toBe(true);
  expect(box.disabled).toBe(true);
  expect(host.querySelector("[data-testid='inv-post-stock-lock']").textContent).toBe(
    "🔒 Onaylı faturada değiştirilemez. Değiştirmek için faturayı iptal edip yeniden girin.",
  );
  await act(async () => { box.click(); });
  await flush(1);
  expect(host.querySelector("[data-testid='inv-post-stock']").checked).toBe(true);
});

test("390px'te kutu ve ipucu tam genişlik satırda", async () => {
  const previous = window.innerWidth;
  window.innerWidth = 390;
  try {
    await renderPage();
    await act(async () => { host.querySelector("[data-testid='create-new-invoice-btn']").click(); });
    await flush(2);
    await act(async () => { setSelect(host.querySelector("[data-testid='inv-type-select']"), "purchase"); });
    await flush(2);
    const row = host.querySelector("[data-testid='inv-post-stock-row']");
    const hint = host.querySelector("[data-testid='inv-post-stock-hint']");
    expect(row.getAttribute("data-layout")).toBe("full");
    expect(row.className).toContain("w-full");
    expect(row.className).toContain("basis-full");
    expect(row.className).toContain("max-w-full");
    expect(hint.className).toContain("w-full");
    expect(hint.className).toContain("basis-full");
    expect(hint.className).toContain("whitespace-normal");
    expect(hint.className).toContain("break-words");
    expect(row.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hint.textContent.length).toBeGreaterThan(20);
    window.innerWidth = 1280;
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    await flush(2);
    expect(host.querySelector("[data-testid='inv-post-stock-row']").getAttribute("data-layout")).toBe("inline");
    expect(host.querySelector("[data-testid='inv-post-stock-row']").className).not.toContain("basis-full");
  } finally {
    window.innerWidth = previous || 1024;
  }
});
