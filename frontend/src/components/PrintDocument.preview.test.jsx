/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { PrintDocument } from "./PrintDocument";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => new Promise(() => {})),
    put: jest.fn(() => new Promise(() => {})),
    post: jest.fn(() => new Promise(() => {})),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

let host;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

test("sipariş formu şablon cevabını beklemeden çizilir ve satır görseli 200 px ister", async () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    name: `Ürün ${i + 1}`,
    product_id: `p${i}`,
    quantity: 1,
    unit_price: 10,
    vat_rate: 20,
    image_url: `/api/files/tamkobi/products/p${i}.jpg`,
  }));
  await act(async () => {
    root.render(
      <PrintDocument
        docType="order"
        doc={{ order_number: "S-1", items, grand_total: 80 }}
        company={{ id: "c1", name: "Firma" }}
        onClose={() => {}}
      />,
    );
  });
  expect(host.querySelector("[data-testid=print-document]")).not.toBeNull();
  const imgs = [...host.querySelectorAll("[data-testid^=print-item-image-] img")];
  expect(imgs).toHaveLength(8);
  imgs.forEach((img, i) => {
    expect(img.getAttribute("src")).toBe(`/api/files/tamkobi/products/p${i}.jpg?w=200`);
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("width")).toBe("44");
  });
  const templateCall = axios.get.mock.calls.some(([url]) => String(url).includes("print-templates"));
  expect(templateCall).toBe(true);
});
