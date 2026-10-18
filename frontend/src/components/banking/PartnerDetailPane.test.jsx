/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { PartnerDetailPane } from "./PartnerDetailPane";
import { PartnersPanel } from "../PartnersPanel";
import { partnerBalanceMeta } from "../../utils/partnerTx";
import { formatTrAmount } from "../../utils/money";

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
jest.mock("../../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../CashApprovalsBanner", () => ({ CashApprovalsBanner: () => null }));
jest.mock("../PaymentTargetSelect", () => ({
  PaymentTargetSelect: ({ value, testId }) => <div data-testid={testId}>{String(value || "")}</div>,
}));
jest.mock("../VirmanPartySelect", () => ({ VirmanPartySelect: () => null }));

const PARTNER = {
  id: "p1",
  name: "Ali",
  share_percent: 50,
  balance: 1200,
  monthly_salary: 0,
  is_active: true,
};

const SUMMARY = {
  partner_count: 1,
  total_share_percent: 50,
  total_cash_in: 10,
  total_capital_in: 999,
  total_cash_out: 4,
  total_withdrawn: 888,
  total_card_pocket: 1200,
};

const LEDGER = {
  girisDisplay: 10,
  cikisDisplay: 4,
  ledger: 1200,
  stored: 1200,
  drift: false,
  netMatchesCard: true,
  count: 1,
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.post.mockImplementation(async () => ({ data: {} }));
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/partners/transactions")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/partners/summary")) return Promise.resolve({ data: SUMMARY });
    if (u.includes("/banking/partners/ledgers")) return Promise.resolve({ data: { p1: LEDGER } });
    if (u.includes("/banking/accounts")) {
      return Promise.resolve({ data: [{ id: "cash1", type: "cash_box", account_name: "Kasa", current_balance: 10 }] });
    }
    if (u.includes("/banking/partners")) return Promise.resolve({ data: [PARTNER] });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
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
}

test("net etiketi borçlu ve alacaklı partnerBalanceMeta ile gelir", async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(<PartnerDetailPane partner={{ id: "p", name: "Ali", balance: 1200 }} ledger={LEDGER} />);
  });
  const debt = partnerBalanceMeta(1200);
  expect(host.querySelector('[data-testid="partner-detail-net"]').textContent).toContain(`Net · ${debt.label.toLocaleUpperCase("tr-TR")}`);
  expect(host.querySelector('[data-testid="partner-detail-net"]').textContent).toMatch(/BORÇLU|BORCLU/i);
  await act(async () => { root.unmount(); });
  root = createRoot(host);
  await act(async () => {
    root.render(<PartnerDetailPane partner={{ id: "p", name: "Veli", balance: -50 }} />);
  });
  const credit = partnerBalanceMeta(-50);
  expect(host.querySelector('[data-testid="partner-detail-net"]').textContent).toContain(`Net · ${credit.label.toLocaleUpperCase("tr-TR")}`);
  expect(host.querySelector('[data-testid="partner-detail-net"]').textContent).toMatch(/ALACAKLI/i);
});

test("seçili ortakta ledger check görünür, seçim yoksa Ortak seçin", async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(<PartnerDetailPane partner={null}><div data-testid="partner-tx-section">liste</div></PartnerDetailPane>);
  });
  expect(host.textContent).toContain("Ortak seçin");
  expect(host.querySelector('[data-testid="partner-ledger-check"]')).toBeNull();
  expect(host.querySelector('[data-testid="partner-tx-section"]')).toBeTruthy();
  await act(async () => { root.unmount(); });
  root = createRoot(host);
  await act(async () => {
    root.render(<PartnerDetailPane partner={PARTNER} ledger={LEDGER} />);
  });
  expect(host.textContent).not.toContain("Ortak seçin");
  expect(host.querySelector('[data-testid="partner-ledger-check"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="partner-ledger-buckets"]')).toBeTruthy();
});

test("Para Koy / Para Çek / Alacaklandır / Borçlandır doğru tiple tx modalını açar ve ortak seçili gelir", async () => {
  root = createRoot(host);
  await act(async () => { root.render(<PartnersPanel companyId="c1" accounts={[]} />); });
  await waitFor(() => host.textContent?.includes("Ali"));
  await flush(4);
  const net = host.querySelector('[data-testid="partner-summary-net"]');
  expect(net.textContent).toContain(`Net · ${partnerBalanceMeta(SUMMARY.total_card_pocket).label.toLocaleUpperCase("tr-TR")}`);
  expect(net.textContent).toContain(formatTrAmount(SUMMARY.total_card_pocket));
  expect(host.querySelector('[data-testid="partner-summary-capital"]').textContent).toContain(formatTrAmount(10));
  expect(host.querySelector('[data-testid="partner-summary-withdrawn"]').textContent).toContain(formatTrAmount(4));
  expect(host.textContent).toContain("Ortak seçin");

  await act(async () => { host.querySelector('[data-testid="partner-card-Ali"]').click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="partner-ledger-check"]')).toBeTruthy();
  expect(host.textContent).not.toContain("Ortak seçin");

  const open = async (testId) => {
    await act(async () => { host.querySelector(`[data-testid="${testId}"]`).click(); });
    await flush(8);
    await waitFor(() => host.querySelector('[data-testid="partner-tx-modal"]'));
  };
  await open("partner-pane-capital-in");
  expect(host.querySelector('[data-testid="partner-tx-partner-select"]').value).toBe("p1");
  expect(host.querySelector('[data-testid="partner-tx-type-in"]').className).toMatch(/bg-emerald-600/);

  await open("partner-pane-withdrawal");
  expect(host.querySelector('[data-testid="partner-tx-partner-select"]').value).toBe("p1");
  expect(host.querySelector('[data-testid="partner-tx-type-out"]').className).toMatch(/bg-rose-600/);
  expect(host.querySelector('[data-testid="partner-tx-account-select"]')).toBeTruthy();

  await open("partner-pane-credit");
  expect(host.querySelector('[data-testid="partner-tx-partner-select"]').value).toBe("p1");
  expect(host.querySelector('[data-testid="partner-tx-type-credit"]').className).toMatch(/bg-rose-700/);
  expect(host.querySelector('[data-testid="partner-tx-ledger-hint"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="partner-tx-account-select"]')).toBeNull();

  await open("partner-pane-debit");
  expect(host.querySelector('[data-testid="partner-tx-partner-select"]').value).toBe("p1");
  expect(host.querySelector('[data-testid="partner-tx-type-debit"]').className).toMatch(/bg-rose-700/);
  expect(host.querySelector('[data-testid="partner-tx-ledger-hint"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="partner-tx-account-select"]')).toBeNull();
});
