import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { InvoiceOrderMismatchBadge } from "./InvoiceOrderMismatchBadge";

let host;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

const render = (node) => {
  const root = createRoot(host);
  act(() => root.render(node));
  return root;
};

test("order list shows invoice mismatch badge", () => {
  render(
    <InvoiceOrderMismatchBadge
      ord={{
        order_number: "B2B-2026-0080",
        grand_total: 100,
        invoice_mismatch_warning: "Fatura siparişten farklı (Fatura: 1.250,50 TL)",
      }}
    />,
  );
  const badge = host.querySelector("[data-testid='invoice-order-mismatch-B2B-2026-0080']");
  expect(badge).not.toBeNull();
  expect(badge.textContent).toBe("Fatura siparişten farklı (Fatura: 1.250,50 TL)");
});

test("matching totals omit the badge", () => {
  render(
    <InvoiceOrderMismatchBadge
      ord={{ order_number: "B2B-1", grand_total: 100.01 }}
    />,
  );
  expect(host.querySelector("[data-testid='invoice-order-mismatch-B2B-1']")).toBeNull();
  expect(host.textContent).not.toMatch(/Fatura siparişten farklı/);
});
