/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { DocumentFormModal } from "./DocumentFormModal";
import { DocumentLineEditor } from "./DocumentLineEditor";
import { resetBodyScrollLockForTests } from "../utils/documentEditorLayout";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(),
    defaults: {},
    isCancel: () => false,
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" } }),
}));

let host;
let root;

beforeEach(() => {
  resetBodyScrollLockForTests();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: [] });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.innerHTML = "";
  resetBodyScrollLockForTests();
});

function render(node) {
  root = createRoot(host);
  return act(async () => { root.render(node); });
}

test("modal gövdeyi kilitler, kalemler ayrı kayar, Kaydet altta kalır", async () => {
  const rows = Array.from({ length: 42 }, (_, i) => (
    <tr key={i} data-testid={`line-${i}`}><td>Kalem {i + 1}</td></tr>
  ));
  await render(
    <DocumentFormModal
      as="form"
      testId="new-invoice-modal"
      header={<div>Belge türü ve tarih</div>}
      footer={<button type="submit" data-testid="save-invoice-btn">Kaydet</button>}
    >
      <table><tbody>{rows}</tbody></table>
    </DocumentFormModal>
  );
  const panel = document.querySelector("[data-testid='new-invoice-modal']");
  const lines = document.querySelector("[data-testid='new-invoice-modal-lines']");
  const footer = document.querySelector("[data-testid='new-invoice-modal-footer']");
  expect(panel.className).toContain("doc-editor-modal");
  expect(lines.getAttribute("data-doc-lines")).not.toBeNull();
  expect(getComputedStyle(lines).overflowY === "auto" || lines.style.overflowY === "auto" || lines.className.includes("doc-editor-lines")).toBe(true);
  expect(footer.querySelector("[data-testid='save-invoice-btn']")).not.toBeNull();
  expect(lines.querySelectorAll("tr")).toHaveLength(42);
  expect(document.body.style.overflow).toBe("hidden");
  expect(document.body.style.touchAction).not.toBe("none");
});

test("ürün seçimi portalda açılır, kalem kaydırma kutusunun içinde kesilmez", async () => {
  await render(
    <DocumentFormModal
      testId="new-invoice-modal"
      header={<div>Başlık</div>}
      footer={<button type="button" data-testid="save-invoice-btn">Kaydet</button>}
    >
      <DocumentLineEditor
        items={[{ name: "", product_name: "", product_id: "", quantity: 1, unit: "Adet", unit_price: 10, vat_rate: 20, is_service: false }]}
        onChange={() => {}}
        products={[{ id: "p1", name: "Defter", sku: "D1", unit: "Adet", stock_quantity: 4, sale_price: 12 }]}
        kind="invoice"
        testIdPrefix="inv-item"
      />
    </DocumentFormModal>
  );
  const trigger = document.querySelector("[data-testid='inv-item-product-0-trigger']");
  expect(trigger).not.toBeNull();
  await act(async () => { trigger.click(); });
  const menu = document.querySelector("[data-testid='inv-item-product-0-menu']");
  expect(menu).not.toBeNull();
  const lines = document.querySelector("[data-doc-lines]");
  expect(lines.contains(menu)).toBe(false);
  expect(menu.className).toContain("z-[280]");
  expect(menu.parentElement).toBe(document.body);
});
