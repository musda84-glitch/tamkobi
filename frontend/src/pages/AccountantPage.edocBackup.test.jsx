/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";

jest.mock("axios", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
  BACKEND_URL: "http://test",
  useAuth: () => ({ activeCompany: { id: "comp_1" } }),
}));
jest.mock("../components/AiAccountantDocsPanel", () => ({ AiAccountantDocsPanel: () => null }));
jest.mock("../components/AccTaxObligationsPanel", () => ({ AccTaxObligationsPanel: () => null }));

import AccountantPage from "./AccountantPage";

const summary = {
  sales: { count: 1, subtotal: 10, vat: 2, unpaid: 0, total: 12 },
  purchases: { count: 0, subtotal: 0, vat: 0, total: 0 },
  vat: { calculated: 2, deductible: 0, carryover: 0, payable: 2, by_rate: [] },
  cash: { count: 0, inflow: 0, outflow: 0 },
  payroll: { count: 0, gross: 0, net: 0, employer_cost: 0 },
  tax_payables: { unpaid_total: 0 },
  e_docs: { gib_sent: 1, draft: 0, dispatch: 0 },
  invoices: [],
};

const preview = {
  invoice_count: 4,
  xml_count: 4,
  pdf_count: 4,
  integrator_count: 3,
  local_count: 1,
  days: 31,
  max_days: 62,
  last_backup: null,
  reminder_due: false,
};

let host;

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  jest.clearAllMocks();
  URL.createObjectURL = jest.fn(() => "blob:test");
  URL.revokeObjectURL = jest.fn();
  HTMLAnchorElement.prototype.click = jest.fn();
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/accountant/summary")) return Promise.resolve({ data: summary });
    if (String(url).includes("/accountant/edocs/export")) {
      return Promise.resolve({
        data: new Blob(["PK"]),
        headers: {
          get: (name) => ({
            "x-invoice-count": "4",
            "x-xml-count": "4",
            "x-pdf-count": "4",
            "x-integrator-count": "5",
            "x-local-count": "3",
          }[String(name).toLowerCase()]),
          "x-invoice-count": "4",
          "x-integrator-count": "5",
          "x-local-count": "3",
        },
      });
    }
    if (String(url).includes("/accountant/edocs")) return Promise.resolve({ data: preview });
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  host.remove();
});

test("preview shows integrator and local counts from the response", async () => {
  const root = createRoot(host);
  await act(async () => { root.render(<AccountantPage />); });
  await flush();
  const box = host.querySelector('[data-testid="acc-edoc-preview"]');
  expect(box.textContent).toContain("4");
  expect(host.querySelector('[data-testid="acc-edoc-integrator"]').textContent).toContain("Entegratörden alınacak");
  expect(host.querySelector('[data-testid="acc-edoc-integrator"]').textContent).toContain("3");
  expect(host.querySelector('[data-testid="acc-edoc-local"]').textContent).toContain("Yerel");
  expect(host.querySelector('[data-testid="acc-edoc-local"]').textContent).toContain("1");
  await act(async () => { root.unmount(); });
});

test("download toast summarizes integrator and local headers", async () => {
  const root = createRoot(host);
  await act(async () => { root.render(<AccountantPage />); });
  await flush();
  const btn = host.querySelector('[data-testid="acc-edoc-download"]');
  expect(btn.disabled).toBe(false);
  await act(async () => { btn.click(); });
  await flush();
  expect(toast.success).toHaveBeenCalled();
  const message = toast.success.mock.calls.map((c) => c[0]).join(" ");
  expect(message).toMatch(/4 belgenin XML\/PDF yedeği indirildi/);
  expect(message).toMatch(/Entegratör: 5/);
  expect(message).toMatch(/yerel: 3/);
  await act(async () => { root.unmount(); });
});
