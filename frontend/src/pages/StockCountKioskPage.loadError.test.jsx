import React from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import StockCountKioskPage from "./StockCountKioskPage";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" } }),
}));
jest.mock("../components/CameraScanner", () => ({ CameraScanner: () => null }));

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

async function renderPage() {
  root = createRoot(host);
  await act(async () => { root.render(<MemoryRouter><StockCountKioskPage /></MemoryRouter>); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

test("stock count load failure replaces the empty session list", async () => {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/warehouses/stock-counts")) {
      return Promise.reject({ response: { status: 403, data: { detail: "no" } } });
    }
    return Promise.resolve({ data: [] });
  });
  await renderPage();
  expect(host.querySelector('[data-testid="kiosk-load-error"]')?.textContent).toBe("Yetkiniz yok / yüklenemedi");
  expect(host.textContent).not.toContain("Açık sayım yok");
});
