/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import QuoteApprovalPage from "./QuoteApprovalPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("react-router-dom", () => ({ useParams: () => ({ token: "tok-1" }) }));
jest.mock("../context/AuthContext", () => ({ API_URL: "http://api" }));

const QUOTE = {
  quote_number: "TK-1",
  contact_name: "Ada",
  title: "Mutfak",
  issue_date: "2026-10-20",
  valid_until: "2026-11-20",
  subtotal: 100,
  vat_total: 20,
  grand_total: 120,
  company: { name: "TamKobi", phone: "0212" },
  items: [{ name: "Dolap", quantity: 2, unit: "Adet", unit_price: 50, vat_rate: 20 }],
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: QUOTE });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

test("teklif kalem tablosu kaydırılır, sayısal hücreler satır kırmaz", async () => {
  root = createRoot(host);
  await act(async () => { root.render(<QuoteApprovalPage />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const row = host.querySelector('[data-testid="public-quote-item-0"]');
  expect(row).not.toBeNull();
  expect(row.textContent).toContain("Dolap");
  const table = row.closest("table");
  expect(table.parentElement.className).toContain("overflow-x-auto");
  const cells = row.querySelectorAll("td");
  expect(cells[0].className).not.toContain("whitespace-nowrap");
  expect(cells[1].className).toContain("whitespace-nowrap");
  expect(cells[2].className).toContain("whitespace-nowrap");
  expect(cells[3].className).toContain("whitespace-nowrap");
  const heads = table.querySelectorAll("th");
  expect(heads[1].className).toContain("whitespace-nowrap");
  expect(heads[2].className).toContain("whitespace-nowrap");
  expect(heads[3].className).toContain("whitespace-nowrap");
  expect(host.querySelector('[data-testid="public-quote-grand"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="public-quote-name"]')).not.toBeNull();
});
