/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import StatementPublicPage from "./StatementPublicPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("react-router-dom", () => ({ useParams: () => ({ token: "pub-tok" }) }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "http://api",
  useAuth: () => ({ activeCompany: null }),
}));

const DATA = {
  company: { name: "TamKobi", phone: "0212", city: "İstanbul" },
  contact: { name: "Ada" },
  balance: 60,
  currency: "TRY",
  issued_at: "2026-10-20",
  rows: [
    { date: "2026-10-01", doc: "SF-1 • Satış Faturası", debit: 100, credit: 0, balance: 100, kind: "invoice", gib: "sent", e_type: "e_invoice" },
    { date: "2026-10-02", doc: "Tahsilat • Kasa", debit: 0, credit: 40, balance: 60, kind: "payment" },
  ],
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: DATA });
});

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host.remove();
});

test("paylaşılan ekstrede Ekstre Yazdır tam listeyi açar, filtre işaretlenince daralır", async () => {
  root = createRoot(host);
  await act(async () => { root.render(<StatementPublicPage />); });
  const button = host.querySelector('[data-testid="public-statement-print"]');
  expect(button.textContent).toMatch(/Ekstre Yazdır/);
  expect(host.querySelector('[data-testid="public-statement-row-0"]').textContent).toMatch(/SF-1/);
  expect(host.querySelector('[data-testid="public-statement-table-gib-0"]').textContent).toBe("GİB");

  await act(async () => { button.click(); });
  expect(host.querySelectorAll('[data-testid^="statement-print-row-"]')).toHaveLength(2);
  expect(host.querySelector('[data-testid="statement-print-row-0"]').textContent).toMatch(/100,00/);
  expect(host.querySelector('[data-testid="statement-print-gib-0"]').textContent).toBe("GİB");
  expect(host.querySelector('[data-testid="statement-print-filter-note"]')).toBeNull();

  await act(async () => { host.querySelector('[data-testid="public-statement-table-filter-side-credit"]').click(); });
  await act(async () => { host.querySelector('[data-testid="statement-print-apply-filter"] input').click(); });
  expect(host.querySelectorAll('[data-testid^="statement-print-row-"]')).toHaveLength(1);
  expect(host.querySelector('[data-testid="statement-print-row-0"]').textContent).toMatch(/Tahsilat/);
  expect(host.querySelector('[data-testid="statement-print-row-0"]').textContent).toMatch(/60,00/);
  expect(host.querySelector('[data-testid="statement-print-filter-note"]').textContent).toMatch(/Filtre uygulandı/);
  expect(window.location.search).toBe("");
});
