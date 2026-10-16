/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import ContactsPage from "./ContactsPage";
import { CONTACTS_PAGING_STORAGE_KEY } from "../utils/featureFlags";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROWS = [
  { id: "1", name: "Ada Yılmaz", company_title: "Ada Ltd", tax_number_or_id: "111", type: "customer", balance: 10, is_active: true },
  { id: "2", name: "Bora Demir", company_title: "Bora", tax_number_or_id: "222", type: "supplier", balance: -5, is_active: true },
];

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    isCancel: (err) => err?.code === "ERR_CANCELED",
    defaults: {},
    interceptors: { response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => {
  const company = { id: "c1" };
  return {
    API_URL: "/api",
    useAuth: () => ({ activeCompany: company }),
  };
});
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(""), jest.fn()],
}), { virtual: true });
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  cachedList: async (collection, _cid, opts) => {
    globalThis.__cachedListCalls.push(collection);
    if (collection !== "contacts") return [];
    const rows = opts?.filter ? ROWS.filter(opts.filter) : ROWS.slice();
    opts?.onCached?.(rows);
    return rows;
  },
  contactTypeFilter: (type) => (c) => !type || type === "all" || c.type === type,
  dropCached: async () => {},
}));
jest.mock("../components/QuickMessageModal", () => ({ QuickMessageModal: () => null, TEMPLATES: { balance: () => "" } }));
jest.mock("../components/ContactLocationModal", () => ({ ContactLocationModal: () => null, mapsLink: () => "" }));
jest.mock("../components/ContactDetailPanel", () => ({ ContactDetailPanel: () => null }));
jest.mock("../components/ContactForm", () => ({ ContactForm: () => null }));
jest.mock("../components/ExportButtons", () => ({ ExportButtons: () => null }));
jest.mock("../components/StatementShare", () => ({ StatementShareBar: () => null, buildStatementRows: () => [] }));
jest.mock("../components/StatementTxList", () => ({ StatementTxList: () => null }));

function summaryBody(over = {}) {
  return {
    count: 40,
    facet_total: 40,
    balance_total: 9999,
    receivable_total: 9999,
    payable_total: 1234,
    debtors: 7,
    creditors: 3,
    overdue: 2,
    installments: 1,
    clear: 30,
    ...over,
  };
}

function pageBody(params) {
  const pageNo = Number(params?.page || 1);
  const q = params?.q || "";
  const size = Number(params?.page_size || 50);
  if (q) {
    return {
      items: [{ id: "q1", name: "Arama Sonucu", tax_number_or_id: "333", type: "customer", balance: 3, is_active: true, company_title: "Ara", flags: {} }],
      total: 1,
      page: 1,
      page_size: size,
      has_more: false,
      summary: summaryBody({ count: 1, facet_total: 1, balance_total: 3, receivable_total: 3, payable_total: 0, debtors: 1, creditors: 0, overdue: 0, installments: 0, clear: 0 }),
    };
  }
  if (pageNo === 1) {
    return {
      items: [{
        id: "p1",
        name: "Sunucu Cari",
        tax_number_or_id: "999",
        type: "customer",
        balance: 10,
        is_active: true,
        company_title: "Sunucu",
        flags: { overdue_count: 2, overdue_amount: 15, installment_due_count: 0, installment_overdue_count: 0 },
      }],
      total: 40,
      page: 1,
      page_size: size,
      has_more: true,
      summary: summaryBody(),
    };
  }
  return {
    items: [{ id: "p2", name: "Ikinci Sayfa", tax_number_or_id: "888", type: "supplier", balance: -4, is_active: true, company_title: "Iki", flags: {} }],
    total: 40,
    page: pageNo,
    page_size: size,
    has_more: false,
    summary: summaryBody(),
  };
}

function contactListCalls() {
  return axios.get.mock.calls.filter((c) => /\/contacts\/?$/.test(String(c[0]).split("?")[0]));
}

let host;
let root;

beforeEach(() => {
  localStorage.removeItem(CONTACTS_PAGING_STORAGE_KEY);
  globalThis.__cachedListCalls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url, config) => {
    const u = String(url);
    if (/\/contacts\/?$/.test(u.split("?")[0])) return Promise.resolve({ data: pageBody(config?.params) });
    if (u.includes("/contacts/flags")) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  localStorage.removeItem(CONTACTS_PAGING_STORAGE_KEY);
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function waitFor(predicate, { tries = 40 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  throw new Error("waitFor timed out");
}

async function renderPage() {
  root = createRoot(host);
  await act(async () => { root.render(<ContactsPage />); });
  await flush(8);
}

function setControl(el, value) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}

test("flag kapalıyken eski liste akar, sayfa parametresi gitmez", async () => {
  await renderPage();
  await waitFor(() => host.textContent.includes("Ada Yılmaz"));
  expect(globalThis.__cachedListCalls).toContain("contacts");
  expect(contactListCalls()).toHaveLength(0);
  expect(host.querySelector('[data-testid="contacts-pager"]')).toBeNull();
  expect(host.querySelector('[data-testid="contact-fin-filter-debtors"]').textContent).toContain("(1)");
  expect(host.textContent).toContain("Bora Demir");

  const input = host.querySelector('[data-testid="contact-search-input"]');
  await act(async () => { setControl(input, "bora"); });
  await flush(4);
  expect(host.textContent).toContain("Bora Demir");
  expect(host.textContent).not.toContain("Ada Yılmaz");
  expect(contactListCalls()).toHaveLength(0);
});

test("flag açıkken sayfa ister, arama sayfa 1'e döner, toplam sunucudadır", async () => {
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Cari"));
  expect(globalThis.__cachedListCalls).not.toContain("contacts");
  const first = contactListCalls();
  expect(first).toHaveLength(1);
  expect(first[0][1].params).toMatchObject({
    company_id: "c1",
    page: 1,
    page_size: 50,
    type: "all",
    status: "all",
    fin: "all",
    sort: "name",
  });
  expect(first[0][1].params.q).toBeUndefined();
  const summary = host.querySelector('[data-testid="contacts-result-summary"]');
  expect(summary.textContent.replace(/\s/g, "")).toMatch(/9[.\s,]?999/);
  expect(summary.textContent).toContain("40");
  expect(host.querySelector('[data-testid="contact-fin-filter-debtors"]').textContent).toContain("(7)");
  expect(host.textContent).toContain("Vadesi geçti");
  expect(host.textContent).not.toContain("Ikinci Sayfa");
  expect(axios.get.mock.calls.some((c) => String(c[0]).includes("/contacts/flags"))).toBe(false);

  await act(async () => { host.querySelector('[data-testid="contacts-page-next"]').click(); });
  await waitFor(() => host.textContent.includes("Ikinci Sayfa"));
  expect(contactListCalls().map((c) => c[1].params.page)).toEqual([1, 2]);
  expect(host.textContent).not.toContain("Sunucu Cari");

  const input = host.querySelector('[data-testid="contact-search-input"]');
  await act(async () => { setControl(input, "ada"); });
  await waitFor(() => {
    const last = contactListCalls().at(-1);
    return last && last[1].params.page === 1 && last[1].params.q === "ada";
  });
  await waitFor(() => host.textContent.includes("Arama Sonucu"));
  expect(host.querySelector('[data-testid="contacts-page-indicator"]').textContent).toContain("1 /");
});

test("sayfa boyutu ve sıralama sayfa 1'den istenir", async () => {
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Cari"));
  await act(async () => { host.querySelector('[data-testid="contacts-page-next"]').click(); });
  await waitFor(() => host.textContent.includes("Ikinci Sayfa"));

  const size = host.querySelector('[data-testid="contacts-page-size"]');
  await act(async () => { setControl(size, "100"); });
  await waitFor(() => {
    const last = contactListCalls().at(-1);
    return last && last[1].params.page === 1 && Number(last[1].params.page_size) === 100;
  });

  const sort = host.querySelector('[data-testid="contacts-sort"]');
  await act(async () => { setControl(sort, "balance_desc"); });
  await waitFor(() => {
    const last = contactListCalls().at(-1);
    return last && last[1].params.page === 1 && last[1].params.sort === "balance_desc" && Number(last[1].params.page_size) === 100;
  });

  const fin = host.querySelector('[data-testid="contact-fin-filter-select"]');
  await act(async () => { setControl(fin, "debtors"); });
  await waitFor(() => {
    const last = contactListCalls().at(-1);
    return last && last[1].params.page === 1 && last[1].params.fin === "debtors";
  });
});
