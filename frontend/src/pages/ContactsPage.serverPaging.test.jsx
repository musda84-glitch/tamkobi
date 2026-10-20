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
jest.mock("../components/StatementTxList", () => ({ StatementTxList: () => null, StatementViewProvider: ({ children }) => children }));

function summaryBody(over = {}) {
  return {
    count: 120,
    facet_total: 120,
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

const LIST_TOTAL = 120;
let totalOverride = null;

function pageBody(params) {
  const pageNo = Number(params?.page || 1);
  const q = params?.q || "";
  const size = Number(params?.page_size || 50);
  if (q) {
    const total = q === "yok" ? 0 : 1;
    const limit = Math.max(1, Math.ceil(total / size) || 1);
    const inRange = total > 0 && pageNo <= limit;
    return {
      items: inRange ? [{ id: "q1", name: "Arama Sonucu", tax_number_or_id: "333", type: "customer", balance: 3, is_active: true, company_title: "Ara", flags: {} }] : [],
      total,
      page: pageNo,
      page_size: size,
      has_more: false,
      summary: summaryBody({ count: total, facet_total: total, balance_total: total ? 3 : 0, receivable_total: total ? 3 : 0, payable_total: 0, debtors: total ? 1 : 0, creditors: 0, overdue: 0, installments: 0, clear: 0 }),
    };
  }
  const total = totalOverride == null ? LIST_TOTAL : totalOverride;
  const limit = Math.max(1, Math.ceil(total / size) || 1);
  if (pageNo > limit) {
    return { items: [], total, page: pageNo, page_size: size, has_more: false, summary: summaryBody() };
  }
  const first = {
    id: "p1",
    name: "Sunucu Cari",
    tax_number_or_id: "999",
    type: "customer",
    balance: 10,
    is_active: true,
    company_title: "Sunucu",
    flags: { overdue_count: 2, overdue_amount: 15, installment_due_count: 0, installment_overdue_count: 0 },
  };
  const later = {
    id: `p${pageNo}`,
    name: pageNo === 2 ? "Ikinci Sayfa" : `Sayfa ${pageNo}`,
    tax_number_or_id: "888",
    type: "supplier",
    balance: -4,
    is_active: true,
    company_title: "Iki",
    flags: {},
  };
  return {
    items: [pageNo === 1 ? first : later],
    total,
    page: pageNo,
    page_size: size,
    has_more: pageNo < limit,
    summary: summaryBody(),
  };
}

function contactListCalls() {
  return axios.get.mock.calls.filter((c) => /\/contacts\/?$/.test(String(c[0]).split("?")[0]));
}

let host;
let root;

beforeEach(() => {
  totalOverride = null;
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
  const inputWrap = input.parentElement;
  expect(input.className).toContain("w-full");
  expect(input.className).toContain("min-w-[240px]");
  expect(input.className).not.toContain("sm:w-64");
  expect(inputWrap.className).toContain("flex-1");
  expect(inputWrap.className).toContain("min-w-[240px]");
  expect(inputWrap.parentElement.className).toContain("flex-wrap");
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
  expect(summary.textContent).toContain("120");
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
  expect(host.querySelector('[data-testid="contacts-page-indicator"]').textContent.replace(/\s/g, "")).toBe("1/1");
});

function indicatorParts() {
  const text = host.querySelector('[data-testid="contacts-page-indicator"]').textContent;
  const [cur, pages] = text.split("/").map((s) => Number(String(s).trim()));
  return { cur, pages, text };
}

test("seri 5 sonraki tıklaması totalPages'i geçmez", async () => {
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Cari"));
  const next = host.querySelector('[data-testid="contacts-page-next"]');
  expect(next.disabled).toBe(false);
  await act(async () => {
    for (let i = 0; i < 5; i += 1) host.querySelector('[data-testid="contacts-page-next"]').click();
  });
  await flush(8);
  const { cur, pages } = indicatorParts();
  expect(pages).toBe(Math.max(1, Math.ceil(LIST_TOTAL / 50)));
  expect(cur).toBe(pages);
  const requested = contactListCalls().map((c) => Number(c[1].params.page));
  expect(Math.max(...requested)).toBeLessThanOrEqual(pages);
  expect(host.textContent).not.toContain("Filtreye uyan cari yok.");
});

test("yükleme sürerken önceki ve sonraki kapalı", async () => {
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "1");
  const pending = [];
  axios.get.mockImplementation((url, config) => {
    const u = String(url);
    if (/\/contacts\/?$/.test(u.split("?")[0])) {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, params: config?.params });
        config?.signal?.addEventListener("abort", () => {
          const err = new Error("canceled");
          err.code = "ERR_CANCELED";
          err.name = "CanceledError";
          reject(err);
        });
      });
    }
    return Promise.resolve({ data: [] });
  });
  root = createRoot(host);
  await act(async () => { root.render(<ContactsPage />); });
  await flush(3);
  expect(host.querySelector('[data-testid="contacts-page-prev"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="contacts-page-next"]').disabled).toBe(true);

  await act(async () => { pending[0].resolve({ data: pageBody(pending[0].params) }); });
  await waitFor(() => host.textContent.includes("Sunucu Cari"));
  expect(host.querySelector('[data-testid="contacts-page-prev"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="contacts-page-next"]').disabled).toBe(false);

  await act(async () => { host.querySelector('[data-testid="contacts-page-next"]').click(); });
  await flush(3);
  expect(host.querySelector('[data-testid="contacts-page-prev"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="contacts-page-next"]').disabled).toBe(true);

  const pageTwo = pending.filter((entry) => Number(entry.params.page) === 2).at(-1);
  await act(async () => { pageTwo.resolve({ data: pageBody(pageTwo.params) }); });
  await waitFor(() => host.textContent.includes("Ikinci Sayfa"));
  expect(host.querySelector('[data-testid="contacts-page-prev"]').disabled).toBe(false);
  expect(host.querySelector('[data-testid="contacts-page-next"]').disabled).toBe(false);
});

test("son sayfada sonraki kapalı", async () => {
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Cari"));
  const pages = Math.max(1, Math.ceil(LIST_TOTAL / 50));
  for (let i = 1; i < pages; i += 1) {
    await waitFor(() => host.querySelector('[data-testid="contacts-page-next"]').disabled === false);
    const before = indicatorParts().cur;
    await act(async () => { host.querySelector('[data-testid="contacts-page-next"]').click(); });
    await waitFor(() => indicatorParts().cur === before + 1);
  }
  await waitFor(() => host.querySelector('[data-testid="contacts-page-next"]').disabled === true);
  const shown = indicatorParts();
  expect(shown.cur).toBe(shown.pages);
  expect(shown.pages).toBe(pages);
  expect(host.querySelector('[data-testid="contacts-page-prev"]').disabled).toBe(false);
  expect(host.textContent).toContain("Sayfa 3");
});

test("filtre ile total küçülünce sayfa sınırlanır", async () => {
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Cari"));
  await act(async () => { host.querySelector('[data-testid="contacts-page-next"]').click(); });
  await waitFor(() => host.textContent.includes("Ikinci Sayfa"));
  expect(indicatorParts().cur).toBe(2);

  const input = host.querySelector('[data-testid="contact-search-input"]');
  await act(async () => { setControl(input, "yok"); });
  await waitFor(() => indicatorParts().text.replace(/\s/g, "") === "1/1");
  const shown = indicatorParts();
  expect(shown.cur).toBe(1);
  expect(shown.cur).toBeLessThanOrEqual(shown.pages);
  expect(host.textContent).not.toContain("Ikinci Sayfa");
  const pages = contactListCalls().map((c) => Number(c[1].params.page));
  expect(pages.at(-1)).toBe(1);
  expect(contactListCalls().at(-1)[1].params.q).toBe("yok");
});

test("yanıtta total düşünce sayfa son sayfaya iner", async () => {
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => host.textContent.includes("Sunucu Cari"));
  totalOverride = 100;
  await act(async () => {
    for (let i = 0; i < 5; i += 1) host.querySelector('[data-testid="contacts-page-next"]').click();
  });
  await waitFor(() => indicatorParts().text.replace(/\s/g, "") === "2/2");
  expect(host.querySelector('[data-testid="contacts-page-prev"]').disabled).toBe(false);
  expect(host.querySelector('[data-testid="contacts-page-next"]').disabled).toBe(true);
  expect(host.textContent).toContain("Ikinci Sayfa");
  expect(host.textContent).not.toContain("Filtreye uyan cari yok.");
  expect(Math.max(...contactListCalls().map((c) => Number(c[1].params.page)))).toBeLessThanOrEqual(3);
});

test("eski isteğin yanıtı son sayfayı ezmez", async () => {
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "1");
  const pending = [];
  axios.get.mockImplementation((url, config) => {
    const u = String(url);
    if (/\/contacts\/?$/.test(u.split("?")[0])) {
      return new Promise((resolve, reject) => {
        const entry = { resolve, params: { ...(config?.params || {}) }, settled: false };
        pending.push(entry);
        const fail = () => {
          if (entry.settled) return;
          entry.settled = true;
          const err = new Error("canceled");
          err.code = "ERR_CANCELED";
          err.name = "CanceledError";
          reject(err);
        };
        config?.signal?.addEventListener("abort", fail);
      });
    }
    return Promise.resolve({ data: [] });
  });
  root = createRoot(host);
  await act(async () => { root.render(<ContactsPage />); });
  await flush(2);
  await act(async () => { pending[0].resolve({ data: pageBody(pending[0].params) }); pending[0].settled = true; });
  await waitFor(() => host.textContent.includes("Sunucu Cari"));

  await act(async () => { host.querySelector('[data-testid="contacts-page-next"]').click(); });
  await flush(2);
  const stale = pending.filter((entry) => !entry.settled && Number(entry.params.page) === 2).at(-1);
  const input = host.querySelector('[data-testid="contact-search-input"]');
  await act(async () => { setControl(input, "ada"); });
  await flush(3);
  const latest = pending.filter((entry) => !entry.settled && entry.params.q === "ada" && Number(entry.params.page) === 1).at(-1);
  expect(latest).toBeTruthy();
  if (stale && !stale.settled) {
    await act(async () => { stale.resolve({ data: pageBody({ ...stale.params, page: 2 }) }); stale.settled = true; });
    await flush(4);
  }
  expect(host.textContent).not.toContain("Ikinci Sayfa");
  await act(async () => { latest.resolve({ data: pageBody(latest.params) }); latest.settled = true; });
  await waitFor(() => host.textContent.includes("Arama Sonucu"));
  expect(indicatorParts().text.replace(/\s/g, "")).toBe("1/1");
  expect(host.textContent).not.toContain("Ikinci Sayfa");
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
