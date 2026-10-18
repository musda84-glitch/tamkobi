import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";
import { OpsAlertsPanel } from "./OpsAlertsPanel";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/dataRefresh", () => ({ useDataRefresh: () => {} }));

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderPanel(items, count = items.length) {
  axios.get.mockResolvedValue({
    data: {
      count,
      groups: [
        { key: "pick_missing", label: "Depo", path: "/production?tab=missing", count: 1, items: [{ id: "d1", title: "Depo satırı", detail: "x" }] },
        { key: "low_stock", label: "Eksik / kritik stok", path: "/stock", count, items },
      ],
    },
  });
  root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter><OpsAlertsPanel companyId="c1" /></MemoryRouter>);
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function titles() {
  return [...host.querySelectorAll("[data-testid^='ops-alert-low_stock-']")].map((el) => el.querySelector(".font-bold").textContent);
}

test("stock rows use shortage, qty-min, parsed detail and never show a negative", async () => {
  await renderPanel([
    { id: "vida", title: "Vida", shortage: 5, qty: 10, min: 15 },
    { id: "conta", title: "Conta", qty: 1, min: 21 },
    { id: "eski", title: "Eski", detail: "Stok -22 · min 10" },
    { id: "tam", title: "Tam", qty: 4, min: 4 },
    { id: "not", title: "Not", detail: "Açıklama metni" },
  ]);
  expect(host.textContent).toContain("32 eksik");
  expect(host.textContent).toContain("Stok 0 · eşik 10");
  expect(host.textContent).toContain("20 eksik");
  expect(host.textContent).toContain("5 eksik");
  expect(host.textContent).toContain("4 adet kaldı");
  expect(host.textContent).toContain("Açıklama metni");
  expect(host.textContent).not.toMatch(/-\d/);
  expect(host.querySelector("[data-testid='ops-stock-badge-eski']").className).toMatch(/rose/);
  expect(host.querySelector("[data-testid='ops-stock-badge-vida']").className).toMatch(/amber/);
  expect(titles()).toEqual(["Eski", "Conta", "Vida", "Tam", "Not"]);
});

test("ties sort by stock ascending and overflow links to critical stock", async () => {
  const items = [
    { id: "a", title: "Az", shortage: 3, qty: 8, min: 11 },
    { id: "b", title: "Çok", shortage: 3, qty: 1, min: 4 },
  ];
  for (let i = 0; i < 10; i += 1) {
    items.push({ id: `x${i}`, title: `Ek ${i}`, shortage: 1, qty: 20 + i, min: 21 + i });
  }
  await renderPanel(items, items.length);
  expect(titles().slice(0, 2)).toEqual(["Çok", "Az"]);
  expect(titles()).toHaveLength(11);
  expect(host.textContent).not.toContain("Ek 9");
  const more = host.querySelector("[data-testid='ops-stock-more']");
  expect(more.textContent).toContain("+1 ürün daha · Stok ›");
  expect(more.getAttribute("href")).toBe("/stock?status=critical");
});
