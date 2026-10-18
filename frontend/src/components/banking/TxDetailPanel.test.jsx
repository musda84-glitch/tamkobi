/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { TxDetailPanel } from "./TxDetailPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../TxRowMenu", () => ({ TxRowMenu: () => <button type="button">menü</button> }));

const LONG = "Bu açıklama satırda kesilir ama panelde eksiksiz görünmelidir. Karşı taraf: MATEK DEKORASYON SANAYİ VE TİCARET A.Ş. Referans 1890005877722151 ve ek notlar burada devam eder.";

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.innerHTML = "";
});

test("hareket detayı tam açıklamayı gösterir ve ESC kapatır", async () => {
  const onClose = jest.fn();
  root = createRoot(host);
  await act(async () => {
    root.render(
      <TxDetailPanel
        tx={{
          id: "tx9",
          date: "2026-10-11",
          amount: 3000,
          type: "inflow",
          description: LONG,
          source: "bank_sync",
          match_status: "matched",
          category: "Tahsilat",
          contact_name: "ACME",
          created_by_name: "Sistem",
          matched_by_name: "Mustafa BAL",
        }}
        accountLabel="Kuveyt Türk · Vadesiz"
        canEdit={false}
        onClose={onClose}
      />
    );
  });
  const desc = document.querySelector('[data-testid="tx-detail-desc"]');
  expect(desc?.textContent).toBe(LONG);
  expect(document.body.textContent).toContain("Hareket detayı");
  expect(document.body.textContent).toContain("Kuveyt Türk · Vadesiz");
  expect(document.body.textContent).toContain("Mustafa BAL");
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(onClose).toHaveBeenCalled();
});

test("dış tıklama paneli kapatır", async () => {
  const onClose = jest.fn();
  root = createRoot(host);
  await act(async () => {
    root.render(
      <TxDetailPanel
        tx={{ id: "tx9", date: "2026-10-11", amount: 10, type: "outflow", description: "Kısa", source: "manual" }}
        onClose={onClose}
      />
    );
  });
  const backdrop = document.querySelector('[data-testid="tx-detail-backdrop"]');
  await act(async () => {
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onClose).toHaveBeenCalled();
});
