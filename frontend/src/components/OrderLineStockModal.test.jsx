/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { OrderLineStockModal } from "./OrderLineStockModal";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: {} })),
    post: jest.fn(async () => ({
      data: {
        message: "eşleştirildi",
        product: { id: "p1", name: "Kart", sku: "K1", stock_quantity: 1, unit: "Adet" },
        order: { id: "o1", items: [{ product_id: "p1" }] },
      },
    })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" } }),
}));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "" }));
jest.mock("../utils/modalBackdrop", () => ({ backdropDismissProps: () => ({}) }));
jest.mock("./ProductDetailModal", () => ({
  ProductDetailModal: ({ product }) => <div data-testid="product-detail-modal">{product.name}</div>,
}));
jest.mock("./SearchSelect", () => ({
  SearchSelect: ({ value, onChange, testId }) => (
    <select data-testid={testId} value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      <option value="p1">Kart A</option>
    </select>
  ),
}));

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.post.mockReset();
  axios.post.mockImplementation(async () => ({
    data: {
      message: "eşleştirildi",
      product: { id: "p1", name: "Kart", sku: "K1", stock_quantity: 1, unit: "Adet" },
      order: { id: "o1", items: [{ product_id: "p1" }] },
    },
  }));
});

afterEach(() => {
  host.remove();
});

test("eşleşmiş ürün stok kartı modalını açar", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <OrderLineStockModal
        order={{ id: "o1" }}
        item={{ product_name: "Mihrab", product_id: "p1", quantity: 1 }}
        itemIndex={0}
        product={{ id: "p1", name: "Mihrab Kart", sku: "M1", stock_quantity: 3, unit: "Adet" }}
        products={[]}
        companyId="c1"
        onClose={() => {}}
      />
    );
  });
  expect(host.querySelector("[data-testid='product-detail-modal']")?.textContent).toBe("Mihrab Kart");
  await act(async () => { root.unmount(); });
});

test("eşleşmemiş üründe eşleştirme API çağrılır", async () => {
  const onMatched = jest.fn();
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <OrderLineStockModal
        order={{ id: "o1", order_number: "SIP-1", channel: "trendyol" }}
        item={{ product_name: "Namaz Kıble", quantity: 1, sku: "NK" }}
        itemIndex={0}
        product={null}
        products={[{ id: "p1", name: "Kart A" }]}
        companyId="c1"
        onClose={() => {}}
        onMatched={onMatched}
      />
    );
  });
  expect(host.querySelector("[data-testid='order-line-match-modal']")).toBeTruthy();
  const sel = host.querySelector("[data-testid='order-line-match-select']");
  await act(async () => {
    sel.value = "p1";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("[data-testid='order-line-match-btn']").click();
  });
  // matchLine async; mikro görevleri boşalt
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(axios.post).toHaveBeenCalledWith("/api/orders/o1/items/match", { idx: 0, product_id: "p1" });
  expect(onMatched).toHaveBeenCalled();
  expect(host.querySelector("[data-testid='product-detail-modal']")?.textContent).toBe("Kart");
  await act(async () => { root.unmount(); });
});
