import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

jest.mock("./ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ asChild, children }) => children,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, ...rest }) => (
    <button type="button" onClick={onSelect} {...rest}>{children}</button>
  ),
}));

import { DraftInvoiceFaturalastirButton } from "./DraftInvoiceFaturalastirButton";

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

test("shows Taslağı faturalaştır only for sales drafts", () => {
  render(
    <DraftInvoiceFaturalastirButton
      inv={{ status: "draft", invoice_type: "sales", e_type: "e_invoice", invoice_number: "T-1" }}
      onIssue={() => {}}
    />,
  );
  const btn = host.querySelector("[data-testid='draft-faturalastir-btn-T-1']");
  expect(btn).toBeTruthy();
  expect(btn.textContent).toMatch(/Taslağı faturalaştır/);
});

test("hides the button on issued invoices", () => {
  render(
    <DraftInvoiceFaturalastirButton
      inv={{
        status: "approved",
        invoice_type: "sales",
        e_type: "e_invoice",
        invoice_number: "T-2",
        einvoice_state: "sent",
        gib_uuid: "u1",
      }}
      onIssue={() => {}}
    />,
  );
  expect(host.querySelector("[data-testid='draft-faturalastir-btn-T-2']")).toBeNull();
  expect(host.textContent).not.toMatch(/Taslağı faturalaştır/);
});

test("hides the button on incoming purchase drafts", () => {
  render(
    <DraftInvoiceFaturalastirButton
      inv={{
        status: "draft",
        invoice_type: "purchase",
        e_type: "e_invoice",
        invoice_number: "T-3",
        direction: "incoming",
      }}
      onIssue={() => {}}
    />,
  );
  expect(host.querySelector("[data-testid='draft-faturalastir-btn-T-3']")).toBeNull();
});

test("type chooser reuses INVOICE_ISSUE_TYPE_OPTIONS and calls onIssue", () => {
  const onIssue = jest.fn();
  const inv = { status: "draft", invoice_type: "sales", e_type: "e_archive", invoice_number: "T-4" };
  render(<DraftInvoiceFaturalastirButton inv={inv} onIssue={onIssue} />);
  expect(host.querySelector("[data-testid='draft-faturalastir-type-auto']")).toBeTruthy();
  expect(host.querySelector("[data-testid='draft-faturalastir-type-paper']")).toBeTruthy();
  expect(host.querySelector("[data-testid='draft-faturalastir-type-e_export']")).toBeTruthy();
  act(() => {
    host.querySelector("[data-testid='draft-faturalastir-type-paper']").click();
  });
  expect(onIssue).toHaveBeenCalledWith(inv, "paper");
});
