/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { TxMatchActions } from "./TxMatchActions";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: { match_status: "matched" } })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "/api" }));

const base = {
  id: "tx1",
  date: "2026-10-11",
  amount: 1250,
  type: "outflow",
  description: "MATEK DEKORASYON",
  account_id: "a1",
  source: "bank_sync",
  match_status: "unmatched",
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.post.mockClear();
  axios.post.mockResolvedValue({ data: { id: "tx1", match_status: "matched" } });
  toast.success.mockClear();
  toast.error.mockClear();
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

async function render(tx, canEdit = true) {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <TxMatchActions
        tx={tx}
        canEdit={canEdit}
        contacts={[{ id: "c1", name: "EREN" }]}
        accounts={[{ id: "a1", account_name: "Vadesiz" }, { id: "kasa", account_name: "Kasa" }]}
        companyId="comp1"
      />
    );
  });
}

test("eşleşmemiş bank_sync amber Eşleştir gösterir", async () => {
  await render(base, true);
  const btn = host.querySelector('[data-testid="tx-match-btn-tx1"]');
  expect(btn).toBeTruthy();
  expect(btn.textContent).toBe("Eşleştir");
  expect(btn.className).toContain("bg-amber-500");
  expect(btn.className).toContain("text-white");
  expect(host.querySelector('[data-testid="tx-rematch-btn-tx1"]')).toBeNull();
  expect(host.querySelector('[data-testid="tx-unmatch-btn-tx1"]')).toBeNull();
  await act(async () => { btn.click(); });
  expect(document.querySelector('[data-testid="tx-match-modal-tx1"] h3')?.textContent).toContain("Eşleşme");
  expect(document.querySelector('[data-testid="tx-match-modal-tx1"] h3')?.textContent).not.toContain("Eşleştirmeyi değiştir");
  await act(async () => { document.querySelector('[data-testid="tx-match-close"]').click(); });
  expect(axios.post).not.toHaveBeenCalled();
  await act(async () => { host.querySelector('[data-testid="tx-match-btn-tx1"]').click(); });
  const form = document.querySelector('[data-testid="tx-match-modal-tx1"] form');
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  const match = axios.post.mock.calls.find((c) => String(c[0]).includes("/match"));
  expect(match).toBeTruthy();
  expect(Object.prototype.hasOwnProperty.call(match[1], "replace")).toBe(false);
});

test("eşleşmiş hareket Değiştir ve Kaldır gösterir", async () => {
  await render({ ...base, match_status: "matched", contact_id: "c1", contact_name: "EREN" }, true);
  const change = host.querySelector('[data-testid="tx-rematch-btn-tx1"]');
  const remove = host.querySelector('[data-testid="tx-unmatch-btn-tx1"]');
  expect(change?.textContent).toBe("Değiştir");
  expect(change.className).toContain("border-emerald-300");
  expect(change.className).toContain("bg-emerald-50");
  expect(change.className).toContain("text-emerald-700");
  expect(remove?.textContent).toBe("Kaldır");
  expect(remove.className).toContain("border-rose-300");
  expect(remove.className).toContain("text-rose-600");
  expect(remove.className).toContain("bg-white");
  expect(host.querySelector('[data-testid="tx-match-btn-tx1"]')).toBeNull();
});

test("bank_match, partner ve manuel kaynakta buton yoktur", async () => {
  for (const source of ["bank_match", "partner", "manual"]) {
    if (root) {
      act(() => { root.unmount(); });
      root = null;
    }
    host.innerHTML = "";
    // eslint-disable-next-line no-await-in-loop
    await render({ ...base, source, match_status: "matched" }, true);
    expect(host.querySelector('[data-testid="tx-match-btn-tx1"]')).toBeNull();
    expect(host.querySelector('[data-testid="tx-rematch-btn-tx1"]')).toBeNull();
    expect(host.querySelector('[data-testid="tx-unmatch-btn-tx1"]')).toBeNull();
  }
});

test("canEdit false ise buton yoktur", async () => {
  await render({ ...base, match_status: "matched" }, false);
  expect(host.querySelector('[data-testid="tx-match-btn-tx1"]')).toBeNull();
  expect(host.querySelector('[data-testid="tx-rematch-btn-tx1"]')).toBeNull();
  expect(host.querySelector('[data-testid="tx-unmatch-btn-tx1"]')).toBeNull();
});

test("yeniden eşleştirilirken gri rozet, buton yok", async () => {
  await render({ ...base, match_status: "rematching" }, true);
  expect(host.querySelector('[data-testid="tx-rematching-tx1"]')?.textContent).toBe("Eşleştiriliyor…");
  expect(host.querySelector('[data-testid="tx-match-btn-tx1"]')).toBeNull();
  expect(host.querySelector('[data-testid="tx-rematch-btn-tx1"]')).toBeNull();
});

test("Kaldır onayı reddedilince istek yok, kabulde unmatch gider", async () => {
  await render({ ...base, match_status: "matched" }, true);
  window.confirm = jest.fn(() => false);
  await act(async () => { host.querySelector('[data-testid="tx-unmatch-btn-tx1"]').click(); });
  expect(axios.post).not.toHaveBeenCalled();

  window.confirm = jest.fn(() => true);
  await act(async () => { host.querySelector('[data-testid="tx-unmatch-btn-tx1"]').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(axios.post).toHaveBeenCalledWith("/api/banking/transactions/tx1/unmatch");
  expect(toast.success).toHaveBeenCalledWith("Eşleşme geri alındı.");
});

test("Değiştir unmatch çağırmaz; kayıt match body.replace true gider", async () => {
  await render({
    ...base,
    match_status: "matched",
    contact_id: "c9",
    contact_name: "ACME",
    category: "Hizmet",
  }, true);
  await act(async () => { host.querySelector('[data-testid="tx-rematch-btn-tx1"]').click(); });
  expect(axios.post).not.toHaveBeenCalled();
  const title = document.querySelector('[data-testid="tx-match-modal-tx1"] h3');
  expect(title?.textContent).toContain("Eşleştirmeyi değiştir");
  const form = document.querySelector('[data-testid="tx-match-modal-tx1"] form');
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  const calls = axios.post.mock.calls.map((c) => String(c[0]));
  expect(calls.some((u) => u.includes("/unmatch"))).toBe(false);
  const match = axios.post.mock.calls.find((c) => String(c[0]).includes("/match"));
  expect(match).toBeTruthy();
  expect(match[1].replace).toBe(true);
  expect(match[1].contact_id).toBe("c9");
});

test("replace hatasında detail mesajı toast'ta görünür", async () => {
  axios.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Bu hareket yeniden eşleştiriliyor." } } });
  await render({ ...base, match_status: "matched", contact_id: "c9", contact_name: "ACME" }, true);
  await act(async () => { host.querySelector('[data-testid="tx-rematch-btn-tx1"]').click(); });
  const form = document.querySelector('[data-testid="tx-match-modal-tx1"] form');
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(toast.error).toHaveBeenCalledWith("Bu hareket yeniden eşleştiriliyor.");
  expect(axios.post.mock.calls.some((c) => String(c[0]).includes("/unmatch"))).toBe(false);
});
