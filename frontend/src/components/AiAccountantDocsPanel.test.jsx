import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AiAccountantDocsPanel } from "./AiAccountantDocsPanel";

jest.mock("axios", () => {
  const get = jest.fn(() => Promise.resolve({ data: [] }));
  const post = jest.fn(() => Promise.resolve({ data: {} }));
  const api = { get, post };
  api.default = api;
  return api;
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ addonOn: () => true }),
}));
jest.mock("../hooks/useAiStatus", () => ({
  useAiStatus: () => ({ extractLabel: "GPT", ready: true, configured: true, enabled: true }),
}));
jest.mock("./AiInvoiceImportModal", () => ({ AiInvoiceImportModal: () => null }));
jest.mock("./CardStatementImport", () => ({ CardStatementImport: () => null }));
jest.mock("./SearchSelect", () => ({ SearchSelect: () => null }));

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

test("mali müşavir AI evrak paneli tüm türleri ve dropzone'u gösterir", async () => {
  await act(async () => {
    createRoot(host).render(<AiAccountantDocsPanel companyId="c1" />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(host.querySelector('[data-testid="acc-ai-docs"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="acc-ai-dropzone"]')).not.toBeNull();
  expect(host.textContent).toContain("AI ile evrak yükle");
  for (const id of ["purchase", "sales", "expense", "cheque", "bank"]) {
    expect(host.querySelector(`[data-testid="acc-ai-kind-${id}"]`)).not.toBeNull();
  }
});
