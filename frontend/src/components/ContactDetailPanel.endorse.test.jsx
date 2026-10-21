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
    post: jest.fn(async () => ({ data: { status: "endorsed" } })),
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

jest.mock("../utils/dataRefresh", () => ({
  notifyDataChanged: jest.fn(async () => {}),
  useDataRefresh: () => {},
}));

jest.mock("./ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => children,
  DropdownMenuContent: ({ children }) => <div data-testid="detail-collect-menu">{children}</div>,
  DropdownMenuItem: ({ children, onSelect, disabled, ...rest }) => (
    <button type="button" disabled={!!disabled} onClick={() => !disabled && onSelect?.()} {...rest}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children, ...rest }) => <button type="button" {...rest}>{children}</button>,
  DropdownMenuSubContent: ({ children, ...rest }) => <div {...rest}>{children}</div>,
}));

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1", name: "Tam Kobi" }, can: () => true }),
}));

const PORTFOLIO = {
  cheques: [
    {
      id: "own-1",
      number: "CEK-OWN",
      contact_id: "ct1",
      instrument: "cheque",
      direction: "received",
      status: "open",
      amount: 10,
      due_date: "2026-11-01",
      bank_name: "Kendi",
      serial_no: "1",
      contact_name: "NUR ORMAN",
    },
    {
      id: "ch4",
      number: "CEK-2026-0004",
      contact_id: "ersay",
      instrument: "cheque",
      direction: "received",
      status: "open",
      amount: 250000,
      due_date: "2026-11-30",
      bank_name: "Vakıf Bank",
      serial_no: "0021408",
      drawer_name: "ERSAY HOME ÜRETİM TEDARİK",
      contact_name: "ERSAY HOME ÜRETİM TEDARİK",
    },
    {
      id: "ch6",
      number: "CEK-2026-0006",
      contact_id: "ornek",
      instrument: "cheque",
      direction: "received",
      status: "open",
      amount: 120000,
      due_date: "2026-12-15",
      bank_name: "Ziraat Bankası",
      serial_no: "0045173",
      drawer_name: "ÖRNEK MOBİLYA LTD. ŞTİ.",
      contact_name: "ÖRNEK MOBİLYA LTD. ŞTİ.",
    },
    {
      id: "snt2",
      number: "SNT-2026-0002",
      contact_id: "demo",
      instrument: "promissory",
      direction: "received",
      status: "open",
      amount: 75500,
      due_date: "2027-01-05",
      serial_no: "",
      drawer_name: "DEMO YAPI MALZEMELERİ",
      contact_name: "DEMO YAPI MALZEMELERİ",
    },
  ],
};

const OVERVIEW = {
  contact: { id: "ct1", company_id: "c1", name: "NUR ORMAN ÜRÜNLERİ - KAMİL KAYMAZ", type: "supplier", balance: -813088, tax_number_or_id: "1234567890" },
  summary: { total_invoiced: 0, total_paid: 0, open_amount: 0, invoice_count: 0, draft_count: 0, opening_balance: 0 },
  invoices: [],
  payments: [
    {
      id: "pay-ciro",
      type: "outflow",
      date: "2026-10-21",
      account_name: "Çek Portföyü",
      category: "Ciro edilen çek",
      description: "CEK-2026-0004 · vade 30.11.2026 · Vakıf Bank 0021408 · asıl cari ERSAY HOME ÜRETİM TEDARİK",
      amount: 250000,
      currency: "TRY",
      source: "cheque",
      cheque_id: "ch4",
      cheque_kind: "endorsement",
    },
  ],
  orders: [],
  communications: [],
  quotes: [],
  surveys: [],
  cheques: [
    {
      id: "ch4",
      number: "CEK-2026-0004",
      instrument: "cheque",
      direction: "received",
      role: "endorsee",
      amount: 250000,
      currency: "TRY",
      serial_no: "0021408",
      bank_name: "Vakıf Bank",
      drawer_name: "ERSAY HOME ÜRETİM TEDARİK",
      due_date: "2026-11-30",
      status: "endorsed",
      status_label: "Ciro edildi",
    },
  ],
  projects: [],
  email_deliveries: [],
};

let host;
let root;

function mockMatch(matches) {
  window.matchMedia = (query) => ({
    matches: !!matches,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

beforeEach(() => {
  mockMatch(false);
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/overview")) return Promise.resolve({ data: OVERVIEW });
    if (u.includes("/cheques")) return Promise.resolve({ data: PORTFOLIO });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockClear();
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  document.body.innerHTML = "";
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

test("menüde Çek cirola, çekten hemen sonra ve YENİ rozetiyle durur", async () => {
  await renderPanel();
  const menu = host.querySelector("[data-testid=detail-collect-menu]");
  const labels = [...menu.querySelectorAll("button")].map((btn) => btn.textContent);
  const chequeAt = labels.findIndex((text) => text.includes("Çek") && !text.includes("cirola"));
  const endorseAt = labels.findIndex((text) => text.includes("Çek cirola"));
  expect(endorseAt).toBe(chequeAt + 1);
  const item = host.querySelector("[data-testid=detail-collect-cheque_endorse]");
  const badge = item.querySelector("span.uppercase");
  expect(badge.textContent).toBe("yeni");
  expect(badge.className).toContain("bg-rose-600");
  expect(item.textContent).toContain("Portföydeki alınan çeki bu cariye ver");
});

test("ödemeler ciro satırında yalnız makbuz, çek sekmesinde ciro ile gelen", async () => {
  await renderPanel();
  expect(host.querySelector("[data-testid=detail-summary-cheques]").textContent).toContain("250.000,00");
  expect(host.querySelector("[data-testid=detail-summary-cheques-badge]").textContent).toBe("Ciro ile gelen");
  expect(host.querySelector("[data-testid=detail-summary-cheques]").textContent).toContain("ciro ile gelen 1 çek");

  await act(async () => { host.querySelector("[data-testid=detail-tab-payments]").click(); });
  const row = host.querySelector("[data-testid=detail-pay-pay-ciro]");
  expect(row.textContent).toContain("Ciro edilen çek");
  expect(row.textContent).toContain("Çek/Senet");
  expect(row.textContent).toContain("CEK-2026-0004 · vade 30.11.2026");
  expect(row.textContent).toContain("-250.000,00");
  expect(row.querySelector("[data-testid=receipt-btn-pay-ciro]")).toBeTruthy();
  expect(row.querySelector("[data-testid=pay-edit-btn-pay-ciro]")).toBeNull();
  expect(row.querySelector("[data-testid=pay-delete-btn-pay-ciro]")).toBeNull();
  expect(host.querySelector("[data-testid=card-pay-edit-btn-pay-ciro]")).toBeNull();
  expect(host.querySelector("[data-testid=endorse-pay-note]").textContent).toContain("düzenlenemez veya silinemez");

  await act(async () => { host.querySelector("[data-testid=detail-tab-cheques]").click(); });
  const cheque = host.querySelector("[data-testid=detail-cheque-CEK-2026-0004]");
  expect(cheque.textContent).toContain("Ciro ile gelen");
  expect(cheque.textContent).toContain("Ciro edildi");
  expect(cheque.textContent).toContain("Vakıf Bank · 0021408 · asıl cari ERSAY HOME ÜRETİM TEDARİK");
  expect(cheque.querySelector("[data-testid=detail-cheque-receipt-CEK-2026-0004]")).toBeTruthy();
  expect(cheque.querySelector("[data-testid=detail-cheque-lock-CEK-2026-0004]")).toBeTruthy();
  expect(cheque.querySelector("[data-testid=detail-cheque-edit-CEK-2026-0004]")).toBeNull();
  expect(cheque.querySelector("[data-testid=detail-cheque-delete-CEK-2026-0004]")).toBeNull();
  expect(cheque.querySelector("[data-testid=detail-cheque-select-CEK-2026-0004]")).toBeTruthy();
});

test("çek cirola seçimsiz kapalı, arama süzer, kayıt endorse çağırır", async () => {
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-collect-cheque_endorse]").click(); });
  await flush(6);
  const modal = host.querySelector("[data-testid=collect-modal]");
  expect(modal.getAttribute("data-layout")).toBe("dialog");
  expect(modal.querySelector("[data-testid=collect-modal-title]").textContent).toBe("Çek cirola");
  expect(modal.querySelector("[data-testid=endorse-table]")).toBeTruthy();
  expect(modal.querySelector("[data-testid=endorse-cards]")).toBeNull();
  expect(modal.textContent).not.toContain("CEK-OWN");
  expect(modal.querySelector("[data-testid=endorse-save-btn]").disabled).toBe(true);
  expect(modal.querySelector("[data-testid=endorse-summary]").textContent).toContain("0 çek seçildi");

  await act(async () => { modal.querySelector("[data-testid=endorse-pick-CEK-2026-0004]").click(); });
  await act(async () => { modal.querySelector("[data-testid=endorse-pick-CEK-2026-0006]").click(); });
  expect(modal.querySelector("[data-testid=endorse-summary]").textContent).toContain("2 çek seçildi");
  expect(modal.querySelector("[data-testid=endorse-summary]").textContent).toContain("370.000,00");
  expect(modal.querySelector("[data-testid=endorse-row-CEK-2026-0004]").className).toContain("emerald-50");
  expect(modal.querySelector("[data-testid=endorse-save-btn]").disabled).toBe(false);

  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => { setValue(modal.querySelector("[data-testid=endorse-search]"), "örnek"); });
  expect(modal.querySelector("[data-testid=endorse-row-CEK-2026-0006]")).toBeTruthy();
  expect(modal.querySelector("[data-testid=endorse-row-CEK-2026-0004]")).toBeNull();
  expect(modal.querySelector("[data-testid=endorse-row-SNT-2026-0002]")).toBeNull();

  await act(async () => { setValue(modal.querySelector("[data-testid=endorse-search]"), ""); });
  await act(async () => { modal.querySelector("[data-testid=endorse-save-btn]").click(); });
  await flush(4);
  const calls = axios.post.mock.calls.map(([url, body]) => [String(url), body]);
  expect(calls).toEqual([
    ["/api/cheques/ch4/endorse", expect.objectContaining({ contact_id: "ct1", description: "Çek cirosu" })],
    ["/api/cheques/ch6/endorse", expect.objectContaining({ contact_id: "ct1" })],
  ]);
});

test("390px çek cirola alt sayfa kart listesi, tablo yok", async () => {
  mockMatch(true);
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-collect-cheque_endorse]").click(); });
  await flush(6);
  const modal = host.querySelector("[data-testid=collect-modal]");
  expect(modal.getAttribute("data-layout")).toBe("sheet");
  expect(modal.className).toContain("rounded-t-2xl");
  expect(modal.querySelector("table")).toBeNull();
  expect(modal.querySelector("[data-testid=endorse-cards]")).toBeTruthy();
  expect(modal.querySelector("[data-testid=endorse-card-CEK-2026-0004]").textContent).toContain("Asıl cari:");
  expect(modal.querySelector("[data-testid=endorse-save-btn]").disabled).toBe(true);
});
