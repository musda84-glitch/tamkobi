/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
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
  useAuth: () => ({ activeCompany: { id: "c1" }, addonOn: () => true, user: { role: "admin" } }),
}));
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [globalThis.__bankParams || new URLSearchParams(), jest.fn()],
}), { virtual: true });
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  cachedList: async () => [],
  dropCached: async () => {},
}));
jest.mock("../components/PartnersPanel", () => ({
  PartnersPanel: ({ focusApprovalId }) => <div data-testid="partners-focus">{focusApprovalId}</div>,
}));
jest.mock("../components/BankConnectionsPanel", () => ({ BankConnectionsPanel: () => null }));
jest.mock("../components/CardStatementImport", () => ({ CardStatementImport: () => null }));
jest.mock("../components/AccountStatementPrint", () => ({ AccountStatementPrint: () => null }));
jest.mock("../components/TxRowMenu", () => ({ TxRowMenu: () => null }));
jest.mock("../components/SearchSelect", () => ({ SearchSelect: () => null }));
jest.mock("../components/VirmanPartySelect", () => ({ VirmanPartySelect: () => null }));
jest.mock("../hooks/useInfiniteRows", () => ({
  useInfiniteRows: (rows) => ({ visible: rows || [], hasMore: false, sentinelRef: { current: null } }),
}));

let host;
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
  toast.error.mockClear();
  globalThis.__bankParams = new URLSearchParams();
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/cash-approvals")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/partners/summary")) return Promise.resolve({ data: { partner_count: 0 } });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

async function renderPage() {
  const root = createRoot(host);
  await act(async () => {
    root.render(<BankingPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return root;
}

test("tab and approval open the partners tab and pass the request id", async () => {
  globalThis.__bankParams = new URLSearchParams("tab=partners&approval=req-1");
  await renderPage();
  const partners = host.querySelector("[data-testid='banking-tab-partners']");
  expect(partners.className).toMatch(/border-emerald-600/);
  expect(host.querySelector("[data-testid='partners-focus']")?.textContent).toBe("req-1");
});

test("missing approval id toasts and the accounts tab still renders", async () => {
  globalThis.__bankParams = new URLSearchParams("approval=gone");
  await renderPage();
  const accounts = host.querySelector("[data-testid='banking-tab-accounts']");
  expect(accounts.className).toMatch(/border-emerald-600/);
  expect(toast.error).toHaveBeenCalledWith("Kayıt bulunamadı");
  expect(host.querySelector("[data-testid='banking-tab-partners']")).not.toBeNull();
});
