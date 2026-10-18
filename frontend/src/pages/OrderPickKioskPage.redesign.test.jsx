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
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (url) => url || "" }));
jest.mock("../components/CameraScanner", () => ({ ScanButton: () => null, CameraScanner: () => null }));
jest.mock("../components/PickLabelPrintHost", () => ({ PickLabelPrintHost: () => null }));
jest.mock("../utils/dataRefresh", () => ({ notifyDataChanged: jest.fn() }));

const session = {
  order_id: "ord-1",
  order_number: "SIP-100",
  customer_name: "Ada",
  city: "İstanbul",
  items: [
    {
      product_id: "p1",
      product_name: "Kumaş",
      sku: "SKU-1",
      barcode: "8690001",
      line_index: 0,
      ordered_qty: 3,
      picked_qty: 1,
      image_url: "",
    },
    {
      product_id: "p2",
      product_name: "Düğme",
      sku: "SKU-2",
      barcode: "8690002",
      line_index: 1,
      ordered_qty: 3,
      picked_qty: 3,
    },
  ],
  progress: { picked: 4, ordered: 6, complete: false },
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.post.mockReset();
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/order-picks/ord-1")) return Promise.resolve({ data: session });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockImplementation(() => Promise.resolve({ data: session }));
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderSession() {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/?order=ord-1"]}>
        <OrderPickKioskPage />
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
    if (host.querySelector('[data-testid="order-pick-session"]')) return;
  }
}

async function typeQty(idx, text) {
  const input = host.querySelector(`[data-testid="pick-qty-input-${idx}"]`);
  await act(async () => { input.focus(); });
  await act(async () => {
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    proto.set.call(input, text);
    input.selectionStart = String(text).length;
    input.selectionEnd = String(text).length;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.blur(); });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function adjustCalls() {
  return axios.post.mock.calls.filter((call) => String(call[0]).includes("/adjust"));
}

test("line accents, missing tag, and session progress match the picked quantities", async () => {
  await renderSession();
  const line0 = host.querySelector('[data-testid="pick-line-0"]');
  const line1 = host.querySelector('[data-testid="pick-line-1"]');
  expect(line0.className).toContain("border-l-amber-500");
  expect(host.querySelector('[data-testid="pick-line-tag-0"]').textContent).toContain("2 eksik");
  expect(line1.className).toContain("border-l-emerald-500");
  expect(line1.className).toContain("bg-emerald-50");
  expect(host.querySelector('[data-testid="pick-line-tag-1"]').textContent).toContain("✓ Tamam");

  const progress = host.querySelector('[data-testid="pick-progress-text"]').textContent;
  expect(progress).toContain("4 / 6 adet toplandı");
  expect(progress).toContain("2 kalem");
  const bar = host.querySelector('[data-testid="pick-progress-bar"]');
  expect(bar.style.width).toBe("67%");
  expect(bar.className).toContain("h-2");
  expect(bar.className).toContain("bg-emerald-500");
});

test("typed quantity posts an absolute adjust and clamps overscan", async () => {
  await renderSession();
  await typeQty(0, "2");
  expect(adjustCalls()).toEqual([
    ["/api/order-picks/ord-1/adjust", {
      product_id: "p1",
      product_name: "Kumaş",
      line_index: 0,
      picked_qty: 2,
    }],
  ]);

  axios.post.mockClear();
  await typeQty(0, "9");
  expect(adjustCalls()).toEqual([
    ["/api/order-picks/ord-1/adjust", {
      product_id: "p1",
      product_name: "Kumaş",
      line_index: 0,
      picked_qty: 3,
    }],
  ]);
  expect(host.querySelector('[data-testid="pick-overscan-alert"]')).toBeTruthy();

  axios.post.mockClear();
  await typeQty(0, "");
  await typeQty(0, "abc");
  expect(axios.post).not.toHaveBeenCalled();
});

test("Tümü fills the line, completed lines stay disabled, and steppers post absolute qty", async () => {
  await renderSession();
  expect(host.querySelector('[data-testid="pick-all-1"]').disabled).toBe(true);
  expect(host.querySelector('[data-testid="pick-all-0"]').disabled).toBe(false);
  expect(host.querySelector('[data-testid="pick-all-0"]').className).toContain("bg-indigo-600");

  await act(async () => {
    host.querySelector('[data-testid="pick-all-0"]').click();
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(adjustCalls()[0][1]).toEqual({
    product_id: "p1",
    product_name: "Kumaş",
    line_index: 0,
    picked_qty: 3,
  });

  axios.post.mockClear();
  await act(async () => {
    host.querySelector('[data-testid="pick-plus-0"]').click();
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(adjustCalls()[0][1].picked_qty).toBe(2);

  axios.post.mockClear();
  await act(async () => {
    host.querySelector('[data-testid="pick-minus-0"]').click();
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(adjustCalls()[0][1].picked_qty).toBe(0);
});

test("label, scan, bulk print, and complete actions stay on the session", async () => {
  await renderSession();
  expect(host.querySelector('[data-testid="pick-label-0"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="pick-scan-btn"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="pick-print-labels"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="pick-complete"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="pick-qty-input-0"]').getAttribute("inputmode")).toBe("numeric");
  expect(host.querySelector('[data-testid="pick-line-0"] img, [data-testid="pick-line-0"] .w-14.h-14')).toBeTruthy();
});
