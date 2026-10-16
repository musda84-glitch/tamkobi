/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { PartnersPanel } from "./PartnersPanel";
import { PARTNER_TX_PAGING_STORAGE_KEY } from "../utils/featureFlags";
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
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("./CashApprovalsBanner", () => ({ CashApprovalsBanner: () => null }));
jest.mock("./PaymentTargetSelect", () => ({ PaymentTargetSelect: () => null }));
jest.mock("./VirmanPartySelect", () => ({ VirmanPartySelect: () => null }));

const PARTNER = {
  id: "p1",
  name: "Ali",
  share_percent: 50,
  balance: 100,
  monthly_salary: 0,
  is_active: true,
};

const LEDGER = {
  girisDisplay: 1500.5,
  cikisDisplay: 25,
  ledger: 1475.5,
  stored: 1475.5,
  drift: false,
  netMatchesCard: true,
  count: 2,
  cashIn: 1500.5,
  cashOut: 25,
  inflow: 1500.5,
  outflow: 25,
  netDisplay: 1475.5,
  cardDisplay: 1475.5,
  cardPocket: 1475.5,
};

function allPageBody(page) {
  if (page === 1) {
    return {
      items: [{
        id: "all1",
        partner_id: "p1",
        partner_name: "Ali",
        date: "2026-10-12",
        created_at: "2026-10-12T12:00:00Z",
        type: "capital_in",
        amount: 20,
        description: "Tum ortaklar satir",
        balance_delta: 20,
        side: "giris",
      }],
      total: 2,
      page: 1,
      page_size: 50,
      has_more: true,
      period_in: 20,
      period_out: 0,
      ledger: LEDGER,
    };
  }
  return {
    items: [{
      id: "all2",
      partner_id: "p1",
      partner_name: "Ali",
      date: "2026-10-11",
      created_at: "2026-10-11T12:00:00Z",
      type: "withdrawal",
      amount: 4,
      description: "Tum ortaklar ikinci",
      balance_delta: -4,
      side: "cikis",
    }],
    total: 2,
    page: 2,
    page_size: 50,
    has_more: false,
    period_in: 20,
    period_out: 4,
    ledger: LEDGER,
  };
}

function pageBody(page) {
  if (page === 1) {
    return {
      items: [{
        id: "srv1",
        partner_id: "p1",
        partner_name: "Ali",
        date: "2026-10-10",
        created_at: "2026-10-10T12:00:00Z",
        type: "capital_in",
        amount: 10,
        description: "Sunucu satir",
        balance_delta: 10,
        side: "giris",
      }],
      total: 2,
      page: 1,
      page_size: 50,
      has_more: true,
      period_in: 1500.5,
      period_out: 25,
      ledger: LEDGER,
    };
  }
  return {
    items: [{
      id: "srv2",
      partner_id: "p1",
      partner_name: "Ali",
      date: "2026-10-09",
      created_at: "2026-10-09T12:00:00Z",
      type: "withdrawal",
      amount: 5,
      description: "Ikinci sayfa",
      balance_delta: -5,
      side: "cikis",
    }],
    total: 2,
    page: 2,
    page_size: 50,
    has_more: false,
    period_in: 1500.5,
    period_out: 25,
    ledger: LEDGER,
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

function pageCalls() {
  return axios.get.mock.calls.filter((c) => /\/banking\/partners\/[^/?]+\/transactions/.test(String(c[0])));
}

function allPageCalls() {
  return axios.get.mock.calls.filter((c) => String(c[0]).includes("/banking/partners/transactions/page"));
}

function bulkCalls() {
  return axios.get.mock.calls.filter((c) => /\/banking\/partners\/transactions(\?|$)/.test(String(c[0])));
}

function ledgerCalls() {
  return axios.get.mock.calls.filter((c) => String(c[0]).includes("/banking/partners/ledgers"));
}

function accrueCalls() {
  return axios.post.mock.calls.filter((c) => String(c[0]).includes("/banking/partners/accrue-salary"));
}

beforeEach(() => {
  localStorage.removeItem(PARTNER_TX_PAGING_STORAGE_KEY);
  latestIo = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockImplementation((url, config) => {
    const u = String(url);
    if (u.includes("/banking/partners/transactions/page")) {
      const page = Number(config?.params?.page || 1);
      return Promise.resolve({ data: allPageBody(page) });
    }
    if (/\/banking\/partners\/[^/?]+\/transactions/.test(u)) {
      const page = Number(config?.params?.page || 1);
      return Promise.resolve({ data: pageBody(page) });
    }
    if (u.includes("/banking/partners/ledgers")) {
      return Promise.resolve({ data: { p1: LEDGER } });
    }
    if (u.includes("/banking/partners/summary")) {
      return Promise.resolve({
        data: { partner_count: 1, total_cash_in: 100, total_cash_out: 40, total_card_pocket: 60, total_share_percent: 50 },
      });
    }
    if (u.includes("/banking/partners/transactions")) {
      return Promise.resolve({
        data: [{
          id: "old1",
          partner_id: "p1",
          partner_name: "Ali",
          date: "2026-10-10",
          created_at: "2026-10-10T00:00:00Z",
          type: "capital_in",
          amount: 100,
          description: "Eski satir",
        }],
      });
    }
    if (u.includes("/banking/partners")) return Promise.resolve({ data: [PARTNER] });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockImplementation(async () => ({ data: { posted_count: 0 } }));
});

afterEach(() => {
  localStorage.removeItem(PARTNER_TX_PAGING_STORAGE_KEY);
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

async function renderPanel() {
  root = createRoot(host);
  await act(async () => { root.render(<PartnersPanel companyId="c1" accounts={[]} />); });
  await waitFor(() => host.textContent?.includes("Ali"));
  await flush(4);
}

test("flag kapalıyken yeni uçlar çağrılmaz ve accrue yalnız mount'ta bir kez", async () => {
  await renderPanel();
  expect(pageCalls()).toHaveLength(0);
  expect(allPageCalls()).toHaveLength(0);
  expect(ledgerCalls()).toHaveLength(0);
  expect(bulkCalls()).toHaveLength(1);
  expect(accrueCalls()).toHaveLength(1);
  expect(host.textContent).toContain("Eski satir");
  const giris = host.querySelector('[data-testid="partner-card-giris-p1"]');
  expect(giris?.textContent || "").toMatch(/100[.,]00/);

  const beforeBulk = bulkCalls().length;
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, {
        detail: { companyId: "c1", scopes: ["cash"], at: Date.now() },
      }));
    }
  });
  expect(bulkCalls().length).toBe(beforeBulk);
  expect(accrueCalls()).toHaveLength(1);
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
  await flush(8);
  expect(bulkCalls().length).toBe(beforeBulk + 1);
  expect(pageCalls()).toHaveLength(0);
  expect(allPageCalls()).toHaveLength(0);
  expect(ledgerCalls()).toHaveLength(0);
  expect(accrueCalls()).toHaveLength(1);
});

test("flag açıkken sayfa ister, kaydırınca sayfa 2 gelir, değerler sunucudadır", async () => {
  localStorage.setItem(PARTNER_TX_PAGING_STORAGE_KEY, "1");
  await renderPanel();
  expect(bulkCalls()).toHaveLength(0);
  expect(ledgerCalls()).toHaveLength(1);
  expect(pageCalls()).toHaveLength(0);
  expect(accrueCalls()).toHaveLength(1);
  const giris = host.querySelector('[data-testid="partner-card-giris-p1"]');
  expect(giris.textContent).toMatch(/1[.,]500[.,]50/);
  expect(host.querySelector('[data-testid="partner-card-cikis-p1"]').textContent).toMatch(/25[.,]00/);
  expect(host.textContent).not.toContain("Eski satir");

  const card = host.querySelector('[data-testid="partner-card-Ali"]');
  await act(async () => { card.click(); });
  await flush(8);
  await waitFor(() => host.textContent?.includes("Sunucu satir") && latestIo);
  const first = pageCalls();
  expect(first).toHaveLength(1);
  expect(String(first[0][0])).toContain("/banking/partners/p1/transactions");
  expect(first[0][1].params.page).toBe(1);
  expect(first[0][1].params.page_size).toBe(50);
  expect(host.textContent).not.toContain("Ikinci sayfa");

  await act(async () => { latestIo.cb([{ isIntersecting: true }]); });
  await flush(8);
  await waitFor(() => host.textContent?.includes("Ikinci sayfa"));
  const pages = pageCalls().map((c) => c[1].params.page);
  expect(pages).toEqual([1, 2]);
  expect(host.textContent).toContain("Sunucu satir");
  expect(bulkCalls()).toHaveLength(0);
  expect(accrueCalls()).toHaveLength(1);
});

test("flag açıkken 5 cash olayı tek yenileme yapar ve accrue tekrarlamaz", async () => {
  localStorage.setItem(PARTNER_TX_PAGING_STORAGE_KEY, "1");
  await renderPanel();
  const card = host.querySelector('[data-testid="partner-card-Ali"]');
  await act(async () => { card.click(); });
  await flush(8);
  await waitFor(() => host.textContent?.includes("Sunucu satir"));
  const beforeLedgers = ledgerCalls().length;
  const beforePages = pageCalls().length;
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, {
        detail: { companyId: "c1", scopes: ["cash"], at: Date.now() },
      }));
    }
  });
  expect(ledgerCalls().length).toBe(beforeLedgers);
  expect(pageCalls().length).toBe(beforePages);
  expect(accrueCalls()).toHaveLength(1);
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
  await flush(8);
  expect(ledgerCalls().length).toBe(beforeLedgers + 1);
  expect(pageCalls().length).toBe(beforePages + 1);
  expect(pageCalls().at(-1)[1].params.page).toBe(1);
  expect(bulkCalls()).toHaveLength(0);
  expect(accrueCalls()).toHaveLength(1);
});

test("flag açık ve seçim yokken tüm ortaklar ucu satır getirir, seçim uç değiştirir", async () => {
  localStorage.setItem(PARTNER_TX_PAGING_STORAGE_KEY, "1");
  await renderPanel();
  await waitFor(() => host.textContent?.includes("Tum ortaklar satir") && latestIo);
  await flush(4);
  expect(host.textContent).not.toContain("Hareket yok.");
  expect(host.textContent).toContain("Tum ortaklar satir");
  expect(bulkCalls()).toHaveLength(0);
  expect(pageCalls()).toHaveLength(0);
  const firstAll = allPageCalls();
  expect(firstAll.length).toBeGreaterThan(0);
  expect(String(firstAll[0][0])).toContain("/banking/partners/transactions/page");
  expect(firstAll[0][1].params.page).toBe(1);
  expect(firstAll[0][1].params.page_size).toBe(50);
  expect(firstAll[0][1].params.company_id).toBe("c1");
  expect(host.textContent).not.toContain("Tum ortaklar ikinci");

  await act(async () => { latestIo.cb([{ isIntersecting: true }]); });
  await flush(8);
  await waitFor(() => host.textContent?.includes("Tum ortaklar ikinci"));
  const allPages = allPageCalls().map((c) => c[1].params.page);
  expect(allPages).toContain(2);
  expect(pageCalls()).toHaveLength(0);

  const beforeSingle = pageCalls().length;
  const beforeAll = allPageCalls().length;
  const card = host.querySelector('[data-testid="partner-card-Ali"]');
  await act(async () => { card.click(); });
  await flush(8);
  await waitFor(() => host.textContent?.includes("Sunucu satir"));
  expect(pageCalls().length).toBe(beforeSingle + 1);
  expect(String(pageCalls().at(-1)[0])).toContain("/banking/partners/p1/transactions");
  expect(pageCalls().at(-1)[1].params.page).toBe(1);
  expect(allPageCalls().length).toBe(beforeAll);
  expect(host.textContent).not.toContain("Tum ortaklar satir");
  expect(host.textContent).not.toContain("Hareket yok.");

  const beforeBack = allPageCalls().length;
  const clear = host.querySelector('[data-testid="partner-tx-clear-filter"]');
  await act(async () => { clear.click(); });
  await flush(8);
  await waitFor(() => host.textContent?.includes("Tum ortaklar satir"));
  expect(allPageCalls().length).toBe(beforeBack + 1);
  expect(String(allPageCalls().at(-1)[0])).toContain("/banking/partners/transactions/page");
  expect(allPageCalls().at(-1)[1].params.company_id).toBe("c1");
  expect(pageCalls().length).toBe(beforeSingle + 1);
  expect(host.textContent).not.toContain("Sunucu satir");
  expect(host.textContent).not.toContain("Hareket yok.");
  expect(bulkCalls()).toHaveLength(0);
  expect(accrueCalls()).toHaveLength(1);

  const beforeRefresh = allPageCalls().length;
  await act(async () => {
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, {
      detail: { companyId: "c1", scopes: ["cash"], at: Date.now() },
    }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
  await flush(8);
  expect(allPageCalls().length).toBe(beforeRefresh + 1);
  expect(String(allPageCalls().at(-1)[0])).toContain("/banking/partners/transactions/page");
  expect(allPageCalls().at(-1)[1].params.page).toBe(1);
  expect(pageCalls().length).toBe(beforeSingle + 1);
  expect(accrueCalls()).toHaveLength(1);
  expect(host.textContent).toContain("Tum ortaklar satir");
});
