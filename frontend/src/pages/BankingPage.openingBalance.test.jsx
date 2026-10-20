/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import BankingPage from "./BankingPage";
import { formatTrAmount } from "../utils/money";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: { status: "ok" } })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    defaults: {},
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" }, addonOn: () => true }),
}));
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}), { virtual: true });
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  cachedList: async (collection, _cid, opts) => {
    const rows = collection === "bank_transactions"
      ? [{
        id: "tx1",
        date: "2026-10-10",
        account_id: "acc_bank",
        account_name: "Vadesiz",
        amount: 100,
        type: "inflow",
        description: "Test",
      }]
      : [];
    opts?.onCached?.(rows);
    return rows;
  },
  dropCached: async () => {},
}));
jest.mock("../components/PartnersPanel", () => ({ PartnersPanel: () => null }));
jest.mock("../components/BankConnectionsPanel", () => ({ BankConnectionsPanel: () => null }));
jest.mock("../components/CardStatementImport", () => ({ CardStatementImport: () => null }));
jest.mock("../components/CashApprovalsBanner", () => ({ CashApprovalsBanner: () => null }));
jest.mock("../components/AccountStatementPrint", () => ({ AccountStatementPrint: () => null }));
jest.mock("../components/TxRowMenu", () => ({ TxRowMenu: () => null }));
jest.mock("../components/SearchSelect", () => ({ SearchSelect: () => null }));
jest.mock("../components/VirmanPartySelect", () => ({ VirmanPartySelect: () => null }));
jest.mock("../hooks/useInfiniteRows", () => ({
  useInfiniteRows: (rows) => ({ visible: rows || [], hasMore: false, sentinelRef: { current: null } }),
}));

const ACC_BANK = {
  id: "acc_bank",
  type: "bank",
  bank_name: "Kuveyt Türk",
  account_name: "Vadesiz",
  current_balance: -11523.58,
};
const ACC_POOL = {
  id: "acc_pool",
  type: "credit_card",
  card_owner: "customer",
  is_customer_card_pool: true,
  bank_name: "Müşteri Kartları",
  account_name: "Havuz",
  current_balance: 50,
};

let host;
let root;
let quiet;

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
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/accounts")) return Promise.resolve({ data: [ACC_BANK, ACC_POOL] });
    if (u.includes("/banking/partners/summary")) return Promise.resolve({ data: { partner_count: 0 } });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockClear();
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  quiet.mockRestore();
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
}

async function renderPage() {
  root = createRoot(host);
  await act(async () => { root.render(<BankingPage />); });
  await waitFor(() => host.textContent?.includes("Kuveyt"));
  await flush(4);
}

async function openGroup(type) {
  const button = host.querySelector(`[data-testid="account-group-${type}"]`);
  expect(button).toBeTruthy();
  await act(async () => { button.click(); });
  await flush(2);
}

async function typeAmount(value) {
  const input = host.querySelector('[data-testid="opening-balance-amount"]');
  expect(input).toBeTruthy();
  await act(async () => { input.focus(); });
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  await act(async () => {
    proto.set.call(input, value);
    input.selectionStart = value.length;
    input.selectionEnd = value.length;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("hesap kartı menüsü açılış/devir ekler, havuzda menü yok", async () => {
  await renderPage();
  await openGroup("bank");
  const menu = host.querySelector('[data-testid="account-card-menu-acc_bank"]');
  expect(menu).toBeTruthy();
  await act(async () => { menu.click(); });
  await flush(1);
  const item = host.querySelector('[data-testid="add-opening-balance-acc_bank"]');
  expect(item?.textContent).toContain("Açılış/Devir bakiyesi ekle");
  await act(async () => { item.click(); });
  await flush(2);

  const modal = host.querySelector('[data-testid="opening-balance-modal"]');
  expect(modal).toBeTruthy();
  expect(host.querySelector('[data-testid="opening-balance-date"]').value).toBe("2026-10-09");
  expect(host.querySelector('[data-testid="opening-balance-confirm"]').disabled).toBe(true);

  await typeAmount("11523,58");
  await flush(2);
  const preview = host.querySelector('[data-testid="opening-balance-preview"]').textContent;
  expect(preview).toBe(`Bakiye ${formatTrAmount(-11523.58)} → ${formatTrAmount(0)} olur, cari etkilenmez`);

  const note = host.querySelector('[data-testid="opening-balance-note"]');
  await act(async () => {
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    proto.set.call(note, "POS devir");
    note.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { host.querySelector('[data-testid="opening-balance-confirm"]').click(); });
  await flush(4);

  expect(axios.post).toHaveBeenCalledWith("/api/banking/accounts/acc_bank/opening-balance", {
    amount: 11523.58,
    date: "2026-10-09",
    note: "POS devir",
  });
  expect(host.querySelector('[data-testid="opening-balance-modal"]')).toBeNull();

  await openGroup("customer_credit_card");
  expect(host.querySelector('[data-testid="account-card-menu-acc_pool"]')).toBeNull();
  expect(host.querySelector('[data-testid="add-opening-balance-acc_pool"]')).toBeNull();
  expect(host.querySelector('[data-testid="edit-account-acc_pool"]')).toBeTruthy();
});
