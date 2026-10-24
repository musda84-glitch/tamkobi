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
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: null }),
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
  axios.post.mockReset();
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderPage(entry = "/") {
  root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[entry]}><OrderPickKioskPage /></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

test("kiosk without an active company does not call pick or label APIs", async () => {
  await renderPage("/?order=ord-1");
  expect(host.textContent).toContain("Firma seçili değil");
  expect(host.querySelector('[data-testid="pick-empty"]')).toBeNull();
  const urls = axios.get.mock.calls.map((call) => String(call[0]));
  expect(urls.some((url) => url.includes("/order-picks"))).toBe(false);
  expect(urls.some((url) => url.includes("/label-templates"))).toBe(false);
  expect(axios.get).not.toHaveBeenCalled();
  expect(axios.post).not.toHaveBeenCalled();
});
