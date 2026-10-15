import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { OrderInvoiceNumberMarks } from "./OrderInvoiceNumberMarks";

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

test("draft TA number is hidden on the list", () => {
  render(
    <OrderInvoiceNumberMarks
      ord={{
        order_number: "B2B-1",
        is_invoiced: false,
        invoice_id: "inv1",
        invoice_number: "TA2026000000001",
      }}
    />,
  );
  expect(host.textContent).not.toContain("TA2026000000001");
  expect(host.querySelector("[data-testid='order-local-no-B2B-1']")).toBeNull();
  const titles = [...host.querySelectorAll("[title]")].map((el) => el.getAttribute("title") || "").join(" ");
  expect(titles).not.toContain("TA2026000000001");
  expect(host.innerHTML).not.toContain("TA2026000000001");
});

test("OrdersB2BPage paper invoice row shows Fatura TA and never GİB", () => {
  render(
    <OrderInvoiceNumberMarks
      ord={{
        order_number: "B2B-2026-0080",
        e_type: "paper",
        einvoice_state: "paper",
        is_invoiced: true,
        invoice_number: "TA2026000000069",
        gib_status: "Kağıt Fatura (Matbu)",
      }}
    />,
  );
  expect(host.textContent).toContain("Fatura: TA2026000000069");
  expect(host.textContent).not.toMatch(/GİB:/);
  expect(host.querySelector("[data-testid='order-gib-no-B2B-2026-0080']")).toBeNull();
  expect(host.querySelector("[data-testid='order-local-no-B2B-2026-0080']")).toBeTruthy();
});

test("official integrator number is the only GİB label", () => {
  render(
    <OrderInvoiceNumberMarks
      ord={{
        order_number: "B2B-1",
        e_type: "e_invoice",
        einvoice_state: "sent",
        gib_invoice_id: "U052026000000090",
        is_invoiced: true,
        local_invoice_number: "TA2026000000001",
        invoice_number: "U052026000000090",
      }}
    />,
  );
  expect(host.textContent).toContain("GİB: U052026000000090");
  expect(host.textContent).toContain("Fatura: TA2026000000001");
});
