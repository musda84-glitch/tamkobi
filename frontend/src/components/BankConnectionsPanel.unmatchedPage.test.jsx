import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { BankConnectionsPanel } from "./BankConnectionsPanel";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "" }));
jest.mock("../utils/dataRefresh", () => ({ useDataRefresh: () => {}, notifyDataChanged: jest.fn() }));
jest.mock("../utils/jsencryptKuveyt", () => ({
  generateJsencryptKeyPair: jest.fn(async () => ({ privateKey: "P", publicKey: "U", certificatePem: "C" })),
  downloadTextFile: jest.fn(),
}));

const CONTACTS = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, name: `Cari ${i}` }));
const UNMATCHED = Array.from({ length: 120 }, (_, i) => ({
  id: `tx${i}`,
  date: "2026-10-08",
  account_name: "Vadesiz TL",
  description: `Hareket ${i}`,
  amount: 100 + i,
  type: i % 2 ? "inflow" : "outflow",
  account_id: "a1",
}));

let host;
let root;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  global.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/providers")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/connections")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/transactions/unmatched")) return Promise.resolve({ data: UNMATCHED });
    if (u.includes("/banking/match-rules")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/transactions/matched")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/match-rule-suggestions")) return Promise.resolve({ data: [] });
    if (u.includes("/invoices")) return Promise.resolve({ data: [] });
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

test("unmatched list pages first chunk instead of mounting all rows", async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <BankConnectionsPanel
        companyId="comp1"
        accounts={[{ id: "a1", bank_name: "Banka", account_name: "Vadesiz", type: "bank" }]}
        contacts={CONTACTS}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

  const rows = host.querySelectorAll('tr[data-testid^="unmatched-tx-"]');
  expect(rows.length).toBe(25);
  expect(host.querySelector('[data-testid="unmatched-load-more"]')).toBeTruthy();
  expect(host.textContent).toMatch(/120 hareket/);
  expect(host.textContent).toMatch(/25 gösteriliyor/);
  // Cari listesi SearchSelect — kapalıyken yüzlerce <option> yok (yalnızca mod select'leri)
  expect(host.querySelectorAll("select option").length).toBeLessThan(25 * 6);
  expect(host.querySelectorAll('[data-testid$="-trigger"]').length).toBeGreaterThanOrEqual(25);
});
