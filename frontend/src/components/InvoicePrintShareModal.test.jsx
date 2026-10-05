import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { InvoicePrintShareModal } from "./InvoicePrintShareModal";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: new Blob(["%PDF-1.4 xxxxxxxxxxxxxxxxxxxxxxxx"], { type: "application/pdf" }), headers: {} })),
    post: jest.fn(() => Promise.resolve({ data: { message: "ok" } })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/useEscape", () => ({ useEscape: () => {} }));
jest.mock("./QuickMessageModal", () => ({
  QuickMessageModal: ({ defaultSubject }) => <div data-testid="quick-message-modal">{defaultSubject}</div>,
}));

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

const order = {
  invoice_id: "inv-1",
  e_type: "e_invoice",
  einvoice_state: "sent",
  gib_invoice_id: "U052026000000090",
  customer_name: "Acme",
  customer_phone: "05321112233",
  customer_email: "a@x.com",
  order_number: "B2B-2026-0065",
};

test("chooser offers print, email and WhatsApp — not GİB", () => {
  const onPrint = jest.fn();
  render(
    <InvoicePrintShareModal
      order={order}
      companyId="c1"
      companyName="TamKobi"
      onPrint={onPrint}
      onClose={() => {}}
    />,
  );
  const text = host.textContent;
  expect(host.querySelector('[data-testid="invoice-print-share-modal"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="invoice-print-share-print"]')?.textContent).toContain("Yazdır");
  expect(host.querySelector('[data-testid="invoice-print-share-email"]')?.textContent).toContain("E-posta");
  expect(host.querySelector('[data-testid="invoice-print-share-whatsapp"]')?.textContent).toContain("WhatsApp");
  expect(text).toMatch(/GİB gönderimi değildir/);
  expect(text).toContain("U052026000000090");
  act(() => host.querySelector('[data-testid="invoice-print-share-print"]').click());
  expect(onPrint).toHaveBeenCalledWith(expect.objectContaining({ id: "inv-1", e_type: "e_invoice" }));
});

test("e-posta tab opens message modal", async () => {
  render(
    <InvoicePrintShareModal order={order} companyId="c1" onPrint={() => {}} onClose={() => {}} />,
  );
  await act(async () => {
    host.querySelector('[data-testid="invoice-print-share-email"]').click();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(host.querySelector('[data-testid="quick-message-modal"]')?.textContent).toContain("E-Fatura");
});
