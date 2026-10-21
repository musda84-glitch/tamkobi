/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import TradePage from "./TradePage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" }, can: () => true }),
}));

const META = {
  incoterms: ["FOB", "CIF"],
  regimes_export: [["1000", "İhracat"]],
  regimes_import: [["4000", "İthalat"]],
  currencies: ["USD"],
  certificates: [""],
  statuses: [["draft", "Taslak"]],
  fx_defaults: { USD: 34 },
};

function routeGet(url) {
  const path = String(url);
  if (path.includes("/trade-files/meta")) return Promise.resolve({ data: META });
  if (path.includes("/fx/")) return Promise.resolve({ data: { rate: 34, source: "tcmb", rates: {}, currencies: ["USD"] } });
  return Promise.resolve({ data: [] });
}

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation(routeGet);
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderPage() {
  root = createRoot(host);
  await act(async () => { root.render(<TradePage />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

test("dosya listesi tablosu yatay kaydırma kabındadır", async () => {
  await renderPage();
  const table = host.querySelector("table");
  expect(table).not.toBeNull();
  expect(table.className).toContain("min-w-[640px]");
  expect(table.className).toContain("w-full");
  expect(table.parentElement.className).toContain("overflow-x-auto");
  expect(table.parentElement.parentElement.className).toContain("overflow-hidden");
  expect(host.querySelector('[data-testid="trade-page"]')).not.toBeNull();
});

test("kalem satırı mobilde iki sütun, masaüstünde on iki sütun", async () => {
  await renderPage();
  await act(async () => { host.querySelector('[data-testid="trade-new"]').click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const row = host.querySelector('[data-testid="trade-item-0"]');
  const tokens = row.className.split(/\s+/);
  expect(tokens).toContain("grid-cols-2");
  expect(tokens).toContain("md:grid-cols-12");
  expect(tokens).not.toContain("grid-cols-12");
  const prod = host.querySelector('[data-testid="trade-item-prod-0"]');
  const prodTokens = prod.parentElement.className.split(/\s+/);
  expect(prodTokens).toContain("col-span-2");
  expect(prodTokens).toContain("md:col-span-3");
  const gtip = host.querySelector('[data-testid="trade-item-gtip-0"]').className.split(/\s+/);
  expect(gtip).toContain("md:col-span-2");
  expect(gtip).not.toContain("col-span-2");
  expect(host.querySelector('[data-testid="trade-item-price-0"]').className).toContain("md:col-span-1");
});
