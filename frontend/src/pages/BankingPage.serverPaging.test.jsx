/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import BankingPage from "./BankingPage";
import { BANK_TX_PAGING_STORAGE_KEY } from "../utils/featureFlags";
import { DATA_CHANGED_EVENT } from "../utils/dataRefresh";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    isCancel: (err) => err?.code === "ERR_CANCELED",
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
  useSearchParams: () => [new URLSearchParams(globalThis.__bankSearch || ""), jest.fn()],
}), { virtual: true });
jest.mock("../utils/dataSync", () => {
  const txs = [{
    id: "tx1",
    date: "2026-10-10",
    account_id: "acc_bank",
    account_name: "Vadesiz",
    amount: 100,
    type: "inflow",
    description: "Test",
  }];
  return {
    __esModule: true,
    cachedList: async (collection, _cid, opts) => {
      const rows = collection === "bank_transactions" ? txs : [];
      opts?.onCached?.(rows);
      return rows;
    },
    dropCached: async () => {},
  };
});
jest.mock("../components/PartnersPanel", () => ({ PartnersPanel: () => null }));
jest.mock("../components/BankConnectionsPanel", () => ({ BankConnectionsPanel: () => null }));
jest.mock("../components/CardStatementImport", () => ({ CardStatementImport: () => null }));
jest.mock("../components/CashApprovalsBanner", () => ({ CashApprovalsBanner: () => null }));
jest.mock("../components/AccountStatementPrint", () => ({ AccountStatementPrint: () => null }));
jest.mock("../components/TxRowMenu", () => ({
  TxRowMenu: ({ tx, onChanged }) => (
    <button
      type="button"
      data-testid={`tx-match-${tx.id || tx._id}`}
      onClick={() => {
        globalThis.__bankMatched = true;
        onChanged?.({ ...tx, match_status: "matched" });
      }}
    >
      match
    </button>
  ),
}));
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
  current_balance: 6716.58,
};
const ACC_CASH = {
  id: "acc_cash",
  type: "cash_box",
  bank_name: "MATEK",
  account_name: "Kasa",
  current_balance: 0,
};

function pageBody(page, accountId) {
  const matched = globalThis.__bankMatched ? "matched" : "unmatched";
  if (accountId === "acc_cash") {
    return {
      items: [{
        id: "cash1",
        date: "2026-10-01",
        account_id: "acc_cash",
        amount: 5,
        type: "inflow",
        description: "Kasa satiri",
        source: "manual",
      }],
      total: 1,
      page: 1,
      page_size: 50,
      has_more: false,
      period_inflow: 5,
      period_outflow: 0,
      focus_page: null,
    };
  }
  if (String(globalThis.__bankSearch || "").includes("tx=srv-focus")) {
    if (page === 1) {
      return {
        items: [{ id: "older", date: "2026-10-02", account_id: "acc_bank", amount: 1, type: "inflow", description: "Eski", source: "manual" }],
        total: 60,
        page: 1,
        page_size: 50,
        has_more: true,
        period_inflow: 1500.5,
        period_outflow: 25,
        focus_page: 2,
      };
    }
    return {
      items: [{
        id: "srv-focus",
        date: "2026-09-01",
        account_id: "acc_bank",
        amount: 9,
        type: "inflow",
        description: "Odak hareket",
        source: "bank_sync",
        match_status: "unmatched",
      }],
      total: 60,
      page: 2,
      page_size: 50,
      has_more: false,
      period_inflow: 1500.5,
      period_outflow: 25,
      focus_page: 2,
    };
  }
  if (page === 1) {
    return {
      items: [{
        id: "srv1",
        date: "2026-10-10",
        account_id: "acc_bank",
        amount: 10,
        type: "inflow",
        description: "Sunucu satir",
        source: "bank_sync",
        match_status: matched,
      }],
      total: 2,
      page: 1,
      page_size: 50,
      has_more: true,
      period_inflow: 1500.5,
      period_outflow: 25,
      focus_page: null,
    };
  }
  return {
    items: [{
      id: "srv2",
      date: "2026-10-09",
      account_id: "acc_bank",
      amount: 5,
      type: "outflow",
      description: "Ikinci sayfa",
      source: "manual",
    }],
    total: 2,
    page: 2,
    page_size: 50,
    has_more: false,
    period_inflow: 1500.5,
    period_outflow: 25,
    focus_page: null,
  };
}

let host;
let root;
let quiet;
let latestIo;

beforeAll(() => {
  global.IntersectionObserver = class {
    constructor(cb) {
      this.cb = cb;
      latestIo = this;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function txCalls() {
  return axios.get.mock.calls.filter((c) => /\/banking\/accounts\/[^/]+\/transactions/.test(String(c[0])));
}

beforeEach(() => {
  localStorage.removeItem(BANK_TX_PAGING_STORAGE_KEY);
  globalThis.__bankSearch = "";
  globalThis.__bankMatched = false;
  latestIo = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url, config) => {
    const u = String(url);
    if (/\/banking\/accounts\/[^/]+\/transactions/.test(u)) {
      const accountId = u.split("/banking/accounts/")[1].split("/")[0];
      const page = Number(config?.params?.page || 1);
      return Promise.resolve({ data: pageBody(page, accountId) });
    }
    if (u.includes("/banking/accounts")) return Promise.resolve({ data: [ACC_BANK, ACC_CASH] });
    if (u.includes("/banking/partners/summary")) {
      return Promise.resolve({
        data: { partner_count: 1, total_cash_in: 1000, total_cash_out: 200, total_card_pocket: 800 },
      });
    }
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  localStorage.removeItem(BANK_TX_PAGING_STORAGE_KEY);
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

async function openAccount(group, id) {
  const g = host.querySelector(`[data-testid="account-group-${group}"]`);
  expect(g).toBeTruthy();
  await act(async () => { g.click(); });
  await flush(2);
  const card = host.querySelector(`[data-testid="bank-card-${id}"]`);
  expect(card).toBeTruthy();
  await act(async () => { card.click(); });
  await flush(8);
}

test("flag kapalıyken yeni uç çağrılmaz", async () => {
  await renderPage();
  await openAccount("bank", "acc_bank");
  expect(txCalls()).toHaveLength(0);
  const summary = host.querySelector('[data-testid="account-tx-summary"]');
  expect(summary?.textContent || "").toMatch(/100[.,]00/);
  expect(host.textContent).toContain("Test");
});

test("flag açıkken sayfa ister, kaydırınca sayfa 2 gelir, toplam sunucudadır", async () => {
  localStorage.setItem(BANK_TX_PAGING_STORAGE_KEY, "1");
  await renderPage();
  expect(txCalls()).toHaveLength(0);
  await openAccount("bank", "acc_bank");
  await waitFor(() => host.textContent?.includes("Sunucu satir"));
  const first = txCalls();
  expect(first).toHaveLength(1);
  expect(String(first[0][0])).toContain("/banking/accounts/acc_bank/transactions");
  expect(first[0][1].params.page).toBe(1);
  expect(first[0][1].params.page_size).toBe(50);
  const summary = host.querySelector('[data-testid="account-tx-summary"]');
  expect(summary.textContent).toMatch(/1[.,]500[.,]50/);
  expect(summary.textContent).toMatch(/25[.,]00/);
  expect(summary.textContent).not.toMatch(/100[.,]00/);
  expect(host.textContent).not.toContain("Ikinci sayfa");

  await act(async () => { latestIo.cb([{ isIntersecting: true }]); });
  await flush(8);
  await waitFor(() => host.textContent?.includes("Ikinci sayfa"));
  const pages = txCalls().map((c) => c[1].params.page);
  expect(pages).toEqual([1, 2]);
  expect(host.textContent).toContain("Sunucu satir");
});

test("hesap değişince istek sayfa 1'e döner", async () => {
  localStorage.setItem(BANK_TX_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await openAccount("bank", "acc_bank");
  await waitFor(() => host.textContent?.includes("Sunucu satir"));
  await act(async () => { latestIo.cb([{ isIntersecting: true }]); });
  await flush(6);
  await openAccount("cash_box", "acc_cash");
  await waitFor(() => host.textContent?.includes("Kasa satiri"));
  const cash = txCalls().filter((c) => String(c[0]).includes("acc_cash"));
  expect(cash.length).toBeGreaterThan(0);
  expect(cash[0][1].params.page).toBe(1);
  expect(host.textContent).not.toContain("Sunucu satir");
});

test("cash olayı görünür sayfayı bir kez yeniler", async () => {
  localStorage.setItem(BANK_TX_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await openAccount("bank", "acc_bank");
  await waitFor(() => host.textContent?.includes("Sunucu satir"));
  const before = txCalls().length;
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, {
        detail: { companyId: "c1", scopes: ["cash"], at: Date.now() },
      }));
    }
  });
  expect(txCalls().length).toBe(before);
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
  await flush(8);
  expect(txCalls().length).toBe(before + 1);
  expect(txCalls().at(-1)[1].params.page).toBe(1);
});

test("eşleşen satır listede kalır", async () => {
  localStorage.setItem(BANK_TX_PAGING_STORAGE_KEY, "1");
  await renderPage();
  await openAccount("bank", "acc_bank");
  await waitFor(() => host.querySelector('[data-testid="tx-row-srv1"]'));
  const btn = host.querySelector('[data-testid="tx-match-srv1"]');
  expect(btn).toBeTruthy();
  await act(async () => { btn.click(); });
  await flush(8);
  expect(host.querySelector('[data-testid="tx-row-srv1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tx-matched-srv1"]')).toBeTruthy();
});

test("focus_tx_id odak sayfasını açar", async () => {
  localStorage.setItem(BANK_TX_PAGING_STORAGE_KEY, "1");
  globalThis.__bankSearch = "account_id=acc_bank&tx=srv-focus";
  await renderPage();
  await waitFor(() => host.textContent?.includes("Odak hareket"));
  const calls = txCalls();
  expect(calls.length).toBeGreaterThanOrEqual(2);
  expect(calls[0][1].params.focus_tx_id).toBe("srv-focus");
  expect(calls[0][1].params.page).toBe(1);
  expect(calls[1][1].params.page).toBe(2);
  expect(host.querySelector('[data-testid="tx-row-srv-focus"]')).toBeTruthy();
});
