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
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({
    activeCompany: { id: "c1" },
    addonOn: () => true,
    can: (path, action) => path === "/banking" && action === "edit",
  }),
}));
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}), { virtual: true });
jest.mock("../utils/dataSync", () => {
  const txs = [
    {
      id: "tx_open",
      date: "2026-10-10",
      account_id: "acc_bank",
      account_name: "Vadesiz",
      amount: 100,
      type: "inflow",
      description: "Açık hareket",
      source: "bank_sync",
      match_status: "unmatched",
    },
  ];
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
jest.mock("../components/CardStatementImport", () => ({
  CardStatementImport: ({ account }) => <div data-testid="stmt-import-open">{account?.id}</div>,
}));
jest.mock("../components/CashApprovalsBanner", () => ({ CashApprovalsBanner: () => null }));
jest.mock("../components/AccountStatementPrint", () => ({ AccountStatementPrint: () => null }));
jest.mock("../components/SearchSelect", () => ({ SearchSelect: () => null }));
jest.mock("../components/VirmanPartySelect", () => ({ VirmanPartySelect: () => null }));
jest.mock("../components/TxRowMenu", () => ({ TxRowMenu: () => null }));
jest.mock("../hooks/useInfiniteRows", () => ({
  useInfiniteRows: (rows) => ({ visible: rows || [], hasMore: false, sentinelRef: { current: null } }),
}));

const ACC_BANK = {
  id: "acc_bank",
  type: "bank",
  bank_name: "Kuveyt Türk",
  account_name: "Vadesiz",
  current_balance: 6716.58,
  unmatched_count: 12,
};
const ACC_LOCKED = {
  id: "acc_locked",
  type: "bank",
  bank_name: "Enpara",
  account_name: "Entegre",
  current_balance: 100,
  is_integrated: true,
  integration_provider: "enpara",
  integration_status: "connected",
  unmatched_count: 0,
};
const ACC_CASH = {
  id: "acc_cash",
  type: "cash_box",
  bank_name: "Merkez",
  account_name: "Kasa",
  current_balance: 80,
};

let host;
let root;
let quiet;
let confirmSpy;

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
  confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/accounts")) return Promise.resolve({ data: [ACC_BANK, ACC_LOCKED, ACC_CASH] });
    if (u.includes("/banking/partners/summary")) return Promise.resolve({ data: { partner_count: 0, total_cash_net: 0 } });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockImplementation(async () => ({ data: {} }));
  axios.delete.mockImplementation(async () => ({ data: { message: "silindi" } }));
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  confirmSpy.mockRestore();
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

async function click(selector) {
  const node = host.querySelector(selector);
  expect(node).toBeTruthy();
  await act(async () => { node.click(); });
  await flush(2);
}

test("grup sekmesi yalnız o grubun çiplerini gösterir, Tümü seçimi sıfırlar", async () => {
  await renderPage();
  expect(host.querySelector('[data-testid="clear-group-btn"]').textContent).toBe("Tümü");
  expect(host.querySelector('[data-testid="clear-group-btn"]').className).toMatch(/bg-slate-900/);
  expect(host.querySelector('[data-testid="bank-card-acc_bank"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="bank-card-acc_cash"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="account-group-members-bank"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="account-group-members-cash_box"]')).toBeTruthy();

  const bankTab = host.querySelector('[data-testid="account-group-bank"]');
  const bankTotal = formatTrAmount(6716.58 + 100);
  expect(bankTab.textContent.replace(/\s/g, "")).toContain(`Banka·2·${bankTotal.replace(/\s/g, "")}`);
  expect(host.querySelector('[data-testid="summary-bank"]').textContent.replace(/\s/g, "")).toContain(bankTotal.replace(/\s/g, ""));

  await click('[data-testid="account-group-bank"]');
  expect(host.querySelector('[data-testid="account-group-bank"]').className).toMatch(/bg-slate-900/);
  expect(host.querySelector('[data-testid="clear-group-btn"]').className).not.toMatch(/bg-slate-900/);
  expect(host.querySelector('[data-testid="account-group-members-bank"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="bank-card-acc_bank"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="bank-card-acc_locked"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="account-group-members-cash_box"]')).toBeNull();
  expect(host.querySelector('[data-testid="bank-card-acc_cash"]')).toBeNull();

  await click('[data-testid="bank-card-acc_bank"]');
  expect(host.querySelector('[data-testid="bank-account-detail-header"]')).toBeTruthy();

  await click('[data-testid="clear-group-btn"]');
  expect(host.querySelector('[data-testid="bank-account-detail-header"]')).toBeNull();
  expect(host.querySelector('[data-testid="clear-group-btn"]').className).toMatch(/bg-slate-900/);
  expect(host.querySelector('[data-testid="account-group-bank"]').className).not.toMatch(/bg-slate-900/);
  expect(host.querySelector('[data-testid="bank-card-acc_bank"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="bank-card-acc_cash"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="account-group-members-cash_box"]')).toBeTruthy();
});

test("çip BankAccountDetailHeader açar ve eşleşmemiş sayısı sunucu değeridir", async () => {
  await renderPage();
  expect(host.querySelector('[data-testid="tx-filter-unmatched"]').textContent).toBe("Eşleşmemiş (1)");
  await click('[data-testid="bank-card-acc_bank"]');
  expect(host.querySelector('[data-testid="bank-account-detail-header"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="account-kpi-unmatched-value"]').textContent).toBe("12");
  expect(host.querySelector('[data-testid="tx-filter-unmatched"]').textContent).toBe("Eşleşmemiş (12)");
  expect(host.querySelector('[data-testid="account-unmatched-acc_bank"]').textContent).toContain("12 eşleşmemiş");
  const balance = host.querySelector('[data-testid="account-balance-acc_bank"]');
  expect(balance.className).toContain("tabular-nums");
  expect(balance.textContent).toContain(formatTrAmount(6716.58));
});

test("çip menüsünden düzenle, sil, açılış bakiyesi ve ekstre erişilir", async () => {
  await renderPage();
  await click('[data-testid="account-card-menu-acc_bank"]');
  const edit = host.querySelector('[data-testid="edit-account-acc_bank"]');
  const remove = host.querySelector('[data-testid="delete-account-acc_bank"]');
  const opening = host.querySelector('[data-testid="add-opening-balance-acc_bank"]');
  const statement = host.querySelector('[data-testid="bank-stmt-btn-acc_bank"]');
  expect(edit?.textContent).toContain("Düzenle");
  expect(remove?.disabled).toBe(false);
  expect(opening?.textContent).toContain("Açılış/Devir bakiyesi ekle");
  expect(statement?.textContent).toContain("Hareket Yükle (AI)");

  await act(async () => { edit.click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="add-account-modal"]').textContent).toContain("Hesabı Düzelt");
  expect(host.querySelector('[data-testid="account-name-input"]').value).toBe("Vadesiz");
  const cancel = [...host.querySelector('[data-testid="add-account-modal"]').querySelectorAll("button")]
    .find((btn) => btn.textContent.trim() === "İptal");
  await act(async () => { cancel.click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="add-account-modal"]')).toBeNull();

  await click('[data-testid="account-card-menu-acc_bank"]');
  await act(async () => { host.querySelector('[data-testid="add-opening-balance-acc_bank"]').click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="opening-balance-modal"]')).toBeTruthy();
  await act(async () => { host.querySelector('[data-testid="opening-balance-cancel"]').click(); });
  await flush(2);

  await click('[data-testid="account-card-menu-acc_bank"]');
  await act(async () => { host.querySelector('[data-testid="delete-account-acc_bank"]').click(); });
  await flush(1);
  expect(confirmSpy).toHaveBeenCalled();
  confirmSpy.mockClear();

  await click('[data-testid="account-card-menu-acc_bank"]');
  await act(async () => { host.querySelector('[data-testid="bank-stmt-btn-acc_bank"]').click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="stmt-import-open"]').textContent).toBe("acc_bank");

  await click('[data-testid="account-card-menu-acc_locked"]');
  const lockedDelete = host.querySelector('[data-testid="delete-account-acc_locked"]');
  expect(lockedDelete.disabled).toBe(true);
  expect(lockedDelete.getAttribute("title")).toBe("Entegre hesap silinemez");
  await act(async () => { lockedDelete.click(); });
  await flush(1);
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="integrated-badge-acc_locked"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="group-integrated-acc_locked"]')).toBeTruthy();
});

test("detay başlığı menüsü düzenle, açılış ve sil aksiyonlarını açar", async () => {
  await renderPage();
  await click('[data-testid="bank-card-acc_bank"]');
  await click('[data-testid="account-detail-menu"]');
  const panel = host.querySelector('[data-testid="account-detail-menu-panel"]');
  expect(panel.hidden).toBe(false);
  expect(host.querySelector('[data-testid="account-detail-edit"]').textContent).toContain("Düzenle");
  expect(host.querySelector('[data-testid="account-detail-opening"]').textContent).toContain("Açılış/Devir bakiyesi ekle");
  expect(host.querySelector('[data-testid="account-detail-delete"]').disabled).toBe(false);

  await act(async () => { host.querySelector('[data-testid="account-detail-edit"]').click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="add-account-modal"]').textContent).toContain("Hesabı Düzelt");
  expect(host.querySelector('[data-testid="account-name-input"]').value).toBe("Vadesiz");

  await click('[data-testid="bank-card-acc_locked"]');
  await click('[data-testid="account-detail-menu"]');
  const locked = host.querySelector('[data-testid="account-detail-delete"]');
  expect(host.querySelector('[data-testid="account-detail-menu-panel"]').hidden).toBe(false);
  expect(locked.disabled).toBe(true);
  expect(locked.getAttribute("title")).toBe("Entegre hesap silinemez");
  await act(async () => { locked.click(); });
  expect(confirmSpy).not.toHaveBeenCalled();
});
