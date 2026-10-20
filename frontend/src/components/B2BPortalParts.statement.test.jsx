/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { StatementList } from "./B2BPortalParts";
import { setPriceDecimals } from "../utils/money";
import { txMobileListGuards } from "../utils/txMobileOverflow";

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

const LINES = {
  id: "inv_own",
  invoice_number: "SF-1",
  currency: "USD",
  subtotal: 1250.5,
  vat_total: 250.1,
  grand_total: 1500.6,
  items: [
    {
      sku: "DRC-W",
      name: "Duvar Rafı — Beyaz",
      barcode: "8680001234013",
      quantity: 2,
      unit: "Adet",
      unit_price: 500,
      discount_rate: 10,
      vat_rate: 20,
      total: 900,
      image_url: "/api/files/raf-beyaz.webp",
    },
    {
      sku: "HIZ",
      name: "Kurulum",
      quantity: 1,
      unit: "Saat",
      unit_price: 350.5,
      vat_rate: 20,
      total: 350.5,
    },
  ],
};

const LINES_EUR = {
  id: "inv_eur",
  invoice_number: "SF-2",
  currency: "EUR",
  subtotal: 10,
  vat_total: 2,
  grand_total: 12,
  items: [{ sku: "X", name: "Kalem", quantity: 1, unit: "Adet", unit_price: 10, vat_rate: 20, total: 10 }],
};

const INVOICES = [
  {
    id: "inv_own",
    invoice_number: "SF-1",
    issue_date: "2026-10-01",
    due_date: "2026-10-15",
    grand_total: 1500.6,
    paid_amount: 0,
    payment_status: "unpaid",
    currency: "USD",
  },
  {
    id: "inv_eur",
    invoice_number: "SF-2",
    issue_date: "2026-10-02",
    grand_total: 12,
    paid_amount: 12,
    payment_status: "paid",
    currency: "EUR",
  },
];

let host;
let root;

beforeEach(() => {
  setPriceDecimals(2);
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.get.mockImplementation((url) => {
    if (String(url).includes("inv_eur")) return Promise.resolve({ data: LINES_EUR });
    return Promise.resolve({ data: LINES });
  });
});

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host.remove();
  setPriceDecimals(2);
});

const render = async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(<StatementList invoices={INVOICES} company={{}} balance={100} token="tok-1" />);
  });
};

const toggle = (no) => host.querySelector(`[data-testid="b2b-invoice-toggle-${no}"]`);

test("chevron kalemleri açar ve kapatır, lazy fetch bir kez çağrılır, toplamlar fatura dövizindedir", async () => {
  await render();
  expect(host.querySelector('[data-testid="b2b-invoice-lines-SF-1"]')).toBeNull();
  expect(toggle("SF-1").querySelector("svg").classList.contains("rotate-180")).toBe(false);

  await act(async () => { toggle("SF-1").click(); });
  expect(toggle("SF-1").getAttribute("aria-expanded")).toBe("true");
  expect(toggle("SF-1").querySelector("svg").classList.contains("rotate-180")).toBe(true);
  const lines = host.querySelector('[data-testid="b2b-invoice-lines-SF-1"]');
  expect(lines).not.toBeNull();
  expect(lines.textContent).toContain("Duvar Rafı — Beyaz");
  expect(lines.textContent).toContain("8680001234013");
  expect(lines.textContent).toContain("2 Adet");
  expect(lines.textContent).toContain("%10");
  expect(lines.textContent).toContain("%20");
  expect(lines.querySelector("img")?.getAttribute("src") || "").toMatch(/raf-beyaz/);
  const totals = host.querySelector('[data-testid="b2b-invoice-totals-SF-1"]').textContent;
  expect(totals).toMatch(/Ara toplam/);
  expect(totals).toMatch(/1.?250,50 USD/);
  expect(totals).toMatch(/250,10 USD/);
  expect(totals).toMatch(/1.?500,60 USD/);
  const cards = host.querySelector('[data-testid="b2b-invoice-lines-cards-SF-1"]');
  expect(cards.querySelector("table")).toBeNull();
  expect(txMobileListGuards(cards.parentElement || host)).toEqual({ ok: true, reason: "" });
  expect(host.querySelector('[data-testid="b2b-invoice-lines-table-SF-1"]')).not.toBeNull();
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get.mock.calls[0][0]).toContain("/public/b2b/tok-1/invoices/inv_own/lines");

  await act(async () => { toggle("SF-1").click(); });
  expect(host.querySelector('[data-testid="b2b-invoice-lines-SF-1"]')).toBeNull();
  expect(toggle("SF-1").querySelector("svg").classList.contains("rotate-180")).toBe(false);

  await act(async () => { toggle("SF-1").click(); });
  expect(host.querySelector('[data-testid="b2b-invoice-lines-SF-1"]')).not.toBeNull();
  expect(axios.get).toHaveBeenCalledTimes(1);

  await act(async () => { toggle("SF-2").click(); });
  expect(host.querySelector('[data-testid="b2b-invoice-lines-SF-1"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="b2b-invoice-totals-SF-2"]').textContent).toMatch(/12,00 EUR/);
  expect(axios.get).toHaveBeenCalledTimes(2);
});

const STATEMENT = {
  rows: [
    { date: "2026-10-01", doc: "SF-9 • Satış Faturası", debit: 1000, credit: 0, balance: 1000, kind: "invoice" },
    { date: "2026-10-02", doc: "Tahsilat • Kasa • Nakit", debit: 0, credit: 400, balance: 600, kind: "payment" },
    { date: "2026-10-03", doc: "Ödeme • Banka • Havale", debit: 100, credit: 0, balance: 500, kind: "payment" },
  ],
  payments: [
    { date: "2026-10-02", doc: "Tahsilat • Kasa • Nakit", debit: 0, credit: 400, balance: 600, kind: "payment" },
    { date: "2026-10-03", doc: "Ödeme • Banka • Havale", debit: 100, credit: 0, balance: 500, kind: "payment" },
  ],
};

test("tahsilat Hareketler görünümünde Alacak sütununda ve bakiyede görünür", async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <StatementList invoices={INVOICES} company={{}} balance={700} token="tok-1" statement={STATEMENT} />,
    );
  });
  expect(host.querySelector('[data-testid="b2b-statement-tab-moves"]').getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector('[data-testid="b2b-statement-balance"]').textContent).toMatch(/700,00/);
  const sale = host.querySelector('[data-testid="b2b-statement-row-0"]');
  expect(sale.textContent).toContain("Satış Faturası");
  expect(sale.querySelectorAll("td")[2].textContent).toMatch(/1.?000,00/);
  const tahsilat = host.querySelector('[data-testid="b2b-statement-row-1"]');
  const tahsilatCells = tahsilat.querySelectorAll("td");
  expect(tahsilatCells[1].textContent).toContain("Tahsilat");
  expect(tahsilatCells[3].textContent).toMatch(/400,00/);
  expect(tahsilatCells[2].textContent).not.toMatch(/400/);
  expect(tahsilatCells[4].textContent).toMatch(/600,00/);
  const odeme = host.querySelector('[data-testid="b2b-statement-row-2"]');
  expect(odeme.querySelectorAll("td")[1].textContent).toContain("Ödeme");
  expect(odeme.querySelectorAll("td")[2].textContent).toMatch(/100,00/);
  const cards = host.querySelector('[data-testid="b2b-statement-cards"]');
  expect(cards.textContent).toContain("Tahsilat");
  expect(cards.querySelector("table")).toBeNull();
  expect(txMobileListGuards(host)).toEqual({ ok: true, reason: "" });

  await act(async () => { host.querySelector('[data-testid="b2b-statement-tab-invoices"]').click(); });
  await act(async () => { toggle("SF-1").click(); });
  expect(host.querySelector('[data-testid="b2b-invoice-lines-SF-1"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="b2b-invoice-lines-SF-1"]').textContent).toContain("Duvar Rafı — Beyaz");
});

test("ödeme yokken Fatura yok yerine hareket boş durumu yazar", async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <StatementList invoices={[]} company={{}} balance={0} token="tok-1" statement={{ rows: [], payments: [] }} />,
    );
  });
  expect(host.textContent).not.toContain("Fatura yok.");
  expect(host.textContent).toContain("Hareket yok.");
  const cards = host.querySelector('[data-testid="b2b-statement-cards"]');
  expect(cards.textContent).toContain("Hareket yok.");
  expect(cards.querySelector("table")).toBeNull();
  expect(cards.closest("[data-tx-mobile-list]")).not.toBeNull();
});

test("kalemler yüklenirken ve hata olunca durum yazılır", async () => {
  let resolveGet;
  axios.get.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));
  await render();
  await act(async () => { toggle("SF-1").click(); });
  expect(host.querySelector('[data-testid="b2b-invoice-lines-loading-SF-1"]').textContent).toMatch(/Yükleniyor/);

  await act(async () => { resolveGet({ data: LINES }); });
  expect(host.querySelector('[data-testid="b2b-invoice-lines-SF-1"]')).not.toBeNull();

  axios.get.mockRejectedValue({ response: { data: { detail: "Fatura bulunamadı." } } });
  await act(async () => { toggle("SF-2").click(); });
  expect(host.querySelector('[data-testid="b2b-invoice-lines-error-SF-2"]').textContent).toContain("Fatura bulunamadı.");
});
