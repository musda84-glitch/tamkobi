/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { StatementList } from "./B2BPortalParts";
import { cardPayQuoteText } from "./B2BCardPay";
import { formatTrAmount, setPriceDecimals } from "../utils/money";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let host;
let root;

beforeEach(() => {
  setPriceDecimals(2);
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.post.mockReset();
});

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host.remove();
  setPriceDecimals(2);
});

const render = async (cardPayment) => {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <StatementList invoices={[]} company={{}} balance={100} token="tok-1" cardPayment={cardPayment} />,
    );
  });
};

test("kartla öde kapalıyken buton yok", async () => {
  await render(undefined);
  expect(host.querySelector('[data-testid="b2b-card-pay"]')).toBeNull();
  await act(async () => { root.unmount(); });
  root = null;
  await render({ enabled: false, max_installment: 3, commission_payer: "buyer", commission_rate: 2.5 });
  expect(host.querySelector('[data-testid="b2b-card-pay"]')).toBeNull();
});

test("alıcı quote metni komisyonu gösterir, kart alanı yoktur", async () => {
  const quote = { base_amount: "100.00", commission_amount: "2.50", charge_amount: "102.50", installment: 1 };
  expect(cardPayQuoteText(quote, "buyer")).toBe(
    `Ödenecek tutar: ${formatTrAmount(102.5)} ₺ (komisyon ${formatTrAmount(2.5)} ₺ dahil)`,
  );
  axios.get.mockResolvedValue({ data: quote });
  await render({ enabled: true, max_installment: 1, commission_payer: "buyer", commission_rate: 2.5 });
  expect(host.querySelector('[data-testid="b2b-card-pay"]')).not.toBeNull();
  await act(async () => { host.querySelector('[data-testid="b2b-card-pay"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 280)); });
  const text = host.querySelector('[data-testid="b2b-card-quote"]').textContent;
  expect(text).toContain("Ödenecek tutar:");
  expect(text).toContain("komisyon");
  expect(text).toContain(formatTrAmount(102.5));
  expect(host.querySelector('[data-testid="b2b-card-installment"]')).toBeNull();
  expect(host.querySelector('input[name="pan"], input[name="cv2"], input[autocomplete="cc-number"]')).toBeNull();
  expect(host.textContent).not.toMatch(/kart numarası/i);
});

test("satıcı quote metninde komisyon satırı yok", async () => {
  const quote = { base_amount: "100.00", commission_amount: "0.00", charge_amount: "100.00", installment: 3 };
  expect(cardPayQuoteText(quote, "seller")).toBe(`Ödenecek tutar: ${formatTrAmount(100)} ₺`);
  expect(cardPayQuoteText(quote, "seller")).not.toContain("komisyon");
  axios.get.mockResolvedValue({ data: quote });
  await render({ enabled: true, max_installment: 3, commission_payer: "seller", commission_rate: 2.5 });
  await act(async () => { host.querySelector('[data-testid="b2b-card-pay"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 280)); });
  const text = host.querySelector('[data-testid="b2b-card-quote"]').textContent;
  expect(text).toContain("Ödenecek tutar:");
  expect(text).not.toContain("komisyon");
  expect(host.querySelector('[data-testid="b2b-card-installment"]')).not.toBeNull();
});
