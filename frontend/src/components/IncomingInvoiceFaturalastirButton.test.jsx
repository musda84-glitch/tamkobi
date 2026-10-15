import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { IncomingInvoiceFaturalastirButton } from "./IncomingInvoiceFaturalastirButton";

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

const draft = {
  status: "draft",
  invoice_type: "purchase",
  e_type: "e_invoice",
  direction: "incoming",
  invoice_number: "GLN-1",
  effects_applied: false,
};

test("single click posts without an e-document type list", () => {
  const onPress = jest.fn();
  render(<IncomingInvoiceFaturalastirButton inv={draft} onPress={onPress} />);
  const btn = host.querySelector("[data-testid='incoming-faturalastir-GLN-1']");
  expect(btn).toBeTruthy();
  expect(btn.disabled).toBe(false);
  expect(btn.textContent).toMatch(/Faturalaştır/);
  expect(host.textContent).not.toMatch(/E-Fatura|E-Arşiv|Kağıt/);
  expect(host.querySelector("[data-testid*='type-']")).toBeNull();
  act(() => btn.click());
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(onPress).toHaveBeenCalledWith(draft);
});

test("already posted invoice keeps the button disabled", () => {
  const onPress = jest.fn();
  render(
    <IncomingInvoiceFaturalastirButton
      inv={{ ...draft, status: "approved", effects_applied: true, payment_status: "unpaid" }}
      onPress={onPress}
    />,
  );
  const btn = host.querySelector("[data-testid='incoming-faturalastir-GLN-1']");
  expect(btn.disabled).toBe(true);
  expect(btn.getAttribute("data-posted")).toBe("1");
  expect(btn.textContent).toMatch(/Cariye işlendi/);
  act(() => btn.click());
  expect(onPress).not.toHaveBeenCalled();
});

test("sales drafts are not this button", () => {
  render(
    <IncomingInvoiceFaturalastirButton
      inv={{ status: "draft", invoice_type: "sales", e_type: "e_archive", invoice_number: "SF-1" }}
      onPress={() => {}}
    />,
  );
  expect(host.querySelector("button")).toBeNull();
});
