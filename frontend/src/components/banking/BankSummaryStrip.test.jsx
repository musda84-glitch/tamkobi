/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { BankSummaryStrip } from "./BankSummaryStrip";
import { formatTrAmount } from "../../utils/money";
import { partnerSummaryCardMeta } from "../../utils/partnerTx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VALUES = {
  liquidity: 1250.5,
  bank: 800,
  cash: 300.25,
  pos: 100,
  customerCards: 50.5,
};

const PARTNERS = {
  partner_count: 2,
  total_card_pocket: -199822.37,
};

const CARD_IDS = [
  "summary-liquidity",
  "summary-bank",
  "summary-cash",
  "summary-pos",
  "summary-customer-cards",
];

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.innerHTML = "";
});

async function render(props = {}) {
  if (!root) root = createRoot(host);
  await act(async () => {
    root.render(<BankSummaryStrip {...VALUES} {...props} />);
  });
}

function strip() {
  return host.querySelector('[data-testid="bank-summary-strip"]');
}

test("ortaklar varken 6 kart render edilir", async () => {
  await render({ partnerSummary: PARTNERS });
  expect(strip().children).toHaveLength(6);
  CARD_IDS.forEach((id) => {
    expect(host.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
  });
  expect(host.querySelector('[data-testid="partners-account-card"]')).not.toBeNull();
});

test("ortaklar yokken 5 kart render edilir", async () => {
  await render({ partnerSummary: null });
  expect(strip().children).toHaveLength(5);
  CARD_IDS.forEach((id) => {
    expect(host.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
  });
  expect(host.querySelector('[data-testid="partners-account-card"]')).toBeNull();

  await render({ partnerSummary: { partner_count: 0, total_card_pocket: 10 } });
  expect(strip().children).toHaveLength(5);
  expect(host.querySelector('[data-testid="partners-account-card"]')).toBeNull();
});

test("kapsayıcıda overflow-x-auto yok, grid sınıfı var", async () => {
  await render({ partnerSummary: PARTNERS });
  expect(strip().className).not.toContain("overflow-x-auto");
  expect(strip().className).not.toContain("flex");
  expect(strip().className).toContain("grid");
  expect(strip().className).toContain("grid-cols-2");
  expect(strip().className).toContain("md:grid-cols-3");
  expect(strip().className).toContain("2xl:grid-cols-6");
  expect(strip().className).not.toContain("2xl:grid-cols-5");

  await render();
  expect(strip().className).not.toContain("overflow-x-auto");
  expect(strip().className).toContain("grid");
  expect(strip().className).toContain("2xl:grid-cols-5");
  expect(strip().className).not.toContain("2xl:grid-cols-6");
});

test("Ortaklar kartına tıklayınca onOpenPartners çağrılır", async () => {
  const onOpenPartners = jest.fn();
  await render({ partnerSummary: PARTNERS, onOpenPartners });
  await act(async () => {
    host.querySelector('[data-testid="partners-account-card"]').click();
  });
  expect(onOpenPartners).toHaveBeenCalledTimes(1);
});

test("tutarlar formatTrAmount ile gösterilir", async () => {
  await render({ partnerSummary: PARTNERS });
  const meta = partnerSummaryCardMeta(PARTNERS);
  const expectAmount = (testId, amount) => {
    const label = `${formatTrAmount(amount)} ₺`;
    const card = host.querySelector(`[data-testid="${testId}"]`);
    const amountEl = card.querySelector("[title]");
    expect(card.textContent).toContain(label);
    expect(amountEl.textContent).toBe(label);
    expect(amountEl.getAttribute("title")).toBe(label);
    expect(amountEl.className).toContain("whitespace-nowrap");
    expect(amountEl.className).toContain("truncate");
  };
  expectAmount("summary-liquidity", VALUES.liquidity);
  expectAmount("summary-bank", VALUES.bank);
  expectAmount("summary-cash", VALUES.cash);
  expectAmount("summary-pos", VALUES.pos);
  expectAmount("summary-customer-cards", VALUES.customerCards);
  const partnerEl = host.querySelector('[data-testid="partners-account-balance"]');
  const partnerLabel = `${formatTrAmount(meta.display)} ₺`;
  expect(partnerEl.textContent).toBe(partnerLabel);
  expect(partnerEl.getAttribute("title")).toBe(partnerLabel);
  expect(partnerEl.className).toContain("whitespace-nowrap");
  expect(partnerEl.className).toContain(meta.amountCls);
  expect(host.querySelector('[data-testid="partners-account-badge"]').textContent).toContain(meta.label);
  expect(host.querySelector('[data-testid="summary-liquidity"]').textContent).toContain("Kredi kartı hariç kasa + banka + POS");
});
