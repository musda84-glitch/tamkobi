/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import QuickSalePage from "./QuickSalePage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" } }),
}));
jest.mock("../context/PosSessionContext", () => ({
  usePosSession: () => ({
    session: { rules: {} },
    rules: {},
    terminalId: "t1",
    headers: {},
    reload: jest.fn(),
    shift: null,
  }),
}));
jest.mock("../components/CameraScanner", () => ({
  CameraScanner: () => null,
  ScanButton: () => null,
}));
jest.mock("../components/ScalePromptModal", () => ({ ScalePromptModal: () => null }));
jest.mock("../utils/thermalReceipt", () => ({ printThermalReceipt: jest.fn() }));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "" }));
jest.mock("../utils/productImages", () => ({ productListImageUrl: () => "" }));
jest.mock("react-router-dom", () => ({
  useSearchParams: () => {
    const bag = globalThis.__qs || { params: new URLSearchParams(), set: jest.fn() };
    return [bag.params, bag.set];
  },
}), { virtual: true });

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  toast.error.mockClear();
  globalThis.__qs = {
    params: new URLSearchParams(),
    set: jest.fn(),
  };
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/pos/approvals/")) return Promise.resolve({ data: null });
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
    root.render(<QuickSalePage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return root;
}

test("onay param opens the approval card and clears the query", async () => {
  const params = new URLSearchParams("onay=ap1");
  const setSearchParams = jest.fn();
  globalThis.__qs = { params, set: setSearchParams };
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/pos/approvals/ap1")) {
      return Promise.resolve({
        data: { _id: "ap1", id: "ap1", kind: "cancel_cart", summary: "Sepet iptali", can_approve: true, requested_by_name: "Ayşe" },
      });
    }
    return Promise.resolve({ data: [] });
  });
  await renderPage();
  const card = host.querySelector("[data-testid='pos-approval-card']");
  expect(card).not.toBeNull();
  expect(card.textContent).toContain("Sepet iptali");
  expect(host.querySelector("[data-testid='pos-approval-approve']")).not.toBeNull();
  expect(toast.error).not.toHaveBeenCalled();
  expect(setSearchParams).toHaveBeenCalled();
  const updater = setSearchParams.mock.calls[0][0];
  const next = updater(params);
  expect(next.get("onay")).toBeNull();
  expect(setSearchParams.mock.calls[0][1]).toEqual({ replace: true });
});

test("missing onay id toasts and the page still renders", async () => {
  globalThis.__qs = {
    params: new URLSearchParams("onay=gone"),
    set: jest.fn((updater) => updater(new URLSearchParams("onay=gone"))),
  };
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/pos/approvals/")) return Promise.reject(new Error("404"));
    return Promise.resolve({ data: [] });
  });
  await renderPage();
  expect(toast.error).toHaveBeenCalledWith("Kayıt bulunamadı");
  expect(host.querySelector("[data-testid='pos-approval-card']")).toBeNull();
  expect(host.textContent.length).toBeGreaterThan(0);
});
