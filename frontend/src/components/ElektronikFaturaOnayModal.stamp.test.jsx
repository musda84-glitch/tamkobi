import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { ElektronikFaturaOnayModal } from "./ElektronikFaturaOnayModal";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockResolvedValue({
    data: { balance: 10, source: "wallet", is_e_invoice_user: false, suggested_e_type: "e_archive" },
  });
});

afterEach(() => {
  host.remove();
  jest.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("single invoice in invoices[] shows stamp checkbox", async () => {
  const root = createRoot(host);
  const inv = { id: "inv1", invoice_number: "F1", issue_date: "2026-10-12", contact_name: "Cari" };
  await act(async () => {
    root.render(
      <ElektronikFaturaOnayModal
        mode="send"
        invoices={[inv]}
        contacts={[]}
        companyId="c1"
        onClose={() => {}}
        onConfirm={async () => {}}
      />,
    );
  });
  await flush();
  expect(host.querySelector('[data-testid="efatura-onay-stamp-now"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="efatura-onay-stamp-now-check"]')?.checked).toBe(true);
  expect(host.querySelector('[data-testid="efatura-onay-bulk-preview"]')).toBeNull();
});

test("two invoices hide stamp checkbox and show bulk preview", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ElektronikFaturaOnayModal
        mode="send"
        invoices={[
          { id: "a", invoice_number: "F1", issue_date: "2026-09-01" },
          { id: "b", invoice_number: "F2", issue_date: "2026-09-02" },
        ]}
        contacts={[]}
        companyId="c1"
        onClose={() => {}}
        onConfirm={async () => {}}
      />,
    );
  });
  await flush();
  expect(host.querySelector('[data-testid="efatura-onay-stamp-now"]')).toBeNull();
  expect(host.querySelector('[data-testid="efatura-onay-bulk-preview"]')?.textContent).toMatch(/2 belge/);
});

test("old single document shows orange GİB date warning", async () => {
  const root = createRoot(host);
  const old = "2000-01-15";
  await act(async () => {
    root.render(
      <ElektronikFaturaOnayModal
        mode="send"
        invoice={{ id: "inv1", invoice_number: "F1", issue_date: old }}
        invoices={[{ id: "inv1", invoice_number: "F1", issue_date: old }]}
        contacts={[]}
        companyId="c1"
        onClose={() => {}}
        onConfirm={async () => {}}
      />,
    );
  });
  await flush();
  const warn = host.querySelector('[data-testid="efatura-onay-old-date-warn"]');
  expect(warn).not.toBeNull();
  expect(warn.textContent).toMatch(/Belge tarihi 15\.01\.2000/);
  expect(warn.textContent).toMatch(/eski tarihle/);
  expect(host.querySelector('[data-testid="efatura-onay-stamp-now-check"]')?.checked).toBe(true);
});
