import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { CardStatementImport } from "./CardStatementImport";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({
      data: {
        statement: null,
        transactions: [{ date: "2026-03-01", description: "EFT Giden", amount: -25 }],
      },
    })),
  };
  return { __esModule: true, default: impl, ...impl };
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

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

const render = (node) => {
  const root = createRoot(host);
  act(() => root.render(node));
  return root;
};

const account = {
  id: "2e300962-e4dd-4adf-9166-9e4e27f7f54f",
  account_name: "Kuveyt Vadesiz",
  bank_name: "Kuveyt Türk",
  type: "bank",
  company_id: "c1",
};

test("Hareket Yükle modalı contacts=null iken boş sayfa yerine açılır", () => {
  render(<CardStatementImport account={account} contacts={null} onClose={() => {}} />);
  expect(host.querySelector('[data-testid="bank-statement-modal"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="panel-boundary-error"]')).toBeNull();
  expect(host.textContent).toContain("Hesap Hareketi Yükle (AI)");
});

test("analiz tıklaması tıklama olayını dosya sanmaz ve sayfayı boşaltmaz", async () => {
  const file = new File(["ekstre"], "hareket.pdf", { type: "application/pdf" });
  await act(async () => {
    render(<CardStatementImport account={account} contacts={[]} initialFile={file} onClose={() => {}} />);
  });
  const analyzeBtn = host.querySelector('[data-testid="bank-stmt-analyze"]');
  expect(analyzeBtn).not.toBeNull();
  await act(async () => {
    analyzeBtn.click();
    await Promise.resolve();
  });
  expect(host.querySelector('[data-testid="panel-boundary-error"]')).toBeNull();
  expect(host.querySelector('[data-testid="bank-statement-modal"]')).not.toBeNull();
  expect(host.textContent).toContain("Hesap Hareketi Yükle (AI)");
});
