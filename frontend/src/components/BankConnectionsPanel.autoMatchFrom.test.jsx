import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { BankConnectionsPanel } from "./BankConnectionsPanel";
import { notifyDataChanged } from "../utils/dataRefresh";

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
jest.mock("../utils/dataRefresh", () => ({
  useDataRefresh: () => {},
  notifyDataChanged: jest.fn(() => Promise.resolve()),
}));
jest.mock("../utils/jsencryptKuveyt", () => ({
  generateJsencryptKeyPair: jest.fn(async () => ({ privateKey: "P", publicKey: "U", certificatePem: "C" })),
  downloadTextFile: jest.fn(),
}));

const PREVIEW = {
  dry_run: true,
  count: 2,
  total_amount: 1500.5,
  before_date: "2026-10-10",
  by_contact: [
    { contact_name: "Acme", count: 2, amount: 1000 },
    { contact_name: "Beta", count: 1, amount: 500.5 },
  ],
  sample: [
    { tx_id: "t1", date: "2026-09-01", amount: 100, contact_name: "Acme", description: "EFT" },
  ],
};

const RUN = {
  dry_run: false,
  ok: 2,
  fail: [],
  message: "2 otomatik eşleşme geri alındı.",
  processed: [
    { tx_id: "t1", outcome: "ok", contact_name: "Acme", amount: 100, date: "2026-09-01" },
    { tx_id: "t2", outcome: "ok", contact_name: "Beta", amount: 50, date: "2026-09-02" },
  ],
};

function connection(extra = {}) {
  return {
    id: "conn1",
    provider: "enpara",
    provider_name: "Enpara",
    linked_account_id: "acc1",
    linked_account_name: "Vadesiz",
    status: "connected",
    mode: "live",
    auto_match: false,
    auto_sync: true,
    auto_match_from: null,
    auto_match_from_effective: "2026-09-15",
    created_at: "2026-09-15T00:00:00Z",
    synced_count: 1,
    ...extra,
  };
}

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  notifyDataChanged.mockClear();
  axios.put.mockReset();
  axios.put.mockResolvedValue({ data: { auto_match: true, auto_matched_now: 0 } });
  axios.post.mockReset();
  axios.post.mockImplementation((url, body) => {
    if (String(url).includes("/auto-unmatch")) {
      if (body && body.dry_run === false) return Promise.resolve({ data: RUN });
      return Promise.resolve({ data: { ...PREVIEW, before_date: body?.before_date || PREVIEW.before_date } });
    }
    return Promise.resolve({ data: {} });
  });
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/connections")) return Promise.resolve({ data: [connection()] });
    if (u.includes("/banking/transactions/unmatched")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/transactions/matched")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/match-rules")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/match-rule-suggestions")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/providers")) return Promise.resolve({ data: [] });
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

async function renderPanel() {
  root = createRoot(host);
  await act(async () => {
    root.render(<BankConnectionsPanel companyId="co1" accounts={[]} contacts={[]} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function posts() {
  return axios.post.mock.calls.map(([url, body]) => ({ url: String(url), body }));
}

function puts() {
  return axios.put.mock.calls.map(([url, body]) => ({ url: String(url), body }));
}

test("start date shows the effective value and confirm is required before save", async () => {
  await renderPanel();
  const input = host.querySelector('[data-testid="auto-match-from-conn1"]');
  expect(input.value).toBe("2026-09-15");
  await act(async () => {
    host.querySelector('[data-testid="auto-match-from-save-conn1"]').click();
  });
  expect(host.querySelector('[data-testid="auto-match-from-confirm"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="auto-match-from-confirm-text"]').textContent)
    .toContain("Bu tarihten önceki 2 otomatik eşleşme geri alınacak");
  expect(host.querySelector('[data-testid="auto-match-from-confirm-text"]').textContent)
    .toContain("elle yapılan eşleşmeler korunur");
  expect(host.querySelector('[data-testid="auto-match-from-confirm-text"]').textContent).toContain("Acme");
  expect(puts()).toHaveLength(0);
  expect(posts().some((p) => p.body && p.body.dry_run === false)).toBe(false);
  expect(posts().some((p) => p.body && p.body.dry_run === true && p.body.before_date === "2026-09-15")).toBe(true);
});

test("cancel keeps the date unsaved and confirm runs unmatch plus result modal", async () => {
  await renderPanel();
  await act(async () => {
    host.querySelector('[data-testid="auto-match-from-save-conn1"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="auto-match-from-confirm-cancel"]').click();
  });
  expect(host.querySelector('[data-testid="auto-match-from-confirm"]')).toBeNull();
  expect(puts()).toHaveLength(0);
  expect(posts().some((p) => p.body && p.body.dry_run === false)).toBe(false);
  expect(notifyDataChanged).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="auto-match-from-conn1"]').value).toBe("2026-09-15");

  await act(async () => {
    host.querySelector('[data-testid="auto-match-from-save-conn1"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="auto-match-from-confirm-ok"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  const saved = puts().find((p) => p.body && p.body.auto_match_from === "2026-09-15");
  expect(saved).toBeTruthy();
  expect(posts().some((p) => p.body && p.body.dry_run === false && p.body.before_date === "2026-09-15")).toBe(true);
  expect(host.querySelector('[data-testid="bulk-result-modal"]')).not.toBeNull();
  expect(notifyDataChanged).toHaveBeenCalledWith({ companyId: "co1", scopes: ["cash"] });
});

test("rollback button previews counts and does not run without confirmation", async () => {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/banking/connections")) {
      return Promise.resolve({ data: [connection({ auto_match_from: "2026-10-01", auto_match_from_effective: "2026-10-01", auto_match: true })] });
    }
    if (u.includes("/banking/transactions/unmatched")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/transactions/matched")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/match-rules")) return Promise.resolve({ data: [] });
    if (u.includes("/banking/match-rule-suggestions")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  await renderPanel();
  await act(async () => {
    host.querySelector('[data-testid="auto-unmatch-btn-conn1"]').click();
  });
  expect(host.querySelector('[data-testid="auto-unmatch-preview"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="auto-unmatch-preview-count"]').textContent).toBe("2");
  expect(host.querySelector('[data-testid="auto-unmatch-preview-amount"]').getAttribute("data-amount")).toBe("1500.5");
  expect(host.querySelector('[data-testid="auto-unmatch-preview-amount"]').textContent).toMatch(/1[.\s]?500[,.]50|1500[,.]5/);
  expect(host.querySelector('[data-testid="auto-unmatch-preview-contacts"]').textContent).toContain("Acme");
  expect(host.querySelector('[data-testid="auto-unmatch-preview-contacts"]').textContent).toContain("Beta");
  expect(host.querySelectorAll('[data-testid="auto-unmatch-sample-row"]').length).toBe(1);
  expect(posts().every((p) => p.body && p.body.dry_run !== false)).toBe(true);

  await act(async () => {
    host.querySelector('[data-testid="auto-unmatch-cancel"]').click();
  });
  expect(host.querySelector('[data-testid="auto-unmatch-preview"]')).toBeNull();
  expect(posts().some((p) => p.body && p.body.dry_run === false)).toBe(false);
  expect(host.querySelector('[data-testid="bulk-result-modal"]')).toBeNull();

  await act(async () => {
    host.querySelector('[data-testid="auto-unmatch-btn-conn1"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="auto-unmatch-confirm"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  expect(posts().some((p) => p.body && p.body.dry_run === false)).toBe(true);
  expect(host.querySelector('[data-testid="bulk-result-modal"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="bulk-result-label"]').textContent).toContain("Acme");
  expect(notifyDataChanged).toHaveBeenCalledWith({ companyId: "co1", scopes: ["cash"] });
});

test("turning auto match on without a saved date asks for the date first", async () => {
  await renderPanel();
  await act(async () => {
    host.querySelector('[data-testid="auto-match-toggle-conn1"]').click();
  });
  expect(host.querySelector('[data-testid="auto-match-from-required"]')).not.toBeNull();
  expect(puts().some((p) => p.body && Object.prototype.hasOwnProperty.call(p.body, "auto_match"))).toBe(false);
});
