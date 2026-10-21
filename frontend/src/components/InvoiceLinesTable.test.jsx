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
  source_channel: "shopphp",
  payment_type: "transfer",
  payment_method: "Havale",
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
  expect(host.querySelector("[data-testid=inv-general-discount-TA202600000100]").textContent)
    .toContain("Genel iskonto (havale indirimi)");
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

test("kupon indirimi Genel iskonto yazar, havale etiketi yazmaz", () => {
  renderTable({
    inv: {
      ...HAVALE_INV,
      invoice_number: "TA-KUPON",
      payment_type: "card",
      payment_method: "Kupon",
      notes: "havale kelimesi notta geçse de kupon",
      source_channel: "shopphp",
    },
    items: [HAVALE_ITEM],
  });
  const row = host.querySelector("[data-testid=inv-general-discount-TA-KUPON]");
  expect(row.textContent).toContain("Genel iskonto");
  expect(row.textContent).not.toContain("havale");
});

test("ödeme yöntemi EFT ise alt satır havale indirimi yazar", () => {
  renderTable({
    inv: { ...HAVALE_INV, invoice_number: "TA-EFT", payment_type: "", payment_method: "EFT" },
    items: [HAVALE_ITEM],
  });
  expect(host.querySelector("[data-testid=inv-general-discount-TA-EFT]").textContent)
    .toContain("Genel iskonto (havale indirimi)");
});

test("inv_01 satır iskontosu genel iskonto satırı açmaz", () => {
  renderTable({
    inv: {
      invoice_number: "NX202600000104",
      currency: "TRY",
      discount_total: 2373.75,
      subtotal: 59601.25,
      vat_total: 11920.25,
      grand_total: 71521.5,
      source_channel: "manual",
      notes: "havale",
    },
    items: [
      { name: "Kulaklık", quantity: 25, unit: "Adet", unit_price: 1899, vat_rate: 20, total: 45101.25 },
      { name: "Klavye", quantity: 10, unit: "Adet", unit_price: 1450, vat_rate: 20, total: 14500 },
    ],
  });
  expect(host.querySelector("[data-testid=inv-general-discount-NX202600000104]")).toBeNull();
  expect(host.textContent).not.toContain("İskontolu tutar");
  expect(host.querySelector("[data-testid=inv-line-NX202600000104-0]").textContent).toContain("Kulaklık");
});
