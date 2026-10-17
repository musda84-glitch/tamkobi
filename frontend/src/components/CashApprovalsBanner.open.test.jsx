/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CashApprovalsBanner } from "./CashApprovalsBanner";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  toast.error.mockClear();
});

afterEach(() => {
  host.remove();
});

async function renderBanner(focusId) {
  const root = createRoot(host);
  await act(async () => {
    root.render(<CashApprovalsBanner companyId="c1" focusId={focusId} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return root;
}

test("focus id highlights the approval row", async () => {
  axios.get.mockResolvedValue({
    data: [{ id: "req-1", kind: "virman", summary: "100 ₺", requested_by_name: "Ali", can_approve: true }],
  });
  await renderBanner("req-1");
  const row = host.querySelector('[data-testid="cash-approval-req-1"]');
  expect(row).not.toBeNull();
  expect(row.getAttribute("data-open-focus")).toBe("1");
  expect(row.className).toMatch(/ring-amber-300/);
  expect(toast.error).not.toHaveBeenCalled();
});

test("missing approval id toasts without crashing", async () => {
  axios.get.mockResolvedValue({ data: [] });
  await renderBanner("gone");
  expect(toast.error).toHaveBeenCalledWith("Kayıt bulunamadı");
  expect(host.querySelector("[data-testid='cash-approvals-banner']")).toBeNull();
});
