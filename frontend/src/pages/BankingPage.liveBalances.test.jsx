/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import BankingPage from "./BankingPage";
import { DATA_CHANGED_EVENT } from "../utils/dataRefresh";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
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
  TxRowMenu: ({ onChanged }) => (
    <button type="button" data-testid="tx-bump-btn" onClick={() => onChanged?.()}>bump</button>
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

let host;
let root;
let quiet;
let accountsPayload;

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
  accountsPayload = [ACC_BANK, ACC_CASH];
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/accounts")) return Promise.resolve({ data: accountsPayload });
    if (u.includes("/banking/partners/summary")) {
      return Promise.resolve({
        data: {
          partner_count: 2,
          total_cash_in: 1000,
          total_cash_out: 200,
          total_card_pocket: 800,
          total_cash_net: 800,
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
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
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

async function renderPage() {
  root = createRoot(host);
  await act(async () => {
    root.render(<BankingPage />);
  });
  await waitFor(() => host.textContent?.includes("Kuveyt"));
  await flush(4);
}

test("account-groups-grid bakiyeleri cash olayında güncellenir", async () => {
  await renderPage();
  const grid = host.querySelector('[data-testid="account-groups-grid"]');
  expect(grid).toBeTruthy();
  expect(grid.textContent.replace(/\s/g, "")).toMatch(/6[.,]716[.,]58/);

  accountsPayload = [
    { ...ACC_BANK, current_balance: 7716.58 },
    { ...ACC_CASH, current_balance: 500 },
  ];

  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(DATA_CHANGED_EVENT, {
        detail: { companyId: "c1", scopes: ["cash"], at: Date.now() },
      }),
    );
  });
  await flush(10);

  expect(grid.textContent.replace(/\s/g, "")).toMatch(/7[.,]716[.,]58/);
  expect(grid.textContent.replace(/\s/g, "")).toMatch(/500[.,]00/);
});

test("hareket bumpCashData sonrası grup bakiyeleri yenilenir", async () => {
  await renderPage();
  const grid = host.querySelector('[data-testid="account-groups-grid"]');
  expect(grid.textContent.replace(/\s/g, "")).toMatch(/6[.,]716[.,]58/);

  accountsPayload = [
    { ...ACC_BANK, current_balance: 6216.58 },
    { ...ACC_CASH, current_balance: 500 },
  ];

  const bump = host.querySelector('[data-testid="tx-bump-btn"]');
  expect(bump).toBeTruthy();
  await act(async () => { bump.click(); });
  await flush(10);

  expect(grid.textContent.replace(/\s/g, "")).toMatch(/6[.,]216[.,]58/);
  expect(grid.textContent.replace(/\s/g, "")).toMatch(/500[.,]00/);
});
