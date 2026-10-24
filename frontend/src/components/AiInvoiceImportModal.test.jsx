/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import fs from "fs";
import path from "path";
import axios from "axios";
import { AiInvoiceImportModal } from "./AiInvoiceImportModal";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
}));

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test("model rozeti sağlayıcı adı göstermez", async () => {
  axios.get.mockResolvedValue({
    data: {
      enabled: true,
      configured: true,
      ready: true,
      extract_label: "Fatura GPT-4.1",
      badge: "Danışman rozeti kullanılmaz",
      last_test: { ok: true },
    },
  });
  await act(async () => {
    root.render(
      <AiInvoiceImportModal companyId="c1" contacts={[]} onClose={() => {}} onDone={() => {}} />,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const badge = host.querySelector("[data-testid='ai-invoice-model-badge']");
  expect(badge).not.toBeNull();
  expect(badge.textContent).toBe("Yapay zekâ");
  expect(badge.textContent).not.toContain("GPT");
  expect(badge.textContent).not.toContain("Danışman rozeti kullanılmaz");

  const src = fs.readFileSync(path.join(__dirname, "AiInvoiceImportModal.jsx"), "utf8");
  expect(src).not.toContain("GPT-4o");
  expect(src).not.toContain("GPT-4O");
});
