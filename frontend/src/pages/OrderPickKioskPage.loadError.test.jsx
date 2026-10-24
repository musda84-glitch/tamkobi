import React from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import OrderPickKioskPage from "./OrderPickKioskPage";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" } }),
}));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (url) => url || "",
  listImageUrl: (u) => u || "",
  listThumbUrl: (u) => u || "",
  cardThumbUrl: (u) => u || "",
}));
jest.mock("../components/CameraScanner", () => ({ ScanButton: () => null, CameraScanner: () => null }));
jest.mock("../components/PickLabelPrintHost", () => ({ PickLabelPrintHost: () => null }));
jest.mock("../utils/dataRefresh", () => ({ notifyDataChanged: jest.fn() }));

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
  await act(async () => {
    root.render(<MemoryRouter><OrderPickKioskPage /></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

test("order pick load failure replaces the empty order list", async () => {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/order-picks")) {
      return Promise.reject({ response: { status: 403, data: { detail: "no" } } });
    }
    return Promise.resolve({ data: [] });
  });
  await renderPage();
  expect(host.querySelector('[data-testid="pick-load-error"]')?.textContent).toBe("Yetkiniz yok / yüklenemedi");
  expect(host.querySelector('[data-testid="pick-empty"]')).toBeNull();
});
