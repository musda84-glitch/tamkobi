/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import axios from "axios";
import B2BCardResultPage from "./B2BCardResultPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
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
  localStorage.clear();
  localStorage.setItem("b2b_cart_tok-a", JSON.stringify({ p1: 1 }));
  axios.get.mockReset();
});

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host.remove();
  localStorage.clear();
});

async function show(data) {
  axios.get.mockResolvedValue({ data });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/portal/tok-a/odeme/int-1"]}>
        <Routes>
          <Route path="/portal/:token/odeme/:intentId" element={<B2BCardResultPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

test("ödenmiş sipariş numarası sepeti temizler", async () => {
  await show({
    status: "paid",
    charge_amount: "123.00",
    balance: 380,
    order_number: "B2B-2026-0001",
    order_id: "b2bord_int-1",
  });
  expect(host.querySelector('[data-testid="b2b-card-result-paid"]').textContent).toBe("Ödeme alındı");
  expect(host.querySelector('[data-testid="b2b-card-result-order"]').textContent).toBe("Siparişiniz alındı: B2B-2026-0001");
  expect(host.querySelector('[data-testid="b2b-card-result-balance"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="b2b-card-result-review"]')).toBeNull();
  expect(localStorage.getItem("b2b_cart_tok-a")).toBeNull();
});

test("firma onayındaki ödeme sepeti tutar ve inceleme metnini gösterir", async () => {
  await show({
    status: "paid",
    charge_amount: "123.00",
    balance: 380,
    order_error: "review",
    order_number: null,
  });
  expect(host.querySelector('[data-testid="b2b-card-result-review"]').textContent).toBe(
    "Ödemeniz alındı, siparişiniz firma onayında.",
  );
  expect(host.querySelector('[data-testid="b2b-card-result-order"]')).toBeNull();
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
});

test("başarısız ödemede sepet durur ve bakiye satırı yoktur", async () => {
  await show({ status: "failed", charge_amount: "123.00", balance: 500, result: { error: "declined" } });
  expect(host.querySelector('[data-testid="b2b-card-result-failed"]').textContent).toBe("Ödeme başarısız");
  expect(host.querySelector('[data-testid="b2b-card-result-order"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-card-result-review"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-card-result-balance"]')).toBeNull();
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
});

test("cari bakiye ödemesi sipariş satırı basmaz", async () => {
  await show({ status: "paid", charge_amount: "10.25", balance: 90 });
  expect(host.querySelector('[data-testid="b2b-card-result-paid"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="b2b-card-result-balance"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="b2b-card-result-order"]')).toBeNull();
  expect(host.querySelector('[data-testid="b2b-card-result-review"]')).toBeNull();
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
});
