/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import BankingPage from "./BankingPage";

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
    {
      id: "tx_done",
      date: "2026-10-11",
      account_id: "acc_bank",
      account_name: "Vadesiz",
      amount: 50,
      type: "outflow",
      description: "Eşleşen hareket",
      source: "bank_sync",
      match_status: "matched",
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
jest.mock("../components/CardStatementImport", () => ({ CardStatementImport: () => null }));
jest.mock("../components/CashApprovalsBanner", () => ({ CashApprovalsBanner: () => null }));
jest.mock("../components/AccountStatementPrint", () => ({ AccountStatementPrint: () => null }));
jest.mock("../components/SearchSelect", () => ({ SearchSelect: () => null }));
jest.mock("../components/VirmanPartySelect", () => ({
  VirmanPartySelect: ({ value, testId }) => <div data-testid={testId}>{value || ""}</div>,
}));
jest.mock("../hooks/useInfiniteRows", () => ({
  useInfiniteRows: (rows) => ({ visible: rows || [], hasMore: false, sentinelRef: { current: null } }),
}));

const ACC_BANK = {
  id: "acc_bank",
  type: "bank",
  bank_name: "Kuveyt Türk",
  account_name: "Vadesiz TL Uzun Hesap Adı",
  current_balance: 6716.58,
  unmatched_count: 12,
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
    if (u.includes("/banking/accounts")) return Promise.resolve({ data: [ACC_BANK, ACC_CASH] });
    if (u.includes("/banking/partners/summary")) {
      return Promise.resolve({ data: { partner_count: 0, total_cash_net: 0 } });
    }
    return Promise.resolve({ data: [] });
  });
  axios.post.mockImplementation(async () => ({ data: {} }));
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

function headerLabels() {
  return [...host.querySelectorAll("thead th")].map((th) => th.textContent.trim());
}

const REM_PX = 16;
const TABLE_PX = 590;

function fixedRemSum() {
  return [...host.querySelectorAll('[data-testid="bank-tx-table-wrap"] colgroup col')]
    .map((col) => String(col.style.width || ""))
    .filter((width) => width.endsWith("rem"))
    .reduce((sum, width) => sum + Number.parseFloat(width), 0);
}

function descriptionRoomPx() {
  return TABLE_PX - fixedRemSum() * REM_PX;
}

function remWidths() {
  return [...host.querySelectorAll('[data-testid="bank-tx-table-wrap"] colgroup col')]
    .map((col) => String(col.style.width || ""))
    .filter((width) => width.endsWith("rem"))
    .map((width) => Number.parseFloat(width));
}

function amountCell(txId) {
  const row = host.querySelector(`[data-testid="tx-row-${txId}"]`);
  const cells = [...row.querySelectorAll("td")];
  return cells[cells.length - 2];
}

async function renderPage() {
  root = createRoot(host);
  await act(async () => { root.render(<BankingPage />); });
  await waitFor(() => host.textContent?.includes("Kuveyt"));
  await flush(4);
}

async function openBankAccount() {
  await act(async () => { host.querySelector('[data-testid="account-group-bank"]').click(); });
  await flush(2);
  await act(async () => { host.querySelector('[data-testid="bank-card-acc_bank"]').click(); });
  await flush(4);
}

test("hesap seçiliyken Hesap sütunu gizlenir ve İşlem eşleştirme düğmeleri görünür", async () => {
  await renderPage();
  expect(headerLabels()).toContain("Hesap");
  expect(descriptionRoomPx()).toBeGreaterThanOrEqual(160);
  expect(remWidths()[0]).toBeGreaterThanOrEqual(5.25);
  expect(remWidths()[remWidths().length - 2]).toBeGreaterThanOrEqual(6.25);
  const tumuAmount = amountCell("tx_open");
  expect(tumuAmount.getAttribute("title")).toBe(tumuAmount.textContent.trim());
  expect(tumuAmount.className).toContain("overflow-hidden");
  expect(host.querySelector('[data-testid="tx-filter-unmatched"]').textContent).toBe("Eşleşmemiş (1)");

  await openBankAccount();

  const headers = headerLabels();
  expect(headers).not.toContain("Hesap");
  expect(headers).toContain("İşlem");
  expect(host.querySelector('[data-testid="tx-match-btn-tx_open"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tx-match-btn-tx_open"]').textContent).toBe("Eşleştir");
  expect(host.querySelector('[data-testid="tx-rematch-btn-tx_done"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tx-rematch-btn-tx_done"]').textContent).toBe("Değiştir");
  expect(host.querySelector('[data-testid="tx-unmatch-btn-tx_done"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tx-unmatch-btn-tx_done"]').textContent).toBe("Kaldır");

  const actionTh = [...host.querySelectorAll("thead th")].find((th) => th.textContent.trim() === "İşlem");
  expect(actionTh.className).toContain("sticky");
  expect(actionTh.className).toContain("right-0");
  expect(actionTh.className).toContain("whitespace-nowrap");
  expect(actionTh.className).toContain("bg-slate-50");
  expect(descriptionRoomPx()).toBeGreaterThanOrEqual(200);
  const cols = [...host.querySelectorAll('[data-testid="bank-tx-table-wrap"] colgroup col')];
  expect(Number.parseFloat(cols[0].style.width)).toBeGreaterThanOrEqual(5.25);
  expect(remWidths()[remWidths().length - 2]).toBeGreaterThanOrEqual(6.25);
  expect(cols[cols.length - 1].style.width).toBe("8.25rem");
  const selectedAmount = amountCell("tx_open");
  expect(selectedAmount.getAttribute("title")).toBe(selectedAmount.textContent.trim());
  expect(selectedAmount.className).toContain("overflow-hidden");
  const userTh = [...host.querySelectorAll("thead th")].find((th) => th.textContent.trim() === "Kullanıcı");
  expect(userTh.className).toContain("hidden");
  expect(userTh.className).toContain("xl:table-cell");
  expect(host.querySelector('[data-testid="tx-filter-unmatched"]').textContent).toBe("Eşleşmemiş (12)");
  expect(host.querySelector('[data-testid="account-kpi-unmatched-value"]').textContent).toBe("12");
  expect(host.querySelector('[data-testid="account-detail-subtitle"]').textContent).not.toContain("IBAN");
  const table = host.querySelector('[data-testid="bank-tx-table-wrap"] table');
  expect(table.className).toContain("table-fixed");
  expect(table.className).not.toContain("min-w-[");
  const wrap = host.querySelector('[data-testid="bank-tx-table-wrap"]');
  expect(wrap.className).toContain("max-md:overflow-x-auto");
  expect(wrap.className).not.toContain("md:block overflow-x-auto");

  const name = host.querySelector('[data-testid="bank-card-acc_bank"] .line-clamp-2');
  expect(name).toBeTruthy();
  expect(name.getAttribute("title")).toBe("Kuveyt Türk · Vadesiz TL Uzun Hesap Adı");
  expect(host.querySelector('[data-testid="tx-row-tx_open"] [data-testid="tx-match-btn-tx_open"]')).toBeTruthy();
});

test("kasa hesabında IBAN satırı yok ve virman hedefi kaynakla aynı kalmaz", async () => {
  await renderPage();
  await act(async () => { host.querySelector('[data-testid="virman-modal-btn"]').click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="virman-source"]').textContent).toBe("acc_bank");
  expect(host.querySelector('[data-testid="virman-target"]').textContent).toBe("acc_cash");
  const cancel = [...host.querySelectorAll("button")].find((btn) => btn.textContent.trim() === "İptal");
  await act(async () => { cancel.click(); });
  await flush(1);

  await act(async () => { host.querySelector('[data-testid="account-group-cash_box"]').click(); });
  await flush(2);
  await act(async () => { host.querySelector('[data-testid="bank-card-acc_cash"]').click(); });
  await flush(4);
  expect(host.querySelector('[data-testid="account-detail-subtitle"]').textContent).not.toContain("IBAN");
  expect(host.querySelector('[data-testid="account-detail-subtitle"]').textContent).toContain("Kasa");

  await act(async () => { host.querySelector('[data-testid="account-detail-virman"]').click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="virman-source"]').textContent).toBe("acc_cash");
  expect(host.querySelector('[data-testid="virman-target"]').textContent).toBe("acc_bank");
  expect(host.querySelector('[data-testid="virman-target"]').textContent)
    .not.toBe(host.querySelector('[data-testid="virman-source"]').textContent);
});
