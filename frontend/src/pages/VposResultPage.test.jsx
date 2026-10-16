import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import fs from "fs";
import path from "path";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import axios from "axios";
import VposResultPage from "./VposResultPage";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

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
});

async function show(data) {
  axios.get.mockResolvedValue({ data });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/vpos/result/intent-1"]}>
        <Routes>
          <Route path="/vpos/result/:id" element={<VposResultPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

test.each([
  ["paid", "vpos-result-paid", "Ödeme alındı"],
  ["failed", "vpos-result-failed", "Ödeme başarısız"],
  ["expired", "vpos-result-expired", "Ödeme süresi doldu"],
  ["pending", "vpos-result-pending", "Ödeme bekleniyor"],
  ["processing", "vpos-result-processing", "Ödeme işleniyor"],
])("sonuç sayfası %s durumunu gösterir", async (status, testid, title) => {
  await show({
    id: "intent-1",
    status,
    amount: "1.00",
    currency: "TRY",
    purpose: "test",
    result: status === "paid" ? { auth_code: "123456", masked_pan: "453144******1234" } : { error: status === "failed" ? "declined" : status },
  });
  expect(host.querySelector(`[data-testid="${testid}"]`).textContent).toBe(title);
  expect(host.querySelector('[data-testid="vpos-result-amount"]').textContent).toMatch(/1\.00/);
  expect(host.querySelector('[data-testid="vpos-result-test-note"]')).toBeTruthy();
  expect(host.textContent).not.toContain("4531440099991234");
});

test("onaylı sonuç maskeli kartı gösterir, tam kart numarasını basmaz", async () => {
  await show({
    status: "paid",
    amount: "1.00",
    currency: "TRY",
    purpose: "test",
    result: { auth_code: "123456", masked_pan: "453144******1234", pan: "4531440099991234" },
  });
  expect(host.querySelector('[data-testid="vpos-result-pan"]').textContent).toContain("453144******1234");
  expect(host.querySelector('[data-testid="vpos-result-auth"]').textContent).toContain("123456");
  expect(host.textContent).not.toContain("4531440099991234");
});

test("bekleyen sonuç birkaç kez sorgulanır ve ödenince güncellenir", async () => {
  jest.useFakeTimers();
  axios.get
    .mockResolvedValueOnce({ data: { id: "intent-1", status: "pending", amount: "1.00", currency: "TRY", purpose: "test", result: null } })
    .mockResolvedValueOnce({ data: { id: "intent-1", status: "paid", amount: "1.00", currency: "TRY", purpose: "test", result: { auth_code: "1" } } });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/vpos/result/intent-1"]}>
        <Routes>
          <Route path="/vpos/result/:id" element={<VposResultPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="vpos-result-pending"]')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(800);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(host.querySelector('[data-testid="vpos-result-paid"]')).toBeTruthy();
  expect(axios.get).toHaveBeenCalledTimes(2);
  jest.useRealTimers();
});

test("sonuç yolu uygulamada kayıtlıdır", () => {
  const app = fs.readFileSync(path.join(__dirname, "../App.js"), "utf8");
  const paths = fs.readFileSync(path.join(__dirname, "../utils/publicPath.js"), "utf8");
  expect(app).toMatch(/\/vpos\/result\/:id/);
  expect(paths).toMatch(/"\/vpos"/);
});
