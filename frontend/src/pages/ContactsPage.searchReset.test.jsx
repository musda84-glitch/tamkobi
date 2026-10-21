/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import ContactsPage from "./ContactsPage";
import { CONTACTS_PAGING_STORAGE_KEY } from "../utils/featureFlags";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROWS = [
  { id: "1", name: "Ada Yılmaz", company_title: "Ada Ltd", tax_number_or_id: "111", type: "customer", balance: 10, is_active: true },
  { id: "2", name: "Bora Demir", company_title: "Bora", tax_number_or_id: "222", type: "supplier", balance: -5, is_active: true },
  { id: "3", name: "ERSAY HOME ÜRETİM", company_title: "Ersay", tax_number_or_id: "3680486408", type: "customer", balance: 20, is_active: true },
  { id: "4", name: "Pasif Müşteri", company_title: "Pasif", tax_number_or_id: "444", type: "customer", balance: 0, is_active: false },
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
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  cachedList: async (collection, _cid, opts) => {
    if (collection !== "contacts") return [];
    const rows = opts?.filter ? ROWS.filter(opts.filter) : ROWS.slice();
    opts?.onCached?.(rows);
    return rows;
  },
  contactTypeFilter: (type) => (c) => !type || type === "all" || c.type === type,
  dropCached: async () => {},
}));
jest.mock("../components/QuickMessageModal", () => ({
  QuickMessageModal: ({ onClose }) => (
    <div data-testid="quick-message-modal">
      <button type="button" onClick={onClose} data-testid="close-quick-message">Kapat</button>
    </div>
  ),
  TEMPLATES: { balance: () => "" },
}));
jest.mock("../components/ContactLocationModal", () => ({ ContactLocationModal: () => null, mapsLink: () => "" }));
jest.mock("../components/ContactDetailPanel", () => ({
  ContactDetailPanel: ({ contactId, onClose }) => (
    <div data-testid="contact-detail-panel">
      <span data-testid="detail-contact-id">{contactId}</span>
      <button type="button" onClick={onClose} data-testid="close-contact-detail-btn">Kapat</button>
    </div>
  ),
}));
jest.mock("../components/ContactForm", () => ({
  ContactForm: ({ onClose }) => (
    <div data-testid="contact-form-modal">
      <button type="button" onClick={onClose} data-testid="close-contact-form">Kapat</button>
    </div>
  ),
}));
jest.mock("../components/ExportButtons", () => ({ ExportButtons: () => null }));
jest.mock("../components/StatementShare", () => ({ StatementShareBar: () => null, buildStatementRows: () => [] }));
jest.mock("../components/StatementTxList", () => ({ StatementTxList: () => null, StatementViewProvider: ({ children }) => children }));

function summaryBody(over = {}) {
  return {
    count: 120,
    facet_total: 120,
    receivable_total: 10,
    payable_total: 5,
    debtors: 1,
    creditors: 1,
    overdue: 0,
    installments: 0,
    clear: 0,
    ...over,
  };
}

function pageBody(params) {
  const q = String(params?.q || "");
  const items = q
    ? [{ id: "q1", name: "ERSAY HOME ÜRETİM", company_title: "Ersay", tax_number_or_id: "3680486408", type: "customer", balance: 20, is_active: true, flags: {} }]
    : [
      { id: "p1", name: "Sunucu Cari", tax_number_or_id: "999", type: "customer", balance: 10, is_active: true, company_title: "Sunucu", flags: {} },
      { id: "p2", name: "Bora Demir", tax_number_or_id: "222", type: "supplier", balance: -5, is_active: true, company_title: "Bora", flags: {} },
    ];
  const total = q ? items.length : 120;
  return {
    items,
    total,
    page: Number(params?.page || 1),
    page_size: Number(params?.page_size || 50),
    has_more: false,
    summary: summaryBody({ count: total, facet_total: total }),
  };
}

function contactListCalls() {
  return axios.get.mock.calls.filter((c) => /\/contacts\/?$/.test(String(c[0]).split("?")[0]));
}

function UrlProbe() {
  const [params] = useSearchParams();
  return <output data-testid="contacts-url-probe">{params.toString()}</output>;
}

let host;
let root;

beforeEach(() => {
  localStorage.removeItem(CONTACTS_PAGING_STORAGE_KEY);
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url, config) => {
    const u = String(url);
    if (u.includes("/statement")) return Promise.resolve({ data: { transactions: [] } });
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

async function renderPage(entry = "/contacts") {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <ContactsPage />
        <UrlProbe />
      </MemoryRouter>,
    );
  });
  await flush(8);
}

function setControl(el, value) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}

function searchInput() {
  return host.querySelector('[data-testid="contact-search-input"]');
}

function listText() {
  return host.querySelector('[data-testid="contacts-list"]').textContent;
}

function urlQuery() {
  return host.querySelector('[data-testid="contacts-url-probe"]').textContent;
}

async function typeSearch(value) {
  await act(async () => { setControl(searchInput(), value); });
  await flush(4);
}

async function clickTestId(id) {
  await act(async () => {
    const el = host.querySelector(`[data-testid="${id}"]`);
    if (!el) throw new Error(`missing ${id}`);
    el.click();
  });
}

function expectFullClientList() {
  const text = listText();
  expect(text).toContain("Ada Yılmaz");
  expect(text).toContain("Bora Demir");
  expect(text).toContain("ERSAY HOME");
  expect(text).toContain("Pasif Müşteri");
}

async function openAndReturn(openTestId) {
  await typeSearch("ersay");
  expect(searchInput().value).toBe("ersay");
  expect(listText()).toContain("ERSAY HOME");
  expect(listText()).not.toContain("Ada Yılmaz");
  await clickTestId(openTestId);
  await waitFor(() => host.querySelector('[data-testid="contact-detail-panel"]'));
  expect(host.querySelector('[data-testid="detail-contact-id"]').textContent).toBe("3");
  expect(searchInput().value).toBe("");
  await clickTestId("close-contact-detail-btn");
  await waitFor(() => !host.querySelector('[data-testid="contact-detail-panel"]'));
  expect(searchInput().value).toBe("");
  expectFullClientList();
}

test("ersay yazıp satıra tıklayınca geri dönüşte arama boş ve liste tam", async () => {
  await renderPage();
  await waitFor(() => listText().includes("Ada Yılmaz"));
  await openAndReturn("contact-name-3680486408");
});

test("sağ ok ile karta girince geri dönüşte arama boş ve liste tam", async () => {
  await renderPage();
  await waitFor(() => listText().includes("Ada Yılmaz"));
  await openAndReturn("open-contact-btn-3680486408");
});

test("ekstre açılıp kapanınca arama boş ve liste tam", async () => {
  await renderPage();
  await waitFor(() => listText().includes("Ada Yılmaz"));
  await typeSearch("ersay");
  expect(listText()).not.toContain("Ada Yılmaz");
  await clickTestId("statement-btn-3680486408");
  await waitFor(() => host.querySelector('[data-testid="statement-modal"]'));
  expect(searchInput().value).toBe("");
  expectFullClientList();
  await act(async () => {
    const close = [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === "Kapat");
    close.click();
  });
  await waitFor(() => !host.querySelector('[data-testid="statement-modal"]'));
  expect(searchInput().value).toBe("");
  expectFullClientList();
});

test("tür, aktif/pasif ve etiket filtresi karttan dönünce durur", async () => {
  await renderPage();
  await waitFor(() => listText().includes("Ada Yılmaz"));
  await clickTestId("contact-filter-customer");
  await clickTestId("contact-status-filter-active");
  await act(async () => { setControl(host.querySelector('[data-testid="contact-fin-filter-select"]'), "debtors"); });
  await flush(4);
  await typeSearch("ersay");
  await clickTestId("contact-name-3680486408");
  await waitFor(() => host.querySelector('[data-testid="contact-detail-panel"]'));
  await clickTestId("close-contact-detail-btn");
  await waitFor(() => !host.querySelector('[data-testid="contact-detail-panel"]'));

  expect(searchInput().value).toBe("");
  expect(host.querySelector('[data-testid="contact-filter-customer"]').className).toContain("bg-slate-900");
  expect(host.querySelector('[data-testid="contact-filter-all"]').className).not.toContain("bg-slate-900");
  expect(host.querySelector('[data-testid="contact-status-filter-active"]').className).toContain("bg-slate-800");
  expect(host.querySelector('[data-testid="contact-status-filter-all"]').className).not.toContain("bg-slate-800");
  expect(host.querySelector('[data-testid="contact-fin-filter-select"]').value).toBe("debtors");
  const text = listText();
  expect(text).toContain("Ada Yılmaz");
  expect(text).toContain("ERSAY HOME");
  expect(text).not.toContain("Bora Demir");
  expect(text).not.toContain("Pasif Müşteri");
});

test("kart açılmadan arama metni korunur", async () => {
  await renderPage();
  await waitFor(() => listText().includes("Ada Yılmaz"));
  await typeSearch("ersay");
  await clickTestId("contact-status-filter-active");
  await clickTestId("location-btn-3680486408");
  expect(searchInput().value).toBe("ersay");
  expect(listText()).toContain("ERSAY HOME");
  expect(listText()).not.toContain("Ada Yılmaz");
  expect(listText()).not.toContain("Bora Demir");
});

test("kalem ve not ikonu aramayı temizler", async () => {
  await renderPage();
  await waitFor(() => listText().includes("Ada Yılmaz"));
  await typeSearch("ersay");
  await clickTestId("edit-contact-btn-3680486408");
  await waitFor(() => host.querySelector('[data-testid="contact-form-modal"]'));
  expect(searchInput().value).toBe("");
  expectFullClientList();
  await clickTestId("close-contact-form");

  await typeSearch("ersay");
  expect(listText()).not.toContain("Ada Yılmaz");
  await clickTestId("message-btn-3680486408");
  await waitFor(() => host.querySelector('[data-testid="quick-message-modal"]'));
  expect(searchInput().value).toBe("");
  expectFullClientList();
});

test("kart ve ekstre URL'deki search ve q parametrelerini siler", async () => {
  await renderPage("/contacts?search=ersay&q=eski&ref=abc");
  await waitFor(() => listText().includes("ERSAY HOME"));
  expect(searchInput().value).toBe("ersay");
  expect(listText()).not.toContain("Ada Yılmaz");
  await clickTestId("statement-btn-3680486408");
  await waitFor(() => host.querySelector('[data-testid="statement-modal"]'));
  expect(searchInput().value).toBe("");
  expect(urlQuery()).toBe("ref=abc");
  expectFullClientList();

  await act(() => { root.unmount(); });
  root = null;
  host.innerHTML = "";
  await renderPage("/contacts?search=ersay&q=eski");
  await waitFor(() => searchInput().value === "ersay");
  await clickTestId("open-contact-btn-3680486408");
  await waitFor(() => host.querySelector('[data-testid="contact-detail-panel"]'));
  expect(urlQuery()).toBe("contact_id=3");
  expect(searchInput().value).toBe("");
  await clickTestId("close-contact-detail-btn");
  await waitFor(() => !host.querySelector('[data-testid="contact-detail-panel"]'));
  expect(urlQuery()).toBe("");
  expect(searchInput().value).toBe("");
  expectFullClientList();
});

test("sunucu sayfalamada arama silinir, sıralama ve sayfa boyutu kalır", async () => {
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await waitFor(() => listText().includes("Sunucu Cari"));
  await act(async () => { setControl(host.querySelector('[data-testid="contacts-page-size"]'), "100"); });
  await act(async () => { setControl(host.querySelector('[data-testid="contacts-sort"]'), "balance_desc"); });
  await act(async () => { setControl(host.querySelector('[data-testid="contact-fin-filter-select"]'), "creditors"); });
  await clickTestId("contact-filter-supplier");
  await clickTestId("contact-status-filter-inactive");
  await typeSearch("ersay");
  await waitFor(() => {
    const last = contactListCalls().at(-1);
    return last && last[1].params.q === "ersay" && listText().includes("ERSAY HOME");
  });
  await clickTestId("open-contact-btn-3680486408");
  await waitFor(() => host.querySelector('[data-testid="contact-detail-panel"]'));
  await clickTestId("close-contact-detail-btn");
  await waitFor(() => !host.querySelector('[data-testid="contact-detail-panel"]'));
  await waitFor(() => {
    const last = contactListCalls().at(-1);
    return last && last[1].params.q == null && listText().includes("Sunucu Cari");
  });

  expect(searchInput().value).toBe("");
  expect(listText()).toContain("Bora Demir");
  expect(host.querySelector('[data-testid="contacts-page-size"]').value).toBe("100");
  expect(host.querySelector('[data-testid="contacts-sort"]').value).toBe("balance_desc");
  expect(host.querySelector('[data-testid="contact-fin-filter-select"]').value).toBe("creditors");
  expect(host.querySelector('[data-testid="contact-filter-supplier"]').className).toContain("bg-slate-900");
  expect(host.querySelector('[data-testid="contact-status-filter-inactive"]').className).toContain("bg-slate-800");
  const last = contactListCalls().at(-1)[1].params;
  expect(last.type).toBe("supplier");
  expect(last.status).toBe("inactive");
  expect(last.fin).toBe("creditors");
  expect(last.sort).toBe("balance_desc");
  expect(Number(last.page_size)).toBe(100);
  expect(last.page).toBe(1);
});
