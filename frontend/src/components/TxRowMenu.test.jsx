/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { TxRowMenu } from "./TxRowMenu";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: { match_status: "matched" } })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.post.mockClear();
  window.confirm = jest.fn(() => true);
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.innerHTML = "";
});

test("Eşleşme düzelt unmatch etmeden replace modalı açar", async () => {
  const tx = {
    id: "tx7",
    date: "2026-10-11",
    amount: 40,
    type: "outflow",
    description: "Kira",
    source: "bank_sync",
    match_status: "matched",
    contact_id: "c1",
    contact_name: "EREN",
    target_account_id: null,
    category: "Kira",
  };
  root = createRoot(host);
  await act(async () => {
    root.render(<TxRowMenu tx={tx} accounts={[]} contacts={[{ id: "c1", name: "EREN" }]} company={{ id: "comp1" }} />);
  });
  await act(async () => { host.querySelector('[data-testid="tx-more-btn-tx7"]').click(); });
  const fix = document.querySelector('[data-testid="tx-fix-match-btn-tx7"]');
  expect(fix?.textContent).toContain("Eşleşme düzelt");
  await act(async () => { fix.click(); });
  expect(window.confirm).not.toHaveBeenCalled();
  expect(axios.post).not.toHaveBeenCalled();
  expect(document.querySelector('[data-testid="tx-match-modal-tx7"] h3')?.textContent).toContain("Eşleştirmeyi değiştir");
  const form = document.querySelector('[data-testid="tx-match-modal-tx7"] form');
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  const match = axios.post.mock.calls.find((c) => String(c[0]).includes("/match"));
  expect(match).toBeTruthy();
  expect(match[1].replace).toBe(true);
  expect(axios.post.mock.calls.some((c) => String(c[0]).includes("/unmatch"))).toBe(false);
});
