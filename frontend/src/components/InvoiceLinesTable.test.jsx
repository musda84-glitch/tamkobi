/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { InvoiceLinesTable } from "./InvoiceLinesTable";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HAVALE_ITEM = {
  name: "Ürün",
  quantity: 1,
  unit: "Adet",
  unit_price: 9999.17,
  vat_rate: 20,
  total: 9999.17,
  vat_amount: 1999.83,
  total_incl: 11999,
};

const HAVALE_INV = {
  invoice_number: "TA202600000100",
  currency: "TRY",
  general_discount_amount: 399.97,
  discount_total: 399.97,
  subtotal: 9599.2,
  vat_total: 1919.84,
  grand_total: 11519.04,
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
});

function renderTable(props) {
  act(() => {
    root.render(<InvoiceLinesTable {...props} />);
  });
}

test("havale iskontosu genel iskonto satırını ve 11.519,04 genel toplamı gösterir", () => {
  renderTable({ inv: HAVALE_INV, items: [HAVALE_ITEM] });
  expect(host.querySelector("[data-testid=inv-lines-table-TA202600000100]")).toBeTruthy();
  expect(host.querySelector("[data-testid=inv-line-TA202600000100-0]").textContent).toContain("Ürün");
  expect(host.querySelector("[data-testid=inv-general-discount-TA202600000100]").textContent).toContain("Genel iskonto");
  expect(host.querySelector("[data-testid=inv-grand-total-TA202600000100]").textContent).toMatch(/11\.519,04/);
  expect(host.textContent).toMatch(/11\.519,04\s*₺/);
  const discounted = host.querySelector("[data-testid=inv-line-discounted-TA202600000100-0]");
  expect(discounted.textContent).toMatch(/11\.519,04/);
});

test("iskontosuz faturada iskonto satırı yoktur, detail-inv testid korunur", () => {
  renderTable({
    inv: { invoice_number: "F-1", currency: "TRY", grand_total: 120, general_discount_amount: 0, discount_total: 0 },
    items: [{ name: "Kalem", quantity: 1, unit: "ad", unit_price: 100, vat_rate: 20, total: 100, total_incl: 120 }],
    prefix: "detail-inv",
  });
  expect(host.querySelector("[data-testid=detail-inv-lines-table-F-1]")).toBeTruthy();
  expect(host.querySelector("[data-testid=detail-inv-line-F-1-0]").textContent).toContain("Kalem");
  expect(host.querySelector("[data-testid=detail-inv-general-discount-F-1]")).toBeNull();
  expect(host.textContent).not.toContain("Genel iskonto");
  expect(host.textContent).not.toContain("İskontolu tutar");
});
